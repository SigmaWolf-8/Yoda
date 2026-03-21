//! Cube Relay WebSocket — inference proxy bridge.
//!
//! GET /ws/cube-relay?token=JWT
//!
//! A tiny relay agent (cube-relay.mjs) runs on the user's local machine
//! alongside their Cube daemon.  It connects here, receives inference
//! requests via WebSocket, calls the local llama-server (no CORS because
//! Node.js is not a browser), and sends the result back.
//!
//! This eliminates the browser-relay CORS problem entirely.

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::Response,
};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc};
use tokio::sync::{mpsc, oneshot, RwLock};
use uuid::Uuid;

use crate::state::AppState;

// ── Shared registry types (exported so state.rs + query.rs can use them) ──

/// An in-flight inference request sent to the relay agent.
#[derive(Debug, Clone, Serialize)]
pub struct RelayInferRequest {
    #[serde(rename = "type")]
    pub kind: &'static str,         // always "infer"
    pub request_id: Uuid,
    pub task_id: Uuid,
    pub endpoint: String,
    pub messages: serde_json::Value,
    pub model: String,
    pub max_tokens: u32,
    pub temperature: f32,
}

/// The relay agent's response for a completed inference.
#[derive(Debug, Clone)]
pub struct RelayInferResult {
    pub content: String,
    pub model: String,
    pub latency_ms: u64,
}

/// Wire into AppState — one Sender per org (the most-recently connected relay wins).
pub type RelaySenders = Arc<RwLock<HashMap<Uuid, mpsc::Sender<RelayInferRequest>>>>;

/// Pending HTTP callers waiting for a relay result.
pub type PendingRelays = Arc<RwLock<HashMap<Uuid, oneshot::Sender<RelayInferResult>>>>;

pub fn new_relay_senders() -> RelaySenders {
    Arc::new(RwLock::new(HashMap::new()))
}

pub fn new_pending_relays() -> PendingRelays {
    Arc::new(RwLock::new(HashMap::new()))
}

// ── Internal wire message from relay agent ─────────────────────────────────

#[derive(Debug, Deserialize)]
struct AgentMessage {
    #[serde(rename = "type")]
    kind: String,
    request_id: Option<Uuid>,
    task_id: Option<Uuid>,
    content: Option<String>,
    model: Option<String>,
    latency_ms: Option<u64>,
    error: Option<String>,
}

// ── Query param struct ─────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct RelayQuery {
    pub token: String,
}

// ── Handler ────────────────────────────────────────────────────────────────

/// GET /ws/cube-relay?token=JWT
pub async fn ws_cube_relay_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<RelayQuery>,
    State(state): State<AppState>,
) -> Response {
    ws.on_upgrade(move |socket| handle_relay_connection(socket, params.token, state))
}

async fn handle_relay_connection(mut socket: WebSocket, token: String, state: AppState) {
    // Validate the JWT to get the org_id
    let org_id = match crate::auth::decode_access_token(&token, &state.jwt_secret) {
        Ok(claims) => claims.org_id,
        Err(_) => {
            let _ = socket.send(Message::Text(
                r#"{"type":"error","error":"invalid token"}"#.into(),
            )).await;
            return;
        }
    };

    tracing::info!(org_id = %org_id, "Cube relay agent connected");

    // Create a channel: query.rs pushes requests here, we forward them to the agent
    let (tx, mut rx) = mpsc::channel::<RelayInferRequest>(16);
    state.relay_senders.write().await.insert(org_id, tx);

    // Send a welcome message so the agent knows it's live
    let _ = socket.send(Message::Text(
        serde_json::json!({
            "type": "ready",
            "org_id": org_id,
            "message": "Cube relay connected — ready to proxy inference requests"
        })
        .to_string()
        .into(),
    )).await;

    loop {
        tokio::select! {
            // ── Outbound: relay request arriving from query.rs ──────────────
            Some(req) = rx.recv() => {
                let json = match serde_json::to_string(&req) {
                    Ok(j) => j,
                    Err(e) => {
                        tracing::warn!(error = %e, "Failed to serialize relay request");
                        continue;
                    }
                };
                if socket.send(Message::Text(json.into())).await.is_err() {
                    tracing::warn!(org_id = %org_id, "Relay socket closed while sending infer request");
                    break;
                }
            }

            // ── Inbound: result (or error) from the relay agent ─────────────
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let Ok(agent_msg) = serde_json::from_str::<AgentMessage>(&text) else {
                            tracing::warn!(text = %text, "Unparseable relay message");
                            continue;
                        };

                        match agent_msg.kind.as_str() {
                            "result" => {
                                if let Some(request_id) = agent_msg.request_id {
                                    let result = RelayInferResult {
                                        content: agent_msg.content.unwrap_or_default(),
                                        model: agent_msg.model.unwrap_or_else(|| "local".into()),
                                        latency_ms: agent_msg.latency_ms.unwrap_or(0),
                                    };
                                    // Resolve the pending oneshot waiter in query.rs
                                    if let Some(sender) = state.pending_relays.write().await.remove(&request_id) {
                                        let _ = sender.send(result);
                                    } else {
                                        tracing::warn!(request_id = %request_id, "No pending relay for this request_id");
                                    }
                                }
                            }
                            "error" => {
                                if let Some(request_id) = agent_msg.request_id {
                                    tracing::warn!(
                                        request_id = %request_id,
                                        error = ?agent_msg.error,
                                        "Relay agent reported inference error"
                                    );
                                    // Drop the sender — the awaiting query handler will hit its timeout
                                    state.pending_relays.write().await.remove(&request_id);
                                }
                            }
                            "ping" => {
                                let _ = socket.send(Message::Text(r#"{"type":"pong"}"#.into())).await;
                            }
                            _ => {}
                        }
                    }
                    Some(Ok(Message::Ping(data))) => {
                        let _ = socket.send(Message::Pong(data)).await;
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(e)) => {
                        tracing::warn!(error = %e, "Cube relay WebSocket error");
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    // Clean up — remove the relay sender so query.rs falls back to browser relay
    state.relay_senders.write().await.remove(&org_id);
    tracing::info!(org_id = %org_id, "Cube relay agent disconnected");
}
