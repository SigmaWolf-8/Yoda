use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use inter_cube::{CubeRegistrationService, CubeAddr};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{Arc, Mutex, RwLock},
};
use tower_http::cors::{Any, CorsLayer};

// ── Session tracking ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
enum SessionEntry {
    Pending,
    Registered { address: String },
}

type SessionStore = Arc<RwLock<HashMap<String, SessionEntry>>>;

// ── Shared state ──────────────────────────────────────────────────────────────

struct AppState {
    crs: Mutex<CubeRegistrationService>,
    sessions: SessionStore,
}

// ── Request/response types ────────────────────────────────────────────────────

/// Standard CRS register fields plus an optional YODA session token.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtendedRegisterRequest {
    endpoint: String,
    public_key: String,
    address: Option<Vec<u8>>,
    session_token: Option<String>,
}

/// CRS heartbeat body.
#[derive(Deserialize)]
struct HeartbeatRequest {
    address: Vec<u8>,
    endpoint: String,
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "service": "yoda-crs",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

async fn crs_register(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ExtendedRegisterRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let endpoint: SocketAddr = req.endpoint.parse().map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": format!("Invalid endpoint: {e}")})),
        )
    })?;

    let public_key = req.public_key.as_bytes().to_vec();

    let specific_addr: Option<CubeAddr> = if let Some(trits) = req.address {
        let mut arr = [0u8; 13];
        for (i, &t) in trits.iter().take(13).enumerate() {
            arr[i] = t;
        }
        CubeAddr::try_from_bytes(&arr)
    } else {
        None
    };

    let result = {
        let mut crs = state.crs.lock().unwrap();
        crs.register(endpoint, public_key, specific_addr)
    };

    match result {
        Ok(reg) => {
            let address_str = format!("{}", reg.address);

            if let Some(token) = req.session_token {
                if !token.is_empty() {
                    let mut sessions = state.sessions.write().unwrap();
                    sessions.insert(
                        token,
                        SessionEntry::Registered {
                            address: address_str.clone(),
                        },
                    );
                }
            }

            let neighbors: Vec<serde_json::Value> = reg
                .neighbors
                .iter()
                .map(|n| {
                    serde_json::json!({
                        "address": format!("{}", n.addr),
                        "endpoint": n.endpoint.map(|e| e.to_string()),
                        "registered": n.endpoint.is_some(),
                    })
                })
                .collect();

            tracing::info!("[yoda-crs] Registered: {} at {}", address_str, endpoint);

            Ok(Json(serde_json::json!({
                "address": address_str,
                "neighbors": neighbors,
            })))
        }
        Err(e) => {
            tracing::error!("[yoda-crs] Registration failed: {e:?}");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": format!("{e:?}")})),
            ))
        }
    }
}

async fn crs_heartbeat(
    State(state): State<Arc<AppState>>,
    Json(req): Json<HeartbeatRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let mut arr = [0u8; 13];
    for (i, &t) in req.address.iter().take(13).enumerate() {
        arr[i] = t;
    }
    let addr = CubeAddr::try_from_bytes(&arr).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid address"})),
        )
    })?;

    let endpoint: SocketAddr = req.endpoint.parse().map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": format!("Invalid endpoint: {e}")})),
        )
    })?;

    let ok = {
        let mut crs = state.crs.lock().unwrap();
        crs.heartbeat(&addr, endpoint)
    };

    if ok {
        Ok(Json(serde_json::json!({"ok": true})))
    } else {
        Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Address not registered"})),
        ))
    }
}

async fn crs_stats(
    State(state): State<Arc<AppState>>,
) -> Json<serde_json::Value> {
    let (count, total) = {
        let crs = state.crs.lock().unwrap();
        (crs.registered_count(), inter_cube::TOTAL_VERTICES)
    };
    Json(serde_json::json!({
        "registeredCount": count,
        "totalVertices": total,
        "utilizationPercent": (count as f64 / total as f64) * 100.0,
    }))
}

async fn session_status(
    State(state): State<Arc<AppState>>,
    Path(token): Path<String>,
) -> Json<serde_json::Value> {
    let sessions = state.sessions.read().unwrap();
    match sessions.get(&token) {
        Some(SessionEntry::Registered { address }) => {
            Json(serde_json::json!({"status": "registered", "address": address}))
        }
        Some(SessionEntry::Pending) | None => {
            Json(serde_json::json!({"status": "pending"}))
        }
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    let port: u16 = std::env::var("CUBE_API_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8081);

    let crs = CubeRegistrationService::new();
    let sessions: SessionStore = Arc::new(RwLock::new(HashMap::new()));

    let state = Arc::new(AppState {
        crs: Mutex::new(crs),
        sessions,
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health))
        .route(
            "/api/salvi/inter-cube/crs/register",
            post(crs_register),
        )
        .route(
            "/api/salvi/inter-cube/crs/heartbeat",
            post(crs_heartbeat),
        )
        .route(
            "/api/salvi/inter-cube/crs/stats",
            get(crs_stats),
        )
        .route(
            "/api/yoda/crs/session/{token}",
            get(session_status),
        )
        .layer(cors)
        .with_state(state);

    let bind = format!("0.0.0.0:{port}");
    tracing::info!("[yoda-crs] Listening on {bind}");
    let listener = tokio::net::TcpListener::bind(&bind).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
