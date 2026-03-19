//! Application state shared across all Axum handlers.

use sqlx::PgPool;
use yoda_inference_router::health::SharedHealthState;
use yoda_orchestrator::agent::AgentRegistry;

use crate::websocket::PipelineChannels;

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
        }
    }
}
