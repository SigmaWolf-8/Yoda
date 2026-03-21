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
use serde::Deserialize;
use std::{collections::HashMap, sync::Arc, time::Duration};
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
pub type PendingRelays = Arc<RwLock<HashMap<Uuid, oneshot::Sender<RelayInferResult>>>>;

pub fn new_relay_tx() -> RelayTx {
    Arc::new(RwLock::new(None))
}

pub fn new_pending_relays() -> PendingRelays {
    Arc::new(RwLock::new(HashMap::new()))
}

// ── Address mapping (slot → cube ternary address) ─────────────────────────
//
// Multi-agent table (from PlenumLAN Relay Protocol Reference):
//   Agent 0 (Engine A, ports 8080/8081) → 1111111111112
//   Agent 1 (Engine B, ports 8082/8083) → 1111111111113
//   Agent 2 (Engine C, ports 8084/8085) → 1111111111121

pub fn slot_to_cube_address(slot: &str) -> &'static str {
    match slot {
        "b" => "1111111111113",
        "c" => "1111111111121",
        _   => "1111111111112",
    }
}

// ── Constants ─────────────────────────────────────────────────────────────

const CRS_BASE: &str = "https://plenumnet.replit.app";
const CRS_WS: &str   = "wss://plenumnet.replit.app/ws/relay";

// ── Entry point ───────────────────────────────────────────────────────────

/// Spawn the relay background task.  Call once after AppState is created.
pub fn spawn_relay_task(state: AppState) {
    tokio::spawn(async move {
        // Load or generate YODA's relay key.
        // This is a throwaway key shortcut — not TL-DSA-87 compliant.
        // The CRS stores whatever string we pass and matches it on re-auth.
        let public_key = std::env::var("PLENUMLAN_PUBLIC_KEY").unwrap_or_else(|_| {
            // Derive a stable random key from the JWT secret so restarts reuse
            // the same key (prevents accumulating orphan registrations on the CRS).
            let seed = std::env::var("JWT_SECRET")
                .unwrap_or_else(|_| "yoda-relay-default-seed".into());
            format!("{:0>64}", hex::encode(seed.as_bytes()))
        });

        let mut backoff_secs: u64 = 2;

        loop {
            // Re-register (HTTP) on every reconnect — CRS clears its in-memory
            // registry on restart (Replit restarts periodically).
            let address = match register_with_crs(&state.http_client, &public_key).await {
                Ok(a) => {
                    tracing::info!(address = %a, "Registered with PlenumLAN CRS");
                    backoff_secs = 2;
                    a
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

            match run_relay_session(&state, &address, &public_key).await {
                Ok(()) => {
                    tracing::info!("PlenumLAN relay session ended cleanly");
                }
                Err(e) => {
                    tracing::warn!(error = %e, "PlenumLAN relay session error");
                }
            }

            // Disarm relay_tx so query.rs falls back to browser relay
            *state.relay_tx.write().await = None;
            tracing::info!(backoff_secs, "PlenumLAN relay reconnecting...");
            tokio::time::sleep(Duration::from_secs(backoff_secs)).await;
            backoff_secs = (backoff_secs * 2).min(60);
        }
    });
}

// ── CRS HTTP registration ──────────────────────────────────────────────────

async fn register_with_crs(
    client: &reqwest::Client,
    public_key: &str,
) -> Result<String, anyhow::Error> {
    let url = format!(
        "{}/api/salvi/inter-cube/relay/register?publicKey={}&endpoint=yoda-api",
        CRS_BASE, public_key
    );
    let resp = client.get(&url).send().await?.error_for_status()?;
    let body: serde_json::Value = resp.json().await?;
    body["address"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| anyhow::anyhow!("CRS registration response missing 'address' field"))
}

// ── WebSocket session ──────────────────────────────────────────────────────

async fn run_relay_session(
    state: &AppState,
    address: &str,
    public_key: &str,
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

    match tokio::time::timeout(Duration::from_secs(10), stream.next()).await {
        Ok(Some(Ok(Message::Text(t)))) => {
            let v: serde_json::Value = serde_json::from_str(&t)
                .unwrap_or(serde_json::Value::Null);
            match v["type"].as_str() {
                Some("auth_ok") => {
                    tracing::info!(address = %address, "PlenumLAN relay authenticated");
                }
                Some("auth_fail") => {
                    anyhow::bail!("PlenumLAN auth_fail: {}", v["error"].as_str().unwrap_or("unknown"));
                }
                _ => {
                    anyhow::bail!("Unexpected auth response: {t}");
                }
            }
        }
        Ok(Some(Ok(_))) => anyhow::bail!("Non-text message during auth handshake"),
        Ok(Some(Err(e))) => anyhow::bail!("WS error during auth: {e}"),
        Ok(None) => anyhow::bail!("Connection closed before auth_ok"),
        Err(_) => anyhow::bail!("Auth handshake timed out after 10 s"),
    }

    // ── Arm relay_tx ───────────────────────────────────────────────────────
    let (req_tx, mut req_rx) = mpsc::channel::<RelayInferRequest>(32);
    *state.relay_tx.write().await = Some(req_tx);
    tracing::info!("PlenumLAN relay armed — inference requests will route through CRS");

    // ── Main loop ──────────────────────────────────────────────────────────
    let mut ping_interval = tokio::time::interval(Duration::from_secs(25));
    ping_interval.tick().await; // discard the immediate first tick

    loop {
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
                sink.send(Message::Text(envelope.to_string().into())).await?;
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
                        handle_inbound(state, &text).await;
                    }
                    Some(Ok(Message::Ping(data))) => {
                        sink.send(Message::Pong(data)).await?;
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        tracing::info!("PlenumLAN relay WebSocket closed by server");
                        break;
                    }
                    Some(Err(e)) => return Err(e.into()),
                    _ => {}
                }
            }

            // Keepalive
            _ = ping_interval.tick() => {
                sink.send(Message::Text(r#"{"type":"ping"}"#.into())).await?;
            }
        }
    }

    Ok(())
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
}

async fn handle_inbound(state: &AppState, text: &str) {
    let env: RelayEnvelope = match serde_json::from_str(text) {
        Ok(e) => e,
        Err(_) => {
            tracing::debug!(text = %text, "Unparseable relay envelope — skipping");
            return;
        }
    };

    match env.kind.as_str() {
        "relay" => {
            if env.msg_type.as_deref() == Some("inference_response") {
                let payload_str = env.payload.as_deref().unwrap_or("{}");
                let Ok(payload) = serde_json::from_str::<InferenceResponsePayload>(payload_str)
                else {
                    tracing::warn!(from = ?env.from, "inference_response: invalid payload JSON");
                    return;
                };
                let Ok(request_id) = payload.request_id.parse::<Uuid>() else {
                    tracing::warn!("inference_response: invalid requestId UUID");
                    return;
                };
                let result = RelayInferResult {
                    content: payload.content,
                    model: payload.model.unwrap_or_else(|| "local".into()),
                    tokens: payload.tokens.unwrap_or(0),
                };
                let mut pending = state.pending_relays.write().await;
                if let Some(sender) = pending.remove(&request_id) {
                    let _ = sender.send(result);
                    tracing::info!(request_id = %request_id, "inference_response resolved via relay");
                } else {
                    tracing::warn!(request_id = %request_id, "No pending relay for request_id");
                }
            }
        }
        "relay_ack" => {
            if env.delivered == Some(false) {
                tracing::warn!("Relay message undelivered — Cube node may be offline; will timeout");
            }
        }
        "pong" => {}
        other => {
            tracing::debug!(kind = %other, "Ignoring relay message type in main loop");
        }
    }
}
