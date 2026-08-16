//! # YODA API Server
//!
//! Axum backend serving the React SPA and all API endpoints.
//!
//! Usage:
//!   cargo run --bin yoda-api                              # Start server
//!   cargo run --bin yoda-api -- --cli --task "Build X"    # CLI mode
//!
//! Copyright (c) 2026 Capomastro Holdings Ltd. — Applied Physics Division

use axum::{
    http::header::{HeaderName, CACHE_CONTROL, CONTENT_TYPE},
    http::HeaderValue,
    middleware,
    response::{IntoResponse, Response},
    routing::get,
    Json,
    Router,
};
use serde_json::json;
use sqlx::postgres::PgPoolOptions;
use std::net::SocketAddr;
use std::path::PathBuf;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

pub mod agents;
pub mod array3_installation_engine;
pub mod audit;
pub mod auth;
pub mod bible;
pub mod capability;
pub mod capomastro;
pub mod cube_relay;
pub mod error;
pub mod gate_handle;
pub mod kb;
pub mod kyokushin_brothers;
pub mod forge_routes;
pub mod install;
pub mod llm_agent_gateway;
pub mod modes;
pub mod query;
pub mod routes;
pub mod salvi_engine_routes;
pub mod security;
pub mod settings;
pub mod state;
pub mod theta;
pub mod three_factor;
pub mod websocket;

#[cfg(test)]
mod security_tests;

/// SPA shell for any path that is not a real file on disk.
///
/// This deliberately does *not* use `ServeFile`. `ServeFile` honours conditional
/// requests, and a browser reload sends `If-Modified-Since` for the URL it is
/// reloading. On a client-side route such as `/about`, `ServeDir` finds no file,
/// hands off to the not-found service, and the conditional match produces a
/// response carrying neither a body nor a `Content-Type` — which arrives at the
/// client as a bare 404. The effect was that every route except `/` broke on
/// refresh while working perfectly on first navigation, and the 404-to-200
/// rewrite below could not save it, because that rewrite keys off a
/// `text/html` content type the response did not have.
///
/// The SPA shell is tiny and must never be cached anyway, so it is always
/// returned whole, with an unconditional 200.
async fn spa_index(dist: PathBuf) -> Response {
    match tokio::fs::read(dist.join("index.html")).await {
        Ok(body) => (
            axum::http::StatusCode::OK,
            [
                (CONTENT_TYPE, "text/html; charset=utf-8"),
                (CACHE_CONTROL, "no-cache, must-revalidate"),
                // `ServeDir` overwrites this handler's status with 404 on its way
                // out, whatever we set here, so the 200 has to be restored by the
                // response middleware. This header is how it recognises the shell:
                // keying off the marker rather than off "any HTML 404" means a
                // genuine not-found elsewhere is still reported as not-found.
                (SPA_SHELL_MARKER, "1"),
            ],
            body,
        )
            .into_response(),
        Err(e) => {
            tracing::error!(error = %e, path = %dist.join("index.html").display(),
                "SPA shell missing — the frontend has not been built");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Frontend build not found. Run `npm run build` in frontend/.",
            )
                .into_response()
        }
    }
}

/// Internal marker set by [`spa_index`] and stripped before the response leaves.
const SPA_SHELL_MARKER: HeaderName = HeaderName::from_static("x-spa-shell");

async fn no_cache_static(resp: Response) -> Response {
    let mut resp = resp;
    // Restore the status `ServeDir` clobbered, then remove the marker so it is
    // never visible to a client.
    if resp.headers_mut().remove(SPA_SHELL_MARKER).is_some() {
        *resp.status_mut() = axum::http::StatusCode::OK;
    }
    let resp = resp;

    let ct = resp
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let is_html = ct.starts_with("text/html");
    let is_revalidatable = is_html
        || ct.starts_with("application/javascript")
        || ct.starts_with("text/javascript");
    if !is_revalidatable {
        return resp;
    }
    // A 404-to-200 rewrite for HTML used to live here, to undo the 404 that
    // ServeDir's not_found_service produced for client-side routes. `spa_index`
    // now returns 200 directly, so the rewrite is dead and has been removed —
    // a genuine HTML 404 should stay a 404 rather than be silently laundered.
    let mut resp = resp;
    resp.headers_mut().insert(
        CACHE_CONTROL,
        HeaderValue::from_static("no-cache, must-revalidate"),
    );
    resp
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // ── Initialize logging ───────────────────────────────────────────
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .json()
        .init();

    tracing::info!("YODA API Server starting");

    // ── Check for CLI mode ───────────────────────────────────────────
    let args: Vec<String> = std::env::args().collect();
    if args.contains(&"--cli".to_string()) {
        return run_cli(&args).await;
    }

    // ── Connect to PostgreSQL ────────────────────────────────────────
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://localhost:5432/yoda".to_string());

    tracing::info!("Connecting to PostgreSQL...");
    let db = PgPoolOptions::new()
        .max_connections(20)
        .connect(&database_url)
        .await?;

    tracing::info!("Database connected");

    // ── Run database migrations ──────────────────────────────────────
    // Root-cause fix: previously migrations ran only as a shell deploy step,
    // so a fresh DB started with no tables (the "AI agents offline / 0 agents"
    // symptom). Embed the migration run at startup. Non-fatal by design — a
    // checksum drift on an already-applied migration must not take the API
    // down, so log and continue rather than aborting the process.
    match sqlx::migrate!("../../migrations").run(&db).await {
        Ok(_) => tracing::info!("Database migrations up to date"),
        Err(e) => tracing::warn!(error = %e, "Database migration run failed — continuing"),
    }

    // ── Load agent configs ───────────────────────────────────────────
    let agents_path = std::env::var("AGENTS_COMPILED_PATH")
        .unwrap_or_else(|_| "./agents/compiled".to_string());
    let agents = yoda_orchestrator::agent::AgentRegistry::load(&PathBuf::from(&agents_path))
        .unwrap_or_else(|e| {
            tracing::warn!(error = %e, "Failed to load agents — starting with empty registry");
            yoda_orchestrator::agent::AgentRegistry::load(&PathBuf::from("/dev/null"))
                .unwrap_or_else(|_| panic!("Cannot create empty agent registry"))
        });
    tracing::info!(count = agents.count(), "Agent configs loaded");

    if agents.count() == 0 {
        tracing::warn!(
            "No agents loaded — all queries will use generic prompts. \
             Run 'bash scripts/bootstrap-agents.sh' to compile the agent roster."
        );
    }

    // ── Build app state ──────────────────────────────────────────────
    let state = state::AppState::new(db, agents);

    // ── Spawn PlenumLAN relay background task ────────────────────────
    cube_relay::spawn_relay_task(state.clone());

    // ── Spawn relay health monitor (updates engine DB every 30 s) ───
    cube_relay::spawn_relay_health_monitor(state.clone());

    // ── Probe every configured engine once, right now ────────────────
    // The background monitors only write a status on their first tick (30–60 s
    // in), so without this the UI shows "offline" for everything on boot.
    routes::spawn_startup_engine_probes(state.clone());

    // ── Initialize Kyokushin Brothers (Alpha/Beta/Gamma orchestrator) ─
    let kyokushin = kyokushin_brothers::init_kyokushin_brothers().await;

    // ── Build router ─────────────────────────────────────────────────
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Serve React SPA from frontend/dist/ — API routes registered first take priority.
    // Any path not matched by an API route falls through to the SPA's index.html.
    let frontend_dist = std::env::var("FRONTEND_DIST_PATH")
        .unwrap_or_else(|_| "./frontend/dist".to_string());
    let dist_path = PathBuf::from(&frontend_dist);
    let serve_dir = ServeDir::new(&frontend_dist)
        .not_found_service(get(move || spa_index(dist_path.clone())));

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/health", get(health))
        // array3-monitor.html is now served by the static-file fallback below.
        // Task #26: the on-disk file no longer carries a placeholder token —
        // it reads its token from localStorage via the #cfg-token panel input.
        .merge(routes::build_router(state))
        .merge(kyokushin_brothers::kyokushin_routes(kyokushin))
        .merge(forge_routes::forge_router())
        .fallback_service(serve_dir)
        .layer(middleware::map_response(no_cache_static))
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    // ── Bind and serve ───────────────────────────────────────────────
    let port: u16 = std::env::var("BIND_PORT")
        .unwrap_or_else(|_| "3000".to_string())
        .parse()?;
    // BIND_ADDR was documented in .env.example and docker-compose.yml but never
    // read — the server always listened on 0.0.0.0. That is right for a
    // container, wrong for the desktop build, which passes 127.0.0.1 so the API
    // is not published to the local network. Default stays 0.0.0.0.
    let bind_addr = std::env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0".to_string());
    let ip: std::net::IpAddr = bind_addr.parse().map_err(|_| {
        anyhow::anyhow!("BIND_ADDR is not a valid IP address: {bind_addr:?}")
    })?;
    let addr = SocketAddr::new(ip, port);

    tracing::info!("Listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

/// Health check endpoint.
async fn health() -> Json<serde_json::Value> {
    Json(json!({
        "status": "ok",
        "service": "yoda-api",
        "version": env!("CARGO_PKG_VERSION"),
        // The startup script compares this against the child it launched. A
        // port that answers is not proof that *this* build answered it: an
        // orphaned instance from an earlier run will happily reply while the
        // new binary is dying on EADDRINUSE.
        "pid": std::process::id(),
    }))
}

// ─── CLI Mode (B2.3.3) ──────────────────────────────────────────────

async fn run_cli(args: &[String]) -> anyhow::Result<()> {
    tracing::info!("Running in CLI mode");

    let task_text = args
        .iter()
        .position(|a| a == "--task")
        .and_then(|i| args.get(i + 1))
        .map(|s| s.as_str())
        .unwrap_or("Hello from YODA CLI");

    tracing::info!(task = task_text, "CLI task submitted");

    // Connect to database
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://localhost:5432/yoda".to_string());
    // _db: connection kept alive for future CLI sub-commands that query the DB directly.
    let _db = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    // Load agents
    let agents_path = std::env::var("AGENTS_COMPILED_PATH")
        .unwrap_or_else(|_| "./agents/compiled".to_string());
    let agents = yoda_orchestrator::agent::AgentRegistry::load(&PathBuf::from(&agents_path))
        .unwrap_or_else(|e| {
            tracing::warn!(error = %e, "No agents loaded");
            yoda_orchestrator::agent::AgentRegistry::load(&PathBuf::from("/dev/null")).unwrap()
        });

    println!("\n=== YODA CLI ===");
    println!("Task: {}", task_text);
    println!("Agents loaded: {}", agents.count());
    println!();

    // For now, print agent roster
    if agents.count() > 0 {
        println!("Available agents:");
        for id in agents.list_ids() {
            println!("  • {}", id);
        }
    } else {
        println!("No agents loaded. Run ./scripts/compile-agents.sh first.");
    }

    println!();
    println!("CLI four-step execution requires configured engines.");
    println!("Configure engines via the Settings page or POST /api/settings/engines/:slot");
    println!();
    println!("=== END ===");

    Ok(())
}
