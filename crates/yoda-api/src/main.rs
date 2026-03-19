//! # YODA API Server
//!
//! Axum backend serving the React SPA and all API endpoints.
//!
//! Usage:
//!   cargo run --bin yoda-api                              # Start server
//!   cargo run --bin yoda-api -- --cli --task "Build X"    # CLI mode
//!
//! Copyright (c) 2026 Capomastro Holdings Ltd. — Applied Physics Division

use axum::{routing::get, Json, Router};
use serde_json::json;
use sqlx::postgres::PgPoolOptions;
use std::net::SocketAddr;
use std::path::PathBuf;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

pub mod audit;
pub mod auth;
pub mod bible;
pub mod capability;
pub mod error;
pub mod kb;
pub mod modes;
pub mod query;
pub mod routes;
pub mod security;
pub mod settings;
pub mod state;
pub mod websocket;

#[cfg(test)]
mod security_tests;

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

    // ── Build app state ──────────────────────────────────────────────
    let state = state::AppState::new(db, agents);

    // ── Build router ─────────────────────────────────────────────────
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/health", get(health))
        .merge(routes::build_router(state))
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    // TODO: Serve React dist/ as static files via tower_http::services::ServeDir
    // when frontend/dist/ exists. For now, API-only.

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
    let db = PgPoolOptions::new()
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
