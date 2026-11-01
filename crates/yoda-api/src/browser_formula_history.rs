//! Authenticated, append-only intake of explicitly unverified browser evidence.
use axum::{extract::{Query, State}, http::{header, HeaderValue, StatusCode}, Extension, Json};
use serde::Deserialize;
use serde_json::Value;
use crate::{auth::AuthenticatedUser, browser_formula_store as store, error::AppError, state::AppState};

pub async fn append(
    State(state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(input): Json<store::Submission>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    input.validate().map_err(|s| AppError::Validation(s.into()))?;
    let (saved, same) = store::append(&state.db, user.org_id, user.user_id, &input).await?;
    if !same {
        return Err(AppError::Conflict("Submission ID already belongs to a different immutable record".into()));
    }
    Ok((StatusCode::CREATED, Json(saved)))
}

#[derive(Deserialize)]
pub struct Page { before: Option<i64> }

pub async fn history(
    State(state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
    Query(page): Query<Page>,
) -> Result<Json<Value>, AppError> {
    if page.before.is_some_and(|v| v <= 0) {
        return Err(AppError::Validation("Invalid history cursor".into()));
    }
    Ok(Json(store::history(&state.db, user.org_id, user.user_id, page.before).await?))
}

pub async fn no_cache(request: axum::extract::Request, next: axum::middleware::Next)
    -> axum::response::Response
{
    let mut response = next.run(request).await;
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("private, no-store"));
    response
}
