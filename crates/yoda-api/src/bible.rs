//! Task Bible routes.
//!
//! B5.4: GET /api/projects/:id/bible → list entries
//!       GET /api/bible/:task_id → single entry with code blocks, reviews, sigs

use axum::{extract::{Path, State}, Json};
use serde::Serialize;
use uuid::Uuid;

use crate::auth::AuthenticatedUser;
use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct BibleEntryResponse {
    pub id: Uuid,
    pub task_id: Uuid,
    pub task_number: String,
    pub title: String,
    pub competencies: serde_json::Value,
    pub dependencies: serde_json::Value,
    pub all_results: serde_json::Value,
    pub all_reviews: serde_json::Value,
    pub final_output: String,
    pub code_blocks: serde_json::Value,
    pub tl_dsa_signature: Option<String>,
    pub signature_chain: serde_json::Value,
    pub timestamps: serde_json::Value,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// GET /api/projects/:id/bible
pub async fn list_bible_entries(
    State(state): State<AppState>,
    user: axum::Extension<AuthenticatedUser>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<Vec<BibleEntryResponse>>, AppError> {
    // Verify project ownership
    let _ = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM projects WHERE id = $1 AND org_id = $2"
    )
    .bind(project_id)
    .bind(user.org_id)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?
    .ok_or(AppError::NotFound("Project not found".into()))?;

    let rows = sqlx::query_as::<_, (
        Uuid, Uuid, String, String, serde_json::Value, serde_json::Value,
        serde_json::Value, serde_json::Value, String, serde_json::Value,
        Option<String>, serde_json::Value, serde_json::Value,
        chrono::DateTime<chrono::Utc>,
    )>(
        "SELECT tbe.id, tbe.task_id, tbe.task_number, tbe.title, tbe.competencies, \
         tbe.dependencies, tbe.all_results, tbe.all_reviews, tbe.final_output, \
         tbe.code_blocks, tbe.tl_dsa_signature, tbe.signature_chain, tbe.timestamps, \
         tbe.created_at \
         FROM task_bible_entries tbe \
         JOIN tasks t ON tbe.task_id = t.id \
         WHERE t.project_id = $1 \
         ORDER BY tbe.task_number"
    )
    .bind(project_id)
    .fetch_all(&state.db)
    .await
    .map_err(AppError::Database)?;

    Ok(Json(rows.into_iter().map(|r| BibleEntryResponse {
        id: r.0, task_id: r.1, task_number: r.2, title: r.3,
        competencies: r.4, dependencies: r.5, all_results: r.6,
        all_reviews: r.7, final_output: r.8, code_blocks: r.9,
        tl_dsa_signature: r.10, signature_chain: r.11, timestamps: r.12,
        created_at: r.13,
    }).collect()))
}

/// GET /api/bible/:task_id
pub async fn get_bible_entry(
    State(state): State<AppState>,
    Path(task_id): Path<Uuid>,
) -> Result<Json<BibleEntryResponse>, AppError> {
    let row = sqlx::query_as::<_, (
        Uuid, Uuid, String, String, serde_json::Value, serde_json::Value,
        serde_json::Value, serde_json::Value, String, serde_json::Value,
        Option<String>, serde_json::Value, serde_json::Value,
        chrono::DateTime<chrono::Utc>,
    )>(
        "SELECT id, task_id, task_number, title, competencies, dependencies, \
         all_results, all_reviews, final_output, code_blocks, tl_dsa_signature, \
         signature_chain, timestamps, created_at \
         FROM task_bible_entries WHERE task_id = $1"
    )
    .bind(task_id)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?
    .ok_or(AppError::NotFound("Task Bible entry not found".into()))?;

    Ok(Json(BibleEntryResponse {
        id: row.0, task_id: row.1, task_number: row.2, title: row.3,
        competencies: row.4, dependencies: row.5, all_results: row.6,
        all_reviews: row.7, final_output: row.8, code_blocks: row.9,
        tl_dsa_signature: row.10, signature_chain: row.11, timestamps: row.12,
        created_at: row.13,
    }))
}
