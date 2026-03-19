//! SaaS-ready authentication and authorization.
//!
//! B-AUTH.1: User registration with argon2 password hashing
//! B-AUTH.2: Login with JWT issuance
//! B-AUTH.3: Token refresh with rotation
//! B-AUTH.4: JWT auth middleware + API key auth
//! B-AUTH.5: Organization CRUD
//! B-AUTH.6: Org membership and roles
//! B-AUTH.7: Per-org project isolation
//! B-AUTH.8: API key management

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{
    extract::{Request, State},
    http::{self, StatusCode},
    middleware::Next,
    response::Response,
    Json,
};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppError;
use crate::state::AppState;

// ─── JWT Claims ──────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: Uuid,      // user_id
    pub email: String,
    pub org_id: Uuid,   // current org
    pub exp: i64,       // expiry timestamp
    pub iat: i64,       // issued at
}

// ─── Request/Response Types ──────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub user: UserResponse,
    pub token: String,
    pub refresh_token: String,
}

#[derive(Debug, Serialize)]
pub struct UserResponse {
    pub id: Uuid,
    pub email: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateOrgRequest {
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct OrgResponse {
    pub id: Uuid,
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct InviteRequest {
    pub email: String,
    pub role: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateApiKeyRequest {
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct ApiKeyCreatedResponse {
    pub id: Uuid,
    pub name: String,
    pub key: String, // full key — shown ONCE
}

#[derive(Debug, Serialize)]
pub struct ApiKeyResponse {
    pub id: Uuid,
    pub name: String,
    pub prefix: String,
    pub created_at: chrono::DateTime<Utc>,
}

// ─── Authenticated User (extracted by middleware) ─────────────────────

#[derive(Debug, Clone)]
pub struct AuthenticatedUser {
    pub user_id: Uuid,
    pub email: String,
    pub org_id: Uuid,
}

// ─── Password Hashing (B-AUTH.1) ─────────────────────────────────────

pub fn hash_password(password: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    argon2
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| AppError::Internal(format!("Password hash failed: {}", e)))
}

pub fn verify_password(password: &str, hash: &str) -> Result<bool, AppError> {
    let parsed = PasswordHash::new(hash)
        .map_err(|e| AppError::Internal(format!("Invalid hash format: {}", e)))?;
    Ok(Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok())
}

// ─── JWT Operations (B-AUTH.2, B-AUTH.3) ─────────────────────────────

pub fn create_access_token(
    user_id: Uuid,
    email: &str,
    org_id: Uuid,
    secret: &str,
    expiry_minutes: i64,
) -> Result<String, AppError> {
    let claims = Claims {
        sub: user_id,
        email: email.to_string(),
        org_id,
        exp: (Utc::now() + Duration::minutes(expiry_minutes)).timestamp(),
        iat: Utc::now().timestamp(),
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(format!("JWT encode failed: {}", e)))
}

pub fn create_refresh_token() -> String {
    // Cryptographically random token
    format!("{}{}", Uuid::new_v4(), Uuid::new_v4()).replace('-', "")
}

pub fn validate_access_token(token: &str, secret: &str) -> Result<Claims, AppError> {
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|e| AppError::Unauthorized(format!("Invalid token: {}", e)))?;
    Ok(data.claims)
}

// ─── Auth Handlers ───────────────────────────────────────────────────

/// POST /api/auth/register (B-AUTH.1)
pub async fn register(
    State(state): State<AppState>,
    Json(req): Json<RegisterRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    // Validate input
    if req.email.is_empty() || !req.email.contains('@') {
        return Err(AppError::Validation("Invalid email".into()));
    }
    if req.password.len() < 8 {
        return Err(AppError::Validation("Password must be at least 8 characters".into()));
    }

    // Check if email exists
    let existing = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users WHERE email = $1")
        .bind(&req.email)
        .fetch_one(&state.db)
        .await
        .map_err(AppError::Database)?;
    if existing > 0 {
        return Err(AppError::Conflict("Email already registered".into()));
    }

    // Hash password
    let password_hash = hash_password(&req.password)?;

    // Create user
    let user_id = Uuid::new_v4();
    sqlx::query("INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, $3, $4)")
        .bind(user_id)
        .bind(&req.email)
        .bind(&password_hash)
        .bind(&req.name)
        .execute(&state.db)
        .await
        .map_err(AppError::Database)?;

    // Create default org
    let org_id = Uuid::new_v4();
    let org_name = format!("{}'s Organization", req.name);
    sqlx::query("INSERT INTO organizations (id, name) VALUES ($1, $2)")
        .bind(org_id)
        .bind(&org_name)
        .execute(&state.db)
        .await
        .map_err(AppError::Database)?;

    // Assign owner role
    sqlx::query("INSERT INTO org_members (user_id, org_id, role) VALUES ($1, $2, 'owner')")
        .bind(user_id)
        .bind(org_id)
        .execute(&state.db)
        .await
        .map_err(AppError::Database)?;

    // Issue tokens
    let token = create_access_token(user_id, &req.email, org_id, &state.jwt_secret, state.jwt_access_expiry_minutes)?;
    let refresh = create_refresh_token();

    // Store refresh token hash
    let refresh_hash = hash_password(&refresh)?;
    let expires_at = Utc::now() + Duration::days(state.jwt_refresh_expiry_days);
    sqlx::query("INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)")
        .bind(user_id)
        .bind(&refresh_hash)
        .bind(expires_at)
        .execute(&state.db)
        .await
        .map_err(AppError::Database)?;

    Ok(Json(AuthResponse {
        user: UserResponse { id: user_id, email: req.email, name: req.name },
        token,
        refresh_token: refresh,
    }))
}

/// POST /api/auth/login (B-AUTH.2)
pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    // Find user
    let row = sqlx::query_as::<_, (Uuid, String, String, String)>(
        "SELECT id, email, password_hash, name FROM users WHERE email = $1"
    )
    .bind(&req.email)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?
    .ok_or(AppError::Unauthorized("Invalid credentials".into()))?;

    let (user_id, email, password_hash, name) = row;

    // Verify password
    if !verify_password(&req.password, &password_hash)? {
        return Err(AppError::Unauthorized("Invalid credentials".into()));
    }

    // Get user's first org
    let org_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT org_id FROM org_members WHERE user_id = $1 ORDER BY created_at LIMIT 1"
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .map_err(AppError::Database)?;

    // Issue tokens
    let token = create_access_token(user_id, &email, org_id, &state.jwt_secret, state.jwt_access_expiry_minutes)?;
    let refresh = create_refresh_token();

    let refresh_hash = hash_password(&refresh)?;
    let expires_at = Utc::now() + Duration::days(state.jwt_refresh_expiry_days);
    sqlx::query("INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)")
        .bind(user_id)
        .bind(&refresh_hash)
        .bind(expires_at)
        .execute(&state.db)
        .await
        .map_err(AppError::Database)?;

    Ok(Json(AuthResponse {
        user: UserResponse { id: user_id, email, name },
        token,
        refresh_token: refresh,
    }))
}

/// POST /api/auth/refresh (B-AUTH.3)
pub async fn refresh_token(
    State(state): State<AppState>,
    Json(req): Json<RefreshRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    // Find valid (non-revoked, non-expired) refresh tokens for verification
    let tokens = sqlx::query_as::<_, (Uuid, Uuid, String)>(
        "SELECT id, user_id, token_hash FROM refresh_tokens \
         WHERE revoked = FALSE AND expires_at > NOW() \
         ORDER BY created_at DESC LIMIT 50"
    )
    .fetch_all(&state.db)
    .await
    .map_err(AppError::Database)?;

    // Verify the provided token against stored hashes
    let mut matched: Option<(Uuid, Uuid)> = None;
    for (token_id, user_id, hash) in &tokens {
        if verify_password(&req.refresh_token, hash)? {
            matched = Some((*token_id, *user_id));
            break;
        }
    }

    let (token_id, user_id) = matched
        .ok_or(AppError::Unauthorized("Invalid refresh token".into()))?;

    // Revoke old token (rotation)
    sqlx::query("UPDATE refresh_tokens SET revoked = TRUE WHERE id = $1")
        .bind(token_id)
        .execute(&state.db)
        .await
        .map_err(AppError::Database)?;

    // Get user details
    let (email, name) = sqlx::query_as::<_, (String, String)>(
        "SELECT email, name FROM users WHERE id = $1"
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .map_err(AppError::Database)?;

    let org_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT org_id FROM org_members WHERE user_id = $1 ORDER BY created_at LIMIT 1"
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .map_err(AppError::Database)?;

    // Issue new pair
    let new_token = create_access_token(user_id, &email, org_id, &state.jwt_secret, state.jwt_access_expiry_minutes)?;
    let new_refresh = create_refresh_token();

    let refresh_hash = hash_password(&new_refresh)?;
    let expires_at = Utc::now() + Duration::days(state.jwt_refresh_expiry_days);
    sqlx::query("INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)")
        .bind(user_id)
        .bind(&refresh_hash)
        .bind(expires_at)
        .execute(&state.db)
        .await
        .map_err(AppError::Database)?;

    Ok(Json(AuthResponse {
        user: UserResponse { id: user_id, email, name },
        token: new_token,
        refresh_token: new_refresh,
    }))
}

/// POST /api/auth/logout
pub async fn logout() -> StatusCode {
    // Client-side: discard tokens. Server-side: tokens expire naturally.
    // For immediate revocation, the client sends the refresh token to revoke.
    StatusCode::NO_CONTENT
}

// ─── JWT Auth Middleware (B-AUTH.4) ───────────────────────────────────

/// Middleware that extracts and validates JWT from Authorization header
/// or API key from X-API-Key header.
pub async fn auth_middleware(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, AppError> {
    let headers = request.headers();

    // Try JWT first
    if let Some(auth_header) = headers.get(http::header::AUTHORIZATION) {
        let auth_str = auth_header
            .to_str()
            .map_err(|_| AppError::Unauthorized("Invalid auth header".into()))?;

        if let Some(token) = auth_str.strip_prefix("Bearer ") {
            let claims = validate_access_token(token, &state.jwt_secret)?;
            request.extensions_mut().insert(AuthenticatedUser {
                user_id: claims.sub,
                email: claims.email,
                org_id: claims.org_id,
            });
            return Ok(next.run(request).await);
        }
    }

    // Try API key
    if let Some(api_key_header) = headers.get("x-api-key") {
        let key_str = api_key_header
            .to_str()
            .map_err(|_| AppError::Unauthorized("Invalid API key header".into()))?;

        if let Some(user) = validate_api_key(&state.db, key_str).await? {
            request.extensions_mut().insert(user);
            return Ok(next.run(request).await);
        }
    }

    Err(AppError::Unauthorized("Missing authentication".into()))
}

/// Validate an API key against stored hashes.
async fn validate_api_key(db: &PgPool, key: &str) -> Result<Option<AuthenticatedUser>, AppError> {
    let prefix = if key.len() >= 8 { &key[..8] } else { key };

    let rows = sqlx::query_as::<_, (Uuid, String, Uuid)>(
        "SELECT ak.user_id, ak.key_hash, om.org_id \
         FROM api_keys ak \
         JOIN org_members om ON ak.user_id = om.user_id \
         WHERE ak.key_prefix = $1 \
         ORDER BY om.created_at LIMIT 5"
    )
    .bind(prefix)
    .fetch_all(db)
    .await
    .map_err(AppError::Database)?;

    for (user_id, hash, org_id) in &rows {
        if verify_password(key, hash)? {
            let email = sqlx::query_scalar::<_, String>("SELECT email FROM users WHERE id = $1")
                .bind(user_id)
                .fetch_one(db)
                .await
                .map_err(AppError::Database)?;

            return Ok(Some(AuthenticatedUser {
                user_id: *user_id,
                email,
                org_id: *org_id,
            }));
        }
    }

    Ok(None)
}

// ─── Organization Handlers (B-AUTH.5, B-AUTH.6) ──────────────────────

/// POST /api/orgs
pub async fn create_org(
    State(state): State<AppState>,
    user: axum::Extension<AuthenticatedUser>,
    Json(req): Json<CreateOrgRequest>,
) -> Result<Json<OrgResponse>, AppError> {
    let org_id = Uuid::new_v4();
    sqlx::query("INSERT INTO organizations (id, name) VALUES ($1, $2)")
        .bind(org_id)
        .bind(&req.name)
        .execute(&state.db)
        .await
        .map_err(AppError::Database)?;

    // Creator becomes owner
    sqlx::query("INSERT INTO org_members (user_id, org_id, role) VALUES ($1, $2, 'owner')")
        .bind(user.user_id)
        .bind(org_id)
        .execute(&state.db)
        .await
        .map_err(AppError::Database)?;

    Ok(Json(OrgResponse { id: org_id, name: req.name }))
}

/// GET /api/orgs
pub async fn list_orgs(
    State(state): State<AppState>,
    user: axum::Extension<AuthenticatedUser>,
) -> Result<Json<Vec<OrgResponse>>, AppError> {
    let orgs = sqlx::query_as::<_, (Uuid, String)>(
        "SELECT o.id, o.name FROM organizations o \
         JOIN org_members om ON o.id = om.org_id \
         WHERE om.user_id = $1 ORDER BY o.created_at"
    )
    .bind(user.user_id)
    .fetch_all(&state.db)
    .await
    .map_err(AppError::Database)?;

    Ok(Json(orgs.into_iter().map(|(id, name)| OrgResponse { id, name }).collect()))
}

// ─── API Key Handlers (B-AUTH.8) ─────────────────────────────────────

/// POST /api/keys
pub async fn create_api_key(
    State(state): State<AppState>,
    user: axum::Extension<AuthenticatedUser>,
    Json(req): Json<CreateApiKeyRequest>,
) -> Result<Json<ApiKeyCreatedResponse>, AppError> {
    let full_key = format!("yoda_{}{}", Uuid::new_v4(), Uuid::new_v4()).replace('-', "");
    let prefix = full_key[..8].to_string();
    let key_hash = hash_password(&full_key)?;
    let key_id = Uuid::new_v4();

    sqlx::query("INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix) VALUES ($1, $2, $3, $4, $5)")
        .bind(key_id)
        .bind(user.user_id)
        .bind(&req.name)
        .bind(&key_hash)
        .bind(&prefix)
        .execute(&state.db)
        .await
        .map_err(AppError::Database)?;

    Ok(Json(ApiKeyCreatedResponse {
        id: key_id,
        name: req.name,
        key: full_key, // shown ONCE
    }))
}

/// GET /api/keys
pub async fn list_api_keys(
    State(state): State<AppState>,
    user: axum::Extension<AuthenticatedUser>,
) -> Result<Json<Vec<ApiKeyResponse>>, AppError> {
    let keys = sqlx::query_as::<_, (Uuid, String, String, chrono::DateTime<Utc>)>(
        "SELECT id, name, key_prefix, created_at FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC"
    )
    .bind(user.user_id)
    .fetch_all(&state.db)
    .await
    .map_err(AppError::Database)?;

    Ok(Json(keys.into_iter().map(|(id, name, prefix, created_at)| {
        ApiKeyResponse { id, name, prefix, created_at }
    }).collect()))
}

/// DELETE /api/keys/:id
pub async fn delete_api_key(
    State(state): State<AppState>,
    user: axum::Extension<AuthenticatedUser>,
    axum::extract::Path(key_id): axum::extract::Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let result = sqlx::query("DELETE FROM api_keys WHERE id = $1 AND user_id = $2")
        .bind(key_id)
        .bind(user.user_id)
        .execute(&state.db)
        .await
        .map_err(AppError::Database)?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("API key not found".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}
