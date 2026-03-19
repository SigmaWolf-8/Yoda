//! WebSocket endpoint for real-time pipeline status.
//!
//! B5.8: GET /ws/pipeline/:project_id → upgrade to WebSocket
//!       Broadcasts: TaskStateChange, EngineActivity, StepProgress, Completion
//!       Uses tokio::sync::broadcast internally.

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    response::Response,
};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use uuid::Uuid;

use crate::state::AppState;

/// Pipeline event types sent over WebSocket.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum PipelineEvent {
    /// A task changed state.
    TaskStateChange {
        task_id: Uuid,
        task_number: String,
        from_status: String,
        to_status: String,
        timestamp: chrono::DateTime<chrono::Utc>,
    },
    /// An engine is processing a request.
    EngineActivity {
        task_id: Uuid,
        engine_slot: String,
        model_name: String,
        action: String, // "producing", "reviewing", "idle"
    },
    /// Step progress within a task.
    StepProgress {
        task_id: Uuid,
        task_number: String,
        current_step: u8,
        total_steps: u8,
        reviewers_complete: u8,
        reviewers_total: u8,
    },
    /// A task completed (FINAL or ESCALATED).
    TaskCompletion {
        task_id: Uuid,
        task_number: String,
        status: String,
        elapsed_ms: u64,
    },
    /// All tasks in the project are done.
    ProjectCompletion {
        total_tasks: usize,
        completed: usize,
        escalated: usize,
        elapsed_ms: u64,
    },
    /// Error during pipeline execution.
    PipelineError {
        task_id: Option<Uuid>,
        error: String,
    },
}

/// Channel capacity per project.
const CHANNEL_CAPACITY: usize = 256;

/// Shared broadcast channels per project.
pub type PipelineChannels = Arc<RwLock<HashMap<Uuid, broadcast::Sender<PipelineEvent>>>>;

/// Create a new shared pipeline channels map.
pub fn new_pipeline_channels() -> PipelineChannels {
    Arc::new(RwLock::new(HashMap::new()))
}

/// Get or create a broadcast channel for a project.
pub async fn get_or_create_channel(
    channels: &PipelineChannels,
    project_id: Uuid,
) -> broadcast::Sender<PipelineEvent> {
    {
        let map = channels.read().await;
        if let Some(tx) = map.get(&project_id) {
            return tx.clone();
        }
    }

    let mut map = channels.write().await;
    let (tx, _) = broadcast::channel(CHANNEL_CAPACITY);
    map.insert(project_id, tx.clone());
    tx
}

/// Emit a pipeline event to all connected WebSocket clients for a project.
pub async fn emit_event(
    channels: &PipelineChannels,
    project_id: Uuid,
    event: PipelineEvent,
) {
    let map = channels.read().await;
    if let Some(tx) = map.get(&project_id) {
        // Ignore send errors (no receivers connected)
        let _ = tx.send(event);
    }
}

/// Handle WebSocket upgrade for pipeline status.
///
/// GET /ws/pipeline/:project_id
pub async fn ws_pipeline_handler(
    ws: WebSocketUpgrade,
    Path(project_id): Path<Uuid>,
    State(state): State<AppState>,
) -> Response {
    ws.on_upgrade(move |socket| handle_ws_connection(socket, project_id, state))
}

/// Handle an individual WebSocket connection.
async fn handle_ws_connection(
    mut socket: WebSocket,
    project_id: Uuid,
    state: AppState,
) {
    tracing::info!(project_id = %project_id, "WebSocket client connected");

    // Subscribe to this project's broadcast channel
    let tx = get_or_create_channel(&state.pipeline_channels, project_id).await;
    let mut rx = tx.subscribe();

    // Send initial connection confirmation
    let welcome = serde_json::json!({
        "type": "connected",
        "project_id": project_id,
        "timestamp": chrono::Utc::now(),
    });
    if socket
        .send(Message::Text(serde_json::to_string(&welcome).unwrap_or_default().into()))
        .await
        .is_err()
    {
        return;
    }

    // Forward broadcast events to the WebSocket client
    loop {
        tokio::select! {
            // Receive event from broadcast channel → send to client
            event = rx.recv() => {
                match event {
                    Ok(pipeline_event) => {
                        let json = match serde_json::to_string(&pipeline_event) {
                            Ok(j) => j,
                            Err(e) => {
                                tracing::warn!(error = %e, "Failed to serialize pipeline event");
                                continue;
                            }
                        };
                        if socket.send(Message::Text(json.into())).await.is_err() {
                            // Client disconnected
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!(project_id = %project_id, skipped = n, "WebSocket client lagged");
                        // Continue — client will get next events
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        break;
                    }
                }
            }

            // Receive message from client (ping/pong, close, or commands)
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Ping(data))) => {
                        if socket.send(Message::Pong(data)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        break;
                    }
                    Some(Ok(Message::Text(text))) => {
                        // Client commands (future: manual intervention via WS)
                        tracing::debug!(
                            project_id = %project_id,
                            msg = %text,
                            "Received WebSocket message from client"
                        );
                    }
                    Some(Err(e)) => {
                        tracing::warn!(error = %e, "WebSocket error");
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    tracing::info!(project_id = %project_id, "WebSocket client disconnected");
}
