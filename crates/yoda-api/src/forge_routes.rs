// ═════════════════════════════════════════════════════════════════════════════
// FORGE HTTP ROUTES
// Thin Axum wrappers around the native Rust math implementations.
// All calculations (audit, harmony-fix, theorem register, HPTP timestamp)
// execute on the backend, NOT in the browser.
//
// To swap the underlying math crate (e.g. once the Capomastro crate lands
// in this repo), change the two lines below and the wrapper bodies adjust
// automatically.
// ═════════════════════════════════════════════════════════════════════════════

pub const FORGE_RUST_SOURCE: &str = "yoda-api::kyokushin_brothers";
use crate::kyokushin_brothers as forge_math;

use axum::{
    extract::Query,
    response::Json,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct AuditRequest {
    pub filename: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct AuditResponse {
    pub source: &'static str,
    pub findings: Vec<forge_math::HarmonyFinding>,
}

async fn audit(Json(req): Json<AuditRequest>) -> Json<AuditResponse> {
    let findings = forge_math::audit_source(&req.filename, &req.content);
    Json(AuditResponse {
        source: FORGE_RUST_SOURCE,
        findings,
    })
}

#[derive(Deserialize)]
pub struct FixRequest {
    pub content: String,
}

#[derive(Serialize)]
pub struct FixResponse {
    pub source: &'static str,
    pub fixed: String,
    pub changed: bool,
}

async fn fix(Json(req): Json<FixRequest>) -> Json<FixResponse> {
    let fixed = forge_math::apply_harmony_fixes(&req.content);
    let changed = fixed != req.content;
    Json(FixResponse {
        source: FORGE_RUST_SOURCE,
        fixed,
        changed,
    })
}

#[derive(Serialize)]
pub struct HptpResponse {
    pub source: &'static str,
    pub timestamp: String,
    pub filename_stamp: String,
}

async fn hptp() -> Json<HptpResponse> {
    Json(HptpResponse {
        source: FORGE_RUST_SOURCE,
        timestamp: forge_math::hptp_timestamp(),
        filename_stamp: forge_math::hptp_filename_stamp(),
    })
}

#[derive(Serialize)]
pub struct TheoremsResponse {
    pub source: &'static str,
    pub theorems: Vec<forge_math::Theorem>,
}

async fn theorems() -> Json<TheoremsResponse> {
    Json(TheoremsResponse {
        source: FORGE_RUST_SOURCE,
        theorems: forge_math::build_theorem_registry(),
    })
}

#[derive(Deserialize)]
pub struct RegisterQuery {
    #[serde(default = "default_mode")]
    pub mode: String,
}

fn default_mode() -> String {
    "internal".to_string()
}

#[derive(Serialize)]
pub struct RegisterResponse {
    pub source: &'static str,
    pub mode: String,
    pub markdown: String,
    pub filename: String,
    pub timestamp: String,
}

async fn theorem_register(Query(q): Query<RegisterQuery>) -> Json<RegisterResponse> {
    let mode = if q.mode == "external" { "external" } else { "internal" };
    let markdown = forge_math::generate_theorem_register_md(mode);
    let stamp = forge_math::hptp_filename_stamp();
    let filename = format!("theorem-register-{}-{}.md", mode, stamp);
    Json(RegisterResponse {
        source: FORGE_RUST_SOURCE,
        mode: mode.to_string(),
        markdown,
        filename,
        timestamp: forge_math::hptp_timestamp(),
    })
}

#[derive(Serialize)]
pub struct InfoResponse {
    pub source: &'static str,
    pub endpoints: Vec<&'static str>,
}

async fn info() -> Json<InfoResponse> {
    Json(InfoResponse {
        source: FORGE_RUST_SOURCE,
        endpoints: vec![
            "POST /api/forge/audit",
            "POST /api/forge/fix",
            "GET  /api/forge/hptp",
            "GET  /api/forge/theorems",
            "GET  /api/forge/theorem-register?mode=internal|external",
            "GET  /api/forge/info",
        ],
    })
}

pub fn forge_router() -> Router {
    Router::new()
        .route("/api/forge/audit", post(audit))
        .route("/api/forge/fix", post(fix))
        .route("/api/forge/hptp", get(hptp))
        .route("/api/forge/theorems", get(theorems))
        .route("/api/forge/theorem-register", get(theorem_register))
        .route("/api/forge/info", get(info))
}
