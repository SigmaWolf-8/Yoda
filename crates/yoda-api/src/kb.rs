//! Knowledge Base routes.
//!
//! B5.5: GET  /api/projects/:id/kb?q=&tags=&archived= → search KB
//!       PUT  /api/kb/:id → update tags/boost/archive/pin
//!       DELETE /api/kb/:id → permanent delete

use axum::{extract::{Path, Query, State}, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::AuthenticatedUser;
use crate::error::AppError;
use crate::state::AppState;
use yoda_knowledge_base::{SearchFilters, SearchResult};
use yoda_knowledge_base::search::{hybrid_search, SearchWeights};
use yoda_knowledge_base::storage;
use yoda_knowledge_base::tagging;

#[derive(Debug, Deserialize)]
pub struct KBSearchQuery {
    pub q: Option<String>,
    pub tags: Option<String>,  // comma-separated
    pub archived: Option<bool>,
    pub pinned: Option<bool>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct KBSearchResponse {
    pub results: Vec<SearchResultResponse>,
    pub total: usize,
}

#[derive(Debug, Serialize)]
pub struct SearchResultResponse {
    pub id: Uuid,
    pub content: String,
    pub summary: String,
    pub tags: Vec<String>,
    pub archived: bool,
    pub pinned: bool,
    pub boost_score: f64,
    pub relevance_score: f64,
    pub match_source: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// GET /api/projects/:id/kb
pub async fn search_kb(
    State(state): State<AppState>,
    user: axum::Extension<AuthenticatedUser>,
    Path(project_id): Path<Uuid>,
    Query(params): Query<KBSearchQuery>,
) -> Result<Json<KBSearchResponse>, AppError> {
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

    let tags: Option<Vec<String>> = params.tags.map(|t| {
        t.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()
    });

    let filters = SearchFilters {
        query: params.q,
        project_id: Some(project_id),
        tags,
        archived: params.archived,
        pinned: params.pinned,
        limit: params.limit.or(Some(20)),
        offset: params.offset,
        ..Default::default()
    };

    // TODO: generate query embedding for semantic search when embedding engine available
    let query_embedding: Option<&[f32]> = None;

    let results = hybrid_search(&state.db, &filters, query_embedding, &SearchWeights::default())
        .await
        .map_err(|e| AppError::Internal(format!("Search failed: {}", e)))?;

    let total = results.len();
    let response_results: Vec<SearchResultResponse> = results.into_iter().map(|r| {
        SearchResultResponse {
            id: r.entry.id,
            content: r.entry.content,
            summary: r.entry.summary,
            tags: r.entry.tags,
            archived: r.entry.archived,
            pinned: r.entry.pinned,
            boost_score: r.entry.boost_score,
            relevance_score: r.relevance_score,
            match_source: format!("{:?}", r.match_source).to_lowercase(),
            created_at: r.entry.created_at,
        }
    }).collect();

    Ok(Json(KBSearchResponse { results: response_results, total }))
}

#[derive(Debug, Deserialize)]
pub struct UpdateKBRequest {
    pub tags: Option<Vec<String>>,
    pub boost_score: Option<f64>,
    pub archived: Option<bool>,
    pub pinned: Option<bool>,
}

/// PUT /api/kb/:id
pub async fn update_kb_entry(
    State(state): State<AppState>,
    Path(entry_id): Path<Uuid>,
    Json(req): Json<UpdateKBRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Validate boost range
    if let Some(boost) = req.boost_score {
        if !(0.0..=5.0).contains(&boost) {
            return Err(AppError::Validation("boost_score must be between 0.0 and 5.0".into()));
        }
    }

    storage::update_entry(
        &state.db, entry_id,
        req.tags.as_deref(), req.boost_score, req.archived, req.pinned,
    )
    .await
    .map_err(|e| AppError::Internal(format!("Update failed: {}", e)))?;

    Ok(Json(serde_json::json!({"status": "updated", "id": entry_id})))
}

/// DELETE /api/kb/:id
pub async fn delete_kb_entry(
    State(state): State<AppState>,
    Path(entry_id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    storage::delete_entry(&state.db, entry_id)
        .await
        .map_err(|e| match e {
            storage::StorageError::NotFound(_) => AppError::NotFound("KB entry not found".into()),
            storage::StorageError::Database(e) => AppError::Database(e),
        })?;
    Ok(StatusCode::NO_CONTENT)
}

/// GET /api/projects/:id/kb/tags
pub async fn get_kb_tags(
    State(state): State<AppState>,
    user: axum::Extension<AuthenticatedUser>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<Vec<tagging::TagInfo>>, AppError> {
    let tags = tagging::get_project_tags(&state.db, project_id)
        .await
        .map_err(|e| AppError::Internal(format!("Tag retrieval failed: {}", e)))?;
    Ok(Json(tags))
}
