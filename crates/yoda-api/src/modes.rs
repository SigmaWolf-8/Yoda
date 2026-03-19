//! Mode promotion and escalation endpoints.
//!
//! B7.2: POST /api/projects/:id/promote → Yoda→Ronin (inherits all context)
//! B7.3: POST /api/tasks/:id/escalate-to-yoda → Ronin→Yoda (technical constraint)

use axum::{extract::{Path, State}, Json};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::AuthenticatedUser;
use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct PromoteResponse {
    pub project_id: Uuid,
    pub previous_mode: String,
    pub new_mode: String,
    pub context_preserved: bool,
}

/// POST /api/projects/:id/promote
///
/// Promote a Yoda project to Ronin mode. All existing context,
/// knowledge base entries, and task history are preserved.
/// Assembly output will now include implementation instructions + code blocks.
pub async fn promote_to_ronin(
    State(state): State<AppState>,
    user: axum::Extension<AuthenticatedUser>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<PromoteResponse>, AppError> {
    let current_mode = sqlx::query_scalar::<_, String>(
        "SELECT mode FROM projects WHERE id = $1 AND org_id = $2"
    )
    .bind(project_id)
    .bind(user.org_id)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?
    .ok_or(AppError::NotFound("Project not found".into()))?;

    if current_mode == "ronin" {
        return Err(AppError::Conflict("Project is already in Ronin mode".into()));
    }

    // Update mode — settings preserved, review_intensity upgraded to full
    sqlx::query(
        "UPDATE projects SET mode = 'ronin', \
         settings = jsonb_set(settings, '{review_intensity}', '\"full\"') \
         WHERE id = $1"
    )
    .bind(project_id)
    .execute(&state.db)
    .await
    .map_err(AppError::Database)?;

    // Log the promotion
    crate::security::log_audit_event(
        &state.db,
        None,
        Some(project_id),
        "mode_promoted",
        &serde_json::json!({
            "from": "yoda",
            "to": "ronin",
            "user_id": user.user_id,
        }),
    )
    .await
    .map_err(|e| AppError::Internal(format!("Audit log failed: {}", e)))?;

    tracing::info!(project_id = %project_id, "Project promoted: Yoda → Ronin");

    Ok(Json(PromoteResponse {
        project_id,
        previous_mode: "yoda".into(),
        new_mode: "ronin".into(),
        context_preserved: true,
    }))
}

#[derive(Debug, Deserialize)]
pub struct EscalateToYodaRequest {
    pub constraint: String,
}

#[derive(Debug, Serialize)]
pub struct EscalateToYodaResponse {
    pub original_task_id: Uuid,
    pub analysis_task_id: Uuid,
    pub analysis_title: String,
    pub mode: String,
}

/// POST /api/tasks/:id/escalate-to-yoda
///
/// Escalate a Ronin task to Yoda mode for analysis. Creates a new
/// Yoda-mode analysis task to evaluate the technical constraint.
/// The Ronin task is paused (ESCALATED) until analysis completes.
pub async fn escalate_to_yoda(
    State(state): State<AppState>,
    Path(task_id): Path<Uuid>,
    Json(req): Json<EscalateToYodaRequest>,
) -> Result<Json<EscalateToYodaResponse>, AppError> {
    // Get the original task
    let (project_id, title, task_number) = sqlx::query_as::<_, (Uuid, String, String)>(
        "SELECT project_id, title, task_number FROM tasks WHERE id = $1"
    )
    .bind(task_id)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?
    .ok_or(AppError::NotFound("Task not found".into()))?;

    // Mark original task as ESCALATED
    sqlx::query("UPDATE tasks SET status = 'ESCALATED' WHERE id = $1")
        .bind(task_id)
        .execute(&state.db)
        .await
        .map_err(AppError::Database)?;

    // Create a Yoda-mode analysis task
    let (analysis_mode, analysis_title) =
        yoda_orchestrator::assembly::escalate_to_yoda(&title, &req.constraint);

    let analysis_task_id = Uuid::new_v4();
    let now = chrono::Utc::now();
    let analysis_number = format!("{}.analysis", task_number);
    let mode_str = "yoda";

    sqlx::query(
        "INSERT INTO tasks (id, project_id, task_number, title, competencies, dependencies, \
         status, workflow_position, mode, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, '[\"analysis\", \"architecture\"]'::jsonb, $5::jsonb, \
         'QUEUED', NULL, $6, $7, $7)"
    )
    .bind(analysis_task_id)
    .bind(project_id)
    .bind(&analysis_number)
    .bind(&analysis_title)
    .bind(serde_json::json!([task_number]))
    .bind(mode_str)
    .bind(now)
    .execute(&state.db)
    .await
    .map_err(AppError::Database)?;

    // Log the escalation
    crate::security::log_audit_event(
        &state.db,
        Some(task_id),
        Some(project_id),
        "task_escalated_to_yoda",
        &serde_json::json!({
            "original_task": task_id,
            "analysis_task": analysis_task_id,
            "constraint": req.constraint,
        }),
    )
    .await
    .map_err(|e| AppError::Internal(format!("Audit log failed: {}", e)))?;

    tracing::info!(
        task_id = %task_id,
        analysis_id = %analysis_task_id,
        "Ronin task escalated to Yoda analysis"
    );

    Ok(Json(EscalateToYodaResponse {
        original_task_id: task_id,
        analysis_task_id,
        analysis_title,
        mode: mode_str.into(),
    }))
}
