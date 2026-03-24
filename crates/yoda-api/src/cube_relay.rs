//! PlenumLAN relay client — background Tokio task.
//!
//! Connects outbound to the CRS WebSocket relay at
//! `wss://plenumnet.replit.app/ws/relay` and maintains a persistent
//! authenticated connection.  Inference requests from query.rs are sent
//! through the relay to the target Cube node; responses are matched back
//! to pending oneshot senders.
//!
//! Architecture:
//!   query.rs  ──mpsc──►  spawn_relay_task  ──wss──►  CRS relay  ──►  Cube node
//!   query.rs  ◄─oneshot─  spawn_relay_task  ◄─wss──  CRS relay  ◄──  Cube node
//!
//! Falls back to browser relay when disconnected or on 30 s timeout.

use futures_util::{SinkExt, StreamExt};
use rand::RngCore;
use serde::Deserialize;
use std::{collections::{HashMap, HashSet}, sync::Arc, time::Duration};
use tokio::sync::{mpsc, oneshot, RwLock};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use uuid::Uuid;

use crate::state::AppState;

// ── Public types (used by state.rs and query.rs) ───────────────────────────

/// An inference request queued by query.rs for relay delivery.
#[derive(Debug)]
pub struct RelayInferRequest {
    pub request_id: Uuid,
    pub task_id: Uuid,
    pub cube_address: String,
    pub messages: serde_json::Value,
    pub model: String,
    pub max_tokens: u32,
    pub temperature: f32,
}

/// The inference result resolved from the relay.
#[derive(Debug)]
pub struct RelayInferResult {
    pub content: String,
    pub model: String,
    pub tokens: u64,
}

/// Sender half: held in AppState.relay_tx, set to Some when relay is live.
pub type RelayTx = Arc<RwLock<Option<mpsc::Sender<RelayInferRequest>>>>;

/// Pending oneshots awaiting relay responses, keyed by request_id.
/// The inner Result carries Ok(result) on success or Err(message) on inference_error.
pub type PendingRelays = Arc<RwLock<HashMap<Uuid, oneshot::Sender<Result<RelayInferResult, String>>>>>;

/// The set of ternary addresses of live inference cube peers currently connected
/// to the relay.  Updated from auth_ok, peer_joined/left, and peer_list messages.
/// Stores all three daemons when all are online.
pub type LiveCubePeer = Arc<RwLock<HashSet<String>>>;

pub fn new_relay_tx() -> RelayTx {
    Arc::new(RwLock::new(None))
}

pub fn new_pending_relays() -> PendingRelays {
    Arc::new(RwLock::new(HashMap::new()))
}

pub fn new_live_cube_peer() -> LiveCubePeer {
    Arc::new(RwLock::new(HashSet::new()))
}

// ── Address mapping (slot → cube ternary address) ─────────────────────────
//
// Array3 address table (from PlenumNET Invariants & Handoff doc Section 3b):
//   Agent A (CRS coordinator, ports 8080/8081) → 1111111111111
//   Agent B (Worker,          ports 8082/8083) → 2111111111111
//   Agent C (Worker,          ports 8084/8085) → 3111111111111
//
// These are the deterministic addresses derived from each daemon's PT26-DSA
// identity.  Do NOT change them — port assignments and addresses are fixed.

pub fn slot_to_cube_address(slot: &str) -> &'static str {
    match slot {
        "b" => "2111111111111",
        "c" => "3111111111111",
        _   => "1111111111111",
    }
}

/// All three Array3 daemon addresses, ordered A/B/C.
/// Used for startup probing so all daemons are discovered even if CRS
/// registration returns no neighbors.
fn all_daemon_addresses() -> [&'static str; 3] {
    ["1111111111111", "2111111111111", "3111111111111"]
}

// ── Constants ─────────────────────────────────────────────────────────────

const CRS_BASE: &str = "https://plenumnet.replit.app";
const CRS_WS: &str   = "wss://plenumnet.replit.app/ws/relay";

// ── Entry point ───────────────────────────────────────────────────────────

/// Spawn the relay background task.  Call once after AppState is created.
pub fn spawn_relay_task(state: AppState) {
    tokio::spawn(async move {
        // Load or generate YODA's relay public key.
        // Uses OsRng for a cryptographically-random 32-byte throwaway key
        // when PLENUMLAN_PUBLIC_KEY is not set in the environment.
        let public_key = std::env::var("PLENUMLAN_PUBLIC_KEY").unwrap_or_else(|_| {
            let mut bytes = [0u8; 32];
            rand::rngs::OsRng.fill_bytes(&mut bytes);
            hex::encode(bytes)
        });

        let mut backoff_secs: u64 = 2;

        loop {
            // Re-register (HTTP) on every reconnect — CRS clears its in-memory
            // registry on restart (Replit restarts periodically).
            let (address, neighbors) = match register_with_crs(&state.http_client, &public_key).await {
                Ok((a, n)) => {
                    tracing::info!(address = %a, "Registered with PlenumLAN CRS");
                    (a, n)
                    // Do NOT reset backoff here — reset only after a stable session.
                }
                Err(e) => {
                    tracing::warn!(
                        error = %e,
                        backoff_secs,
                        "PlenumLAN CRS registration failed — retrying"
                    );
                    tokio::time::sleep(Duration::from_secs(backoff_secs)).await;
                    backoff_secs = (backoff_secs * 2).min(60);
                    continue;
                }
            };

            let session_result = run_relay_session(&state, &address, &public_key, neighbors, state.http_client.clone()).await;

            // Disarm relay_tx so query.rs falls back to browser relay
            *state.relay_tx.write().await = None;

            match session_result {
                Ok(()) => {
                    tracing::info!("PlenumLAN relay session ended cleanly");
                    // Clean exit: reset backoff — this was a stable session.
                    backoff_secs = 2;
                }
                Err(e) => {
                    tracing::warn!(error = %e, "PlenumLAN relay session error");
                    // Session failed — advance backoff before reconnecting.
                }
            }

            tracing::info!(backoff_secs, "PlenumLAN relay reconnecting...");
            tokio::time::sleep(Duration::from_secs(backoff_secs)).await;
            backoff_secs = (backoff_secs * 2).min(60);
        }
    });
}

// ── CRS HTTP registration ──────────────────────────────────────────────────

/// Returns (own_address, registered_neighbor_addresses).
async fn register_with_crs(
    client: &reqwest::Client,
    public_key: &str,
) -> Result<(String, Vec<String>), anyhow::Error> {
    let url = format!(
        "{}/api/salvi/inter-cube/relay/register?publicKey={}&endpoint=0.0.0.0:3000",
        CRS_BASE, public_key
    );
    let resp = client.get(&url).send().await?.error_for_status()?;
    let body: serde_json::Value = resp.json().await?;
    let address = body["address"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| anyhow::anyhow!("CRS registration response missing 'address' field"))?;

    // Collect registered neighbor addresses for peer probing.
    // The response may contain "neighbors" as an array of objects or strings.
    let neighbors: Vec<String> = body["neighbors"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|n| {
            // Format 1: {"address":"...", "registered":true}
            if let Some(addr) = n["address"].as_str() {
                let registered = n["registered"].as_bool().unwrap_or(true);
                if registered && addr != address {
                    return Some(addr.to_string());
                }
            }
            // Format 2: plain string addresses
            if let Some(addr) = n.as_str() {
                if addr != address {
                    return Some(addr.to_string());
                }
            }
            None
        })
        .collect();

    tracing::info!(
        count = neighbors.len(),
        neighbors = ?neighbors,
        "CRS registration: registered neighbor addresses"
    );

    Ok((address, neighbors))
}

// ── WebSocket session ──────────────────────────────────────────────────────

async fn run_relay_session(
    state: &AppState,
    address: &str,
    public_key: &str,
    neighbors: Vec<String>,
    http_client: reqwest::Client,
) -> Result<(), anyhow::Error> {
    let (ws_stream, _) = connect_async(CRS_WS).await?;
    let (mut sink, mut stream) = ws_stream.split();

    // ── Auth handshake (must complete within 10 s) ─────────────────────────
    let auth = serde_json::json!({
        "type": "auth",
        "address": address,
        "publicKey": public_key,
    });
    sink.send(Message::Text(auth.to_string().into())).await?;

    // ── Auth loop: handle optional challenge before auth_ok ────────────────
    // The relay may send {"type":"challenge","nonce":"..."} before auth_ok.
    // We echo the nonce back as a challenge_response (throwaway-key mode).
    // The loop runs until auth_ok or auth_fail, with a 15s overall deadline.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            anyhow::bail!("Auth handshake timed out after 15 s");
        }
        match tokio::time::timeout(remaining, stream.next()).await {
            Ok(Some(Ok(Message::Text(t)))) => {
                let v: serde_json::Value = serde_json::from_str(&t)
                    .unwrap_or(serde_json::Value::Null);
                match v["type"].as_str() {
                    Some("challenge") => {
                        let nonce = v["nonce"].as_str().unwrap_or("");
                        tracing::info!(nonce = %&nonce[..nonce.len().min(16)], "Relay challenge received — responding");
                        let resp = serde_json::json!({
                            "type": "challenge_response",
                            "nonce": nonce,
                            "signature": nonce,
                        });
                        sink.send(Message::Text(resp.to_string().into())).await?;
                    }
                    Some("auth_ok") => {
                        tracing::info!(address = %address, "PlenumLAN relay authenticated");
                        // Capture all peers already online — all 3 daemons may be connected.
                        let peers = v["connectedPeers"].as_array()
                            .or_else(|| v["peers"].as_array())
                            .or_else(|| v["online"].as_array());
                        if let Some(peers) = peers {
                            let mut live = state.live_cube_peer.write().await;
                            for peer in peers {
                                if let Some(addr) = peer.as_str() {
                                    if addr != address {
                                        tracing::info!(peer = %addr, "Live cube peer discovered from auth_ok");
                                        live.insert(addr.to_string());
                                    }
                                }
                            }
                            tracing::info!(count = live.len(), "Live cube peers after auth_ok");
                        }
                        break;
                    }
                    Some("auth_fail") => {
                        anyhow::bail!("PlenumLAN auth_fail: {}", v["error"].as_str().unwrap_or("unknown"));
                    }
                    _ => {
                        tracing::warn!(msg = %t, "Unexpected auth handshake message — ignoring");
                    }
                }
            }
            Ok(Some(Ok(_))) => { /* ignore non-text frames during auth */ }
            Ok(Some(Err(e))) => anyhow::bail!("WS error during auth: {e}"),
            Ok(None) => anyhow::bail!("Connection closed before auth_ok"),
            Err(_) => anyhow::bail!("Auth handshake timed out"),
        }
    }

    // ── Arm relay_tx ───────────────────────────────────────────────────────
    let (req_tx, mut req_rx) = mpsc::channel::<RelayInferRequest>(32);
    *state.relay_tx.write().await = Some(req_tx);
    tracing::info!("PlenumLAN relay armed — inference requests will route through CRS");

    // ── Probe all known Array3 daemon addresses to discover live peers ────────
    // The relay may not send peer-join notifications, so we send a minimal
    // inference probe to each known daemon address.  When the daemon is online
    // it responds with inference_response; the `from` field is captured by
    // handle_inbound and inserted into live_cube_peer.
    {
        let mut probed_now: Vec<&str> = Vec::new();
        // First: probe the CRS-registered neighbors (may include YODA itself)
        for neighbor in &neighbors {
            if neighbor != address {
                probed_now.push(neighbor.as_str());
            }
        }
        // Second: always probe all three known Array3 addresses regardless of
        // CRS response, so we don't miss any daemon that is online but whose
        // registration hasn't appeared in the CRS neighbor list yet.
        for &known_addr in all_daemon_addresses().iter() {
            if known_addr != address && !probed_now.contains(&known_addr) {
                probed_now.push(known_addr);
            }
        }

        tracing::info!(count = probed_now.len(), addresses = ?probed_now, "Probing Array3 daemon addresses");
        for target in &probed_now {
            let probe_id = uuid::Uuid::new_v4().to_string();
            let probe_payload = serde_json::json!({
                "requestId": probe_id,
                "messages": [{"role": "user", "content": "ping"}],
                "maxTokens": 1,
                "model": "local",
                "temperature": 0,
            });
            let probe_envelope = serde_json::json!({
                "type": "relay",
                "to": target,
                "msgType": "inference_request",
                "payload": probe_payload.to_string(),
            });
            tracing::debug!(to = %target, probe_id = %probe_id, "Sending startup probe");
            let _ = sink.send(Message::Text(probe_envelope.to_string().into())).await;
        }
    }

    // Track probed addresses for the re-probe interval logic.
    let mut probed: HashSet<String> = neighbors.iter().cloned().collect();
    for &a in all_daemon_addresses().iter() {
        probed.insert(a.to_string());
    }

    // ── Main loop ──────────────────────────────────────────────────────────
    let mut ping_interval    = tokio::time::interval(Duration::from_secs(25));
    // Reprobe backs off exponentially: 60s, 120s, 240s … up to 10 min.
    // After 6 consecutive full-failure cycles we stop probing entirely and
    // rely on peer_joined events (which the relay sends automatically when
    // any daemon reconnects).  This avoids flooding the relay queue.
    let mut reprobe_secs: u64 = 60;
    let mut reprobe_fail_count: u32 = 0;
    let mut reprobe_deadline = tokio::time::Instant::now() + Duration::from_secs(reprobe_secs);
    ping_interval.tick().await;    // discard the immediate first tick
    let mut last_pong_at = std::time::Instant::now();

    let result = loop {
        tokio::select! {
            // Outbound: relay an inference request to the Cube node
            Some(req) = req_rx.recv() => {
                let payload = serde_json::json!({
                    "requestId": req.request_id.to_string(),
                    "messages": req.messages,
                    "maxTokens": req.max_tokens,
                    "model": req.model,
                    "temperature": req.temperature,
                });
                let envelope = serde_json::json!({
                    "type": "relay",
                    "to": req.cube_address,
                    "msgType": "inference_request",
                    "payload": payload.to_string(),
                });
                if let Err(e) = sink.send(Message::Text(envelope.to_string().into())).await {
                    break Err(e.into());
                }
                tracing::debug!(
                    request_id = %req.request_id,
                    to = %req.cube_address,
                    "inference_request sent via PlenumLAN relay"
                );
            }

            // Inbound: messages from the CRS relay
            msg = stream.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        // auth_fail after session start is fatal — terminate so
                        // the outer loop can re-register and re-auth.
                        let v: serde_json::Value = serde_json::from_str(&text)
                            .unwrap_or(serde_json::Value::Null);
                        if v["type"].as_str() == Some("auth_fail") {
                            let reason = v["error"].as_str().unwrap_or("unknown");
                            tracing::warn!(reason = %reason, "auth_fail in session main loop — terminating");
                            break Err(anyhow::anyhow!("auth_fail: {reason}"));
                        }
                        if v["type"].as_str() == Some("pong") {
                            last_pong_at = std::time::Instant::now();
                            tracing::trace!("pong received");
                        } else {
                            // When a daemon comes back online, reset the reprobe backoff
                            // so we start probing again quickly for any remaining offline daemons.
                            if matches!(v["type"].as_str(), Some("peer_joined") | Some("peer_online") | Some("peer_connected")) {
                                reprobe_fail_count = 0;
                                reprobe_secs = 60;
                                reprobe_deadline = tokio::time::Instant::now() + Duration::from_secs(10);
                            }
                            handle_inbound(state, &text, address).await;
                        }
                    }
                    Some(Ok(Message::Pong(_))) => {
                        last_pong_at = std::time::Instant::now();
                    }
                    Some(Ok(Message::Ping(data))) => {
                        if let Err(e) = sink.send(Message::Pong(data)).await {
                            break Err(e.into());
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        tracing::info!("PlenumLAN relay WebSocket closed by server");
                        break Ok(());
                    }
                    Some(Err(e)) => break Err(e.into()),
                    _ => {}
                }
            }

            // Periodic re-probe — exponential backoff, stops after 6 full-failure cycles.
            // Probe type: mesh_ping (lightweight, not queued by relay like inference_request).
            // Relies on peer_joined events as the primary discovery mechanism once all
            // daemons are confirmed offline; probing is just an early-reconnect optimisation.
            _ = tokio::time::sleep_until(reprobe_deadline) => {
                let live_count = state.live_cube_peer.read().await.len();
                if live_count >= 3 {
                    // All daemons live — reset backoff and wait.
                    reprobe_fail_count = 0;
                    reprobe_secs = 60;
                    reprobe_deadline = tokio::time::Instant::now() + Duration::from_secs(reprobe_secs);
                } else if reprobe_fail_count >= 6 {
                    // Gave up probing — relay peer_joined will wake us when a daemon connects.
                    // Check again in 10 min in case peer_joined was missed.
                    reprobe_deadline = tokio::time::Instant::now() + Duration::from_secs(600);
                    tracing::debug!("Reprobe suspended — waiting for peer_joined events");
                } else {
                    tracing::info!(live = live_count, backoff_secs = reprobe_secs,
                                   fail_cycle = reprobe_fail_count,
                                   "Re-probing Array3 addresses for offline daemons");
                    let live_now = state.live_cube_peer.read().await.clone();
                    let mut any_sent = false;
                    for &known_addr in all_daemon_addresses().iter() {
                        if known_addr != address && !live_now.contains(known_addr) {
                            // Use mesh_ping — lighter weight, relay does not queue pings for
                            // offline targets (returns undelivered immediately).
                            let ping_envelope = serde_json::json!({
                                "type": "relay",
                                "to": known_addr,
                                "msgType": "mesh_ping",
                                "payload": serde_json::json!({"nonce": uuid::Uuid::new_v4().to_string()}).to_string(),
                            });
                            if sink.send(Message::Text(ping_envelope.to_string().into())).await.is_ok() {
                                any_sent = true;
                            }
                        }
                    }
                    if any_sent {
                        reprobe_fail_count += 1;
                    }
                    // Exponential backoff: 60s → 120s → 240s → 480s → 600s cap
                    reprobe_secs = (reprobe_secs * 2).min(600);
                    reprobe_deadline = tokio::time::Instant::now() + Duration::from_secs(reprobe_secs);
                }
            }

            // Keepalive: WebSocket ping + HTTP heartbeat to CRS
            _ = ping_interval.tick() => {
                // If we haven't seen a pong in 75 s (3 missed ping cycles), reconnect.
                if last_pong_at.elapsed() > Duration::from_secs(75) {
                    tracing::warn!("PlenumLAN relay stale — no pong for 75 s, reconnecting");
                    break Err(anyhow::anyhow!("stale connection: no pong for 75 s"));
                }
                if let Err(e) = sink.send(Message::Text(r#"{"type":"ping"}"#.into())).await {
                    break Err(e.into());
                }
                // HTTP heartbeat keeps YODA's CRS registration alive (5-min TTL).
                let hb_url = format!(
                    "{}/api/salvi/inter-cube/relay/heartbeat?address={}&publicKey={}",
                    CRS_BASE, address, public_key
                );
                let _ = state.http_client.get(&hb_url).send().await;
            }
        }
    };

    // Prune pending_relays that are now stranded (Cube node unreachable).
    // Their oneshot receivers will resolve as Err, which query.rs treats as
    // a send failure and surfaces to the browser relay fallback.
    {
        let mut pending = state.pending_relays.write().await;
        let n = pending.len();
        pending.clear();
        if n > 0 {
            tracing::warn!(pruned = n, "Cleared stranded pending relay requests on session teardown");
        }
    }

    // Clear live peers — the relay session is gone, all peers are unreachable.
    // They will be re-discovered on reconnect via auth_ok + startup probes.
    state.live_cube_peer.write().await.clear();

    result
}

// ── Inbound message dispatcher ─────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct RelayEnvelope {
    #[serde(rename = "type")]
    kind: String,
    #[serde(rename = "msgType")]
    msg_type: Option<String>,
    from: Option<String>,
    payload: Option<String>,
    delivered: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct InferenceResponsePayload {
    #[serde(rename = "requestId")]
    request_id: String,
    content: String,
    model: Option<String>,
    tokens: Option<u64>,
    usage: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct InferenceErrorPayload {
    #[serde(rename = "requestId")]
    request_id: String,
    error: String,
}

async fn handle_inbound(state: &AppState, text: &str, own_address: &str) {
    let env: RelayEnvelope = match serde_json::from_str(text) {
        Ok(e) => e,
        Err(_) => {
            tracing::debug!(text = %text, "Unparseable relay envelope — skipping");
            return;
        }
    };

    match env.kind.as_str() {
        // Peer joined/left notifications — update live_cube_peer set
        "peer_joined" | "peer_online" | "peer_connected" => {
            let v: serde_json::Value = serde_json::from_str(text).unwrap_or_default();
            let addr = v["address"].as_str()
                .or_else(|| v["peer"].as_str())
                .or_else(|| env.from.as_deref());
            if let Some(addr) = addr {
                if addr != own_address {
                    tracing::info!(peer = %addr, "Live cube peer joined relay");
                    state.live_cube_peer.write().await.insert(addr.to_string());
                }
            }
        }
        "peer_left" | "peer_offline" | "peer_disconnected" => {
            let v: serde_json::Value = serde_json::from_str(text).unwrap_or_default();
            let addr = v["address"].as_str()
                .or_else(|| v["peer"].as_str())
                .or_else(|| env.from.as_deref());
            if let Some(addr) = addr {
                let removed = state.live_cube_peer.write().await.remove(addr);
                if removed {
                    tracing::info!(peer = %addr, "Live cube peer left relay");
                }
            }
        }
        // Relay may send a dedicated peer_list message with all online nodes
        "peer_list" | "peers" | "online_peers" => {
            let v: serde_json::Value = serde_json::from_str(text).unwrap_or_default();
            let list = v["peers"].as_array()
                .or_else(|| v["addresses"].as_array())
                .or_else(|| v["online"].as_array());
            if let Some(list) = list {
                let mut live = state.live_cube_peer.write().await;
                for peer in list {
                    if let Some(addr) = peer.as_str() {
                        if addr != own_address {
                            live.insert(addr.to_string());
                        }
                    }
                }
                tracing::info!(count = live.len(), "Live cube peers updated from peer_list");
            }
        }
        "relay" => {
            let payload_str = env.payload.as_deref().unwrap_or("{}");
            match env.msg_type.as_deref() {
                Some("inference_response") => {
                    let Ok(payload) = serde_json::from_str::<InferenceResponsePayload>(payload_str)
                    else {
                        tracing::warn!(from = ?env.from, "inference_response: invalid payload JSON");
                        return;
                    };
                    let Ok(request_id) = payload.request_id.parse::<Uuid>() else {
                        tracing::warn!("inference_response: invalid requestId UUID");
                        return;
                    };
                    // Confirm the sender's address as a live cube peer
                    if let Some(from) = &env.from {
                        if from != own_address {
                            state.live_cube_peer.write().await.insert(from.clone());
                        }
                    }
                    let result = RelayInferResult {
                        content: payload.content,
                        model: payload.model.unwrap_or_else(|| "local".into()),
                        tokens: payload.tokens
                            .or_else(|| {
                                // Fall back to usage.completion_tokens if present
                                payload.usage.as_ref()
                                    .and_then(|u| u["completion_tokens"].as_u64())
                            })
                            .unwrap_or(0),
                    };
                    let mut pending = state.pending_relays.write().await;
                    if let Some(sender) = pending.remove(&request_id) {
                        let _ = sender.send(Ok(result));
                        tracing::info!(request_id = %request_id, "inference_response resolved via relay");
                    } else {
                        tracing::warn!(request_id = %request_id, "No pending relay for inference_response");
                    }
                }
                Some("inference_error") => {
                    let Ok(payload) = serde_json::from_str::<InferenceErrorPayload>(payload_str)
                    else {
                        tracing::warn!(from = ?env.from, "inference_error: invalid payload JSON");
                        return;
                    };
                    let Ok(request_id) = payload.request_id.parse::<Uuid>() else {
                        tracing::warn!("inference_error: invalid requestId UUID");
                        return;
                    };
                    let mut pending = state.pending_relays.write().await;
                    if let Some(sender) = pending.remove(&request_id) {
                        let _ = sender.send(Err(payload.error.clone()));
                        tracing::warn!(
                            request_id = %request_id,
                            error = %payload.error,
                            "inference_error received from cube — relayed to query handler"
                        );
                    } else {
                        tracing::warn!(request_id = %request_id, "No pending relay for inference_error");
                    }
                }
                other => {
                    tracing::debug!(msg_type = ?other, from = ?env.from, "Unhandled relay msgType");
                }
            }
        }
        "relay_ack" => {
            if env.delivered == Some(false) {
                // A specific message was undelivered to its target.
                // We don't know which peer failed from the ack alone, so we
                // log a warning but leave the live set intact for other peers.
                // Fast-fail pending relay requests so the query handler falls back quickly.
                tracing::warn!("Relay message undelivered — target Cube node may be offline");
                let mut pending = state.pending_relays.write().await;
                for (_, sender) in pending.drain() {
                    let _ = sender.send(Err("Cube node offline — falling back to browser relay".into()));
                }
            }
        }
        "pong" => {}
        other => {
            tracing::info!(kind = %other, raw = %text, "Unrecognised relay message — logging for peer discovery debug");
        }
    }
}
