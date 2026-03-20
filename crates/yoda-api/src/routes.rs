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
    extract::{Path, State},
    http::StatusCode,
    middleware,
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::agents;
use crate::auth;
use crate::audit;
use crate::bible;
use crate::capability;
use crate::error::AppError;
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
        .route("/api/salvi/inter-cube/crs/stats", get(crs_stats))
        .route("/api/yoda/crs/session/{token}", get(crs_session));

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

        // Engine configuration
        .route("/api/settings/engines", get(get_engines))
        .route("/api/settings/engines/{slot}", put(update_engine))
        .route("/api/settings/engines/{slot}", delete(clear_engine))
        .route("/api/settings/engines/{slot}/probe", get(probe_engine))
        .route("/api/settings/engines/{slot}/mark-online", post(mark_engine_online))
        .route("/api/settings/engines/{slot}/mark-offline", post(mark_engine_offline))
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

#[derive(Debug, Serialize)]
struct TaskResponse {
    id: Uuid, task_number: String, title: String, status: String,
    mode: String, competencies: serde_json::Value, dependencies: serde_json::Value,
    workflow_position: Option<i32>, created_at: chrono::DateTime<chrono::Utc>,
}

async fn list_tasks(
    State(state): State<AppState>,
    user: axum::Extension<auth::AuthenticatedUser>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<Vec<TaskResponse>>, AppError> {
    let _ = sqlx::query_scalar::<_,Uuid>("SELECT id FROM projects WHERE id=$1 AND org_id=$2")
        .bind(project_id).bind(user.org_id).fetch_optional(&state.db).await
        .map_err(AppError::Database)?.ok_or(AppError::NotFound("Project not found".into()))?;
    let rows = sqlx::query_as::<_, (Uuid,String,String,String,String,serde_json::Value,serde_json::Value,Option<i32>,chrono::DateTime<chrono::Utc>)>(
        "SELECT id,task_number,title,status,mode,competencies,dependencies,workflow_position,created_at FROM tasks WHERE project_id=$1 ORDER BY workflow_position,task_number"
    ).bind(project_id).fetch_all(&state.db).await.map_err(AppError::Database)?;
    Ok(Json(rows.into_iter().map(|(id,tn,t,s,m,c,d,wp,ca)| TaskResponse{id,task_number:tn,title:t,status:s,mode:m,competencies:c,dependencies:d,workflow_position:wp,created_at:ca}).collect()))
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

async fn get_task(State(state): State<AppState>, Path(task_id): Path<Uuid>) -> Result<Json<TaskResponse>, AppError> {
    let (id,tn,t,s,m,c,d,wp,ca) = sqlx::query_as::<_, (Uuid,String,String,String,String,serde_json::Value,serde_json::Value,Option<i32>,chrono::DateTime<chrono::Utc>)>(
        "SELECT id,task_number,title,status,mode,competencies,dependencies,workflow_position,created_at FROM tasks WHERE id=$1"
    ).bind(task_id).fetch_optional(&state.db).await.map_err(AppError::Database)?.ok_or(AppError::NotFound("Task not found".into()))?;
    Ok(Json(TaskResponse{id,task_number:tn,title:t,status:s,mode:m,competencies:c,dependencies:d,workflow_position:wp,created_at:ca}))
}

async fn retry_task(State(_state): State<AppState>, Path(_task_id): Path<Uuid>) -> Result<Json<serde_json::Value>, AppError> {
    Err(AppError::Internal("Task retry — full implementation in B-8 DAG engine".into()))
}

async fn escalate_task(State(state): State<AppState>, Path(task_id): Path<Uuid>) -> Result<Json<TaskResponse>, AppError> {
    sqlx::query("UPDATE tasks SET status='ESCALATED' WHERE id=$1").bind(task_id).execute(&state.db).await.map_err(AppError::Database)?;
    get_task(State(state), Path(task_id)).await
}

async fn cancel_task(State(state): State<AppState>, Path(task_id): Path<Uuid>) -> Result<StatusCode, AppError> {
    sqlx::query("UPDATE tasks SET status='ESCALATED' WHERE id=$1 AND status NOT IN ('FINAL','ESCALATED')")
        .bind(task_id).execute(&state.db).await.map_err(AppError::Database)?;
    Ok(StatusCode::NO_CONTENT)
}

// ─── Engines ─────────────────────────────────────────────────────────

async fn get_engines(
    State(state): State<AppState>,
    user: axum::Extension<auth::AuthenticatedUser>,
) -> Result<Json<serde_json::Value>, AppError> {
    let rows = sqlx::query_as::<_, (Uuid,String,String,String,String,String,String,Option<String>,String,Option<i32>)>(
        "SELECT id,slot,hosting_mode,endpoint_url,auth_type,model_name,model_family,family_override,health_status,avg_latency_ms FROM engine_configs WHERE org_id=$1 ORDER BY slot"
    ).bind(user.org_id).fetch_all(&state.db).await.map_err(AppError::Database)?;
    let engines: Vec<serde_json::Value> = rows.into_iter().map(|(id,slot,hm,eu,at,mn,mf,fo,hs,al)| serde_json::json!({
        "id":id,"slot":slot,"hosting_mode":hm,"endpoint_url":eu,"auth_type":at,
        "model_name":mn,"model_family":mf,"family_override":fo,"health_status":hs,"avg_latency_ms":al
    })).collect();
    Ok(Json(serde_json::json!({ "engines": engines })))
}

#[derive(Debug, Deserialize)]
struct UpdateEngineRequest {
    hosting_mode: String, endpoint_url: String, auth_type: String,
    credentials: Option<String>, model_name: String, model_family: String,
    family_override: Option<String>,
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

    sqlx::query(
        "INSERT INTO engine_configs (id, org_id, slot, hosting_mode, endpoint_url, auth_type, \
         credentials_encrypted, model_name, model_family, family_override, health_status) \
         VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, 'offline') \
         ON CONFLICT (org_id, slot) DO UPDATE SET \
         hosting_mode=$3, endpoint_url=$4, auth_type=$5, credentials_encrypted=$6, \
         model_name=$7, model_family=$8, family_override=$9"
    )
    .bind(user.org_id).bind(&slot).bind(&req.hosting_mode).bind(&req.endpoint_url)
    .bind(&req.auth_type).bind(&credentials_encrypted).bind(&req.model_name)
    .bind(&req.model_family).bind(&req.family_override)
    .execute(&state.db).await.map_err(AppError::Database)?;

    Ok(Json(serde_json::json!({"status":"updated","slot":slot})))
}

/// DELETE /api/settings/engines/{slot}
/// Clears a slot — resets model_name to empty and restores the default endpoint.
async fn clear_engine(
    State(state): State<AppState>,
    user: axum::Extension<auth::AuthenticatedUser>,
    Path(slot): Path<String>,
) -> Result<StatusCode, AppError> {
    if !["a","b","c"].contains(&slot.as_str()) {
        return Err(AppError::Validation("Slot must be 'a', 'b', or 'c'".into()));
    }
    let default_port: u16 = match slot.as_str() { "a" => 8080, "b" => 8081, _ => 8082 };
    sqlx::query(
        "UPDATE engine_configs \
         SET model_name='', model_family='', family_override=NULL, \
             endpoint_url=$3, credentials_encrypted=NULL \
         WHERE org_id=$1 AND slot=$2"
    )
    .bind(user.org_id)
    .bind(&slot)
    .bind(format!("http://localhost:{}", default_port))
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

/// GET /api/settings/engines/{slot}/probe
/// Tries the engine endpoint from the server side.
/// Checks /health (PlenumNET / inter-cube) first, then /api/tags (Ollama) as fallback.
/// Writes health_status + avg_latency_ms back to the DB on success.
async fn probe_engine(
    State(state): State<AppState>,
    user: axum::Extension<auth::AuthenticatedUser>,
    Path(slot): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let row = sqlx::query_as::<_, (String,)>(
        "SELECT endpoint_url FROM engine_configs WHERE org_id=$1 AND slot=$2",
    )
    .bind(user.org_id)
    .bind(&slot)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?;

    let endpoint_url = match row {
        Some((url,)) => url,
        None => {
            return Ok(Json(serde_json::json!({
                "reachable": false,
                "error": "Engine not configured"
            })))
        }
    };

    let base = endpoint_url.trim_end_matches('/');
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| AppError::Internal(format!("HTTP client: {e}")))?;

    // Try /health first (PlenumNET/inter-cube), then /api/tags (Ollama)
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

    // Write health result back to DB
    let health_str = if reachable { "online" } else { "offline" };
    let latency_i = latency_ms as i32;
    let _ = sqlx::query(
        "UPDATE engine_configs SET health_status=$1, avg_latency_ms=$2 \
         WHERE org_id=$3 AND slot=$4",
    )
    .bind(health_str)
    .bind(latency_i)
    .bind(user.org_id)
    .bind(&slot)
    .execute(&state.db)
    .await;

    Ok(Json(serde_json::json!({
        "reachable": reachable,
        "latency_ms": latency_ms,
        "http_status": http_status,
        "probe_url": probe_url_used,
        "endpoint_url": endpoint_url,
    })))
}

/// POST /api/settings/engines/{slot}/mark-online
/// Called by the frontend when the CRS session confirms the local node is registered.
async fn mark_engine_online(
    State(state): State<AppState>,
    user: axum::Extension<auth::AuthenticatedUser>,
    Path(slot): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    sqlx::query(
        "UPDATE engine_configs SET health_status='online' WHERE org_id=$1 AND slot=$2",
    )
    .bind(user.org_id)
    .bind(&slot)
    .execute(&state.db)
    .await
    .map_err(AppError::Database)?;
    Ok(Json(serde_json::json!({"status": "online", "slot": slot})))
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
// yoda-crs on 127.0.0.1:8081 (internal only). Install scripts and the
// frontend polling both hit port 3000; they never speak to 8081 directly.

const CRS_BASE: &str = "http://127.0.0.1:8081";

/// Helper: build a one-shot reqwest client (no connection pooling needed).
fn crs_client() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .build()
        .map_err(|e| AppError::Internal(format!("CRS client: {e}")))
}

/// POST /api/salvi/inter-cube/crs/register → CRS register
/// Body is forwarded verbatim so sessionToken is preserved.
async fn crs_register(body: Bytes) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let client = crs_client()?;
    let resp = client
        .post(format!("{CRS_BASE}/api/salvi/inter-cube/crs/register"))
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
    Ok((status, Json(json)))
}

/// POST /api/salvi/inter-cube/crs/heartbeat → CRS heartbeat
async fn crs_heartbeat(body: Bytes) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let client = crs_client()?;
    let resp = client
        .post(format!("{CRS_BASE}/api/salvi/inter-cube/crs/heartbeat"))
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
    Ok((status, Json(json)))
}

/// GET /api/salvi/inter-cube/crs/stats → CRS stats
async fn crs_stats() -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let client = crs_client()?;
    let resp = client
        .get(format!("{CRS_BASE}/api/salvi/inter-cube/crs/stats"))
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

/// GET /api/yoda/crs/session/{token} → CRS session poll
/// Used by ModelInstallModal to track connection status.
async fn crs_session(
    Path(token): Path<String>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let client = crs_client()?;
    let resp = client
        .get(format!("{CRS_BASE}/api/yoda/crs/session/{token}"))
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
