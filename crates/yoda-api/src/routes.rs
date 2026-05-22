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
    extract::{Path, Query, State},
    http::StatusCode,
    middleware,
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
use crate::cube_relay::{RelayInferRequest, slot_to_cube_address};
use crate::error::AppError;
use crate::install;
use crate::kb;
use crate::modes;
use crate::query;
use crate::settings;
use crate::state::AppState;
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
        .route("/api/monitoring/registered-nodes", get(monitoring_registered_nodes))
        .route("/api/yoda/crs/session/{token}", get(crs_session))
        .route("/api/relay/status", get(relay_status))
        .route("/api/system/status", get(system_status))
        // Local-install download endpoints (public — needed by install script)
        .route("/api/install/source.tar.gz", get(install::download_source))
        .route("/api/install/install.ps1", get(install::windows_installer));

    // ── Protected routes (JWT or API key) ────────────────────────────
    let protected = Router::new()
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
        .route("/api/settings/engines/{slot}/mark-online", post(mark_engine_online))
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
        .route("/api/agents/{id}", get(agents::get_agent))

        // Auth middleware on all protected routes
        .layer(middleware::from_fn_with_state(state.clone(), auth::auth_middleware));

    // ── WebSocket (B5.8) — outside auth middleware (uses query param or header auth) ──
    let ws_routes = Router::new()
        .route("/ws/pipeline/{project_id}", get(websocket::ws_pipeline_handler));

    // B5.9: Rate limiting — tower::RateLimitLayer removed (not Clone-compatible
    // with axum 0.8 Router::layer). Add per-route limits via middleware::from_fn.
    Router::new()
        .merge(public)
        .merge(protected)
        .merge(ws_routes)
        .with_state(state)
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
    let rows = sqlx::query_as::<_, (Uuid,Uuid,String,String,String,String,serde_json::Value,serde_json::Value,Option<i32>,Option<String>,Option<String>,chrono::DateTime<chrono::Utc>,chrono::DateTime<chrono::Utc>,Option<String>)>(
        "SELECT id,project_id,task_number,title,status,mode,competencies,dependencies,workflow_position,primary_engine_slot,primary_agent_role,created_at,updated_at,error_message FROM tasks WHERE project_id=$1 ORDER BY workflow_position,task_number"
    ).bind(project_id).fetch_all(&state.db).await.map_err(AppError::Database)?;
    let tasks: Vec<serde_json::Value> = rows.into_iter().map(|(id,pid,tn,t,s,m,c,d,wp,pe,par,ca,ua,em)| {
        serde_json::json!({
            "id": id, "project_id": pid, "task_number": tn, "title": t,
            "status": s, "mode": m, "competencies": c, "dependencies": d,
            "workflow_position": wp, "primary_engine": pe, "primary_agent_role": par,
            "parent_task_id": serde_json::Value::Null,
            "error_message": em,
            "created_at": ca, "updated_at": ua,
        })
    }).collect();
    Ok(Json(serde_json::json!({ "tasks": tasks })))
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
                    "UPDATE tasks SET status='STEP_1', updated_at=NOW() WHERE id=$1"
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

async fn retry_task(State(_state): State<AppState>, Path(_task_id): Path<Uuid>) -> Result<Json<serde_json::Value>, AppError> {
    Err(AppError::Internal("Task retry — full implementation in B-8 DAG engine".into()))
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
    let rows = sqlx::query_as::<_, (Uuid,String,String,String,String,String,String,Option<String>,String,Option<i32>,Option<String>,bool)>(
        "SELECT id,slot,hosting_mode,endpoint_url,auth_type,model_name,model_family,family_override,health_status,avg_latency_ms,cube_endpoint_url,is_disabled FROM engine_configs WHERE org_id=$1 ORDER BY slot"
    ).bind(user.org_id).fetch_all(&state.db).await.map_err(AppError::Database)?;
    let engines: Vec<serde_json::Value> = rows.into_iter().map(|(id,slot,hm,eu,at,mn,mf,fo,hs,al,ce,dis)| serde_json::json!({
        "id":id,"slot":slot,"hosting_mode":hm,"endpoint_url":eu,"auth_type":at,
        "model_name":mn,"model_family":mf,"family_override":fo,"health_status":hs,"avg_latency_ms":al,
        "cube_endpoint_url":ce,"is_disabled":dis
    })).collect();

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
        let candidates = [
            format!("{base}/health"),
            format!("{base}/api/tags"),
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

    url.ok_or_else(|| AppError::Validation(
        "Slot A cube endpoint not configured — set it on the AI Engines page".into()
    ))
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
        .map_err(|e| AppError::Internal(format!("CRS unreachable: {e}")))?;

    let status = StatusCode::from_u16(resp.status().as_u16())
        .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("CRS response: {e}")))?;

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
        .map_err(|e| AppError::Internal(format!("CRS unreachable: {e}")))?;

    let status = StatusCode::from_u16(resp.status().as_u16())
        .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("CRS response: {e}")))?;
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
        .map_err(|e| AppError::Internal(format!("CRS unreachable: {e}")))?;
    let status = StatusCode::from_u16(resp.status().as_u16())
        .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("CRS response: {e}")))?;
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
        .map_err(|e| AppError::Internal(format!("CRS unreachable: {e}")))?;
    let status = StatusCode::from_u16(resp.status().as_u16())
        .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("CRS response: {e}")))?;
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
        .map_err(|e| AppError::Internal(format!("CRS unreachable: {e}")))?;

    let status = StatusCode::from_u16(resp.status().as_u16())
        .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("CRS response: {e}")))?;
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

    if !llm_enabled {
        issues.push(serde_json::json!({
            "id": "llm_gateway_disabled",
            "severity": "critical",
            "title": "AI agents are offline",
            "detail": "ANTHROPIC_API_KEY, OPENAI_API_KEY, and TOGETHER_API_KEY must all be set as environment variables before Alpha, Beta, and Gamma can process queries.",
            "action": "Add the three API keys in Settings → API Keys, then restart the server."
        }));
    }

    if live_peers.is_empty() {
        issues.push(serde_json::json!({
            "id": "no_cube_peers",
            "severity": "warning",
            "title": "No Array3 cube daemons reachable",
            "detail": "The PlenumLAN relay is armed but no cube peers have connected. Queries will fall back to cloud LLM only.",
            "action": "Start at least one Array3 daemon and ensure it can reach this server's CRS address."
        }));
    }

    Json(serde_json::json!({
        "ok": issues.iter().all(|i| i["severity"] != "critical"),
        "llm_gateway": {
            "enabled": llm_enabled,
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
