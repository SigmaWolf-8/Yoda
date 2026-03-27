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

/// Spawn a background inference task via PlenumLAN relay.
/// Returns immediately — the frontend polls GET /api/tasks/{id} every 3 s.
pub fn spawn_bg_inference(
    state: AppState,
    relay_tx: tokio::sync::mpsc::Sender<RelayInferRequest>,
    task_id: Uuid,
    cube_address: String,
    slot: String,
    model: String,
    messages: serde_json::Value,
    step_number: i32,
) {
    tokio::spawn(async move {
        const MAX_ATTEMPTS: u32 = 8;
        const RETRY_WAIT_SECS: u64 = 20;

        let mut succeeded = false;
        for attempt in 1..=MAX_ATTEMPTS {
            let req_id = Uuid::new_v4();
            let relay_req = RelayInferRequest {
                request_id: req_id,
                task_id,
                cube_address: cube_address.clone(),
                messages: messages.clone(),
                model: "local".to_string(),
                max_tokens: 1024,
                temperature: 0.7,
            };

            let (tx, rx) = oneshot::channel();
            state.pending_relays.write().await.insert(req_id, tx);

            let send_ok = match relay_tx.send(relay_req).await {
                Ok(()) => true,
                Err(e) => {
                    tracing::warn!(error = %e, attempt, "relay_tx send failed in bg task");
                    state.pending_relays.write().await.remove(&req_id);
                    false
                }
            };

            if !send_ok { break; }

            tracing::info!(
                task_id = %task_id, request_id = %req_id, attempt,
                "BG inference dispatched via PlenumLAN relay"
            );

            match tokio::time::timeout(Duration::from_secs(90), rx).await {
                Ok(Ok(Ok(result))) => {
                    let _ = sqlx::query(
                        "UPDATE tasks SET status = 'FINAL', updated_at = NOW() WHERE id = $1"
                    )
                    .bind(task_id)
                    .execute(&state.db)
                    .await;

                    let tis27 = format!("relay-{task_id}-step{step_number}");
                    let _ = sqlx::query(
                        "INSERT INTO task_results \
                         (id, task_id, step_number, engine_slot, engine_model, agent_role, tis27_hash, result_content, created_at) \
                         VALUES (uuid_generate_v4(), $1, $2, $3, $4, 'plenumlan-relay', $5, $6, NOW()) \
                         ON CONFLICT (task_id, step_number) DO UPDATE \
                           SET result_content = EXCLUDED.result_content, engine_model = EXCLUDED.engine_model"
                    )
                    .bind(task_id)
                    .bind(step_number)
                    .bind(slot.as_str())
                    .bind(&model)
                    .bind(&tis27)
                    .bind(&result.content)
                    .execute(&state.db)
                    .await;

                    // Store assistant message in thread
                    let _ = sqlx::query(
                        "INSERT INTO task_messages (task_id, role, content) VALUES ($1, 'assistant', $2)"
                    )
                    .bind(task_id)
                    .bind(&result.content)
                    .execute(&state.db)
                    .await;

                    tracing::info!(
                        task_id = %task_id, tokens = result.tokens, attempt,
                        "BG relay inference stored — task FINAL"
                    );
                    succeeded = true;
                    break;
                }
                Ok(Ok(Err(error_msg))) => {
                    if attempt >= MAX_ATTEMPTS {
                        tracing::warn!(
                            task_id = %task_id, error = %error_msg, attempt,
                            "BG: cube inference_error on final attempt — ESCALATED"
                        );
                        let _ = sqlx::query(
                            "UPDATE tasks SET status = 'ESCALATED', error_message = $2, updated_at = NOW() WHERE id = $1"
                        )
                        .bind(task_id)
                        .bind(&error_msg)
                        .execute(&state.db)
                        .await;
                    } else {
                        let remaining = MAX_ATTEMPTS - attempt;
                        let status_msg = format!(
                            "Waiting for engine (attempt {attempt}/{MAX_ATTEMPTS}, {remaining} retries left): {error_msg}"
                        );
                        tracing::warn!(
                            task_id = %task_id, error = %error_msg, attempt,
                            retry_in_secs = RETRY_WAIT_SECS,
                            "BG: cube inference_error — retrying"
                        );
                        let _ = sqlx::query(
                            "UPDATE tasks SET error_message = $2, updated_at = NOW() WHERE id = $1"
                        )
                        .bind(task_id)
                        .bind(&status_msg)
                        .execute(&state.db)
                        .await;
                        tokio::time::sleep(Duration::from_secs(RETRY_WAIT_SECS)).await;
                    }
                }
                Ok(Err(_)) => {
                    tracing::warn!(task_id = %task_id, attempt, "BG: relay oneshot dropped");
                    break;
                }
                Err(_) => {
                    state.pending_relays.write().await.remove(&req_id);
                    if attempt < MAX_ATTEMPTS {
                        tracing::warn!(
                            task_id = %task_id, attempt,
                            "BG: relay timed out — retrying"
                        );
                        tokio::time::sleep(Duration::from_secs(RETRY_WAIT_SECS)).await;
                    } else {
                        tracing::warn!(task_id = %task_id, "BG: relay timed out on final attempt — marking ESCALATED");
                        let _ = sqlx::query(
                            "UPDATE tasks SET status = 'ESCALATED', error_message = 'Engine did not respond within the retry window. Check that llama-server is running on the engine node.', updated_at = NOW() WHERE id = $1"
                        )
                        .bind(task_id)
                        .execute(&state.db)
                        .await;
                    }
                }
            }
        }

        if !succeeded {
            tracing::warn!(task_id = %task_id, "BG relay exhausted all attempts");
        }
    });
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
           AND is_disabled = false \
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

    // Store the opening user message in the thread
    let _ = sqlx::query(
        "INSERT INTO task_messages (task_id, role, content) VALUES ($1, 'user', $2)"
    )
    .bind(task_id)
    .bind(&req.text)
    .execute(&state.db)
    .await;

    // ── Try PlenumLAN relay first ─────────────────────────────────────────────
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
    let (engine_slot, engine_model_name) = match engine_info {
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

    if let Some(ref slot) = engine_slot {
        if let Some(relay_tx) = state.relay_tx.read().await.clone() {
            let preferred_addr = slot_to_cube_address(slot.as_str()).to_string();
            let live_peers = state.live_cube_peer.read().await.clone();
            let cube_address_opt = if live_peers.contains(&preferred_addr) {
                Some(preferred_addr)
            } else if !live_peers.is_empty() {
                tracing::warn!(
                    slot = %slot,
                    preferred = %slot_to_cube_address(slot.as_str()),
                    "Preferred daemon not live — routing to any available live peer"
                );
                live_peers.into_iter().next()
            } else {
                live_cube_address.clone()
            };

            if let Some(cube_address) = cube_address_opt {
                let _ = sqlx::query(
                    "UPDATE tasks SET status = 'STEP_1', updated_at = NOW() WHERE id = $1"
                )
                .bind(task_id)
                .execute(&state.db)
                .await;

                let bg_messages = serde_json::json!([
                    {"role": "system", "content": "You are a helpful AI assistant. Always respond in English, regardless of the language used in the query."},
                    {"role": "user", "content": req.text}
                ]);

                spawn_bg_inference(
                    state.clone(),
                    relay_tx,
                    task_id,
                    cube_address,
                    slot.clone(),
                    engine_model_name.clone(),
                    bg_messages,
                    1,
                );

                return Ok((StatusCode::CREATED, Json(QueryResponse {
                    decomposition: None,
                    task_id: Some(task_id),
                    needs_approval: false,
                    relay_endpoint: None,
                })));
            }
        }
    }

    // ── No relay path available ───────────────────────────────────────────────
    Ok((StatusCode::CREATED, Json(QueryResponse {
        decomposition: None,
        task_id: Some(task_id),
        needs_approval: false,
        relay_endpoint: None,
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
