//! Application state shared across all Axum handlers.

use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;
use yoda_inference_router::health::SharedHealthState;
use yoda_orchestrator::agent::AgentRegistry;

use crate::websocket::PipelineChannels;
use crate::cube_relay::{LiveCubePeer, PendingRelays, RelayTx};

/// Shared application state, cloneable (all fields are Arc-like or Clone).
#[derive(Clone)]
pub struct AppState {
    /// PostgreSQL connection pool.
    pub db: PgPool,
    /// JWT signing secret.
    pub jwt_secret: String,
    /// JWT refresh signing secret.
    pub jwt_refresh_secret: String,
    /// Access token expiry in minutes.
    pub jwt_access_expiry_minutes: i64,
    /// Refresh token expiry in days.
    pub jwt_refresh_expiry_days: i64,
    /// Loaded agent configurations.
    pub agents: AgentRegistry,
    /// Engine health state (updated by background monitors).
    pub engine_health: SharedHealthState,
    /// HTTP client for inference dispatch.
    pub http_client: reqwest::Client,
    /// Path to model_lineages.json.
    pub lineages_path: String,
    /// WebSocket broadcast channels per project.
    pub pipeline_channels: PipelineChannels,
    /// PlenumLAN relay sender — Some when relay is connected, None otherwise.
    /// query.rs checks this to decide whether to route through the relay or
    /// fall back to the browser relay.
    pub relay_tx: RelayTx,
    /// Pending inference requests awaiting a relay response (keyed by request_id).
    pub pending_relays: PendingRelays,
    /// The most recently seen inference cube peer address from the relay session.
    /// Populated from auth_ok peers and peer_joined messages; cleared on relay_ack undelivered.
    pub live_cube_peer: LiveCubePeer,
    /// Cancellation tokens for active background inference tasks, keyed by task_id.
    /// Before spawning a new bg inference loop for a task, cancel the existing token
    /// (if any) and insert a fresh one. The bg loop checks this token between retries.
    pub task_cancel_tokens: Arc<RwLock<HashMap<Uuid, CancellationToken>>>,
}

impl AppState {
    /// Create app state from environment variables and a database pool.
    pub fn new(db: PgPool, agents: AgentRegistry) -> Self {
        let jwt_secret = std::env::var("JWT_SECRET")
            .unwrap_or_else(|_| "CHANGE_ME_IN_PRODUCTION".to_string());
        let jwt_refresh_secret = std::env::var("JWT_REFRESH_SECRET")
            .unwrap_or_else(|_| "CHANGE_ME_REFRESH_SECRET".to_string());
        let jwt_access_expiry_minutes: i64 = std::env::var("JWT_ACCESS_EXPIRY_MINUTES")
            .unwrap_or_else(|_| "15".to_string())
            .parse()
            .unwrap_or(15);
        let jwt_refresh_expiry_days: i64 = std::env::var("JWT_REFRESH_EXPIRY_DAYS")
            .unwrap_or_else(|_| "7".to_string())
            .parse()
            .unwrap_or(7);
        let lineages_path = std::env::var("MODEL_LINEAGES_PATH")
            .unwrap_or_else(|_| "./model_lineages.json".to_string());

        Self {
            db,
            jwt_secret,
            jwt_refresh_secret,
            jwt_access_expiry_minutes,
            jwt_refresh_expiry_days,
            agents,
            engine_health: yoda_inference_router::health::new_health_state(),
            http_client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .expect("Failed to build HTTP client"),
            lineages_path,
            pipeline_channels: crate::websocket::new_pipeline_channels(),
            relay_tx: crate::cube_relay::new_relay_tx(),
            pending_relays: crate::cube_relay::new_pending_relays(),
            live_cube_peer: crate::cube_relay::new_live_cube_peer(),
            task_cancel_tokens: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}
