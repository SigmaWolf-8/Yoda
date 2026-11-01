//! Complete API router — all endpoints from api-contract.md.
//!
//! B5.1: Project CRUD
//! B5.2: Task routes (retry/escalate/cancel)
//! B5.3: Query submission + approval
//! B5.4: Task Bible
//! B5.5: Knowledge Base
//! B5.6: Audit export
//! B5.7: Settings (project, GitHub PAT)
//! B5.8: WebSocket
//! B5.9: Rate limiting

use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::StatusCode,
    middleware,
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::agents;
use crate::auth;
use crate::audit;
use crate::bible;
use crate::capability;
use crate::capomastro;
use crate::cube_relay::{RelayInferRequest, slot_to_cube_address};
use crate::error::AppError;
use crate::gate_handle::GateHandle;
use crate::install;
use crate::kb;
use crate::modes;
use crate::query;
use crate::salvi_engine_routes;
use crate::settings;
use crate::state::AppState;
use crate::theta;
use crate::websocket;

/// Build the complete API router with all routes.
pub fn build_router(state: AppState) -> Router {
    // ── Public routes (no auth) ──────────────────────────────────────
    let public = Router::new()
        .route("/api/auth/register", post(auth::register))
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/refresh", post(auth::refresh_token))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/lineages", get(get_lineages))
        // ── CRS proxy routes (unauthenticated — called by install scripts) ──
        .route("/api/salvi/inter-cube/crs/register", post(crs_register))
        .route("/api/salvi/inter-cube/crs/heartbeat", post(crs_heartbeat))
        .route("/api/salvi/inter-cube/relay/heartbeat", get(relay_heartbeat_get))
        .route("/api/salvi/inter-cube/crs/stats", get(crs_stats))
        .route("/api/salvi/inter-cube/topology", get(crs_topology))
        .route("/api/salvi/inter-cube/fts/status", get(crs_fts_status))
        .route("/api/salvi/inter-cube/node/info", get(node_info))
        // Same-origin gateway views for the Array3 monitor + 3FA widget. A remote
        // browser (Replit preview or published domain) can only reach port 3000,
        // so it fetches these instead of the unreachable daemon ports directly.
        .route("/api/salvi/inter-cube/relay/status", get(crate::relay_monitor::status))
        .route("/api/salvi/inter-cube/slots", get(inter_cube_slots))
        .route("/api/salvi/inter-cube/monitor/slots", get(crate::relay_monitor::slots))
        .route("/api/salvi/inter-cube/relay/slot-inventory", get(crate::relay_monitor::inventory))
        .route("/api/monitoring/registered-nodes", get(monitoring_registered_nodes))
        .route("/api/yoda/crs/session/{token}", get(crs_session))
        .route("/api/relay/status", get(relay_status))
        .route("/api/system/status", get(system_status))
        // ── Salvi fixed-precision engine (public — pure computation, no state) ──
        // Carries its own tight body limit, so it is merged as a group rather
        // than listed here route by route.
        .merge(salvi_engine_routes::router())
        // Local-install download endpoints (public — needed by install script)
        // ── Capomastro sovereign ledger (public read surfaces) ──
        // Published record of the estate: the workbook, the sealed token
        // measurements, and the ISO 20022 parse endpoint.
        .route("/api/capomastro/ledger", get(capomastro::get_ledger))
        .route("/api/capomastro/conservation", get(capomastro::conservation::get))
        .route("/api/capomastro/conservation/evaluate", post(capomastro::conservation::evaluate))
        .route("/api/capomastro/conservation/verify", post(capomastro::conservation::verify))
        .route("/api/capomastro/revenue", get(capomastro::get_revenue))
        // Statements are computed per request from the workbook plus live
        // reference rates — see capomastro::statements.
        .route(
            "/api/capomastro/statements",
            get(capomastro::statements::get_statements),
        )
        // One-click auditor copies. Same computation as the statements route —
        // these render it for paper and for Excel, they do not recompute it.
        .route(
            "/api/capomastro/export/statements.html",
            get(capomastro::export::export_statements_html),
        )
        .route(
            "/api/capomastro/export/statements.csv",
            get(capomastro::export::export_statements_csv),
        )
        .route(
            "/api/capomastro/export/trial-balance.csv",
            get(capomastro::export::export_trial_balance_csv),
        )
        .route(
            "/api/capomastro/export/ledger.csv",
            get(capomastro::export::export_ledger_csv),
        )
        .route("/api/capomastro/measurements", get(capomastro::get_measurements))
        // The parse endpoint is public and buffers its whole body, so it gets a
        // tight limit of its own — a pacs.008 message is kilobytes, not
        // megabytes, and without this an anonymous caller can force unbounded
        // buffering. Over-limit bodies are rejected with 413.
        .route(
            "/api/capomastro/pacs008/parse",
            post(capomastro::parse_pacs008)
                .layer(DefaultBodyLimit::max(capomastro::MAX_PACS008_BYTES)),
        )
        // ── Collections settlement webhook (public by necessity — Stripe is
        // the caller; authenticated by signature, not by session). The body is
        // read raw because the signature covers the exact bytes sent, and a
        // Stripe event is kilobytes — the tight limit stops an anonymous
        // caller forcing unbounded buffering.
        .route(
            capomastro::webhook::WEBHOOK_PATH,
            post(capomastro::webhook::stripe_webhook)
                .layer(DefaultBodyLimit::max(256 * 1024)),
        )
        .route("/api/install/source.tar.gz", get(install::download_source))
        .route("/api/install/install.ps1", get(install::windows_installer));

    // ── Protected routes (JWT or API key) ────────────────────────────
    let protected = Router::new()
        .route("/api/agents/runtime", get(crate::agent_worker::status).put(crate::agent_worker::control))
        .route("/api/capomastro/conservation/records", post(capomastro::conservation::append))
        // ── Collections (Capomastro) ──
        // Money leaves the estate's control here: these routes raise real
        // invoices against real debtors, so they sit behind credentials even
        // though the ledger they read from is a public record.
        .route(
            "/api/capomastro/collections",
            get(capomastro::collections::get_register),
        )
        .route(
            "/api/capomastro/collections/{position_id}/demand",
            post(capomastro::collections::issue_demand),
        )
        .route(
            "/api/capomastro/collections/demands/{id}/void",
            post(capomastro::collections::void_demand),
        )

        // Organizations (B-AUTH.5, B-AUTH.6)
        .route("/api/orgs", post(auth::create_org))
        .route("/api/orgs", get(auth::list_orgs))

        // Projects (B5.1)
        .route("/api/projects", post(create_project))
        .route("/api/projects", get(list_projects))
        .route("/api/projects/{id}", get(get_project))
        .route("/api/projects/{id}", put(update_project))
        .route("/api/projects/{id}", delete(delete_project))

        // Query submission (B5.3)
        .route("/api/projects/{id}/query", post(query::submit_query))
        .route("/api/projects/{id}/query/approve", post(query::approve_decomposition))

        // Threads (Task #29) — root tasks treated as first-class objects
        .route("/api/projects/{id}/threads", get(list_threads))
        .route("/api/projects/{id}/threads/{thread_id}", axum::routing::patch(update_thread))
        .route("/api/projects/{id}/threads/{thread_id}", delete(delete_thread))

        // Tasks (B5.2)
        .route("/api/tasks/recent", get(list_recent_tasks))
        .route("/api/projects/{id}/tasks", get(list_tasks))
        .route("/api/tasks/{id}", get(get_task))
        .route("/api/tasks/{id}", delete(delete_task))
        .route("/api/tasks/{id}/output", post(set_task_output))
        .route("/api/tasks/{id}/message", post(add_task_message))
        .route("/api/tasks/{id}/retry", post(retry_task))
        .route("/api/tasks/{id}/escalate", post(escalate_task))
        .route("/api/tasks/{id}/cancel", post(cancel_task))

        // Task Bible (B5.4)
        .route("/api/projects/{id}/bible", get(bible::list_bible_entries))
        .route("/api/bible/{task_id}", get(bible::get_bible_entry))

        // Knowledge Base (B5.5)
        .route("/api/projects/{id}/kb", get(kb::search_kb))
        .route("/api/projects/{id}/kb/tags", get(kb::get_kb_tags))
        .route("/api/kb/{id}", put(kb::update_kb_entry))
        .route("/api/kb/{id}", delete(kb::delete_kb_entry))

        // Audit (B5.6)
        .route("/api/audit/{task_id}", get(audit::get_audit_log))
        .route("/api/audit/{task_id}/export/json", get(audit::export_audit_json))

        // Engine configuration (GET returns engines + daemons block;
        // PUT root accepts a partial body such as {daemons:{host,ports}})
        .route("/api/settings/engines", get(get_engines))
        .route("/api/settings/engines", put(update_engines_settings))
        .route("/api/settings/engines/{slot}", put(update_engine))
        .route("/api/settings/engines/{slot}", delete(clear_engine))
        .route("/api/settings/engines/{slot}/probe", get(probe_engine))
        // On-demand engine ping — synchronous health check for one slot
        .route("/api/yoda/engines/{slot}/ping", post(crate::engine_verification::verify))
        .route("/api/settings/engines/{slot}/mark-online", post(crate::engine_verification::verify))
        .route("/api/settings/engines/{slot}/mark-offline", post(mark_engine_offline))
        .route("/api/settings/engines/{slot}/disable", post(disable_engine))
        .route("/api/settings/engines/{slot}/enable", post(enable_engine))
        .route("/api/settings/engines/validate-diversity", post(validate_diversity))

        // Project settings (B5.7)
        .route("/api/settings/project/{id}", get(settings::get_project_settings))
        .route("/api/settings/project/{id}", put(settings::update_project_settings))

        // GitHub PAT (B5.7)
        .route("/api/settings/github-pat", put(settings::update_github_pat))
        .route("/api/settings/github-pat", get(settings::get_github_pat))

        // API keys (B-AUTH.8)
        .route("/api/keys", post(auth::create_api_key))
        .route("/api/keys", get(auth::list_api_keys))
        .route("/api/keys/{id}", delete(auth::delete_api_key))

        // Mode promotion/escalation (B7.2, B7.3)
        .route("/api/projects/{id}/promote", post(modes::promote_to_ronin))
        .route("/api/tasks/{id}/escalate-to-yoda", post(modes::escalate_to_yoda))

        // Capability matrix (B7.1)
        .route("/api/settings/capabilities", get(get_capabilities))

        // LLM Gateway health (Alpha/Beta/Gamma cloud agents)
        .route("/api/health/llm", get(llm_health))

        // Agent roster and upstream sync
        .route("/api/agents", get(agents::list_agents))
        .route("/api/agents/sync-status", get(agents::sync_status))
        .route("/api/agents/sync", post(agents::trigger_sync))
        .route("/api/agents/review", post(agents::review_agents))
        .route("/api/agents/upload", post(agents::upload_agents))
        .route("/api/agents/{id}", get(agents::get_agent))

        // Auth middleware on all protected routes
        .layer(middleware::from_fn_with_state(state.clone(), auth::auth_middleware));

    // ── WebSocket (B5.8) — outside auth middleware (uses query param or header auth) ──
    let ws_routes = Router::new()
        .route("/ws/pipeline/{project_id}", get(websocket::ws_pipeline_handler));

    // ── 3-Factor Auth (Task #39) ─────────────────────────────────────
    // Unauthenticated by design — this flow IS a login path (reachable from
    // the Crystal / Array3 Cubes page). Registered after `let protected` so it
    // is not counted by the public-route security test, which splits on that
    // marker. Each step is gated on the previous factor completing.
    let three_factor = Router::new()
        .route("/api/3fa/start", post(three_factor_start))
        .route("/api/3fa/knowledge", post(three_factor_knowledge))
        .route("/api/3fa/possession/request", post(three_factor_possession_request))
        .route("/api/3fa/possession/verify", post(three_factor_possession_verify))
        .route("/api/3fa/codepoint", post(three_factor_codepoint))
        // ── Torus Gate: real 3-factor login bound to accounts (Task #49) ──
        // JSON-free, framework-native line protocol. Enrollment + staged login.
        .route("/api/gate/enroll", post(gate_enroll))
        .route("/api/gate/begin", post(gate_begin))
        .route("/api/gate/theta", post(gate_theta))
        .route("/api/gate/sms", post(gate_sms))
        .route("/api/gate/sms/verify", post(gate_sms_verify))
        .route("/api/gate/codepoint", post(gate_codepoint));

    // B5.9: Rate limiting — tower::RateLimitLayer removed (not Clone-compatible
    // with axum 0.8 Router::layer). Add per-route limits via middleware::from_fn.
    Router::new()
        .merge(public)
        .merge(protected)
        .merge(three_factor)
        .merge(ws_routes)
        .with_state(state)
}

// ═══════════════════════════════════════════════════════════════════════
// 3-Factor Auth handlers (Task #39)
// ═══════════════════════════════════════════════════════════════════════

use crate::three_factor::{
    self as tfa, ConsoleSmsSender, ThreeFactorAuthenticator,
};

/// Non-production only: the dev/console possession sender echoes the OTP.
/// In production, wire a real SmsSender and never return the code.
fn is_production() -> bool {
    std::env::var("APP_ENV")
        .map(|v| v.eq_ignore_ascii_case("production") || v.eq_ignore_ascii_case("prod"))
        .unwrap_or(false)
}

async fn three_factor_start(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let session = tfa::new_demo_session();
    let session_id = Uuid::new_v4();
    let (cx, cy, cz) = tfa::DEMO_CODEPOINT;
    let dev = !is_production();
    {
        let mut sessions = state.three_factor_sessions.write().await;
        // Evict abandoned/expired sessions so the map never grows unbounded.
        tfa::prune_expired(&mut sessions);
        // Hard cap on concurrent sessions — bounds memory even under a flood of
        // unauthenticated /start calls.
        if sessions.len() >= tfa::MAX_ACTIVE_SESSIONS {
            return Err(AppError::Validation(
                "Too many active 3FA sessions — try again shortly".into(),
            ));
        }
        sessions.insert(session_id, session);
    }
    Ok(Json(serde_json::json!({
        "session_id": session_id,
        "moving_factor": tfa::current_moving_factor(),
        // Dev-only hints so the demo credential is exercisable without an
        // enrollment UI (out of scope). Suppressed entirely in production.
        "dev_hints": if dev {
            serde_json::json!({
                "pin": tfa::DEMO_PIN,
                "phone": tfa::DEMO_PHONE,
                "codepoint": { "x": cx, "y": cy, "z": cz },
            })
        } else { serde_json::Value::Null },
    })))
}

#[derive(Debug, Deserialize)]
struct KnowledgeRequest {
    session_id: Uuid,
    pin: String,
}

async fn three_factor_knowledge(
    State(state): State<AppState>,
    Json(req): Json<KnowledgeRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut sessions = state.three_factor_sessions.write().await;
    let session = sessions
        .get_mut(&req.session_id)
        .filter(|s| !s.is_expired())
        .ok_or(AppError::NotFound("3FA session not found or expired".into()))?;
    if session.knowledge_attempts >= tfa::MAX_FACTOR_ATTEMPTS {
        sessions.remove(&req.session_id);
        return Err(AppError::Unauthorized(
            "Too many failed PIN attempts — session burned, please restart".into(),
        ));
    }
    let auth = ThreeFactorAuthenticator::new(ConsoleSmsSender);
    if !auth.verify_knowledge(session.knowledge_hash, &req.pin) {
        session.knowledge_attempts += 1;
        return Err(AppError::Unauthorized("Knowledge factor failed: incorrect PIN".into()));
    }
    session.knowledge_ok = true;
    Ok(Json(serde_json::json!({ "ok": true, "factor": "knowledge" })))
}

#[derive(Debug, Deserialize)]
struct PossessionRequestReq {
    session_id: Uuid,
}

async fn three_factor_possession_request(
    State(state): State<AppState>,
    Json(req): Json<PossessionRequestReq>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut sessions = state.three_factor_sessions.write().await;
    let session = sessions
        .get_mut(&req.session_id)
        .filter(|s| !s.is_expired())
        .ok_or(AppError::NotFound("3FA session not found or expired".into()))?;
    if !session.knowledge_ok {
        return Err(AppError::Forbidden("Complete the Knowledge factor first".into()));
    }
    // Select the delivery mechanism. The relay is the default everywhere; the
    // echoing console sender is only reachable where the environment is
    // positively identified as development (fail-closed).
    let sender = tfa::select_sms_sender().map_err(AppError::Internal)?;
    let echoing_sender = sender.echoes_code();
    let auth = ThreeFactorAuthenticator::new(sender);
    // Anchor the OTP to the CURRENT moving factor so the code is genuinely
    // time-windowed (valid only within the drift window of now), not for the
    // whole session lifetime.
    let echoed = auth
        .request_possession_code(
            &session.phone,
            session.possession_secret,
            tfa::current_moving_factor(),
        )
        .map_err(AppError::Internal)?;
    session.code_requested = true;
    let phone = session.phone.clone();
    // Only the console sender echoes, and only where it is permitted at all.
    let dev_code = if echoing_sender { echoed } else { None };
    Ok(Json(serde_json::json!({
        "ok": true,
        "sent_to": phone,
        "dev_code": dev_code,
    })))
}

#[derive(Debug, Deserialize)]
struct PossessionVerifyReq {
    session_id: Uuid,
    code: u32,
}

async fn three_factor_possession_verify(
    State(state): State<AppState>,
    Json(req): Json<PossessionVerifyReq>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut sessions = state.three_factor_sessions.write().await;
    let session = sessions
        .get_mut(&req.session_id)
        .filter(|s| !s.is_expired())
        .ok_or(AppError::NotFound("3FA session not found or expired".into()))?;
    if !session.knowledge_ok {
        return Err(AppError::Forbidden("Complete the Knowledge factor first".into()));
    }
    if !session.code_requested {
        return Err(AppError::Forbidden("Request a possession code first".into()));
    }
    if session.possession_attempts >= tfa::MAX_FACTOR_ATTEMPTS {
        sessions.remove(&req.session_id);
        return Err(AppError::Unauthorized(
            "Too many failed code attempts — session burned, please restart".into(),
        ));
    }
    let auth = ThreeFactorAuthenticator::new(ConsoleSmsSender);
    // Verify against the CURRENT moving factor (± drift), matching the
    // time-windowed code issued at request time.
    if !auth.verify_possession_code(
        session.possession_secret,
        tfa::current_moving_factor(),
        req.code,
    ) {
        session.possession_attempts += 1;
        return Err(AppError::Unauthorized("Possession factor failed: incorrect code".into()));
    }
    session.possession_ok = true;
    Ok(Json(serde_json::json!({ "ok": true, "factor": "possession" })))
}

#[derive(Debug, Deserialize)]
struct CodepointReq {
    session_id: Uuid,
    x: i64,
    y: i64,
    z: i64,
}

async fn three_factor_codepoint(
    State(state): State<AppState>,
    Json(req): Json<CodepointReq>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut sessions = state.three_factor_sessions.write().await;
    let session = sessions
        .get_mut(&req.session_id)
        .filter(|s| !s.is_expired())
        .ok_or(AppError::NotFound("3FA session not found or expired".into()))?;
    if !session.knowledge_ok || !session.possession_ok {
        return Err(AppError::Forbidden(
            "Complete the Knowledge and Possession factors first".into(),
        ));
    }
    let auth = ThreeFactorAuthenticator::new(ConsoleSmsSender);
    let point = tfa::Codepoint::new(req.x, req.y, req.z);
    let expected = ThreeFactorAuthenticator::<ConsoleSmsSender>::expected_codepoint_scalar(
        &session.expected_codepoint,
        session.moving_factor,
    );
    if !auth.verify_codepoint_factor(&point, expected, session.moving_factor) {
        return Err(AppError::Unauthorized(
            "Codepoint factor failed: selected cube does not match".into(),
        ));
    }

    // All three factors satisfied — derive the presence scalar and mint a
    // short-lived presence/capability token via the existing JWT plumbing.
    let presence = auth.derive_presence_scalar(
        session.knowledge_hash,
        session.possession_secret,
        &point,
        session.moving_factor,
    );
    let presence_id = Uuid::new_v4();
    let token = auth::create_access_token(
        presence_id,
        "friendly-approved@plenumnet",
        presence_id,
        &state.jwt_secret,
        10,
    )?;

    // Consume the session (single-use).
    sessions.remove(&req.session_id);

    Ok(Json(serde_json::json!({
        "ok": true,
        "factor": "codepoint",
        "status": "Friendly Approved Member connected",
        "presence_scalar": presence.to_string(),
        "token": token,
        "expires_in_minutes": 10,
    })))
}

// ═══════════════════════════════════════════════════════════════════════
// Torus Gate — real 3-factor login bound to accounts (Task #49)
//
// JSON-free: every request/response uses the framework-native line wire
// (`tfa::wire`). Stages: enroll → begin (Knowledge=password) → possession
// (SMS) → codepoint (Crystal cube) → real account tokens minted.
// ═══════════════════════════════════════════════════════════════════════

/// Text response with the native line wire content type.
fn wire_ok(pairs: &[(&str, String)]) -> Response {
    (
        [(axum::http::header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        tfa::wire::emit(pairs),
    )
        .into_response()
}

/// Mask a phone so only the country prefix and last two digits survive:
/// `+1*******67`. Enough for an operator to recognise their own handset,
/// useless to anyone enumerating accounts.
fn mask_phone(phone: &str) -> String {
    let digits: Vec<char> = phone.chars().collect();
    if digits.len() < 4 {
        return "*".repeat(digits.len());
    }
    let head = if phone.starts_with('+') { 2 } else { 1 };
    let tail = 2;
    let hidden = digits.len().saturating_sub(head + tail);
    let mut out: String = digits[..head].iter().collect();
    out.push_str(&"*".repeat(hidden));
    out.extend(&digits[digits.len() - tail..]);
    out
}

/// Turn whatever an operator typed into a number the carrier will accept.
///
/// People write phone numbers the way they say them — `780 555 1234`,
/// `(780) 555-1234`, `780.555.1234`. Refusing those and demanding E.164 puts
/// the burden of a wire format on the person least equipped to care about it,
/// at the one screen where being stuck means no account. So: keep the digits,
/// infer the country code when it is unambiguous, and only give up when there
/// is genuinely no number there.
///
/// Returns the normalized `+…` form, or `Err` with a plain-language reason.
fn normalize_phone(raw: &str) -> Result<String, String> {
    let raw = raw.trim();
    let had_plus = raw.starts_with('+');
    let mut digits: String = raw.chars().filter(|c| c.is_ascii_digit()).collect();

    if digits.is_empty() {
        return Err("That doesn't look like a phone number.".into());
    }

    // `00` is how much of the world writes `+`. Without this, `0044 20 …`
    // would be handed to the carrier as `+0044…`, which is not a number.
    if !had_plus && digits.starts_with("00") {
        digits = digits[2..].to_string();
    }

    if digits.len() < 10 {
        return Err(
            "That number looks too short — include the area code, like 780 555 1234.".into(),
        );
    }
    if digits.len() > 15 {
        return Err("That number is longer than any phone number in use.".into());
    }

    // A bare 10-digit number has no country code on it, so one has to be
    // assumed. This product is North American, and NANP area codes never begin
    // with 0 or 1 — if it does begin with one of those, the assumption is
    // unsafe and we ask rather than guess wrong and text a stranger.
    let e164 = if !had_plus && digits.len() == 10 {
        match digits.as_bytes()[0] {
            b'2'..=b'9' => format!("+1{digits}"),
            _ => {
                return Err(
                    "Add the country code to that number, starting with + — like +44 for the UK."
                        .into(),
                )
            }
        }
    } else {
        format!("+{digits}")
    };

    // E.164: a leading '+', a country code that cannot start with 0, and no
    // more than 15 digits in total.
    if e164.as_bytes()[1] == b'0' {
        return Err(
            "That number's country code doesn't look right — write it as +44…, +1…, and so on."
                .into(),
        );
    }
    if e164.len() > 16 {
        return Err("That number is longer than any phone number in use.".into());
    }
    Ok(e164)
}

/// Derive a per-user possession seed (TOTP-style). Deterministic given the
/// inputs; unique per user because the user id is unique.
fn derive_possession_seed(user_id: Uuid, now_nanos: u64) -> u64 {
    tfa::combine(tfa::hash_bytes(user_id.as_bytes()), now_nanos)
}

/// POST /api/gate/enroll — enroll a phone + Crystal cube for an account.
/// Fields: `email` `password` `phone` `cube` (dotted trits, e.g. `1.3.2`),
/// plus `name` when creating a brand-new account. Verifies the password for
/// existing accounts (first-login enrollment); creates the account otherwise.
async fn gate_enroll(
    State(state): State<AppState>,
    body: String,
) -> Result<Response, AppError> {
    let f = tfa::wire::parse(&body);
    let email = f.get("email").cloned().unwrap_or_default();
    let password = f.get("password").cloned().unwrap_or_default();
    let phone = f.get("phone").cloned().unwrap_or_default();
    let cube = f.get("cube").cloned().unwrap_or_default();

    if email.is_empty() || !email.contains('@') {
        return Err(AppError::Validation("Invalid email".into()));
    }
    if password.len() < 8 {
        return Err(AppError::Validation(
            "Password must be at least 8 characters".into(),
        ));
    }
    // A handset is optional — an operator without one is never locked out. If
    // one is given, take it however it was typed and normalize it here.
    let phone = if phone.trim().is_empty() {
        String::new()
    } else {
        normalize_phone(&phone).map_err(AppError::Validation)?
    };
    let (cx, cy, cz) = tfa::wire::parse_cube(&cube).ok_or_else(|| {
        AppError::Validation("Cube must be three trits 1..3, e.g. 1.3.2".into())
    })?;

    let existing = sqlx::query_as::<_, (Uuid, String, bool)>(
        // Case-insensitive: nobody remembers how they capitalized their own
        // address, and typing it in lower case must not read as a wrong one.
        "SELECT id, password_hash, COALESCE(gate_enrolled, FALSE) FROM users \
         WHERE lower(email) = lower($1)",
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?;

    let now_nanos = chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0) as u64;

    let user_id = match existing {
        Some((id, hash, enrolled)) => {
            // First-login enrollment for a pre-existing account: prove the password.
            if !auth::verify_password(&password, &hash)? {
                return Err(AppError::Unauthorized("Invalid credentials".into()));
            }
            if enrolled {
                return Err(AppError::Conflict(
                    "This account is already enrolled at the Gate".into(),
                ));
            }
            id
        }
        None => {
            // Brand-new account — needs a name and full account scaffolding.
            let name = f.get("name").cloned().unwrap_or_default();
            if name.trim().is_empty() {
                return Err(AppError::Validation("Name required for a new account".into()));
            }
            let password_hash = auth::hash_password(&password)?;
            let id = Uuid::new_v4();
            sqlx::query(
                "INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, $3, $4)",
            )
            .bind(id)
            .bind(&email)
            .bind(&password_hash)
            .bind(&name)
            .execute(&state.db)
            .await
            .map_err(AppError::Database)?;

            let org_id = Uuid::new_v4();
            sqlx::query("INSERT INTO organizations (id, name) VALUES ($1, $2)")
                .bind(org_id)
                .bind(format!("{name}'s Organization"))
                .execute(&state.db)
                .await
                .map_err(AppError::Database)?;
            sqlx::query(
                "INSERT INTO org_members (user_id, org_id, role) VALUES ($1, $2, 'owner')",
            )
            .bind(id)
            .bind(org_id)
            .execute(&state.db)
            .await
            .map_err(AppError::Database)?;
            id
        }
    };

    // The Θ-lock seed. Issued once, here, and never sent again: from now on
    // both the Crystal and the Gate derive the same reading from it and the
    // theta angle, so no secret crosses the wire at login.
    let theta_seed = GateHandle::generate();
    let theta_hex_bytes = theta_seed.to_hex();
    let theta_hex = core::str::from_utf8(&theta_hex_bytes)
        .expect("hex is ASCII")
        .to_string();

    let legacy_seed = derive_possession_seed(user_id, now_nanos);
    sqlx::query(
        "UPDATE users SET gate_phone = $1, gate_possession_seed = $2, gate_theta_seed = $3, \
         gate_cp_x = $4, gate_cp_y = $5, gate_cp_z = $6, gate_enrolled = TRUE WHERE id = $7",
    )
    .bind(&phone)
    .bind(legacy_seed.to_string())
    .bind(&theta_hex)
    .bind(cx as i16)
    .bind(cy as i16)
    .bind(cz as i16)
    .bind(user_id)
    .execute(&state.db)
    .await
    .map_err(AppError::Database)?;

    let now = chrono::Utc::now().timestamp();
    let t = theta::theta_at(now);
    Ok(wire_ok(&[
        ("ok", "1".into()),
        ("enrolled", "1".into()),
        ("seed", theta_hex),
        ("theta_deg", t.degrees.to_string()),
        ("theta_station", t.station.to_string()),
    ]))
}

/// POST /api/gate/begin — Factor 1 (Knowledge = account password).
/// Fields: `email` `password`. On success opens a gate session and returns
/// `session <id>` `moving_factor <n>` `phone_hint <masked>`. If the account
/// exists but is not enrolled, returns `status enroll_required` so the canvas
/// routes the operator through one-time enrollment instead of locking them out.
async fn gate_begin(
    State(state): State<AppState>,
    body: String,
) -> Result<Response, AppError> {
    let f = tfa::wire::parse(&body);
    let email = f.get("email").cloned().unwrap_or_default();
    let password = f.get("password").cloned().unwrap_or_default();
    if email.is_empty() || password.is_empty() {
        return Err(AppError::Validation("email and password required".into()));
    }

    let row = sqlx::query_as::<
        _,
        (Uuid, String, bool, Option<String>, Option<String>, Option<i16>, Option<i16>, Option<i16>),
    >(
        "SELECT id, password_hash, COALESCE(gate_enrolled, FALSE), gate_phone, \
         gate_possession_seed, gate_cp_x, gate_cp_y, gate_cp_z FROM users \
         WHERE lower(email) = lower($1)",
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?
    .ok_or(AppError::Unauthorized("Invalid credentials".into()))?;

    let (user_id, password_hash, enrolled, phone, seed, cx, cy, cz) = row;

    if !auth::verify_password(&password, &password_hash)? {
        return Err(AppError::Unauthorized("Invalid credentials".into()));
    }

    if !enrolled {
        // Password is right, but no possession/codepoint on file yet.
        return Ok(wire_ok(&[("status", "enroll_required".into())]));
    }

    // Phone is no longer a factor, so its absence must not bar an enrolled
    // operator from the Gate.
    let phone = phone.unwrap_or_default();
    let seed: u64 = seed
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| AppError::Internal("enrolled user missing possession seed".into()))?;
    let (cx, cy, cz) = match (cx, cy, cz) {
        (Some(x), Some(y), Some(z)) => (x as i64, y as i64, z as i64),
        _ => return Err(AppError::Internal("enrolled user missing codepoint".into())),
    };

    let org_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT org_id FROM org_members WHERE user_id = $1 ORDER BY created_at LIMIT 1",
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .map_err(AppError::Database)?;

    let session = tfa::new_user_session(
        user_id,
        email,
        org_id,
        phone.clone(),
        seed,
        tfa::Codepoint::new(cx, cy, cz),
    );
    let session_id = Uuid::new_v4();
    {
        let mut sessions = state.three_factor_sessions.write().await;
        tfa::prune_expired(&mut sessions);
        if sessions.len() >= tfa::MAX_ACTIVE_SESSIONS {
            return Err(AppError::Validation(
                "Too many active gate sessions — try again shortly".into(),
            ));
        }
        sessions.insert(session_id, session);
    }

    // Hand back where the circle stands. The operator's Crystal needs the
    // angle to derive its reading; nothing here is secret, and nothing here
    // is trusted when it comes back — the Gate reads its own clock.
    let now = chrono::Utc::now().timestamp();
    let t = theta::theta_at(now);
    // Whether a text is coming after the Θ-lock, and to which handset. The hint
    // is masked; the number itself never leaves the server.
    let sms_required = !phone.trim().is_empty();
    Ok(wire_ok(&[
        ("session", session_id.to_string()),
        ("theta_deg", t.degrees.to_string()),
        ("theta_station", t.station.to_string()),
        ("theta_revolution", t.revolution.to_string()),
        ("station_holds", theta::secs_to_next_station(now).to_string()),
        ("sms_required", if sms_required { "1" } else { "0" }.into()),
        (
            "phone_hint",
            if sms_required {
                mask_phone(&phone)
            } else {
                String::new()
            },
        ),
    ]))
}

/// POST /api/gate/theta — Factor 2 (Θ-lock).
///
/// Fields: `session` `reading`. Returns `ok 1`.
///
/// There is no request step and no message to wait for. The Crystal derives
/// the reading from its enrolled seed and the angle of the unified epoch; the
/// Gate derives the same value from its own clock and compares. Nothing is
/// sent, so there is nothing to intercept, and no carrier sits in the trust
/// path.
async fn gate_theta(
    State(state): State<AppState>,
    body: String,
) -> Result<Response, AppError> {
    let f = tfa::wire::parse(&body);
    let session_id: Uuid = f
        .get("session")
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| AppError::Validation("valid session required".into()))?;
    let code: u32 = f
        .get("reading")
        .and_then(|s| s.trim().parse().ok())
        .ok_or_else(|| AppError::Validation("numeric theta reading required".into()))?;

    // Establish who is knocking and that Factor 1 is behind them, then drop
    // the lock — the seed lookup is a database round-trip and must not be held
    // across every other gate session.
    let user_id = {
        let mut sessions = state.three_factor_sessions.write().await;
        let session = sessions
            .get_mut(&session_id)
            .filter(|s| !s.is_expired() && s.user_id.is_some())
            .ok_or(AppError::NotFound("Gate session not found or expired".into()))?;
        if !session.knowledge_ok {
            return Err(AppError::Forbidden("Complete the credentials first".into()));
        }
        if session.possession_attempts >= tfa::MAX_FACTOR_ATTEMPTS {
            sessions.remove(&session_id);
            return Err(AppError::Unauthorized(
                "Too many failed readings — session burned, please restart".into(),
            ));
        }
        session.user_id.expect("filtered on is_some")
    };

    let seed_hex = sqlx::query_scalar::<_, Option<String>>(
        "SELECT gate_theta_seed FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .map_err(AppError::Database)?
    .ok_or_else(|| {
        AppError::Forbidden("This account has no Θ-lock seed — re-enroll at the Gate".into())
    })?;

    // Which station the reading belongs to — needed to spend it.
    let matched = theta::verify_reading_station(
        seed_hex.as_bytes(),
        code,
        chrono::Utc::now().timestamp(),
    );

    // Single-use. The reading is honoured at its own station and one of grace,
    // so without a ledger the same six digits would pass twice inside that
    // window — including from a freshly opened session. Spend the station
    // atomically: the UPDATE only matches if this account has not already used
    // this station or a later one, so two requests racing with the same
    // reading cannot both win.
    let verified = match matched {
        None => false,
        Some(station) => {
            let spent = sqlx::query(
                "UPDATE users SET gate_theta_last_station = $1 \
                 WHERE id = $2 \
                   AND (gate_theta_last_station IS NULL OR gate_theta_last_station < $1)",
            )
            .bind(station)
            .bind(user_id)
            .execute(&state.db)
            .await
            .map_err(AppError::Database)?;
            spent.rows_affected() == 1
        }
    };

    let mut sessions = state.three_factor_sessions.write().await;
    let session = sessions
        .get_mut(&session_id)
        .filter(|s| !s.is_expired())
        .ok_or(AppError::NotFound("Gate session not found or expired".into()))?;
    if !verified {
        session.possession_attempts += 1;
        // Burn immediately if that failure exhausted the budget, so the
        // attempt cap cannot be walked past by racing requests.
        if session.possession_attempts >= tfa::MAX_FACTOR_ATTEMPTS {
            sessions.remove(&session_id);
            return Err(AppError::Unauthorized(
                "Too many failed readings — session burned, please restart".into(),
            ));
        }
        return Err(AppError::Unauthorized(
            "That reading does not match this station of the circle".into(),
        ));
    }
    session.possession_ok = true;
    Ok(wire_ok(&[("ok", "1".into())]))
}

/// POST /api/gate/sms — issue and deliver the SMS confirmation code.
///
/// Fields: `session`. Returns `sent 1` `phone_hint <masked>` `expires <secs>`,
/// plus `dev_code <n>` when a console sender is in use outside production.
///
/// This factor is deliberately the opposite of the Θ-lock. The Θ-lock is
/// derived on both sides and never travels; the SMS code is minted here and
/// travels out of band to the enrolled handset. Requiring both means holding
/// the Crystal seed is not enough — the handset has to be in hand as well.
///
/// Only reachable once Factor 1 and the Θ-lock are behind the session, so an
/// unauthenticated caller cannot use the Gate to send texts to a number they
/// do not control.
async fn gate_sms(
    State(state): State<AppState>,
    body: String,
) -> Result<Response, AppError> {
    let f = tfa::wire::parse(&body);
    let session_id: Uuid = f
        .get("session")
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| AppError::Validation("valid session required".into()))?;

    // Mint the code and record it before handing it to the carrier, so a
    // sender that succeeds slowly can never race ahead of the session state.
    let (phone, code) = {
        let mut sessions = state.three_factor_sessions.write().await;
        let session = sessions
            .get_mut(&session_id)
            .filter(|s| !s.is_expired())
            .ok_or(AppError::NotFound("Gate session not found or expired".into()))?;
        if !session.knowledge_ok {
            return Err(AppError::Forbidden("Complete the credentials first".into()));
        }
        if !session.possession_ok {
            return Err(AppError::Forbidden("Complete the step before this one first".into()));
        }
        if session.phone.trim().is_empty() {
            return Err(AppError::Forbidden(
                "This account has no handset enrolled — nothing to text".into(),
            ));
        }
        if session.sms_sends >= tfa::MAX_SMS_SENDS {
            return Err(AppError::Validation(
                "Too many texts requested for this session — restart the Gate".into(),
            ));
        }
        let code: u32 = rand::Rng::gen_range(&mut rand::thread_rng(), 0..1_000_000);
        session.sms_code_hash = Some(tfa::hash_knowledge(&format!("{code:06}")));
        session.sms_issued_at = Some(chrono::Utc::now());
        session.sms_sends += 1;
        session.code_requested = true;
        (session.phone.clone(), code)
    };

    let sender = state.sms_sender.as_ref().ok_or_else(|| {
        AppError::Internal(
            "SMS delivery is not configured on this server — set the relay credentials".into(),
        )
    })?;

    // A carrier failure must not read as a passed factor, and must not leave a
    // live code behind. Clear it before reporting the failure.
    let echoed = match tfa::SmsSender::send_code(sender.as_ref(), &phone, code) {
        Ok(v) => v,
        Err(e) => {
            let mut sessions = state.three_factor_sessions.write().await;
            if let Some(s) = sessions.get_mut(&session_id) {
                s.sms_code_hash = None;
                s.sms_issued_at = None;
            }
            tracing::error!(error = %e, "Gate SMS delivery failed");
            return Err(AppError::Internal(
                "The confirmation text could not be delivered — try again shortly".into(),
            ));
        }
    };

    let mut out = vec![
        ("sent", "1".to_string()),
        ("phone_hint", mask_phone(&phone)),
        ("expires", tfa::SMS_CODE_TTL_SECS.to_string()),
        (
            "sends_left",
            tfa::MAX_SMS_SENDS.saturating_sub(1).to_string(),
        ),
    ];
    // Second, independent guard on the echo. The console sender is the only
    // one that returns a code and it cannot be selected outside a positively
    // identified development environment — but the response boundary re-checks
    // rather than trusting that, because the cost of being wrong is a live
    // one-time code handed to whoever asked.
    if let (Some(c), true) = (echoed, sender.echoes_code()) {
        out.push(("dev_code", format!("{c:06}")));
    }
    Ok(wire_ok(&out))
}

/// POST /api/gate/sms/verify — Factor 3 (delivered SMS code).
/// Fields: `session` `code`. Returns `ok 1`.
async fn gate_sms_verify(
    State(state): State<AppState>,
    body: String,
) -> Result<Response, AppError> {
    let f = tfa::wire::parse(&body);
    let session_id: Uuid = f
        .get("session")
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| AppError::Validation("valid session required".into()))?;
    let code = f
        .get("code")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Validation("code required".into()))?;

    let mut sessions = state.three_factor_sessions.write().await;
    let session = sessions
        .get_mut(&session_id)
        .filter(|s| !s.is_expired())
        .ok_or(AppError::NotFound("Gate session not found or expired".into()))?;
    if !session.possession_ok {
        return Err(AppError::Forbidden("Complete the step before this one first".into()));
    }
    if session.sms_attempts >= tfa::MAX_FACTOR_ATTEMPTS {
        sessions.remove(&session_id);
        return Err(AppError::Unauthorized(
            "Too many wrong codes — session burned, please restart".into(),
        ));
    }

    let issued = session.sms_issued_at;
    let expected = session.sms_code_hash;
    let fresh = issued
        .map(|t| (chrono::Utc::now() - t).num_seconds() <= tfa::SMS_CODE_TTL_SECS)
        .unwrap_or(false);
    let matches = expected == Some(tfa::hash_knowledge(&code));

    if !fresh || !matches {
        session.sms_attempts += 1;
        // Burn a stale code either way, so an expired one cannot be retried.
        if !fresh {
            session.sms_code_hash = None;
            session.sms_issued_at = None;
        }
        if session.sms_attempts >= tfa::MAX_FACTOR_ATTEMPTS {
            sessions.remove(&session_id);
            return Err(AppError::Unauthorized(
                "Too many wrong codes — session burned, please restart".into(),
            ));
        }
        return Err(AppError::Unauthorized(if expected.is_none() {
            "No code is outstanding — ask the Gate to send one".into()
        } else if fresh {
            "That code does not match the one we sent".into()
        } else {
            "That code has expired — ask the Gate for another".into()
        }));
    }

    // Single use: spend the code the moment it succeeds.
    session.sms_code_hash = None;
    session.sms_issued_at = None;
    session.sms_ok = true;
    Ok(wire_ok(&[("ok", "1".into())]))
}

/// How long an opaque gate handle stays valid before the operator must pass
/// all three factors again. There is no refresh token: a handle is cheap to
/// re-mint and, unlike a JWT, can be revoked the instant it is not wanted.
const GATE_SESSION_HOURS: i64 = 12;

/// POST /api/gate/codepoint — Factor 3 (Crystal cube) → open the session.
/// Fields: `session` `cube` (dotted trits). On success returns
/// `handle <64 hex>` `expires <unix seconds>`.
///
/// No JWT is issued. The handle is 32 opaque bytes; every claim about the
/// operator is read back out of `gate_sessions` server-side.
async fn gate_codepoint(
    State(state): State<AppState>,
    body: String,
) -> Result<Response, AppError> {
    let f = tfa::wire::parse(&body);
    let session_id: Uuid = f
        .get("session")
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| AppError::Validation("valid session required".into()))?;
    let cube = f.get("cube").cloned().unwrap_or_default();
    let (x, y, z) = tfa::wire::parse_cube(&cube)
        .ok_or_else(|| AppError::Validation("cube must be three trits 1..3".into()))?;

    // Verify the codepoint and pull the account identity out of the session.
    let (user_id, org_id) = {
        let mut sessions = state.three_factor_sessions.write().await;
        let session = sessions
            .get_mut(&session_id)
            .filter(|s| !s.is_expired() && s.user_id.is_some())
            .ok_or(AppError::NotFound("Gate session not found or expired".into()))?;
        if !session.knowledge_ok || !session.possession_ok {
            return Err(AppError::Forbidden(
                "Complete the credentials and the Θ-lock first".into(),
            ));
        }
        // The SMS confirmation is required exactly when a handset is enrolled.
        // An account with no number on file has nothing to text and is not held
        // at a stage it could never clear.
        if !session.phone.trim().is_empty() && !session.sms_ok {
            return Err(AppError::Forbidden(
                "Enter the code we texted you first".into(),
            ));
        }
        // Cap brute force on the codepoint — only 27 cubes exist, so an
        // uncapped session would let an attacker who already holds factors 1+2
        // enumerate the third. Burn the session once the cap is hit.
        if session.codepoint_attempts >= tfa::MAX_FACTOR_ATTEMPTS {
            sessions.remove(&session_id);
            return Err(AppError::Unauthorized(
                "Too many failed cube attempts — session burned, please restart".into(),
            ));
        }
        let auth = ThreeFactorAuthenticator::new(ConsoleSmsSender);
        let point = tfa::Codepoint::new(x, y, z);
        let expected = ThreeFactorAuthenticator::<ConsoleSmsSender>::expected_codepoint_scalar(
            &session.expected_codepoint,
            session.moving_factor,
        );
        if !auth.verify_codepoint_factor(&point, expected, session.moving_factor) {
            session.codepoint_attempts += 1;
            // Burn immediately if this failure exhausts the budget.
            if session.codepoint_attempts >= tfa::MAX_FACTOR_ATTEMPTS {
                sessions.remove(&session_id);
                return Err(AppError::Unauthorized(
                    "Too many failed cube attempts — session burned, please restart".into(),
                ));
            }
            return Err(AppError::Unauthorized(
                "Those aren't the three numbers you chose when you set up this account".into(),
            ));
        }
        let uid = session.user_id.expect("filtered on is_some");
        let org_id = session.org_id.expect("user session carries org");
        // Single-use — consume the session now that all factors passed.
        sessions.remove(&session_id);
        (uid, org_id)
    };

    // All three factors satisfied — open a session. The operator receives an
    // opaque handle, not a token that describes them: nothing about their
    // identity travels back to the client or is trusted from it afterwards.
    let handle = GateHandle::generate();
    let expires_at = chrono::Utc::now() + chrono::Duration::hours(GATE_SESSION_HOURS);
    sqlx::query(
        "INSERT INTO gate_sessions (token_digest, user_id, org_id, expires_at) \
         VALUES ($1, $2, $3, $4)",
    )
    .bind(handle.digest().to_vec())
    .bind(user_id)
    .bind(org_id)
    .bind(expires_at)
    .execute(&state.db)
    .await
    .map_err(AppError::Database)?;

    // Hex bytes → wire. This is the only point the handle becomes text.
    let hex = handle.to_hex();
    let handle_wire = core::str::from_utf8(&hex)
        .expect("hex is ASCII")
        .to_string();

    Ok(wire_ok(&[
        ("handle", handle_wire),
        ("expires", expires_at.timestamp().to_string()),
    ]))
}

// ═══════════════════════════════════════════════════════════════════════
// Inline handlers (kept here for routes that don't warrant their own module)
// ═══════════════════════════════════════════════════════════════════════

// ─── LLM Gateway health ───────────────────────────────────────────────

async fn llm_health(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    match &state.llm_gateway {
        Some(gateway) => {
            let status = gateway.health_check().await;
            Json(serde_json::json!({
                "alpha": status.alpha,
                "beta": status.beta,
                "gamma": status.gamma,
                "any_available": status.any_available,
                "all_available": status.all_available,
            }))
        }
        None => Json(serde_json::json!({
            "alpha": false,
            "beta": false,
            "gamma": false,
            "any_available": false,
            "all_available": false,
            "note": "Cloud LLM gateway not configured — set ANTHROPIC_API_KEY + OPENAI_API_KEY + TOGETHER_API_KEY"
        })),
    }
}

// ─── Lineages ────────────────────────────────────────────────────────

async fn get_lineages(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let content = std::fs::read_to_string(&state.lineages_path)
        .map_err(|e| AppError::Internal(format!("Failed to read lineages: {}", e)))?;
    let value: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| AppError::Internal(format!("Invalid lineages JSON: {}", e)))?;
    Ok(Json(value))
}

// ─── Projects ────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct CreateProjectRequest { name: String, mode: String }

fn project_json(
    id: Uuid, name: String, mode: String,
    settings: serde_json::Value,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
) -> serde_json::Value {
    serde_json::json!({
        "id": id, "name": name, "mode": mode, "settings": settings,
        "created_at": created_at, "updated_at": updated_at,
    })
}

async fn create_project(
    State(state): State<AppState>,
    user: axum::Extension<auth::AuthenticatedUser>,
    Json(req): Json<CreateProjectRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    if !["yoda", "ronin"].contains(&req.mode.as_str()) {
        return Err(AppError::Validation("Mode must be 'yoda' or 'ronin'".into()));
    }
    let id = Uuid::new_v4();
    let now = chrono::Utc::now();
    let settings = serde_json::json!({
        "review_intensity": if req.mode == "ronin" { "full" } else { "medium" },
        "decomposition_budget": 30, "auto_archive_months": 24
    });
    sqlx::query(
        "INSERT INTO projects (id, org_id, name, mode, settings, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$6)"
    ).bind(id).bind(user.org_id).bind(&req.name).bind(&req.mode).bind(&settings).bind(now)
        .execute(&state.db).await.map_err(AppError::Database)?;
    Ok((StatusCode::CREATED, Json(serde_json::json!({
        "project": project_json(id, req.name, req.mode, settings, now, now)
    }))))
}

async fn list_projects(
    State(state): State<AppState>,
    user: axum::Extension<auth::AuthenticatedUser>,
) -> Result<Json<serde_json::Value>, AppError> {
    let rows = sqlx::query_as::<_, (Uuid, String, String, serde_json::Value, chrono::DateTime<chrono::Utc>, chrono::DateTime<chrono::Utc>)>(
        "SELECT id, name, mode, settings, created_at, updated_at FROM projects WHERE org_id = $1 ORDER BY updated_at DESC"
    ).bind(user.org_id).fetch_all(&state.db).await.map_err(AppError::Database)?;
    let projects: Vec<serde_json::Value> = rows.into_iter()
        .map(|(id,name,mode,settings,ca,ua)| project_json(id,name,mode,settings,ca,ua))
        .collect();
    Ok(Json(serde_json::json!({ "projects": projects })))
}

async fn get_project(
    State(state): State<AppState>,
    user: axum::Extension<auth::AuthenticatedUser>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let (id,name,mode,settings,ca,ua) = sqlx::query_as::<_, (Uuid,String,String,serde_json::Value,chrono::DateTime<chrono::Utc>,chrono::DateTime<chrono::Utc>)>(
        "SELECT id, name, mode, settings, created_at, updated_at FROM projects WHERE id = $1 AND org_id = $2"
    ).bind(project_id).bind(user.org_id).fetch_optional(&state.db).await
        .map_err(AppError::Database)?.ok_or(AppError::NotFound("Project not found".into()))?;
    Ok(Json(serde_json::json!({ "project": project_json(id,name,mode,settings,ca,ua) })))
}

#[derive(Debug, Deserialize)]
struct UpdateProjectRequest { name: Option<String>, mode: Option<String>, settings: Option<serde_json::Value> }

async fn update_project(
    State(state): State<AppState>,
    user: axum::Extension<auth::AuthenticatedUser>,
    Path(project_id): Path<Uuid>,
    Json(req): Json<UpdateProjectRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let (cur_name,cur_mode,cur_settings,created_at) = sqlx::query_as::<_, (String,String,serde_json::Value,chrono::DateTime<chrono::Utc>)>(
        "SELECT name, mode, settings, created_at FROM projects WHERE id = $1 AND org_id = $2"
    ).bind(project_id).bind(user.org_id).fetch_optional(&state.db).await
        .map_err(AppError::Database)?.ok_or(AppError::NotFound("Project not found".into()))?;
    let name = req.name.unwrap_or(cur_name);
    let mode = req.mode.unwrap_or(cur_mode);
    let settings = req.settings.unwrap_or(cur_settings);
    let now = chrono::Utc::now();
    sqlx::query("UPDATE projects SET name=$1, mode=$2, settings=$3, updated_at=$4 WHERE id=$5")
        .bind(&name).bind(&mode).bind(&settings).bind(now).bind(project_id)
        .execute(&state.db).await.map_err(AppError::Database)?;
    Ok(Json(serde_json::json!({ "project": project_json(project_id,name,mode,settings,created_at,now) })))
}

async fn delete_project(
    State(state): State<AppState>,
    user: axum::Extension<auth::AuthenticatedUser>,
    Path(project_id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let r = sqlx::query("DELETE FROM projects WHERE id=$1 AND org_id=$2")
        .bind(project_id).bind(user.org_id).execute(&state.db).await.map_err(AppError::Database)?;
    if r.rows_affected() == 0 { return Err(AppError::NotFound("Project not found".into())); }
    Ok(StatusCode::NO_CONTENT)
}

// ─── Tasks ───────────────────────────────────────────────────────────

async fn list_tasks(
    State(state): State<AppState>,
    user: axum::Extension<auth::AuthenticatedUser>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let _ = sqlx::query_scalar::<_,Uuid>("SELECT id FROM projects WHERE id=$1 AND org_id=$2")
        .bind(project_id).bind(user.org_id).fetch_optional(&state.db).await
        .map_err(AppError::Database)?.ok_or(AppError::NotFound("Project not found".into()))?;
    let rows = sqlx::query_as::<_, (Uuid,Uuid,String,String,String,String,serde_json::Value,serde_json::Value,Option<i32>,Option<String>,Option<String>,chrono::DateTime<chrono::Utc>,chrono::DateTime<chrono::Utc>,Option<String>,Option<Uuid>)>(
        "SELECT id,project_id,task_number,title,status,mode,competencies,dependencies,workflow_position,primary_engine_slot,primary_agent_role,created_at,updated_at,error_message,parent_task_id FROM tasks WHERE project_id=$1 ORDER BY workflow_position,task_number"
    ).bind(project_id).fetch_all(&state.db).await.map_err(AppError::Database)?;
    let tasks: Vec<serde_json::Value> = rows.into_iter().map(|(id,pid,tn,t,s,m,c,d,wp,pe,par,ca,ua,em,parent)| {
        serde_json::json!({
            "id": id, "project_id": pid, "task_number": tn, "title": t,
            "status": s, "mode": m, "competencies": c, "dependencies": d,
            "workflow_position": wp, "primary_engine": pe, "primary_agent_role": par,
            "parent_task_id": parent,
            "error_message": em,
            "created_at": ca, "updated_at": ua,
        })
    }).collect();
    Ok(Json(serde_json::json!({ "tasks": tasks })))
}

// ─── Threads (Task #29) ──────────────────────────────────────────────
//
// Threads are root tasks (parent_task_id IS NULL). Each thread carries
// pinned/archived metadata and rolls up status from its descendants.

#[derive(Debug, Deserialize)]
struct ThreadListQuery {
    #[serde(default, alias = "archived")]
    include_archived: Option<bool>,
    #[serde(default, alias = "q")]
    search: Option<String>,
}

async fn list_threads(
    State(state): State<AppState>,
    user: axum::Extension<auth::AuthenticatedUser>,
    Path(project_id): Path<Uuid>,
    Query(params): Query<ThreadListQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let _ = sqlx::query_scalar::<_, Uuid>("SELECT id FROM projects WHERE id=$1 AND org_id=$2")
        .bind(project_id).bind(user.org_id).fetch_optional(&state.db).await
        .map_err(AppError::Database)?.ok_or(AppError::NotFound("Project not found".into()))?;

    let include_archived = params.include_archived.unwrap_or(false);
    let search = params.search.unwrap_or_default();
    let has_search = !search.trim().is_empty();
    let search_pattern = format!("%{}%", search.trim().to_lowercase());

    // Opportunistic cleanup: hard-delete any root thread (and descendants)
    // whose deletion_scheduled_at has passed. Cheap thanks to partial index.
    let expired: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM tasks \
          WHERE project_id = $1 AND parent_task_id IS NULL \
            AND deletion_scheduled_at IS NOT NULL AND deletion_scheduled_at < NOW()"
    )
    .bind(project_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    for root_id in expired {
        let _ = sqlx::query(
            "WITH RECURSIVE descendants AS (\
               SELECT id FROM tasks WHERE parent_task_id = $1 \
               UNION ALL \
               SELECT t.id FROM tasks t JOIN descendants d ON t.parent_task_id = d.id\
             ) DELETE FROM tasks WHERE id IN (SELECT id FROM descendants)"
        ).bind(root_id).execute(&state.db).await;
        let _ = sqlx::query("DELETE FROM tasks WHERE id = $1")
            .bind(root_id).execute(&state.db).await;
    }

    // Roll-up: walk descendants for each root and aggregate status + latest activity.
    let rows = sqlx::query_as::<_, (
        Uuid, String, String, String, chrono::DateTime<chrono::Utc>,
        chrono::DateTime<chrono::Utc>, bool, bool, Option<chrono::DateTime<chrono::Utc>>,
        Option<chrono::DateTime<chrono::Utc>>,
        i64, i64, i64, i64, Option<chrono::DateTime<chrono::Utc>>,
    )>(
        "WITH RECURSIVE descendants AS (\
           SELECT id AS root_id, id, status, updated_at FROM tasks \
             WHERE project_id = $1 AND parent_task_id IS NULL \
           UNION ALL \
           SELECT d.root_id, t.id, t.status, t.updated_at \
             FROM tasks t JOIN descendants d ON t.parent_task_id = d.id\
         ), agg AS (\
           SELECT root_id, \
                  COUNT(*) FILTER (WHERE id <> root_id) AS subtask_count, \
                  COUNT(*) FILTER (WHERE status = 'ESCALATED') AS escalated_count, \
                  COUNT(*) FILTER (WHERE status IN ('FINAL','ESCALATED','CANCELLED')) AS terminal_count, \
                  COUNT(*) AS total_count, \
                  MAX(updated_at) AS latest_activity \
             FROM descendants GROUP BY root_id\
         ) \
         SELECT t.id, t.task_number, t.title, t.status, t.created_at, t.updated_at, \
                t.pinned, t.archived, t.archived_at, t.deletion_scheduled_at, \
                COALESCE(agg.subtask_count, 0), \
                COALESCE(agg.escalated_count, 0), \
                COALESCE(agg.terminal_count, 0), \
                COALESCE(agg.total_count, 1), \
                agg.latest_activity \
           FROM tasks t LEFT JOIN agg ON agg.root_id = t.id \
          WHERE t.project_id = $1 AND t.parent_task_id IS NULL \
            AND ($2 OR t.archived = FALSE) \
            AND (NOT $3 OR LOWER(t.title) LIKE $4)"
    )
    .bind(project_id)
    .bind(include_archived)
    .bind(has_search)
    .bind(&search_pattern)
    .fetch_all(&state.db)
    .await
    .map_err(AppError::Database)?;

    let mut threads: Vec<serde_json::Value> = rows.into_iter().map(
        |(id, task_number, title, status, created_at, updated_at, pinned, archived, archived_at,
          deletion_scheduled_at,
          subtask_count, escalated_count, terminal_count, total_count, latest_activity)| {
            let latest = latest_activity.unwrap_or(updated_at);
            let rollup = if escalated_count > 0 {
                "escalated"
            } else if status == "FINAL" && terminal_count == total_count {
                "final"
            } else if status == "CANCELLED" && terminal_count == total_count {
                "cancelled"
            } else if terminal_count < total_count {
                "in_progress"
            } else {
                "idle"
            };
            serde_json::json!({
                "id": id,
                "task_number": task_number,
                "title": title,
                "status": status,
                "rollup_status": rollup,
                "subtask_count": subtask_count,
                "pinned": pinned,
                "archived": archived,
                "archived_at": archived_at,
                "deletion_scheduled_at": deletion_scheduled_at,
                "created_at": created_at,
                "updated_at": updated_at,
                "latest_activity": latest,
            })
        }
    ).collect();

    // Sort: pinned first (by latest_activity desc), then unpinned (by latest_activity desc).
    threads.sort_by(|a, b| {
        let ap = a.get("pinned").and_then(|v| v.as_bool()).unwrap_or(false);
        let bp = b.get("pinned").and_then(|v| v.as_bool()).unwrap_or(false);
        if ap != bp { return bp.cmp(&ap); }
        let al = a.get("latest_activity").and_then(|v| v.as_str()).unwrap_or("");
        let bl = b.get("latest_activity").and_then(|v| v.as_str()).unwrap_or("");
        bl.cmp(al)
    });

    Ok(Json(serde_json::json!({ "threads": threads })))
}

#[derive(Debug, Deserialize)]
struct UpdateThreadRequest {
    title: Option<String>,
    pinned: Option<bool>,
    archived: Option<bool>,
}

async fn update_thread(
    State(state): State<AppState>,
    user: axum::Extension<auth::AuthenticatedUser>,
    Path((project_id, thread_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<UpdateThreadRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Verify the thread belongs to this project & org and is a root task.
    let owned = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM tasks t JOIN projects p ON p.id = t.project_id \
          WHERE t.id = $1 AND t.project_id = $2 AND p.org_id = $3 AND t.parent_task_id IS NULL)"
    )
    .bind(thread_id).bind(project_id).bind(user.org_id)
    .fetch_one(&state.db).await.map_err(AppError::Database)?;
    if !owned {
        return Err(AppError::NotFound("Thread not found".into()));
    }

    if let Some(ref t) = req.title {
        if t.trim().is_empty() {
            return Err(AppError::Validation("Thread title cannot be empty".into()));
        }
    }

    let now = chrono::Utc::now();
    let archived_at = req.archived.map(|a| if a { Some(now) } else { None });
    // Restoring a thread (archived=false) clears any pending deletion timer.
    let clear_deletion = matches!(req.archived, Some(false));

    sqlx::query(
        "UPDATE tasks SET \
           title       = COALESCE($1, title), \
           pinned      = COALESCE($2, pinned), \
           archived    = COALESCE($3, archived), \
           archived_at = CASE WHEN $4::bool THEN $5 ELSE archived_at END, \
           deletion_scheduled_at = CASE WHEN $6::bool THEN NULL ELSE deletion_scheduled_at END, \
           updated_at  = $7 \
         WHERE id = $8"
    )
    .bind(req.title.as_ref().map(|s| s.trim().to_string()))
    .bind(req.pinned)
    .bind(req.archived)
    .bind(req.archived.is_some())
    .bind(archived_at.flatten())
    .bind(clear_deletion)
    .bind(now)
    .bind(thread_id)
    .execute(&state.db).await.map_err(AppError::Database)?;

    Ok(Json(serde_json::json!({ "ok": true, "thread_id": thread_id })))
}

#[derive(Debug, Deserialize, Default)]
struct DeleteThreadQuery {
    #[serde(default)]
    permanent: Option<bool>,
}

/// Soft-delete by default: archive the thread and schedule a hard-delete in 30 days.
/// The thread remains recoverable from the archived list (PATCH archived=false)
/// during that window. Pass `?permanent=true` to bypass the grace period and
/// hard-delete the root + all descendants immediately.
async fn delete_thread(
    State(state): State<AppState>,
    user: axum::Extension<auth::AuthenticatedUser>,
    Path((project_id, thread_id)): Path<(Uuid, Uuid)>,
    Query(params): Query<DeleteThreadQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let owned = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM tasks t JOIN projects p ON p.id = t.project_id \
          WHERE t.id = $1 AND t.project_id = $2 AND p.org_id = $3 AND t.parent_task_id IS NULL)"
    )
    .bind(thread_id).bind(project_id).bind(user.org_id)
    .fetch_one(&state.db).await.map_err(AppError::Database)?;
    if !owned {
        return Err(AppError::NotFound("Thread not found".into()));
    }

    let permanent = params.permanent.unwrap_or(false);

    if permanent {
        // Two-step delete: descendants first (parent_task_id is ON DELETE SET NULL,
        // not CASCADE), then the root. Use a recursive CTE to collect all descendants.
        sqlx::query(
            "WITH RECURSIVE descendants AS (\
               SELECT id FROM tasks WHERE parent_task_id = $1 \
               UNION ALL \
               SELECT t.id FROM tasks t JOIN descendants d ON t.parent_task_id = d.id\
             ) DELETE FROM tasks WHERE id IN (SELECT id FROM descendants)"
        )
        .bind(thread_id)
        .execute(&state.db).await.map_err(AppError::Database)?;

        sqlx::query("DELETE FROM tasks WHERE id = $1")
            .bind(thread_id)
            .execute(&state.db).await.map_err(AppError::Database)?;

        return Ok(Json(serde_json::json!({
            "ok": true, "thread_id": thread_id, "permanent": true
        })));
    }

    // Soft delete: archive + schedule hard-delete in 30 days.
    let now = chrono::Utc::now();
    let scheduled = now + chrono::Duration::days(30);
    sqlx::query(
        "UPDATE tasks SET archived = TRUE, archived_at = $1, \
            deletion_scheduled_at = $2, updated_at = $1 \
          WHERE id = $3"
    )
    .bind(now)
    .bind(scheduled)
    .bind(thread_id)
    .execute(&state.db).await.map_err(AppError::Database)?;

    Ok(Json(serde_json::json!({
        "ok": true,
        "thread_id": thread_id,
        "permanent": false,
        "deletion_scheduled_at": scheduled,
    })))
}

/// GET /api/tasks/recent — most recent tasks across all projects for this org.
/// Used by the Agent Roster panel to show live system activity (no simulation).
async fn list_recent_tasks(
    State(state): State<AppState>,
    user: axum::Extension<auth::AuthenticatedUser>,
) -> Result<Json<serde_json::Value>, AppError> {
    let rows = sqlx::query_as::<_, (Uuid, String, String, String, chrono::DateTime<chrono::Utc>)>(
        "SELECT t.id, t.task_number, t.title, t.status, t.created_at \
         FROM tasks t \
         JOIN projects p ON p.id = t.project_id \
         WHERE p.org_id = $1 \
         ORDER BY t.created_at DESC \
         LIMIT 10",
    )
    .bind(user.org_id)
    .fetch_all(&state.db)
    .await
    .map_err(AppError::Database)?;

    let tasks: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|(id, task_number, title, status, created_at)| {
            serde_json::json!({
                "id": id,
                "task_number": task_number,
                "title": title,
                "status": status,
                "created_at": created_at,
            })
        })
        .collect();

    Ok(Json(serde_json::json!({ "tasks": tasks })))
}

async fn get_task(State(state): State<AppState>, Path(task_id): Path<Uuid>) -> Result<Json<serde_json::Value>, AppError> {
    let (id,pid,tn,t,s,m,c,d,wp,pe,par,ca,ua,em) = sqlx::query_as::<_, (Uuid,Uuid,String,String,String,String,serde_json::Value,serde_json::Value,Option<i32>,Option<String>,Option<String>,chrono::DateTime<chrono::Utc>,chrono::DateTime<chrono::Utc>,Option<String>)>(
        "SELECT id,project_id,task_number,title,status,mode,competencies,dependencies,workflow_position,primary_engine_slot,primary_agent_role,created_at,updated_at,error_message FROM tasks WHERE id=$1"
    ).bind(task_id).fetch_optional(&state.db).await.map_err(AppError::Database)?.ok_or(AppError::NotFound("Task not found".into()))?;

    let task = serde_json::json!({
        "id": id, "project_id": pid, "task_number": tn, "title": t,
        "status": s, "mode": m, "competencies": c, "dependencies": d,
        "workflow_position": wp, "primary_engine": pe, "primary_agent_role": par,
        "parent_task_id": serde_json::Value::Null,
        "error_message": em,
        "created_at": ca, "updated_at": ua,
    });

    let result_rows = sqlx::query_as::<_, (Uuid, i16, String, String, String)>(
        "SELECT id, step_number, result_content, engine_slot, agent_role FROM task_results WHERE task_id=$1 ORDER BY step_number"
    ).bind(task_id).fetch_all(&state.db).await.map_err(AppError::Database)?;

    let results: Vec<serde_json::Value> = result_rows.into_iter().map(|(rid, sn, rc, es, ar)| serde_json::json!({
        "id": rid, "task_id": task_id, "step_number": sn,
        "result_content": rc, "engine_id": es, "agent_role": ar,
        "tis27_hash": "", "created_at": ca,
    })).collect();

    let message_rows = sqlx::query_as::<_, (Uuid, String, String, chrono::DateTime<chrono::Utc>)>(
        "SELECT id, role, content, created_at FROM task_messages WHERE task_id=$1 ORDER BY created_at"
    ).bind(task_id).fetch_all(&state.db).await.unwrap_or_default();

    let messages: Vec<serde_json::Value> = message_rows.into_iter().map(|(mid, role, content, msg_ca)| serde_json::json!({
        "id": mid, "task_id": task_id, "role": role, "content": content, "created_at": msg_ca,
    })).collect();

    Ok(Json(serde_json::json!({ "task": task, "results": results, "reviews": [], "messages": messages })))
}

#[derive(Debug, Deserialize)]
struct AddMessageRequest {
    text: String,
}

async fn add_task_message(
    State(state): State<AppState>,
    user: axum::Extension<auth::AuthenticatedUser>,
    Path(task_id): Path<Uuid>,
    Json(req): Json<AddMessageRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    if req.text.trim().is_empty() {
        return Err(AppError::Validation("text is required".into()));
    }

    // Verify ownership
    let owned = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM tasks t JOIN projects p ON p.id = t.project_id \
         WHERE t.id = $1 AND p.org_id = $2)"
    )
    .bind(task_id)
    .bind(user.org_id)
    .fetch_one(&state.db)
    .await
    .map_err(AppError::Database)?;

    if !owned {
        return Err(AppError::NotFound("Task not found".into()));
    }

    // Fetch existing messages for conversation context
    let existing: Vec<(String, String)> = sqlx::query_as::<_, (String, String)>(
        "SELECT role, content FROM task_messages WHERE task_id=$1 ORDER BY created_at"
    )
    .bind(task_id)
    .fetch_all(&state.db)
    .await
    .map_err(AppError::Database)?;

    // Build full conversation history for the LLM
    // R2-4: Read the agent assigned at task creation instead of re-inferring from title.
    let agent_prompt = {
        let stored_role: Option<String> = sqlx::query_scalar(
            "SELECT primary_agent_role FROM tasks WHERE id = $1"
        )
        .bind(task_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

        match stored_role.as_deref() {
            Some(role) if !role.is_empty() => {
                // Use the stored agent's system prompt if it's still in the registry.
                if let Some(agent) = state.agents.get(role) {
                    agent.system_prompt.clone()
                } else {
                    // Agent compiled out of the registry since task was created — re-infer.
                    tracing::warn!(
                        task_id = %task_id, role = %role,
                        "Stored agent role not found in registry — falling back to competency match"
                    );
                    let task_title: Option<String> = sqlx::query_scalar(
                        "SELECT title FROM tasks WHERE id = $1"
                    )
                    .bind(task_id)
                    .fetch_optional(&state.db)
                    .await
                    .ok()
                    .flatten();
                    let title = task_title.as_deref().unwrap_or("");
                    let competencies = query::infer_competencies_pub(title);
                    state.agents.find_best_match(&competencies)
                        .map(|a| a.system_prompt.clone())
                        .unwrap_or_else(|_| default_yoda_prompt())
                }
            }
            _ => {
                // No stored agent — fall back to competency inference from title
                let task_title: Option<String> = sqlx::query_scalar(
                    "SELECT title FROM tasks WHERE id = $1"
                )
                .bind(task_id)
                .fetch_optional(&state.db)
                .await
                .ok()
                .flatten();
                let title = task_title.as_deref().unwrap_or("");
                let competencies = query::infer_competencies_pub(title);
                state.agents.find_best_match(&competencies)
                    .map(|a| a.system_prompt.clone())
                    .unwrap_or_else(|_| default_yoda_prompt())
            }
        }
    };

    let mut msgs = vec![serde_json::json!({
        "role": "system",
        "content": agent_prompt
    })];
    for (role, content) in &existing {
        msgs.push(serde_json::json!({ "role": role, "content": content }));
    }
    msgs.push(serde_json::json!({ "role": "user", "content": req.text }));
    let messages = serde_json::Value::Array(msgs);

    // Insert user message into thread
    sqlx::query("INSERT INTO task_messages (task_id, role, content) VALUES ($1, 'user', $2)")
        .bind(task_id)
        .bind(&req.text)
        .execute(&state.db)
        .await
        .map_err(AppError::Database)?;

    // Determine next step number
    let next_step: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(step_number), 0) + 1 FROM task_results WHERE task_id=$1"
    )
    .bind(task_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(1);

    // Fetch engine info
    let engine_info: Option<(String, String)> = sqlx::query_as(
        "SELECT slot, COALESCE(model_name, '') FROM engine_configs \
         WHERE org_id = $1 AND endpoint_url IS NOT NULL AND endpoint_url <> '' \
         AND hosting_mode = 'self_hosted' AND is_disabled = false \
         ORDER BY slot ASC LIMIT 1"
    )
    .bind(user.org_id)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);

    let (engine_slot, engine_model) = match engine_info {
        Some((s, m)) => (Some(s), m),
        None => (None, String::new()),
    };

    let live_cube_address: Option<String> = sqlx::query_scalar(
        "SELECT address_str FROM crs_registrations \
         WHERE last_heartbeat > NOW() - INTERVAL '5 minutes' \
         ORDER BY last_heartbeat DESC LIMIT 1"
    )
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);

    // Reset task status so UI shows it's working
    let _ = sqlx::query(
        "UPDATE tasks SET status='QUEUED', error_message=NULL, updated_at=NOW() WHERE id=$1"
    )
    .bind(task_id)
    .execute(&state.db)
    .await;

    if let Some(ref slot) = engine_slot {
        if let Some(relay_tx) = state.relay_tx.read().await.clone() {
            let preferred_addr = slot_to_cube_address(slot.as_str()).to_string();
            let live_peers_set = state.live_cube_peer.read().await.clone();

            let mut cube_peers: Vec<String> = live_peers_set.into_iter().collect();
            if let Some(pos) = cube_peers.iter().position(|p| p == &preferred_addr) {
                cube_peers.swap(0, pos);
            }
            if cube_peers.is_empty() {
                if let Some(addr) = live_cube_address.clone() {
                    cube_peers.push(addr);
                }
            }

            if !cube_peers.is_empty() {
                let _ = sqlx::query(
                    "UPDATE tasks SET status='STEP_1_PRODUCTION', updated_at=NOW() WHERE id=$1"
                )
                .bind(task_id)
                .execute(&state.db)
                .await;

                // Cancel any existing bg inference for this task and create fresh token
                let cancel_token = {
                    let token = tokio_util::sync::CancellationToken::new();
                    let mut tokens = state.task_cancel_tokens.write().await;
                    if let Some(old) = tokens.insert(task_id, token.clone()) {
                        old.cancel();
                        tracing::info!(task_id = %task_id, "Cancelled previous bg inference before follow-up");
                    }
                    token
                };

                query::spawn_bg_inference(
                    state.clone(),
                    relay_tx,
                    task_id,
                    cube_peers,
                    slot.clone(),
                    engine_model,
                    messages,
                    next_step as i32,
                    cancel_token,
                );
            }
        }
    }

    Ok(Json(serde_json::json!({ "task_id": task_id, "ok": true })))
}

async fn retry_task(State(state): State<AppState>, user: axum::Extension<auth::AuthenticatedUser>, Path(task_id): Path<Uuid>) -> Result<Json<serde_json::Value>, AppError> {
    let mut tx = state.db.begin().await?;
    let status: Option<String> = sqlx::query_scalar(
        "SELECT t.status FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=$1 AND p.org_id=$2 FOR UPDATE OF t")
        .bind(task_id).bind(user.org_id).fetch_optional(&mut *tx).await?;
    match status.as_deref() {
        None => return Err(AppError::NotFound("Task not found".into())),
        Some("ESCALATED") => {},
        _ => return Err(AppError::Validation("Only an escalated task can be retried".into())),
    }
    sqlx::query("UPDATE agent_worker_attempts SET attempts=0,next_attempt_at=NOW(),last_error=NULL WHERE task_id=$1")
        .bind(task_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE tasks SET status='QUEUED',error_message=NULL,updated_at=NOW() WHERE id=$1")
        .bind(task_id).execute(&mut *tx).await?;
    tx.commit().await?;
    get_task(State(state),Path(task_id)).await
}

async fn escalate_task(State(state): State<AppState>, Path(task_id): Path<Uuid>) -> Result<Json<serde_json::Value>, AppError> {
    sqlx::query("UPDATE tasks SET status='ESCALATED' WHERE id=$1").bind(task_id).execute(&state.db).await.map_err(AppError::Database)?;
    get_task(State(state), Path(task_id)).await
}

async fn cancel_task(State(state): State<AppState>, Path(task_id): Path<Uuid>) -> Result<StatusCode, AppError> {
    // Cancel the background inference token first
    {
        let mut tokens = state.task_cancel_tokens.write().await;
        if let Some(token) = tokens.remove(&task_id) {
            token.cancel();
            tracing::info!(task_id = %task_id, "Cancelled bg inference token on task cancel");
        }
    }

    sqlx::query("UPDATE tasks SET status='ESCALATED' WHERE id=$1 AND status NOT IN ('FINAL','ESCALATED')")
        .bind(task_id).execute(&state.db).await.map_err(AppError::Database)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_task(
    State(state): State<AppState>,
    user: axum::Extension<auth::AuthenticatedUser>,
    Path(task_id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    // Verify ownership via project membership before deleting
    let owned = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM tasks t JOIN projects p ON p.id = t.project_id \
         WHERE t.id = $1 AND p.org_id = $2)"
    )
    .bind(task_id)
    .bind(user.org_id)
    .fetch_one(&state.db)
    .await
    .map_err(AppError::Database)?;

    if !owned {
        return Err(AppError::NotFound("Task not found".into()));
    }

    sqlx::query("DELETE FROM tasks WHERE id = $1")
        .bind(task_id)
        .execute(&state.db)
        .await
        .map_err(AppError::Database)?;

    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/tasks/:id/output
/// Browser relay: the frontend calls the local llama-server directly and
/// posts the completed inference result here. Marks the task as FINAL.
#[derive(Debug, Deserialize)]
struct TaskOutputRequest {
    content: String,
    model: Option<String>,
    latency_ms: Option<i32>,
}

async fn set_task_output(
    State(state): State<AppState>,
    Path(task_id): Path<Uuid>,
    Json(req): Json<TaskOutputRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Store the result and mark the task complete
    sqlx::query(
        "UPDATE tasks SET status = 'FINAL', updated_at = NOW() WHERE id = $1 \
         AND status NOT IN ('FINAL', 'ESCALATED')"
    )
    .bind(task_id)
    .execute(&state.db)
    .await
    .map_err(AppError::Database)?;

    // Insert a task_results row so the workspace page can display it.
    // ON CONFLICT DO UPDATE so idempotent if relay fires twice (UNIQUE task_id+step_number).
    let model_name = req.model.as_deref().unwrap_or("browser-relay");
    let tis27 = format!("relay-{task_id}");
    sqlx::query(
        "INSERT INTO task_results \
           (id, task_id, step_number, engine_slot, engine_model, agent_role, tis27_hash, result_content, created_at) \
         VALUES (uuid_generate_v4(), $1, 1, 'a', $2, 'browser-relay', $3, $4, NOW()) \
         ON CONFLICT (task_id, step_number) DO UPDATE \
           SET result_content = EXCLUDED.result_content, engine_model = EXCLUDED.engine_model"
    )
    .bind(task_id)
    .bind(model_name)
    .bind(&tis27)
    .bind(&req.content)
    .execute(&state.db)
    .await
    .map_err(AppError::Database)?;

    tracing::info!(
        task_id = %task_id,
        model = req.model.as_deref().unwrap_or("unknown"),
        latency_ms = req.latency_ms,
        "Browser-relayed inference result stored"
    );

    Ok(Json(serde_json::json!({ "status": "ok", "task_id": task_id })))
}

/// Default YODA system prompt — delegates to query::DEFAULT_YODA_PROMPT (R3-7).
fn default_yoda_prompt() -> String {
    query::DEFAULT_YODA_PROMPT.to_string()
}

// ─── Engines ─────────────────────────────────────────────────────────
//
// `GET /api/settings/engines` returns both the per-slot engine configs
// AND the singleton `daemons:{host,ports}` block (task #26) that tells
// the Array3 monitor where to probe the three Kernel HTTP daemons.
//
// `PUT /api/settings/engines` accepts a partial body — currently only
// `{daemons:{host,ports}}`.  Per-slot engine writes still go through
// `PUT /api/settings/engines/{slot}`.

/// Load the singleton daemon row, falling back to defaults when the
/// table is empty (covers fresh databases pre-migration-#26).
async fn load_daemons(db: &sqlx::PgPool) -> Result<(String, Vec<i32>), sqlx::Error> {
    let row = sqlx::query_as::<_, (String, Vec<i32>)>(
        "SELECT host, ports FROM daemon_config WHERE id = 1",
    )
    .fetch_optional(db)
    .await?;
    Ok(row.unwrap_or_else(|| ("127.0.0.1".to_string(), vec![11488, 11515, 11906])))
}

#[derive(Debug, Deserialize)]
struct DaemonsPayload {
    host: String,
    ports: Vec<i32>,
}

#[derive(Debug, Deserialize)]
struct UpdateEnginesSettingsRequest {
    daemons: Option<DaemonsPayload>,
}

async fn get_engines(
    State(state): State<AppState>,
    user: axum::Extension<auth::AuthenticatedUser>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Expired evidence must not keep any status surface or scheduler green.
    sqlx::query("UPDATE engine_configs SET health_status='offline' WHERE org_id=$1 AND health_status='online' AND COALESCE((verification->>'expires_at')::timestamptz,'-infinity') <= now()")
        .bind(user.org_id).execute(&state.db).await.map_err(AppError::Database)?;
    sqlx::query("UPDATE engine_configs SET health_status='suspect',verification=verification || '{\"status\":\"suspect\",\"verified\":false,\"error\":\"Verification interrupted or could not persist its result; no certification issued.\"}'::jsonb WHERE org_id=$1 AND verification->>'status'='verifying' AND (verification->>'expires_at')::timestamptz <= now()")
        .bind(user.org_id).execute(&state.db).await.map_err(AppError::Database)?;
    let rows = sqlx::query_as::<_, (Uuid,String,String,String,String,String,String,Option<String>,String,Option<i32>,Option<String>,bool)>(
        "SELECT id,slot,hosting_mode,endpoint_url,auth_type,model_name,model_family,family_override,health_status,avg_latency_ms,cube_endpoint_url,is_disabled FROM engine_configs WHERE org_id=$1 ORDER BY slot"
    ).bind(user.org_id).fetch_all(&state.db).await.map_err(AppError::Database)?;
    let mut engines: Vec<serde_json::Value> = rows.into_iter().map(|(id,slot,hm,eu,at,mn,mf,fo,hs,al,ce,dis)| serde_json::json!({
        "id":id,"slot":slot,"hosting_mode":hm,"endpoint_url":eu,"auth_type":at,
        "model_name":mn,"model_family":mf,"family_override":fo,"health_status":hs,"avg_latency_ms":al,
        "cube_endpoint_url":ce,"is_disabled":dis
    })).collect();
    let proofs = sqlx::query_as::<_,(String,Option<serde_json::Value>)>(
        "SELECT slot,verification FROM engine_configs WHERE org_id=$1")
        .bind(user.org_id).fetch_all(&state.db).await.map_err(AppError::Database)?;
    for engine in &mut engines {
        engine["verification"] = proofs.iter().find(|(slot,_)| engine["slot"]==slot.as_str())
            .and_then(|(_,proof)|proof.clone()).unwrap_or(serde_json::Value::Null);
        engine["operational"] = serde_json::json!(engine["health_status"]=="online" && engine["is_disabled"]==false);
    }

    let (host, ports) = load_daemons(&state.db).await.map_err(AppError::Database)?;
    Ok(Json(serde_json::json!({
        "engines": engines,
        "daemons": { "host": host, "ports": ports },
    })))
}

/// PUT `/api/settings/engines` — currently accepts only the daemons block.
/// Per-slot engine updates use `PUT /api/settings/engines/{slot}` instead.
async fn update_engines_settings(
    State(state): State<AppState>,
    _user: axum::Extension<auth::AuthenticatedUser>,
    Json(req): Json<UpdateEnginesSettingsRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    if let Some(d) = req.daemons {
        let host = d.host.trim().to_string();
        if host.is_empty() {
            return Err(AppError::Validation("Daemon host must not be empty".into()));
        }
        if host.len() > 253 || host.chars().any(|c| c.is_whitespace()) {
            return Err(AppError::Validation("Daemon host is not a valid hostname or IP".into()));
        }
        if d.ports.is_empty() {
            return Err(AppError::Validation("At least one daemon port required".into()));
        }
        for &p in &d.ports {
            if !(1..=65535).contains(&p) {
                return Err(AppError::Validation(format!("Port {} out of range 1–65535", p)));
            }
        }
        let mut seen = std::collections::HashSet::new();
        for &p in &d.ports {
            if !seen.insert(p) {
                return Err(AppError::Validation(format!("Duplicate port: {}", p)));
            }
        }

        sqlx::query(
            "INSERT INTO daemon_config (id, host, ports, updated_at) \
             VALUES (1, $1, $2, now()) \
             ON CONFLICT (id) DO UPDATE SET host = $1, ports = $2, updated_at = now()",
        )
        .bind(&host)
        .bind(&d.ports)
        .execute(&state.db)
        .await
        .map_err(AppError::Database)?;
    }

    let (host, ports) = load_daemons(&state.db).await.map_err(AppError::Database)?;
    Ok(Json(serde_json::json!({
        "daemons": { "host": host, "ports": ports },
    })))
}

#[derive(Debug, Deserialize)]
struct UpdateEngineRequest {
    hosting_mode: String, endpoint_url: String, auth_type: String,
    credentials: Option<String>, model_name: String, model_family: String,
    family_override: Option<String>, cube_endpoint_url: Option<String>,
}

async fn update_engine(
    State(state): State<AppState>,
    user: axum::Extension<auth::AuthenticatedUser>,
    Path(slot): Path<String>,
    Json(req): Json<UpdateEngineRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !["a","b","c"].contains(&slot.as_str()) {
        return Err(AppError::Validation("Slot must be 'a', 'b', or 'c'".into()));
    }
    // TODO: encrypt credentials via Phase Encryption (B-5)
    let credentials_encrypted = req.credentials;

    // Normalize endpoint_url: strip common API path suffixes so the stored
    // value is always a base URL (dispatch.rs appends /v1/chat/completions itself).
    let endpoint_url = {
        let mut url = req.endpoint_url.trim_end_matches('/').to_string();
        for suffix in &["/v1/chat/completions", "/v1/completions", "/chat/completions", "/v1"] {
            if url.ends_with(suffix) {
                url.truncate(url.len() - suffix.len());
                break;
            }
        }
        url
    };

    sqlx::query(
        "INSERT INTO engine_configs (id, org_id, slot, hosting_mode, endpoint_url, auth_type, \
         credentials_encrypted, model_name, model_family, family_override, health_status, cube_endpoint_url) \
         VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, 'offline', $10) \
         ON CONFLICT (org_id, slot) DO UPDATE SET \
         hosting_mode=$3, endpoint_url=$4, auth_type=$5, \
         credentials_encrypted=COALESCE($6, engine_configs.credentials_encrypted), \
         model_name=$7, model_family=$8, family_override=$9, cube_endpoint_url=$10"
    )
    .bind(user.org_id).bind(&slot).bind(&req.hosting_mode).bind(&endpoint_url)
    .bind(&req.auth_type).bind(&credentials_encrypted).bind(&req.model_name)
    .bind(&req.model_family).bind(&req.family_override).bind(&req.cube_endpoint_url)
    .execute(&state.db).await.map_err(AppError::Database)?;

    if req.hosting_mode == "commercial" || req.hosting_mode == "free_tier" {
        // Spawn a background probe for cloud engines so health_status updates
        // immediately after save.
        let db_clone         = state.db.clone();
        let relay_tx_clone   = state.relay_tx.clone();
        let live_peer_clone  = state.live_cube_peer.clone();
        let org_clone        = user.org_id;
        let slot_clone       = slot.clone();
        tokio::spawn(async move {
            probe_engine_inner(db_clone, relay_tx_clone, live_peer_clone, org_clone, slot_clone).await;
        });
    } else if req.hosting_mode == "self_hosted" {
        // For self-hosted engines the relay health monitor promotes offline→tunnel_open
        // every 30 seconds, but that means a newly-saved engine can show as offline for
        // up to 30 s even when the relay is already live.  Promote immediately here so
        // the UI reflects real state right after Save.  Never downgrade 'online'.
        let relay_armed = state.relay_tx.read().await.is_some();
        let peer_count  = state.live_cube_peer.read().await.len();
        if relay_armed && peer_count > 0 {
            let _ = sqlx::query(
                "UPDATE engine_configs SET health_status='tunnel_open' \
                 WHERE org_id=$1 AND slot=$2 AND health_status='offline'",
            )
            .bind(user.org_id)
            .bind(&slot)
            .execute(&state.db)
            .await;
        }
    }

    Ok(Json(serde_json::json!({"status":"updated","slot":slot})))
}

/// DELETE /api/settings/engines/{slot}
/// Clears a slot — resets model_name, family and credentials to empty.
/// The endpoint URLs are left untouched so the user's configured ports are preserved.
async fn clear_engine(
    State(state): State<AppState>,
    user: axum::Extension<auth::AuthenticatedUser>,
    Path(slot): Path<String>,
) -> Result<StatusCode, AppError> {
    if !["a","b","c"].contains(&slot.as_str()) {
        return Err(AppError::Validation("Slot must be 'a', 'b', or 'c'".into()));
    }
    sqlx::query(
        "UPDATE engine_configs \
         SET model_name='', model_family='', family_override=NULL, \
             endpoint_url='', credentials_encrypted=NULL \
         WHERE org_id=$1 AND slot=$2"
    )
    .bind(user.org_id)
    .bind(&slot)
    .execute(&state.db)
    .await
    .map_err(AppError::Database)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn validate_diversity(
    State(state): State<AppState>,
    user: axum::Extension<auth::AuthenticatedUser>,
) -> Result<Json<serde_json::Value>, AppError> {
    let lineage_db = yoda_inference_router::diversity::ModelLineageDb::load(
        std::path::Path::new(&state.lineages_path)
    ).map_err(|e| AppError::Internal(format!("Lineage load: {}", e)))?;

    let rows = sqlx::query_as::<_, (String,String,String)>(
        "SELECT slot,model_name,model_family FROM engine_configs WHERE org_id=$1 ORDER BY slot"
    ).bind(user.org_id).fetch_all(&state.db).await.map_err(AppError::Database)?;

    let mut results = Vec::new();
    let mut seen: Vec<(String,String)> = Vec::new();
    for (slot,mn,mf) in &rows {
        let family = if !mf.is_empty() { mf.clone() } else {
            lineage_db.lookup_family(mn).unwrap_or("unknown".into())
        };
        let conflict = seen.iter().any(|(_,f)| f == &family);
        results.push(serde_json::json!({"slot":slot,"model_name":mn,"family":family,"status":if conflict{"red"}else{"green"}}));
        seen.push((slot.clone(), family));
    }
    let valid = results.iter().all(|r| r["status"] == "green");
    Ok(Json(serde_json::json!({"valid":valid,"engines":results})))
}

// ─── Engine Probe ────────────────────────────────────────────────────

// ── Engine probe helpers ──────────────────────────────────────────────────────

/// Extract the URL origin (scheme + host) from a full URL.
/// "https://api.x.ai/v1/chat/completions" → "https://api.x.ai"
fn extract_origin(url: &str) -> String {
    if let Some(after_scheme) = url.split("://").nth(1) {
        let host = after_scheme.split('/').next().unwrap_or(after_scheme);
        let scheme = if url.starts_with("https://") { "https" } else { "http" };
        format!("{scheme}://{host}")
    } else {
        url.to_string()
    }
}

/// Core probe logic — extracted so both the GET /probe route and the
/// post-save background task can share it.
async fn probe_engine_inner(
    db: sqlx::PgPool,
    relay_tx: crate::cube_relay::RelayTx,
    live_cube_peer: crate::cube_relay::LiveCubePeer,
    org_id: Uuid,
    slot: String,
) -> serde_json::Value {
    let row = sqlx::query_as::<_, (String, String, Option<String>, String)>(
        "SELECT hosting_mode, endpoint_url, credentials_encrypted, auth_type \
         FROM engine_configs WHERE org_id=$1 AND slot=$2",
    )
    .bind(org_id)
    .bind(&slot)
    .fetch_optional(&db)
    .await
    .ok()
    .flatten();

    let (hosting_mode, endpoint_url, credentials, auth_type) = match row {
        Some(r) => r,
        None => return serde_json::json!({ "reachable": false, "error": "Engine not configured" }),
    };

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "reachable": false, "error": format!("HTTP client: {e}") }),
    };

    if hosting_mode == "commercial" || hosting_mode == "free_tier" {
        // ── Real credentialed probe ───────────────────────────────────────
        let key = credentials.as_deref().unwrap_or("").trim().to_string();
        let is_google    = endpoint_url.contains("googleapis.com");
        let is_anthropic = endpoint_url.contains("anthropic.com");
        let origin = extract_origin(&endpoint_url);

        // Pick the lightest probe endpoint available per provider.
        // GET /v1/models is standard for OpenAI-compatible APIs.
        // Google uses a query-param key (request); response redacts the key.
        // Anthropic needs an extra version header.
        let probe_url = if is_google {
            format!("{origin}/v1beta/models")
        } else {
            format!("{origin}/v1/models")
        };
        // Safe display URL never includes credential material.
        let probe_url_display = probe_url.clone();

        let start = std::time::Instant::now();

        let mut req = client.get(&probe_url);
        if is_google && !key.is_empty() {
            req = req.query(&[("key", &key)]);
        } else if !key.is_empty() {
            req = match auth_type.as_str() {
                "bearer"  => req.header("Authorization", format!("Bearer {key}")),
                "api_key" => req.header("x-api-key", &key),
                _         => req,
            };
        }
        if is_anthropic {
            req = req.header("anthropic-version", "2023-06-01");
            if !key.is_empty() { req = req.header("x-api-key", &key); }
        }

        match req.send().await {
            Ok(resp) => {
                let status     = resp.status().as_u16();
                let latency_ms = start.elapsed().as_millis() as u64;
                // 2xx/4xx = reachable; 5xx or connection failure = offline.
                // 401/403 = endpoint is up but credentials are invalid → "suspect".
                let reachable = status < 500;
                let creds_ok  = status != 401 && status != 403;

                let new_status = if reachable && creds_ok { "online" }
                                 else if reachable        { "suspect" }
                                 else                     { "offline" };
                let _ = sqlx::query(
                    "UPDATE engine_configs SET health_status=$1, avg_latency_ms=$2 \
                     WHERE org_id=$3 AND slot=$4",
                )
                .bind(new_status)
                .bind(latency_ms as i32)
                .bind(org_id)
                .bind(&slot)
                .execute(&db)
                .await;

                let note: Option<&str> = if !creds_ok {
                    Some("Reachable — credentials appear invalid (401/403)")
                } else {
                    None
                };
                serde_json::json!({
                    "reachable": reachable,
                    "latency_ms": latency_ms,
                    "http_status": status,
                    "probe_url": probe_url_display,
                    "endpoint_url": endpoint_url,
                    "note": note,
                })
            }
            Err(e) => {
                let latency_ms = start.elapsed().as_millis() as u64;
                let _ = sqlx::query(
                    "UPDATE engine_configs SET health_status='offline' WHERE org_id=$1 AND slot=$2",
                )
                .bind(org_id)
                .bind(&slot)
                .execute(&db)
                .await;
                serde_json::json!({
                    "reachable": false,
                    "latency_ms": latency_ms,
                    "error": e.to_string().lines().next().unwrap_or("Connection failed").to_string(),
                    "probe_url": probe_url_display,
                    "endpoint_url": endpoint_url,
                })
            }
        }
    } else {
        // ── Self-hosted probe ─────────────────────────────────────────────────
        let base = endpoint_url.trim_end_matches('/');

        // Local/LAN addresses are unreachable from the cloud server — the probe
        // would always fail and falsely write 'offline' to the DB.  Detect them
        // early and return an informational response without touching health_status.
        // Status for these engines is only changed by mark-online / mark-offline.
        let after_scheme = base
            .trim_start_matches("https://")
            .trim_start_matches("http://");
        let host_part = after_scheme.split('/').next().unwrap_or(after_scheme);
        // Strip port number to isolate just the hostname.
        let hostname = host_part.split(':').next().unwrap_or(host_part);
        let is_local = matches!(hostname,
            "localhost" | "127.0.0.1" | "::1"
        ) || hostname.starts_with("192.168.")
          || hostname.starts_with("10.")
          || {
              // 172.16.0.0/12 range
              if let Some(second) = hostname.strip_prefix("172.") {
                  let octet: u8 = second.split('.').next()
                      .and_then(|o| o.parse().ok())
                      .unwrap_or(0);
                  (16..=31).contains(&octet)
              } else {
                  false
              }
          };

        if is_local {
            // Local/LAN addresses are unreachable from the cloud server directly.
            // Instead, check the PlenumLAN relay: if the relay is armed and at
            // least one cube peer is heartbeating, inference WILL work through
            // the relay → mark online.  If the relay is down, mark offline.
            let relay_armed = relay_tx.read().await.is_some();
            let peer_count  = live_cube_peer.read().await.len();
            let relay_live  = relay_armed && peer_count > 0;

            // relay_live → tunnel_open (relay works, but llama-server not yet confirmed).
            // relay down  → offline.
            // Never downgrade from 'online' here — only mark-online can grant that.
            let current_status: Option<String> = sqlx::query_scalar(
                "SELECT health_status FROM engine_configs WHERE org_id=$1 AND slot=$2",
            )
            .bind(org_id)
            .bind(&slot)
            .fetch_optional(&db)
            .await
            .ok()
            .flatten();
            let already_online = current_status.as_deref() == Some("online");

            let new_status = if relay_live && !already_online {
                "tunnel_open"
            } else if relay_live {
                "online" // keep existing online status intact
            } else {
                "offline"
            };
            let _ = sqlx::query(
                "UPDATE engine_configs SET health_status=$1 WHERE org_id=$2 AND slot=$3",
            )
            .bind(new_status)
            .bind(org_id)
            .bind(&slot)
            .execute(&db)
            .await;

            let peers: Vec<String> = live_cube_peer.read().await.iter().cloned().collect();
            return serde_json::json!({
                "reachable": relay_live,
                "local_endpoint": true,
                "relay_armed": relay_armed,
                "relay_peer_count": peer_count,
                "relay_peers": peers,
                "health_status": new_status,
                "endpoint_url": endpoint_url,
                "source": "plenumnet_relay",
                "note": if relay_live && !already_online {
                    format!("PlenumLAN relay active — {} cube peer(s) connected. Tunnel is open. Run Step 2 to install the model.", peer_count)
                } else if relay_live {
                    format!("PlenumLAN relay active — {} cube peer(s) connected. Engine is online.", peer_count)
                } else if relay_armed {
                    "PlenumLAN relay connected but no cube peers are heartbeating. Make sure your daemon is running.".to_string()
                } else {
                    "PlenumLAN relay not connected. Check that the YODA server can reach plenumnet.replit.app.".to_string()
                },
            });
        }

        // Non-local self-hosted (e.g. a VM with a public IP).
        // Probe unauthenticated, lightweight endpoints. Handle both llama.cpp
        // (/health) and OpenAI-compatible runtimes like Ollama, whose base URL
        // ends in /v1 and which expose GET /v1/models and (at the origin)
        // /api/tags. No API key is sent — "none" auth is valid for local engines.
        let origin = extract_origin(base);
        let candidates = [
            format!("{base}/health"),
            format!("{base}/models"),
            format!("{origin}/v1/models"),
            format!("{origin}/api/tags"),
        ];

        let start = std::time::Instant::now();
        let mut reachable = false;
        let mut http_status: Option<u16> = None;
        let mut probe_url_used = candidates[0].clone();

        for url in &candidates {
            match client.get(url).send().await {
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    if status < 500 {
                        reachable = true;
                        http_status = Some(status);
                        probe_url_used = url.clone();
                        break;
                    }
                }
                Err(_) => continue,
            }
        }

        let latency_ms = start.elapsed().as_millis() as u64;
        let health_str = if reachable { "online" } else { "offline" };
        let _ = sqlx::query(
            "UPDATE engine_configs SET health_status=$1, avg_latency_ms=$2 \
             WHERE org_id=$3 AND slot=$4",
        )
        .bind(health_str)
        .bind(latency_ms as i32)
        .bind(org_id)
        .bind(&slot)
        .execute(&db)
        .await;

        serde_json::json!({
            "reachable": reachable,
            "latency_ms": latency_ms,
            "http_status": http_status,
            "probe_url": probe_url_used,
            "endpoint_url": endpoint_url,
        })
    }
}

/// GET /api/settings/engines/{slot}/probe
/// For self-hosted engines: tries /health then /api/tags (no auth).
/// For commercial/free_tier: makes a real credentialed request to the
/// provider's models endpoint using the stored API key.
/// Writes health_status back to DB on conclusive result.
async fn probe_engine(
    State(state): State<AppState>,
    user: axum::Extension<auth::AuthenticatedUser>,
    Path(slot): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(probe_engine_inner(
        state.db.clone(),
        state.relay_tx.clone(),
        state.live_cube_peer.clone(),
        user.org_id,
        slot,
    ).await))
}

/// POST /api/yoda/engines/{slot}/ping
///
/// On-demand health check for one engine slot. Runs the same probe the
/// background monitor uses, synchronously, and returns the resulting status
/// plus round-trip latency so the UI can show pass/fail in seconds instead of
/// waiting for the next polling tick. Auth + org scope match the other engine
/// settings endpoints (JWT via the protected router, `user.org_id`).
async fn ping_engine(
    State(state): State<AppState>,
    user: axum::Extension<auth::AuthenticatedUser>,
    Path(slot): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !["a", "b", "c"].contains(&slot.as_str()) {
        return Err(AppError::Validation("Slot must be 'a', 'b', or 'c'".into()));
    }

    let started = std::time::Instant::now();
    let probe = probe_engine_inner(
        state.db.clone(),
        state.relay_tx.clone(),
        state.live_cube_peer.clone(),
        user.org_id,
        slot.clone(),
    )
    .await;

    let reachable = probe.get("reachable").and_then(|v| v.as_bool()).unwrap_or(false);
    let latency_ms = probe
        .get("latency_ms")
        .and_then(|v| v.as_u64())
        .unwrap_or_else(|| started.elapsed().as_millis() as u64);
    let error = probe
        .get("error")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let note = probe
        .get("note")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // `probe_engine_inner` writes the conclusive status to the DB, so read it
    // back rather than re-deriving it here — the two can never disagree.
    let stored_status: Option<String> = sqlx::query_scalar(
        "SELECT health_status FROM engine_configs WHERE org_id=$1 AND slot=$2",
    )
    .bind(user.org_id)
    .bind(&slot)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?;

    let status = stored_status.unwrap_or_else(|| {
        if reachable { "online".to_string() } else { "offline".to_string() }
    });

    Ok(Json(serde_json::json!({
        "slot": slot,
        "status": status,
        "reachable": reachable,
        "latency_ms": latency_ms,
        "error": error,
        "note": note,
    })))
}

/// Probe every configured engine once, immediately at startup.
///
/// Without this the first status the UI can show comes from the 30 s relay
/// monitor tick (self-hosted) or the next background poll (cloud), so engines
/// read "offline" for the first half-minute of every boot even when they are
/// up. Spawned as a background task so it never delays binding the port; all
/// slots are probed concurrently, so status normally lands within a few seconds.
pub fn spawn_startup_engine_probes(state: AppState) {
    tokio::spawn(async move {
        let rows = match sqlx::query_as::<_, (Uuid, String)>(
            "SELECT org_id, slot FROM engine_configs \
             WHERE COALESCE(model_name, '') <> '' AND COALESCE(is_disabled, FALSE) = FALSE",
        )
        .fetch_all(&state.db)
        .await
        {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(error = %e, "Startup engine probe: could not list engines");
                return;
            }
        };

        if rows.is_empty() {
            tracing::info!("Startup engine probe: no configured engines to probe");
            return;
        }

        let count = rows.len();
        let handles: Vec<_> = rows
            .into_iter()
            .map(|(org_id, slot)| {
                let db = state.db.clone();
                let relay_tx = state.relay_tx.clone();
                let live_peer = state.live_cube_peer.clone();
                tokio::spawn(async move {
                    let result = probe_engine_inner(db, relay_tx, live_peer, org_id, slot.clone()).await;
                    let reachable = result.get("reachable").and_then(|v| v.as_bool()).unwrap_or(false);
                    tracing::info!(slot = %slot, reachable, "Startup engine probe complete");
                })
            })
            .collect();

        for h in handles {
            let _ = h.await;
        }
        tracing::info!(count, "Startup engine probes finished");
    });
}

/// POST /api/settings/engines/{slot}/mark-online
/// Sends a real test inference through the PlenumLAN relay to confirm the model
/// is responding end-to-end, then marks the engine online.
async fn mark_engine_online(
    State(state): State<AppState>,
    user: axum::Extension<auth::AuthenticatedUser>,
    Path(slot): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let relay_armed = state.relay_tx.read().await.is_some();
    let peer_count  = state.live_cube_peer.read().await.len();

    // If the relay isn't live we can't test inference — reject with explanation.
    if !relay_armed || peer_count == 0 {
        return Err(AppError::Validation(
            "Relay is not connected. Make sure your PlenumLAN daemon is running and at least one cube peer is live before marking online.".into()
        ));
    }

    // Pick the cube address for this slot (falls back to any live peer if the
    // preferred one isn't online yet).
    let preferred = slot_to_cube_address(&slot).to_string();
    let cube_address = {
        let peers = state.live_cube_peer.read().await;
        if peers.contains(&preferred) {
            preferred.clone()
        } else {
            peers.iter().next().cloned().unwrap_or(preferred)
        }
    };

    // Send a minimal smoke-test prompt through the relay.
    let request_id = Uuid::new_v4();
    let task_id    = Uuid::new_v4();
    let relay_req  = RelayInferRequest {
        request_id,
        task_id,
        cube_address,
        messages: serde_json::json!([{"role": "user", "content": "Reply with the single word: ready"}]),
        model: "local".to_string(),
        max_tokens: 16,
        temperature: 0.0,
    };

    let (tx, rx) = tokio::sync::oneshot::channel();
    state.pending_relays.write().await.insert(request_id, tx);

    let relay_tx_guard = state.relay_tx.read().await;
    if let Some(sender) = relay_tx_guard.as_ref() {
        sender.send(relay_req).await.map_err(|_| {
            AppError::Validation("Failed to dispatch test inference — relay channel closed.".into())
        })?;
    } else {
        state.pending_relays.write().await.remove(&request_id);
        return Err(AppError::Validation("Relay disconnected before test inference could be sent.".into()));
    }
    drop(relay_tx_guard);

    // Wait up to 90 s for the model to respond.
    match tokio::time::timeout(std::time::Duration::from_secs(90), rx).await {
        Ok(Ok(Ok(_result))) => {
            // Inference round-tripped successfully — mark engine online.
            sqlx::query(
                "UPDATE engine_configs SET health_status='online' WHERE org_id=$1 AND slot=$2",
            )
            .bind(user.org_id)
            .bind(&slot)
            .execute(&state.db)
            .await
            .map_err(AppError::Database)?;

            tracing::info!(slot = %slot, "Engine marked online after successful relay inference test");
            Ok(Json(serde_json::json!({
                "status": "online",
                "slot": slot,
                "verified": true,
                "note": "Test inference completed successfully through the PlenumLAN relay.",
            })))
        }
        Ok(Ok(Err(e))) => {
            state.pending_relays.write().await.remove(&request_id);
            Err(AppError::Validation(format!(
                "Test inference failed: {e}. Check that llama-server is running on your machine."
            )))
        }
        Ok(Err(_)) => {
            state.pending_relays.write().await.remove(&request_id);
            Err(AppError::Validation(
                "Test inference channel dropped unexpectedly. Try again.".into()
            ))
        }
        Err(_) => {
            state.pending_relays.write().await.remove(&request_id);
            Err(AppError::Validation(
                "Test inference timed out after 90 s. Make sure llama-server finished loading and your cube daemon is forwarding requests.".into()
            ))
        }
    }
}

/// POST /api/settings/engines/{slot}/mark-offline
/// Called by the frontend when CRS polling times out or fails.
async fn mark_engine_offline(
    State(state): State<AppState>,
    user: axum::Extension<auth::AuthenticatedUser>,
    Path(slot): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    sqlx::query(
        "UPDATE engine_configs SET health_status='offline' WHERE org_id=$1 AND slot=$2",
    )
    .bind(user.org_id)
    .bind(&slot)
    .execute(&state.db)
    .await
    .map_err(AppError::Database)?;
    Ok(Json(serde_json::json!({"status": "offline", "slot": slot})))
}

/// POST /api/settings/engines/{slot}/disable
/// Disables a slot — YODA skips it for all inference until re-enabled.
async fn disable_engine(
    State(state): State<AppState>,
    user: axum::Extension<auth::AuthenticatedUser>,
    Path(slot): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !["a","b","c"].contains(&slot.as_str()) {
        return Err(AppError::Validation("Slot must be 'a', 'b', or 'c'".into()));
    }
    sqlx::query(
        "UPDATE engine_configs SET is_disabled=true WHERE org_id=$1 AND slot=$2",
    )
    .bind(user.org_id)
    .bind(&slot)
    .execute(&state.db)
    .await
    .map_err(AppError::Database)?;
    Ok(Json(serde_json::json!({"disabled": true, "slot": slot})))
}

/// POST /api/settings/engines/{slot}/enable
/// Re-enables a previously disabled slot.
async fn enable_engine(
    State(state): State<AppState>,
    user: axum::Extension<auth::AuthenticatedUser>,
    Path(slot): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !["a","b","c"].contains(&slot.as_str()) {
        return Err(AppError::Validation("Slot must be 'a', 'b', or 'c'".into()));
    }
    sqlx::query(
        "UPDATE engine_configs SET is_disabled=false WHERE org_id=$1 AND slot=$2",
    )
    .bind(user.org_id)
    .bind(&slot)
    .execute(&state.db)
    .await
    .map_err(AppError::Database)?;
    Ok(Json(serde_json::json!({"disabled": false, "slot": slot})))
}

// ─── Capability Matrix ───────────────────────────────────────────────

/// GET /api/settings/capabilities
async fn get_capabilities(
    State(state): State<AppState>,
    user: axum::Extension<auth::AuthenticatedUser>,
) -> Result<Json<Vec<capability::CapabilityScore>>, AppError> {
    let scores = capability::get_all_scores(&state.db, user.org_id)
        .await
        .map_err(|e| AppError::Internal(format!("Capability query failed: {}", e)))?;
    Ok(Json(scores))
}

// ─── CRS Proxy ───────────────────────────────────────────────────────
//
// These handlers forward CRS traffic from port 3000 (publicly exposed) to
// the local yoda-crs daemon. The daemon URL is read at runtime from the
// cube_endpoint_url of engine slot 'a' — never hardcoded here.

/// Fetch the local CRS daemon base URL from the slot-'a' cube_endpoint_url in
/// engine_configs. Returns an error the user can act on if it is not yet set.
async fn get_local_crs_base(db: &sqlx::PgPool) -> Result<String, AppError> {
    let url: Option<String> = sqlx::query_scalar(
        "SELECT cube_endpoint_url FROM engine_configs \
         WHERE slot = 'a' \
           AND cube_endpoint_url IS NOT NULL \
           AND cube_endpoint_url != '' \
         LIMIT 1",
    )
    .fetch_optional(db)
    .await
    .map_err(AppError::Database)?;

    if let Some(u) = url.filter(|s| !s.trim().is_empty()) {
        return Ok(u);
    }
    // Fallback to the co-located yoda-crs daemon so first-run installs (before
    // slot A is configured) still resolve instead of hard-erroring. Override
    // with CRS_LOCAL_URL, or CUBE_API_PORT for just the port.
    Ok(std::env::var("CRS_LOCAL_URL").unwrap_or_else(|_| {
        let port = std::env::var("CUBE_API_PORT").unwrap_or_else(|_| "8081".to_string());
        format!("http://127.0.0.1:{port}")
    }))
}

/// Read a CRS proxy response, turning a non-JSON body into an honest error.
///
/// The CRS daemon serves only a handful of routes. Asking it for one it does
/// not have returns a 404 with an empty body; parsing that as JSON fails, and
/// that failure used to surface as an opaque 500 "Internal server error" —
/// which reads like a bug in this server rather than a missing upstream route.
/// An operator verifying that the daemon arrays are connected needs the real
/// reason, so it is reported rather than masked.
async fn crs_json(
    resp: reqwest::Response,
    crs_base: &str,
) -> Result<(StatusCode, serde_json::Value), AppError> {
    let status =
        StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let url = resp.url().to_string();

    let body = resp.text().await.map_err(|e| {
        AppError::Unavailable(format!("CRS at {crs_base} sent an unreadable body: {e}"))
    })?;

    match serde_json::from_str::<serde_json::Value>(&body) {
        Ok(json) => Ok((status, json)),
        Err(_) if !status.is_success() => Err(AppError::Unavailable(format!(
            "CRS at {url} returned {} with no JSON body — the daemon does not serve this route",
            status.as_u16()
        ))),
        Err(e) => Err(AppError::Unavailable(format!(
            "CRS at {url} returned {} with a malformed JSON body: {e}",
            status.as_u16()
        ))),
    }
}

/// Helper: build a one-shot reqwest client (no connection pooling needed).
fn crs_client() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .build()
        .map_err(|e| AppError::Internal(format!("CRS client: {e}")))
}

/// POST /api/salvi/inter-cube/crs/register → CRS registration proxy.
/// Body is forwarded verbatim so sessionToken is preserved.
/// Side-effect: if the registering node's IP matches any engine_configs endpoint_url,
/// that engine's health_status is flipped to 'online' automatically.
async fn crs_register(
    State(state): State<AppState>,
    body: Bytes,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    // Extract the wire endpoint IP before consuming body
    let endpoint_ip = extract_endpoint_ip(&body);

    let crs_base = get_local_crs_base(&state.db).await?;
    let client = crs_client()?;
    let resp = client
        .post(format!("{crs_base}/api/salvi/inter-cube/crs/register"))
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| AppError::Unavailable(format!("CRS daemon unreachable at {crs_base}: {e}")))?;

    let (status, json) = crs_json(resp, &crs_base).await?;

    // On successful registration, mark any matching engine slot online
    if status.is_success() {
        if let Some(ip) = endpoint_ip {
            mark_engines_online_by_ip(&state.db, &ip).await;
        }
    }

    Ok((status, Json(json)))
}

/// POST /api/salvi/inter-cube/crs/heartbeat → CRS heartbeat proxy.
///
/// Side-effects (always, regardless of internal CRS outcome):
///  1. Upserts the cube's address + endpoint into our local `crs_registrations`
///     so query.rs can look up the live address without depending on the
///     external plenumnet CRS database.
///  2. Marks matching engine slots online by IP.
///
/// Always returns 200 OK to the daemon if we can parse the body — the daemon
/// only needs an ACK; whether our internal CRS already knows about this node
/// is irrelevant.
async fn crs_heartbeat(
    State(state): State<AppState>,
    body: Bytes,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    // Parse body once; address may be a decimal ternary string or byte array.
    let body_json: serde_json::Value =
        serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null);

    let address_str: Option<String> = body_json.get("address").and_then(|a| match a {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Array(arr) => {
            // byte-array format: [1,2,3,...] → decimal digit string
            let digits: String = arr.iter()
                .filter_map(|v| v.as_u64())
                .map(|n| std::char::from_digit(n as u32, 10).unwrap_or('0'))
                .collect();
            if digits.is_empty() { None } else { Some(digits) }
        }
        _ => None,
    });
    let endpoint_str: Option<String> = body_json
        .get("endpoint")
        .and_then(|v| v.as_str())
        .map(|s| s.to_owned());

    // ── Write to local crs_registrations ─────────────────────────────────
    if let (Some(addr), Some(ep)) = (&address_str, &endpoint_str) {
        let _ = sqlx::query(
            r#"INSERT INTO crs_registrations
                (id, endpoint, public_key, address_str, last_heartbeat)
               VALUES (uuid_generate_v4(), $1, '', $2, NOW())
               ON CONFLICT (address_str)
               DO UPDATE SET endpoint = EXCLUDED.endpoint,
                             last_heartbeat = NOW()"#,
        )
        .bind(ep)
        .bind(addr)
        .execute(&state.db)
        .await;

        tracing::debug!(address = %addr, endpoint = %ep, "Heartbeat — cube registration refreshed");
    }

    // ── Mark matching engine slots online by IP ───────────────────────────
    if let Some(ip) = extract_endpoint_ip(&body) {
        mark_engines_online_by_ip(&state.db, &ip).await;
    }

    // ── Forward to internal CRS (best-effort) ────────────────────────────
    // We don't care if the internal CRS returns 404/422 — always ACK the daemon.
    if let (Ok(crs_base), Ok(client)) = (get_local_crs_base(&state.db).await, crs_client()) {
        let _ = client
            .post(format!("{crs_base}/api/salvi/inter-cube/crs/heartbeat"))
            .header("Content-Type", "application/json")
            .body(body)
            .send()
            .await;
    }

    Ok((StatusCode::OK, Json(serde_json::json!({"ok": true}))))
}

/// GET /api/salvi/inter-cube/relay/heartbeat?address=<ternary>&publicKey=<hex>
///
/// The PlenumNET daemon sends keepalive heartbeats as GET requests with query
/// params (the external CRS relay protocol). This route captures the cube's
/// live address and stores it in local crs_registrations so query.rs can look
/// it up for relay routing. Always returns 200 OK.
#[derive(Deserialize)]
struct RelayHeartbeatParams {
    address: Option<String>,
    #[serde(rename = "publicKey")]
    public_key: Option<String>,
    endpoint: Option<String>,
}

async fn relay_heartbeat_get(
    State(state): State<AppState>,
    Query(params): Query<RelayHeartbeatParams>,
) -> (StatusCode, Json<serde_json::Value>) {
    if let Some(addr) = &params.address {
        let ep = params.endpoint.as_deref().unwrap_or("0.0.0.0:51820");
        let _ = sqlx::query(
            r#"INSERT INTO crs_registrations
                (id, endpoint, public_key, address_str, last_heartbeat)
               VALUES (uuid_generate_v4(), $1, $2, $3, NOW())
               ON CONFLICT (address_str)
               DO UPDATE SET endpoint       = EXCLUDED.endpoint,
                             public_key     = EXCLUDED.public_key,
                             last_heartbeat = NOW()"#,
        )
        .bind(ep)
        .bind(params.public_key.as_deref().unwrap_or(""))
        .bind(addr)
        .execute(&state.db)
        .await;

        if let Some(ip) = ep.rsplitn(2, ':').last() {
            if !ip.is_empty() {
                mark_engines_online_by_ip(&state.db, ip).await;
            }
        }

        tracing::debug!(address = %addr, endpoint = %ep, "GET relay heartbeat — cube registration refreshed");
    }

    (StatusCode::OK, Json(serde_json::json!({"ok": true})))
}

/// Extract the host IP from `{ "endpoint": "ip:port", ... }` JSON bodies.
/// Works for both register (`endpoint` = wire address) and heartbeat.
fn extract_endpoint_ip(body: &Bytes) -> Option<String> {
    let val: serde_json::Value = serde_json::from_slice(body).ok()?;
    let endpoint = val.get("endpoint")?.as_str()?;
    // endpoint is "ip:port" — take everything before the last ':'
    let ip = endpoint.rsplitn(2, ':').last()?;
    if ip.is_empty() { None } else { Some(ip.to_owned()) }
}

/// UPDATE engine_configs SET health_status='online' for any slot whose
/// endpoint_url contains `ip` (matches http://10.0.0.35:8080 etc.).
async fn mark_engines_online_by_ip(db: &sqlx::PgPool, ip: &str) {
    let pattern = format!("%{ip}%");
    let _ = sqlx::query(
        "UPDATE engine_configs SET health_status='online' WHERE endpoint_url LIKE $1",
    )
    .bind(&pattern)
    .execute(db)
    .await;
}

/// GET /api/salvi/inter-cube/crs/stats → CRS stats
async fn crs_stats(
    State(state): State<AppState>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let crs_base = get_local_crs_base(&state.db).await?;
    let client = crs_client()?;
    let resp = client
        .get(format!("{crs_base}/api/salvi/inter-cube/crs/stats"))
        .send()
        .await
        .map_err(|e| AppError::Unavailable(format!("CRS daemon unreachable at {crs_base}: {e}")))?;

    let (status, json) = crs_json(resp, &crs_base).await?;
    Ok((status, Json(json)))
}

/// GET /api/salvi/inter-cube/topology → topology proxy
async fn crs_topology(
    State(state): State<AppState>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let crs_base = get_local_crs_base(&state.db).await?;
    let client = crs_client()?;
    let resp = client
        .get(format!("{crs_base}/api/salvi/inter-cube/topology"))
        .send()
        .await
        .map_err(|e| AppError::Unavailable(format!("CRS daemon unreachable at {crs_base}: {e}")))?;
    let (status, json) = crs_json(resp, &crs_base).await?;
    Ok((status, Json(json)))
}

/// GET /api/salvi/inter-cube/fts/status → FTS status proxy
async fn crs_fts_status(
    State(state): State<AppState>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let crs_base = get_local_crs_base(&state.db).await?;
    let client = crs_client()?;
    let resp = client
        .get(format!("{crs_base}/api/salvi/inter-cube/fts/status"))
        .send()
        .await
        .map_err(|e| AppError::Unavailable(format!("CRS daemon unreachable at {crs_base}: {e}")))?;
    let (status, json) = crs_json(resp, &crs_base).await?;
    Ok((status, Json(json)))
}

/// GET /api/salvi/inter-cube/node/info
/// Returns identity + port config for the most recently heartbeated cube node.
async fn node_info(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let row = sqlx::query_as::<_, (String, String)>(
        "SELECT address_str, endpoint FROM crs_registrations \
         WHERE last_heartbeat > NOW() - INTERVAL '5 minutes' \
         ORDER BY last_heartbeat DESC LIMIT 1",
    )
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?;

    match row {
        None => Ok(Json(serde_json::json!({ "error": "No active node", "address": null }))),
        Some((addr, endpoint)) => {
            // Format as dotted groups of 3: 1111111111112 → 111.111.111.111.2
            let dotted = addr
                .as_bytes()
                .chunks(3)
                .map(|c| std::str::from_utf8(c).unwrap_or(""))
                .collect::<Vec<_>>()
                .join(".");

            // Engine port — parsed from the registered endpoint URL.
            let engine_port_str = endpoint
                .rsplit(':')
                .next()
                .unwrap_or("")
                .to_string();

            // Daemon (cube) port — read from the user-configured cube_endpoint_url
            // for the matching engine slot instead of deriving via engine_port + 1.
            let node_port_str: String = sqlx::query_scalar::<_, Option<String>>(
                "SELECT cube_endpoint_url FROM engine_configs \
                 WHERE endpoint_url = $1 \
                   AND cube_endpoint_url IS NOT NULL \
                   AND cube_endpoint_url != '' \
                 LIMIT 1",
            )
            .bind(&endpoint)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten()
            .flatten()
            .and_then(|url| url.rsplit(':').next().map(|s| s.to_string()))
            .unwrap_or_else(|| "(not configured)".to_string());

            let crs_url = std::env::var("REPLIT_URL")
                .or_else(|_| std::env::var("CRS_URL"))
                .unwrap_or_else(|_| "https://plenumnet.replit.app".to_string());

            Ok(Json(serde_json::json!({
                "address":       addr,
                "addressDotted": dotted,
                "mode":          "cube",
                "crsUrl":        crs_url,
                "ports": {
                    "engine": engine_port_str,
                    "node":   node_port_str
                }
            })))
        }
    }
}

/// GET /api/monitoring/registered-nodes
/// Returns cubes that have heartbeated in the last 5 minutes.
async fn monitoring_registered_nodes(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let rows = sqlx::query_as::<_, (String, String, chrono::DateTime<chrono::Utc>)>(
        "SELECT address_str, endpoint, last_heartbeat \
         FROM crs_registrations \
         WHERE last_heartbeat > NOW() - INTERVAL '5 minutes' \
         ORDER BY last_heartbeat DESC LIMIT 20",
    )
    .fetch_all(&state.db)
    .await
    .map_err(AppError::Database)?;

    let nodes: Vec<serde_json::Value> = rows
        .iter()
        .map(|(addr, ep, hb)| {
            serde_json::json!({
                "address": addr,
                "endpoint": ep,
                "lastHeartbeat": hb,
            })
        })
        .collect();

    Ok(Json(serde_json::json!({ "nodes": nodes })))
}

/// Normalize a registered daemon endpoint (a bare "host:port" socket addr, or a
/// full URL) into an http(s) base URL with no trailing slash.
fn normalize_daemon_base(ep: &str) -> String {
    let ep = ep.trim().trim_end_matches('/');
    if ep.starts_with("http://") || ep.starts_with("https://") {
        ep.to_string()
    } else {
        format!("http://{ep}")
    }
}

/// SSRF guard for the same-origin slots fan-out. The daemon `endpoint` rows are
/// written by the (pre-existing) unauthenticated CRS heartbeat handlers, so an
/// attacker could register an arbitrary URL and have this server fetch it. The
/// legitimate cube daemons live on loopback or the trusted private LAN, so those
/// must stay allowed; we reject only clearly-illegitimate targets that are never
/// valid daemons but are the classic SSRF exfiltration prize — link-local /
/// cloud-metadata ranges (169.254.0.0/16, IPv6 fe80::/10) and the unspecified
/// address — plus any non-http(s) scheme.
fn is_allowed_daemon_host(base: &str) -> bool {
    let after_scheme = match base.split_once("://") {
        Some((scheme, rest)) if scheme == "http" || scheme == "https" => rest,
        _ => return false,
    };
    // Strip any path/query/fragment, then the port. Handle bracketed IPv6.
    let authority = after_scheme.split(['/', '?', '#']).next().unwrap_or("");
    let host = if let Some(rest) = authority.strip_prefix('[') {
        rest.split(']').next().unwrap_or("")
    } else {
        authority
            .rsplit_once(':')
            .map(|(h, _)| h)
            .unwrap_or(authority)
    };
    if host.is_empty() {
        return false;
    }
    match host.parse::<std::net::IpAddr>() {
        // Block link-local (incl. 169.254.169.254 metadata) and unspecified.
        Ok(std::net::IpAddr::V4(ip)) => !(ip.is_link_local() || ip.is_unspecified()),
        // Block IPv6 link-local (fe80::/10) and unspecified.
        Ok(std::net::IpAddr::V6(ip)) => {
            !((ip.segments()[0] & 0xffc0) == 0xfe80 || ip.is_unspecified())
        }
        // Non-IP hostname (e.g. a LAN daemon name) — allow.
        Err(_) => true,
    }
}

/// GET /api/salvi/inter-cube/relay/status
/// Same-origin gateway view of the relay for the Array3 monitor. Reports the
/// cube daemons that heartbeated in the last 5 minutes so a remote browser —
/// which cannot reach the daemons directly — sees the true coordinator state
/// ("N daemons connected") instead of a "relay unreachable" error.
async fn inter_cube_relay_status(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let rows = sqlx::query_as::<_, (String, String)>(
        "SELECT address_str, endpoint FROM crs_registrations \
         WHERE last_heartbeat > NOW() - INTERVAL '5 minutes' \
         ORDER BY last_heartbeat DESC LIMIT 20",
    )
    .fetch_all(&state.db)
    .await
    .map_err(AppError::Database)?;

    let nodes: Vec<serde_json::Value> = rows
        .iter()
        .map(|(addr, ep)| {
            serde_json::json!({
                "address": addr,
                "endpoint": ep,
                "connected": true,
            })
        })
        .collect();

    Ok(Json(serde_json::json!({
        "connectedNodes": nodes.len(),
        "nodes": nodes,
    })))
}

/// GET /api/salvi/inter-cube/slots  (alias: /api/salvi/inter-cube/monitor/slots)
/// Same-origin gateway that fans out to each live cube daemon server-side and
/// returns the aggregated cluster the Array3 monitor renders. With no daemons
/// registered it returns an empty cluster — the honest "0 daemons connected"
/// state — which clears the monitor's error overlay instead of showing
/// "relay unreachable".
async fn inter_cube_slots(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let rows = sqlx::query_as::<_, (String, String)>(
        "SELECT address_str, endpoint FROM crs_registrations \
         WHERE last_heartbeat > NOW() - INTERVAL '5 minutes' \
         ORDER BY last_heartbeat DESC LIMIT 20",
    )
    .fetch_all(&state.db)
    .await
    .map_err(AppError::Database)?;

    let total = rows.len();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| AppError::Internal(format!("slots client: {e}")))?;

    // Fan out concurrently; each daemon serves its own slot inventory.
    let futs = rows.into_iter().enumerate().map(|(i, (addr, ep))| {
        let client = client.clone();
        async move {
            let base = normalize_daemon_base(&ep);
            if !is_allowed_daemon_host(&base) {
                return (
                    false,
                    serde_json::json!({ "status": "blocked", "address": addr }),
                );
            }
            let url = format!("{base}/api/salvi/inter-cube/slots");
            match client.get(&url).send().await {
                Ok(resp) if resp.status().is_success() => {
                    match resp.json::<serde_json::Value>().await {
                        Ok(mut v) => {
                            if let Some(obj) = v.as_object_mut() {
                                obj.entry("node_id_num").or_insert(serde_json::json!(i + 1));
                                obj.entry("address").or_insert(serde_json::json!(addr));
                            }
                            (true, v)
                        }
                        Err(_) => (
                            false,
                            serde_json::json!({ "status": "timeout", "address": addr }),
                        ),
                    }
                }
                _ => (
                    false,
                    serde_json::json!({ "status": "timeout", "address": addr }),
                ),
            }
        }
    });

    let results = futures_util::future::join_all(futs).await;
    let responding = results.iter().filter(|(ok, _)| *ok).count();
    let nodes: Vec<serde_json::Value> = results.into_iter().map(|(_, v)| v).collect();

    Ok(Json(serde_json::json!({
        "cluster": {
            "total_nodes": total,
            "responding_nodes": responding,
            "nodes": nodes,
        }
    })))
}

/// GET /api/yoda/crs/session/{token} → CRS session poll
/// Used by ModelInstallModal to track connection status.
async fn crs_session(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let crs_base = get_local_crs_base(&state.db).await?;
    let client = crs_client()?;
    let resp = client
        .get(format!("{crs_base}/api/yoda/crs/session/{token}"))
        .send()
        .await
        .map_err(|e| AppError::Unavailable(format!("CRS daemon unreachable at {crs_base}: {e}")))?;

    let (status, json) = crs_json(resp, &crs_base).await?;
    Ok((status, Json(json)))
}

/// GET /api/relay/status
/// Returns PlenumLAN relay state: armed flag and live cube peer count.
/// Public — no auth required. Used by the frontend to detect when cube
/// daemons are already connected so the install UI can skip Step 1.
async fn relay_status(State(state): State<AppState>) -> Json<serde_json::Value> {
    let armed = state.relay_tx.read().await.is_some();
    let peers: Vec<String> = state.live_cube_peer.read().await.iter().cloned().collect();
    Json(serde_json::json!({
        "armed": armed,
        "livePeerCount": peers.len(),
        "livePeers": peers,
    }))
}

/// GET /api/system/status
/// Returns honest system-wide status: what is working, what is not, and why.
/// Public — no auth required. Consumed by the frontend SystemStatusBanner.
async fn system_status(State(state): State<AppState>) -> Json<serde_json::Value> {
    let llm_enabled = state.llm_gateway.is_some();
    let agent_count = state.agents.count();

    let relay_armed = state.relay_tx.read().await.is_some();
    let live_peers: Vec<String> = state.live_cube_peer.read().await.iter().cloned().collect();

    let mut issues: Vec<serde_json::Value> = Vec::new();

    // ── Can a query actually be answered? ─────────────────────────────────
    // This is the only question that decides whether the platform works, so
    // it is the only one allowed to raise a critical banner.
    //
    // `submit_query` has two routes to a model, and either one is enough:
    //
    //   Cloud   — one engine row with hosting_mode commercial/free_tier,
    //             health_status 'online' and not disabled, called directly
    //             from this server.
    //   Relay   — one enabled self_hosted row with an endpoint, dispatched
    //             through the PlenumLAN relay to a live cube peer (or a CRS
    //             registration that has heartbeated inside five minutes).
    //             This server cannot dial a self-hosted address itself, which
    //             is why the relay, not the endpoint, decides viability.
    //
    // Only when BOTH are dead is the platform actually unable to answer.
    //
    // The three gateway keys deliberately do NOT appear below. They only
    // construct `state.llm_gateway`, which is read by /api/llm/health and
    // nothing else; blaming them for a dead query path sent operators to
    // Settings → API Keys to fix something that was never the cause.
    let engines_read = sqlx::query_as::<_, (String, String, String, String, bool)>(
        "SELECT slot, hosting_mode, COALESCE(endpoint_url, ''), health_status, is_disabled \
         FROM engine_configs \
         WHERE org_id = (SELECT om.org_id FROM users u \
                         JOIN org_members om ON om.user_id = u.id \
                         ORDER BY u.created_at LIMIT 1) \
         ORDER BY slot",
    )
    .fetch_all(&state.db)
    .await;

    // A database failure is not an engine outage. Say which one it is, or the
    // banner sends the operator to re-key engines that were never the problem.
    let engines = match engines_read {
        Ok(rows) => Some(rows),
        Err(e) => {
            tracing::error!(error = %e, "system_status could not read engine_configs");
            issues.push(serde_json::json!({
                "id": "engine_status_unreadable",
                "severity": "critical",
                "title": "Cannot read the engine configuration",
                "detail": "The database did not answer when this page asked which engines are configured, so the state below is unknown rather than empty. The server log has the error.",
                "action": "Check that the database is reachable, then refresh."
            }));
            None
        }
    };

    let mut usable_cloud = 0usize;
    let mut relay_ready = false;

    if let Some(engines) = engines.as_ref() {
        usable_cloud = engines
            .iter()
            .filter(|(_, mode, _, health, disabled)| {
                matches!(mode.as_str(), "commercial" | "free_tier")
                    && health.as_str() == "online"
                    && !*disabled
            })
            .count();

        let has_relay_engine = engines.iter().any(|(_, mode, endpoint, _, disabled)| {
            mode.as_str() == "self_hosted" && !endpoint.is_empty() && !*disabled
        });

        // Mirrors submit_query: a live peer, or failing that a CRS
        // registration whose heartbeat is still inside the window.
        let recent_crs: i64 = if has_relay_engine && relay_armed && live_peers.is_empty() {
            sqlx::query_scalar(
                "SELECT COUNT(*) FROM crs_registrations \
                 WHERE last_heartbeat > NOW() - INTERVAL '5 minutes'",
            )
            .fetch_one(&state.db)
            .await
            .unwrap_or(0)
        } else {
            0
        };

        relay_ready =
            has_relay_engine && relay_armed && (!live_peers.is_empty() || recent_crs > 0);

        if usable_cloud == 0 && !relay_ready {
            let mut reasons: Vec<String> = engines
                .iter()
                .map(|(slot, mode, _, health, disabled)| {
                    let why = if *disabled {
                        "switched off".to_string()
                    } else if mode.as_str() == "self_hosted" {
                        "self-hosted, so it can only be reached through the relay".to_string()
                    } else {
                        match health.as_str() {
                            "suspect" => {
                                "reachable, but the provider rejected its API key".to_string()
                            }
                            "online" => "online".to_string(),
                            other => format!("not answering ({other})"),
                        }
                    };
                    format!("{}: {}", slot.to_uppercase(), why)
                })
                .collect();

            if !relay_armed {
                reasons.push("relay: not armed".to_string());
            } else if live_peers.is_empty() {
                reasons.push("relay: armed, but no cube peer is live".to_string());
            }

            let detail = if reasons.is_empty() {
                "No engine slots are configured, so there is nowhere to send a query.".to_string()
            } else {
                format!(
                    "A query needs either a cloud engine that is switched on and responding, \
                     or a self-hosted engine reachable through a live relay peer. Neither is \
                     available — {}.",
                    reasons.join("; ")
                )
            };

            issues.push(serde_json::json!({
                "id": "no_usable_engine",
                "severity": "critical",
                "title": "No AI engine can answer queries",
                "detail": detail,
                "action": "Settings → Engines: give one slot a provider key that works (xAI, OpenAI, Anthropic or Together) and press Ping until it reports online — or start a cube daemon so a self-hosted slot can be reached."
            }));
        }
    }

    if live_peers.is_empty() {
        issues.push(serde_json::json!({
            "id": "no_cube_peers",
            "severity": "warning",
            "title": "No Array3 cube daemons reachable",
            "detail": if relay_armed { "The relay is armed but has no connected cube peers. Only an independently usable cloud engine can answer." } else { "The relay is not armed and no cube peers are connected. Local inference is unavailable." },
            "action": "Start at least one Array3 daemon and ensure it can reach this server's CRS address."
        }));
    }

    Json(serde_json::json!({
        "ok": issues.iter().all(|i| i["severity"] != "critical"),
        "llm_gateway": {
            "enabled": llm_enabled,
            // Kept for /api/llm/health only. It does not gate query execution,
            // so it is reported here without raising an issue.
            "note": "Alpha/Beta/Gamma cloud gateway (ANTHROPIC_API_KEY + OPENAI_API_KEY + TOGETHER_API_KEY). Read by /api/llm/health; does not affect whether a query can run.",
        },
        "engines": {
            "readable": engines.is_some(),
            "configured": engines.as_ref().map(|e| e.len()),
            "usable_cloud": usable_cloud,
            "relay_ready": relay_ready,
        },
        "relay": {
            "armed": relay_armed,
            "live_peer_count": live_peers.len(),
        },
        "agents": {
            "loaded": agent_count,
        },
        "issues": issues,
    }))
}
