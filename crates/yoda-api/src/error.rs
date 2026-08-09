//! Unified error handling — all errors return JSON per the API contract:
//! `{ "error": "message", "code": "ERROR_CODE", "details": {} }`

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

#[derive(Debug)]
pub enum AppError {
    /// 400 — invalid input
    Validation(String),
    /// 401 — missing or invalid credentials
    Unauthorized(String),
    /// 403 — authenticated but not authorized
    Forbidden(String),
    /// 404 — resource not found
    NotFound(String),
    /// 409 — conflict (e.g., duplicate email)
    Conflict(String),
    /// 500 — internal server error
    Internal(String),
    /// 503 — a service this request depends on is not reachable.
    ///
    /// Unlike `Internal`, the message is returned to the caller rather than
    /// masked. An operator checking whether the daemon arrays are connected
    /// needs to see *which* address failed and why; "Internal server error"
    /// tells them nothing and looks like a bug in the app itself. These
    /// messages name only infrastructure endpoints, never user data.
    Unavailable(String),
    /// Database error
    Database(sqlx::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message) = match &self {
            AppError::Validation(msg) => (StatusCode::BAD_REQUEST, "VALIDATION_ERROR", msg.clone()),
            AppError::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, "UNAUTHORIZED", msg.clone()),
            AppError::Forbidden(msg) => (StatusCode::FORBIDDEN, "FORBIDDEN", msg.clone()),
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, "NOT_FOUND", msg.clone()),
            AppError::Conflict(msg) => (StatusCode::CONFLICT, "CONFLICT", msg.clone()),
            AppError::Internal(msg) => {
                tracing::error!(error = %msg, "Internal server error");
                (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Internal server error".into())
            }
            AppError::Unavailable(msg) => {
                tracing::warn!(error = %msg, "Upstream service unavailable");
                (StatusCode::SERVICE_UNAVAILABLE, "UNAVAILABLE", msg.clone())
            }
            AppError::Database(e) => {
                tracing::error!(error = %e, "Database error");
                (StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", "Database error".into())
            }
        };

        let body = json!({
            "error": message,
            "code": code,
        });

        (status, Json(body)).into_response()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        AppError::Database(e)
    }
}
