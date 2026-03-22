//! Query submission routes.
//!
//! B5.3: POST /api/projects/:id/query → decompose or single task
//!       POST /api/projects/:id/query/approve → approve proposed breakdown

use axum::{extract::{Path, State}, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::auth::AuthenticatedUser;
use crate::cube_relay::{RelayInferRequest, slot_to_cube_address};
use crate::error::AppError;
use crate::state::AppState;
use yoda_orchestrator::decomposer::{
    self, DecomposeConfig, DecompositionResult, ProposedTask,
};
use yoda_orchestrator::Mode;

#[derive(Debug, Deserialize)]
pub struct SubmitQueryRequest {
    pub text: String,
    pub mode: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct QueryResponse {
    /// If decomposed, the proposed task tree (needs approval if budget exceeded).
    pub decomposition: Option<DecompositionResult>,
    /// If single-task (no decomposition), the task ID.
    pub task_id: Option<Uuid>,
    /// Whether user approval is needed before proceeding.
    pub needs_approval: bool,
    /// When set, the server could not reach the engine directly.
    /// The browser should POST to `{relay_endpoint}/v1/chat/completions`
    /// and then POST the result to /api/tasks/{task_id}/output.
    pub relay_endpoint: Option<String>,
}

/// POST /api/projects/:id/query
///
/// Submit a query for decomposition. If the query is simple, it runs
/// as a single task. If complex, it decomposes into a task tree.
/// If the decomposition exceeds the budget, it returns the proposed
/// breakdown for user approval.
pub async fn submit_query(
    State(state): State<AppState>,
    user: axum::Extension<AuthenticatedUser>,
    Path(project_id): Path<Uuid>,
    Json(req): Json<SubmitQueryRequest>,
) -> Result<(StatusCode, Json<QueryResponse>), AppError> {
    // Verify project ownership
    let (project_mode, settings) = sqlx::query_as::<_, (String, serde_json::Value)>(
        "SELECT mode, settings FROM projects WHERE id = $1 AND org_id = $2"
    )
    .bind(project_id)
    .bind(user.org_id)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?
    .ok_or(AppError::NotFound("Project not found".into()))?;

    let mode = match req.mode.as_deref().unwrap_or(&project_mode) {
        "ronin" => Mode::Ronin,
        _ => Mode::Yoda,
    };

    // Get decomposition budget from project settings
    let budget = settings
        .get("decomposition_budget")
        .and_then(|v| v.as_u64())
        .unwrap_or(30) as usize;

    let config = DecomposeConfig {
        budget,
        enable_merging: true,
    };

    // Try to find an orchestrator agent for decomposition
    let orchestrator = state.agents.get("capomastro-yoda-orchestrator")
        .or_else(|| state.agents.find_best_match(&["orchestration".into()]).ok());

    // Get a configured cloud engine for decomposition.
    // Only commercial/free_tier engines can be called directly from the server.
    // Self-hosted localhost engines cannot be reached from Replit — the browser
    // relay handles those after the task is created.
    let engines = sqlx::query_as::<_, (String, String, String, Option<String>, String, String)>(
        "SELECT slot, hosting_mode, endpoint_url, credentials_encrypted, model_name, auth_type \
         FROM engine_configs \
         WHERE org_id = $1 \
           AND health_status = 'online' \
           AND hosting_mode IN ('commercial', 'free_tier') \
         ORDER BY slot \
         LIMIT 1"
    )
    .bind(user.org_id)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?;

    // If we have an orchestrator agent and an online cloud engine, do full decomposition
    if let (Some(agent), Some(engine_row)) = (orchestrator, engines) {
        let engine_config = build_engine_config(&engine_row);

        match decomposer::decompose_query(
            &state.http_client,
            &engine_config,
            agent,
            &req.text,
            project_id,
            mode,
            &config,
        ).await {
            Ok(result) => {
                let needs_approval = result.budget_exceeded;
                return Ok((StatusCode::OK, Json(QueryResponse {
                    decomposition: Some(result),
                    task_id: None,
                    needs_approval,
                    relay_endpoint: None,
                })));
            }
            Err(e) => {
                tracing::warn!(error = %e, "Decomposition failed — falling back to simple task");
                // Fall through to simple decomposition
            }
        }
    }

    // Fallback: create a single task (no decomposition).
    // Fetch the next task number for this project (auto-increment per project).
    let next_number: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(task_number::bigint), 0) + 1 FROM tasks WHERE project_id = $1"
    )
    .bind(project_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(1);

    let task_id = Uuid::new_v4();
    let now = chrono::Utc::now();
    let competencies = serde_json::to_value(
        decomposer::decompose_simple(&req.text, project_id, mode)
            .first()
            .map(|t| t.competencies.clone())
            .unwrap_or_default()
    ).unwrap_or_default();
    let mode_str = match mode { Mode::Yoda => "yoda", Mode::Ronin => "ronin" };

    sqlx::query(
        "INSERT INTO tasks (id, project_id, task_number, title, competencies, dependencies, \
         status, workflow_position, mode, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, $5, '[]'::jsonb, 'QUEUED', $6, $7, $8, $8)"
    )
    .bind(task_id)
    .bind(project_id)
    .bind(next_number.to_string())
    .bind(&req.text)
    .bind(&competencies)
    .bind(next_number as i32)
    .bind(mode_str)
    .bind(now)
    .execute(&state.db)
    .await
    .map_err(AppError::Database)?;

    // ── Try PlenumLAN relay first ────────────────────────────────────────────
    // Pick the engine slot the user has configured and send the request through
    // the CRS relay.  30 s timeout — on miss, fall back to browser relay.
    let engine_slot: Option<String> = sqlx::query_scalar(
        "SELECT slot FROM engine_configs \
         WHERE org_id = $1 AND endpoint_url IS NOT NULL AND endpoint_url <> '' \
         ORDER BY slot ASC LIMIT 1"
    )
    .bind(user.org_id)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);

    if let Some(slot) = &engine_slot {
        // Check if the relay is alive
        if let Some(relay_tx) = state.relay_tx.read().await.clone() {
            let request_id = Uuid::new_v4();
            let cube_address = slot_to_cube_address(slot).to_string();

            let messages = serde_json::json!([
                {"role": "user", "content": req.text}
            ]);

            let relay_req = RelayInferRequest {
                request_id,
                task_id,
                cube_address,
                messages,
                model: "local".to_string(),
                max_tokens: 1024,
                temperature: 0.7,
            };

            // Register a pending oneshot before sending (avoid a race)
            let (tx, rx) = oneshot::channel();
            state.pending_relays.write().await.insert(request_id, tx);

            match relay_tx.send(relay_req).await {
                Ok(()) => {
                    tracing::info!(
                        task_id = %task_id,
                        request_id = %request_id,
                        "Inference request dispatched via PlenumLAN relay — awaiting response"
                    );

                    match tokio::time::timeout(Duration::from_secs(30), rx).await {
                        Ok(Ok(result)) => {
                            // Write result to DB and mark task FINAL
                            sqlx::query(
                                "UPDATE tasks SET status = 'FINAL', updated_at = NOW() \
                                 WHERE id = $1"
                            )
                            .bind(task_id)
                            .execute(&state.db)
                            .await
                            .map_err(AppError::Database)?;

                            sqlx::query(
                                "INSERT INTO task_results \
                                 (id, task_id, step_number, engine_slot, result_content, created_at) \
                                 VALUES (uuid_generate_v4(), $1, 1, $2, $3, NOW())"
                            )
                            .bind(task_id)
                            .bind(&result.model)
                            .bind(&result.content)
                            .execute(&state.db)
                            .await
                            .map_err(AppError::Database)?;

                            tracing::info!(
                                task_id = %task_id,
                                tokens = result.tokens,
                                "Relay inference result stored — task FINAL"
                            );

                            return Ok((StatusCode::CREATED, Json(QueryResponse {
                                decomposition: None,
                                task_id: Some(task_id),
                                needs_approval: false,
                                relay_endpoint: None,
                            })));
                        }
                        Ok(Err(_)) => {
                            tracing::warn!(task_id = %task_id, "Relay oneshot sender dropped");
                        }
                        Err(_) => {
                            tracing::warn!(
                                task_id = %task_id,
                                request_id = %request_id,
                                "Relay inference timed out after 30 s — falling back to browser relay"
                            );
                            state.pending_relays.write().await.remove(&request_id);
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!(error = %e, "relay_tx send failed — relay may be disconnecting");
                    state.pending_relays.write().await.remove(&request_id);
                }
            }
        }
    }

    // ── Cloud engine server-side inference fallback ───────────────────────────
    // PlenumLAN relay is down (CRS unreachable or timed out). Before handing off
    // to the browser, try any online cloud engine directly from the server.
    // The browser relay to http://localhost is blocked by mixed-content policy
    // from an HTTPS origin, so this is the only path that actually works when
    // the local engine's CRS tunnel isn't established.
    const INFERENCE_SYSTEM_PROMPT: &str =
        "You are YODA — a senior engineering intelligence system. \
         Analyse the user's query thoroughly. Provide structured, expert-level analysis \
         covering technical depth, security implications, trade-offs, and concrete \
         recommendations. Be precise. Use markdown where appropriate.";

    let cloud_engine_rows = sqlx::query_as::<_, (String, String, String, Option<String>, String, String)>(
        "SELECT slot, hosting_mode, endpoint_url, credentials_encrypted, model_name, auth_type \
         FROM engine_configs \
         WHERE org_id = $1 \
           AND health_status = 'online' \
           AND hosting_mode IN ('commercial', 'free_tier') \
           AND endpoint_url IS NOT NULL AND endpoint_url <> '' \
         ORDER BY slot ASC"
    )
    .bind(user.org_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    for engine_row in &cloud_engine_rows {
        let engine_cfg = build_engine_config(engine_row);
        match yoda_inference_router::dispatch::call_engine(
            &state.http_client,
            &engine_cfg,
            INFERENCE_SYSTEM_PROMPT,
            &req.text,
            Some(4096),
        ).await {
            Ok(result) => {
                let slot_str = match engine_cfg.slot {
                    yoda_inference_router::EngineSlot::A => "a",
                    yoda_inference_router::EngineSlot::B => "b",
                    yoda_inference_router::EngineSlot::C => "c",
                };
                sqlx::query(
                    "UPDATE tasks SET status = 'FINAL', updated_at = NOW() WHERE id = $1"
                )
                .bind(task_id)
                .execute(&state.db)
                .await
                .map_err(AppError::Database)?;

                sqlx::query(
                    "INSERT INTO task_results \
                     (id, task_id, step_number, engine_slot, result_content, created_at) \
                     VALUES (uuid_generate_v4(), $1, 1, $2, $3, NOW())"
                )
                .bind(task_id)
                .bind(slot_str)
                .bind(&result.content)
                .execute(&state.db)
                .await
                .map_err(AppError::Database)?;

                tracing::info!(
                    task_id = %task_id,
                    slot = slot_str,
                    latency_ms = result.latency_ms,
                    "Cloud engine inference complete — task FINAL"
                );

                return Ok((StatusCode::CREATED, Json(QueryResponse {
                    decomposition: None,
                    task_id: Some(task_id),
                    needs_approval: false,
                    relay_endpoint: None,
                })));
            }
            Err(e) => {
                tracing::warn!(
                    slot = ?engine_cfg.slot,
                    error = %e,
                    "Cloud engine inference failed — trying next"
                );
            }
        }
    }

    // ── Browser relay last resort ─────────────────────────────────────────────
    // No cloud engine succeeded. Return the local endpoint so the browser can
    // attempt a direct fetch. This only works when the page is served over HTTP
    // (not HTTPS) or when the browser has mixed-content exceptions. On HTTPS
    // this will fail with a CORS/mixed-content error — the user needs the CRS
    // tunnel working or a cloud engine configured.
    let relay_info: Option<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT slot, hosting_mode, endpoint_url FROM engine_configs \
         WHERE org_id = $1 AND hosting_mode = 'self_hosted' \
         ORDER BY slot ASC LIMIT 1"
    )
    .bind(user.org_id)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);

    let relay_endpoint: Option<String> = relay_info.and_then(|(slot, hosting_mode, endpoint_url)| {
        if let Some(url) = endpoint_url.filter(|u| !u.is_empty()) {
            return Some(url);
        }
        if hosting_mode == "self_hosted" {
            let port = match slot.as_str() { "b" => 8082u16, "c" => 8084, _ => 8080 };
            Some(format!("http://localhost:{port}"))
        } else {
            None
        }
    });

    Ok((StatusCode::CREATED, Json(QueryResponse {
        decomposition: None,
        task_id: Some(task_id),
        needs_approval: false,
        relay_endpoint,
    })))
}

#[derive(Debug, Deserialize)]
pub struct ApproveDecompositionRequest {
    pub tasks: Vec<ProposedTask>,
}

#[derive(Debug, Serialize)]
pub struct ApproveResponse {
    pub task_ids: Vec<Uuid>,
    pub task_count: usize,
}

/// POST /api/projects/:id/query/approve
///
/// Approve a proposed decomposition. Creates all tasks in the database.
pub async fn approve_decomposition(
    State(state): State<AppState>,
    user: axum::Extension<AuthenticatedUser>,
    Path(project_id): Path<Uuid>,
    Json(req): Json<ApproveDecompositionRequest>,
) -> Result<(StatusCode, Json<ApproveResponse>), AppError> {
    // Verify project ownership
    let mode_str = sqlx::query_scalar::<_, String>(
        "SELECT mode FROM projects WHERE id = $1 AND org_id = $2"
    )
    .bind(project_id)
    .bind(user.org_id)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?
    .ok_or(AppError::NotFound("Project not found".into()))?;

    let mode = match mode_str.as_str() {
        "ronin" => Mode::Ronin,
        _ => Mode::Yoda,
    };

    // Materialize all proposed tasks
    let tasks = decomposer::materialize_tasks(&req.tasks, project_id, mode);
    let mut task_ids = Vec::new();
    let now = chrono::Utc::now();

    for task in &tasks {
        let competencies_json = serde_json::to_value(&task.competencies).unwrap_or_default();
        let dependencies_json = serde_json::to_value(&task.dependencies).unwrap_or_default();
        let mode_str = match task.mode { Mode::Yoda => "yoda", Mode::Ronin => "ronin" };

        sqlx::query(
            "INSERT INTO tasks (id, project_id, task_number, title, competencies, dependencies, \
             status, workflow_position, mode, created_at, updated_at) \
             VALUES ($1, $2, $3, $4, $5, $6, 'QUEUED', $7, $8, $9, $9)"
        )
        .bind(task.id)
        .bind(project_id)
        .bind(&task.task_number)
        .bind(&task.title)
        .bind(&competencies_json)
        .bind(&dependencies_json)
        .bind(task.workflow_position)
        .bind(mode_str)
        .bind(now)
        .execute(&state.db)
        .await
        .map_err(AppError::Database)?;

        task_ids.push(task.id);
    }

    tracing::info!(
        project_id = %project_id,
        tasks = task_ids.len(),
        "Decomposition approved — tasks created"
    );

    Ok((StatusCode::CREATED, Json(ApproveResponse {
        task_count: task_ids.len(),
        task_ids,
    })))
}

/// Helper: build an EngineConfig from a DB row tuple.
fn build_engine_config(
    row: &(String, String, String, Option<String>, String, String),
) -> yoda_inference_router::EngineConfig {
    use yoda_inference_router::*;
    let (slot, hosting_mode, endpoint_url, credentials, model_name, auth_type) = row;

    EngineConfig {
        slot: match slot.as_str() { "b" => EngineSlot::B, "c" => EngineSlot::C, _ => EngineSlot::A },
        hosting_mode: match hosting_mode.as_str() {
            "commercial" => HostingMode::Commercial,
            "free_tier" => HostingMode::FreeTier,
            _ => HostingMode::SelfHosted,
        },
        endpoint_url: endpoint_url.clone(),
        auth_type: match auth_type.as_str() {
            "bearer" => AuthType::Bearer,
            "api_key" => AuthType::ApiKey,
            _ => AuthType::None,
        },
        credentials: credentials.clone(),
        model_name: model_name.clone(),
        model_family: String::new(),
        health_status: HealthStatus::Online,
    }
}
