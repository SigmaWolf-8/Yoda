//! Settings routes.
//!
//! B5.7: GET/PUT project settings (intensity, budget, mode)
//!       PUT /api/settings/github-pat → store encrypted PAT
//!       GET /api/settings/github-pat → { configured, username }

use axum::{extract::{Path, State}, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::AuthenticatedUser;
use crate::error::AppError;
use crate::state::AppState;

// ─── Project Settings ────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectSettingsResponse {
    pub review_intensity: String,
    pub decomposition_budget: Option<u64>,
    pub mode: String,
    pub auto_archive_months: u64,
}

/// GET /api/settings/project/:id
pub async fn get_project_settings(
    State(state): State<AppState>,
    user: axum::Extension<AuthenticatedUser>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<ProjectSettingsResponse>, AppError> {
    let (mode, settings) = sqlx::query_as::<_, (String, serde_json::Value)>(
        "SELECT mode, settings FROM projects WHERE id = $1 AND org_id = $2"
    )
    .bind(project_id)
    .bind(user.org_id)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?
    .ok_or(AppError::NotFound("Project not found".into()))?;

    Ok(Json(ProjectSettingsResponse {
        review_intensity: settings.get("review_intensity")
            .and_then(|v| v.as_str())
            .unwrap_or("full")
            .to_string(),
        decomposition_budget: settings.get("decomposition_budget")
            .and_then(|v| v.as_u64()),
        mode,
        auto_archive_months: settings.get("auto_archive_months")
            .and_then(|v| v.as_u64())
            .unwrap_or(24),
    }))
}

#[derive(Debug, Deserialize)]
pub struct UpdateProjectSettingsRequest {
    pub review_intensity: Option<String>,
    pub decomposition_budget: Option<u64>,
    pub mode: Option<String>,
    pub auto_archive_months: Option<u64>,
}

/// PUT /api/settings/project/:id
pub async fn update_project_settings(
    State(state): State<AppState>,
    user: axum::Extension<AuthenticatedUser>,
    Path(project_id): Path<Uuid>,
    Json(req): Json<UpdateProjectSettingsRequest>,
) -> Result<Json<ProjectSettingsResponse>, AppError> {
    // Validate intensity
    if let Some(ref intensity) = req.review_intensity {
        if !["full", "medium", "light"].contains(&intensity.as_str()) {
            return Err(AppError::Validation(
                "review_intensity must be 'full', 'medium', or 'light'".into(),
            ));
        }
    }
    // Validate mode
    if let Some(ref mode) = req.mode {
        if !["yoda", "ronin"].contains(&mode.as_str()) {
            return Err(AppError::Validation("mode must be 'yoda' or 'ronin'".into()));
        }
    }

    // Fetch current settings
    let (current_mode, current_settings) = sqlx::query_as::<_, (String, serde_json::Value)>(
        "SELECT mode, settings FROM projects WHERE id = $1 AND org_id = $2"
    )
    .bind(project_id)
    .bind(user.org_id)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?
    .ok_or(AppError::NotFound("Project not found".into()))?;

    // Merge updates
    let mut settings = current_settings.clone();
    if let Some(ref intensity) = req.review_intensity {
        settings["review_intensity"] = serde_json::json!(intensity);
    }
    if let Some(budget) = req.decomposition_budget {
        settings["decomposition_budget"] = serde_json::json!(budget);
    }
    if let Some(months) = req.auto_archive_months {
        settings["auto_archive_months"] = serde_json::json!(months);
    }

    let new_mode = req.mode.as_deref().unwrap_or(&current_mode);

    sqlx::query("UPDATE projects SET settings = $1, mode = $2 WHERE id = $3")
        .bind(&settings)
        .bind(new_mode)
        .bind(project_id)
        .execute(&state.db)
        .await
        .map_err(AppError::Database)?;

    Ok(Json(ProjectSettingsResponse {
        review_intensity: settings.get("review_intensity")
            .and_then(|v| v.as_str()).unwrap_or("full").to_string(),
        decomposition_budget: settings.get("decomposition_budget")
            .and_then(|v| v.as_u64()),
        mode: new_mode.to_string(),
        auto_archive_months: settings.get("auto_archive_months")
            .and_then(|v| v.as_u64()).unwrap_or(24),
    }))
}

// ─── GitHub PAT ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct UpdateGitHubPATRequest {
    pub token: String,
}

#[derive(Debug, Serialize)]
pub struct GitHubPATResponse {
    pub configured: bool,
    pub username: Option<String>,
}

/// PUT /api/settings/github-pat
pub async fn update_github_pat(
    State(state): State<AppState>,
    user: axum::Extension<AuthenticatedUser>,
    Json(req): Json<UpdateGitHubPATRequest>,
) -> Result<Json<GitHubPATResponse>, AppError> {
    // Verify the token by calling GitHub API
    let gh_response = state.http_client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {}", req.token))
        .header("User-Agent", "YODA-Platform")
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("GitHub API call failed: {}", e)))?;

    if !gh_response.status().is_success() {
        return Err(AppError::Validation("Invalid GitHub token".into()));
    }

    let gh_user: serde_json::Value = gh_response
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("GitHub response parse failed: {}", e)))?;

    let username = gh_user.get("login")
        .and_then(|v| v.as_str())
        .ok_or(AppError::Internal("Could not extract GitHub username".into()))?
        .to_string();

    // Encrypt the PAT via Phase Encryption (high_security mode)
    // For now, store directly (B-5 will wire the real encryption)
    let encrypted_pat = req.token.clone(); // TODO: Phase Encryption via B-5

    // Upsert
    sqlx::query(
        "INSERT INTO github_configs (id, org_id, pat_encrypted, github_username) \
         VALUES (uuid_generate_v4(), $1, $2, $3) \
         ON CONFLICT (org_id) DO UPDATE SET pat_encrypted = $2, github_username = $3"
    )
    .bind(user.org_id)
    .bind(&encrypted_pat)
    .bind(&username)
    .execute(&state.db)
    .await
    .map_err(AppError::Database)?;

    Ok(Json(GitHubPATResponse {
        configured: true,
        username: Some(username),
    }))
}

/// GET /api/settings/github-pat
pub async fn get_github_pat(
    State(state): State<AppState>,
    user: axum::Extension<AuthenticatedUser>,
) -> Result<Json<GitHubPATResponse>, AppError> {
    let row = sqlx::query_as::<_, (String,)>(
        "SELECT github_username FROM github_configs WHERE org_id = $1"
    )
    .bind(user.org_id)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?;

    match row {
        Some((username,)) => Ok(Json(GitHubPATResponse {
            configured: true,
            username: Some(username),
        })),
        None => Ok(Json(GitHubPATResponse {
            configured: false,
            username: None,
        })),
    }
}
