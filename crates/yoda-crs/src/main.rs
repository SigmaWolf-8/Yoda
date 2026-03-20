use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use inter_cube::{CubeRegistrationService, CubeAddr};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, postgres::PgPoolOptions, Row};
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{Arc, Mutex, RwLock},
    time::Duration,
};
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;

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
    db: PgPool,
}

// ── Request/response types ────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtendedRegisterRequest {
    endpoint: String,
    public_key: String,
    address: Option<Vec<u8>>,
    session_token: Option<String>,
}

#[derive(Deserialize)]
struct HeartbeatRequest {
    address: Vec<u8>,
    endpoint: String,
}

// ── DB helpers (runtime queries — no compile-time table check) ────────────────

async fn db_upsert_registration(
    db: &PgPool,
    endpoint: &str,
    public_key: &str,
    address_str: &str,
    session_token: Option<&str>,
) {
    let id = Uuid::new_v4();
    let _ = sqlx::query(
        r#"
        INSERT INTO crs_registrations
            (id, endpoint, public_key, address_str, session_token, last_heartbeat)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (address_str) DO UPDATE SET
            endpoint       = EXCLUDED.endpoint,
            session_token  = COALESCE(EXCLUDED.session_token, crs_registrations.session_token),
            last_heartbeat = NOW()
        "#,
    )
    .bind(id)
    .bind(endpoint)
    .bind(public_key)
    .bind(address_str)
    .bind(session_token)
    .execute(db)
    .await;
}

async fn db_update_session_token(db: &PgPool, address_str: &str, token: &str) {
    let _ = sqlx::query(
        "UPDATE crs_registrations SET session_token = $1 WHERE address_str = $2",
    )
    .bind(token)
    .bind(address_str)
    .execute(db)
    .await;
}

async fn db_heartbeat(db: &PgPool, address_str: &str) {
    let _ = sqlx::query(
        "UPDATE crs_registrations SET last_heartbeat = NOW() WHERE address_str = $1",
    )
    .bind(address_str)
    .execute(db)
    .await;
}

async fn db_prune_stale(db: &PgPool) {
    let _ = sqlx::query(
        "DELETE FROM crs_registrations WHERE last_heartbeat < NOW() - INTERVAL '5 minutes'",
    )
    .execute(db)
    .await;
}

// ── Startup: reload persisted registrations ───────────────────────────────────

async fn reload_registrations(
    db: &PgPool,
    crs: &Mutex<CubeRegistrationService>,
    sessions: &SessionStore,
) {
    db_prune_stale(db).await;

    let rows = match sqlx::query(
        "SELECT endpoint, public_key, address_str, session_token \
         FROM crs_registrations \
         WHERE last_heartbeat > NOW() - INTERVAL '5 minutes'",
    )
    .fetch_all(db)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("[yoda-crs] Could not load persisted registrations: {e}");
            return;
        }
    };

    let count = rows.len();
    for row in rows {
        let endpoint_str: String = row.get("endpoint");
        let public_key_str: String = row.get("public_key");
        let prev_address: String = row.get("address_str");
        let session_token: Option<String> = row.get("session_token");

        let Ok(endpoint) = endpoint_str.parse::<SocketAddr>() else { continue };
        let public_key = public_key_str.as_bytes().to_vec();

        // Re-register; CRS may assign a different address — that's acceptable.
        // The PlenumNET daemon will heartbeat with the old address (which will 404),
        // causing it to re-register automatically and get the updated address.
        let result = {
            let mut lock = crs.lock().unwrap();
            lock.register(endpoint, public_key, None)
        };

        match result {
            Ok(reg) => {
                let new_address = format!("{}", reg.address);
                // Update DB with potentially new address
                let _ = sqlx::query(
                    "UPDATE crs_registrations SET address_str = $1 WHERE address_str = $2",
                )
                .bind(&new_address)
                .bind(&prev_address)
                .execute(db)
                .await;

                if let Some(token) = session_token {
                    sessions.write().unwrap().insert(
                        token,
                        SessionEntry::Registered { address: new_address },
                    );
                }
            }
            Err(e) => {
                tracing::warn!("[yoda-crs] Could not re-register {endpoint}: {e:?}");
            }
        }
    }

    if count > 0 {
        tracing::info!("[yoda-crs] Reloaded {count} persisted registration(s) from DB");
    }
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

    if let Some(ref token) = req.session_token {
        if !token.is_empty() {
            let mut sessions = state.sessions.write().unwrap();
            sessions.entry(token.clone()).or_insert(SessionEntry::Pending);
        }
    }

    let result = {
        let mut crs = state.crs.lock().unwrap();
        crs.register(endpoint, public_key, specific_addr)
    };

    match result {
        Ok(reg) => {
            let address_str = format!("{}", reg.address);

            // Persist so registration survives a CRS restart
            db_upsert_registration(
                &state.db,
                &req.endpoint,
                &req.public_key,
                &address_str,
                req.session_token.as_deref(),
            )
            .await;

            if let Some(ref token) = req.session_token {
                if !token.is_empty() {
                    state.sessions.write().unwrap().insert(
                        token.clone(),
                        SessionEntry::Registered { address: address_str.clone() },
                    );
                    db_update_session_token(&state.db, &address_str, token).await;
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
        let address_str = format!("{}", addr);
        db_heartbeat(&state.db, &address_str).await;
        Ok(Json(serde_json::json!({"ok": true})))
    } else {
        Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Address not registered"})),
        ))
    }
}

async fn crs_stats(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
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
    // Check in-memory sessions first
    {
        let sessions = state.sessions.read().unwrap();
        if let Some(entry) = sessions.get(&token) {
            return match entry {
                SessionEntry::Registered { address } => {
                    Json(serde_json::json!({"status": "registered", "address": address}))
                }
                SessionEntry::Pending => Json(serde_json::json!({"status": "pending"})),
            };
        }
    }

    // Fall back to DB (survives CRS restart — heartbeat must be recent)
    match sqlx::query(
        "SELECT address_str FROM crs_registrations \
         WHERE session_token = $1 AND last_heartbeat > NOW() - INTERVAL '5 minutes' \
         LIMIT 1",
    )
    .bind(&token)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => {
            let address: String = row.get("address_str");
            state.sessions.write().unwrap().insert(
                token,
                SessionEntry::Registered { address: address.clone() },
            );
            Json(serde_json::json!({"status": "registered", "address": address}))
        }
        _ => Json(serde_json::json!({"status": "pending"})),
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

    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set");

    let db = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .expect("[yoda-crs] Failed to connect to PostgreSQL");

    tracing::info!("[yoda-crs] Connected to PostgreSQL");

    let crs = Mutex::new(CubeRegistrationService::new());
    let sessions: SessionStore = Arc::new(RwLock::new(HashMap::new()));

    reload_registrations(&db, &crs, &sessions).await;

    let state = Arc::new(AppState {
        crs,
        sessions,
        db: db.clone(),
    });

    // Background: prune stale registrations every 60 s
    {
        let db_bg = db.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(60)).await;
                db_prune_stale(&db_bg).await;
            }
        });
    }

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/salvi/inter-cube/crs/register", post(crs_register))
        .route("/api/salvi/inter-cube/crs/heartbeat", post(crs_heartbeat))
        .route("/api/salvi/inter-cube/crs/stats", get(crs_stats))
        .route("/api/yoda/crs/session/{token}", get(session_status))
        .layer(cors)
        .with_state(state);

    let bind = format!("0.0.0.0:{port}");
    tracing::info!("[yoda-crs] Listening on {bind}");
    let listener = tokio::net::TcpListener::bind(&bind).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
