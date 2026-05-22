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
    http::header::{CACHE_CONTROL, CONTENT_TYPE},
    http::HeaderValue,
    middleware,
    response::Response,
    routing::get,
    Json,
    Router,
};
use serde_json::json;
use sqlx::postgres::PgPoolOptions;
use std::net::SocketAddr;
use std::path::PathBuf;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

pub mod agents;
pub mod array3_installation_engine;
pub mod audit;
pub mod auth;
pub mod bible;
pub mod capability;
pub mod cube_relay;
pub mod error;
pub mod kb;
pub mod kyokushin_brothers;
pub mod forge_routes;
pub mod install;
pub mod llm_agent_gateway;
pub mod modes;
pub mod query;
pub mod routes;
pub mod security;
pub mod settings;
pub mod state;
pub mod websocket;

#[cfg(test)]
mod security_tests;

async fn no_cache_static(resp: Response) -> Response {
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
    let mut resp = resp;
    // ServeDir returns 404 when serving the SPA index.html fallback.
    // Replit's proxy blocks 404 responses — rewrite to 200 for HTML so
    // React Router can handle client-side paths like /kyokushin.
    if is_html && resp.status() == axum::http::StatusCode::NOT_FOUND {
        *resp.status_mut() = axum::http::StatusCode::OK;
    }
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
    let serve_dir = ServeDir::new(&frontend_dist)
        .not_found_service(ServeFile::new(format!("{}/index.html", frontend_dist)));

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
    let addr = SocketAddr::from(([0, 0, 0, 0], port));

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
