//! Audit routes.
//!
//! B5.6: GET /api/audit/:task_id → audit records
//!       GET /api/audit/:task_id/export/json → download signed JSON

use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use uuid::Uuid;

use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct AuditRecordResponse {
    pub id: Uuid,
    pub task_id: Option<Uuid>,
    pub event_type: String,
    pub payload_hash: String,
    pub tl_dsa_signature: Option<String>,
    pub engine_slot: Option<String>,
    pub engine_model: Option<String>,
    pub payload: serde_json::Value,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// GET /api/audit/:task_id
pub async fn get_audit_log(
    State(state): State<AppState>,
    Path(task_id): Path<Uuid>,
) -> Result<Json<Vec<AuditRecordResponse>>, AppError> {
    let rows = sqlx::query_as::<_, (
        Uuid, Option<Uuid>, String, String, Option<String>,
        Option<String>, Option<String>, serde_json::Value,
        chrono::DateTime<chrono::Utc>,
    )>(
        "SELECT id, task_id, event_type, payload_hash, tl_dsa_signature, \
         engine_slot, engine_model, payload, created_at \
         FROM audit_log \
         WHERE task_id = $1 \
         ORDER BY created_at ASC"
    )
    .bind(task_id)
    .fetch_all(&state.db)
    .await
    .map_err(AppError::Database)?;

    Ok(Json(rows.into_iter().map(|r| AuditRecordResponse {
        id: r.0, task_id: r.1, event_type: r.2, payload_hash: r.3,
        tl_dsa_signature: r.4, engine_slot: r.5, engine_model: r.6,
        payload: r.7, created_at: r.8,
    }).collect()))
}

/// GET /api/audit/:task_id/export/json
///
/// Export the complete audit trail as a signed JSON file download.
/// The frontend uses this JSON to generate PDFs via jsPDF.
pub async fn export_audit_json(
    State(state): State<AppState>,
    Path(task_id): Path<Uuid>,
) -> Result<Response, AppError> {
    // Fetch all audit records
    let records = sqlx::query_as::<_, (
        Uuid, Option<Uuid>, String, String, Option<String>,
        Option<String>, Option<String>, serde_json::Value,
        chrono::DateTime<chrono::Utc>,
    )>(
        "SELECT id, task_id, event_type, payload_hash, tl_dsa_signature, \
         engine_slot, engine_model, payload, created_at \
         FROM audit_log \
         WHERE task_id = $1 \
         ORDER BY created_at ASC"
    )
    .bind(task_id)
    .fetch_all(&state.db)
    .await
    .map_err(AppError::Database)?;

    // Fetch task bible entry if exists
    let bible_entry = sqlx::query_as::<_, (
        String, String, serde_json::Value, serde_json::Value, String,
        serde_json::Value, Option<String>, serde_json::Value,
    )>(
        "SELECT task_number, title, all_results, all_reviews, final_output, \
         code_blocks, tl_dsa_signature, signature_chain \
         FROM task_bible_entries WHERE task_id = $1"
    )
    .bind(task_id)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?;

    // Build the signed export
    let export = serde_json::json!({
        "export_type": "yoda_audit_trail",
        "export_version": "1.0",
        "task_id": task_id,
        "exported_at": chrono::Utc::now(),
        "audit_records": records.iter().map(|r| serde_json::json!({
            "id": r.0,
            "event_type": r.2,
            "payload_hash": r.3,
            "tl_dsa_signature": r.4,
            "engine_slot": r.5,
            "engine_model": r.6,
            "payload": r.7,
            "created_at": r.8,
        })).collect::<Vec<_>>(),
        "task_bible": bible_entry.map(|b| serde_json::json!({
            "task_number": b.0,
            "title": b.1,
            "all_results": b.2,
            "all_reviews": b.3,
            "final_output": b.4,
            "code_blocks": b.5,
            "tl_dsa_signature": b.6,
            "signature_chain": b.7,
        })),
        "record_count": records.len(),
    });

    let json_bytes = serde_json::to_string_pretty(&export)
        .map_err(|e| AppError::Internal(format!("JSON serialization failed: {}", e)))?;

    let filename = format!("yoda_audit_{}.json", task_id);

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/json"),
            (header::CONTENT_DISPOSITION, &format!("attachment; filename=\"{}\"", filename)),
        ],
        json_bytes,
    ).into_response())
}
