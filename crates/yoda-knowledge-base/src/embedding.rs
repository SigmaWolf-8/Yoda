//! Embedding generation via configured inference engine.
//!
//! B4.2: Uses /v1/embeddings endpoint (supported by llama-server and most APIs).
//! No separate embedding model — reuse existing engines.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use thiserror::Error;
use uuid::Uuid;
use yoda_inference_router::EngineConfig;

#[derive(Debug, Error)]
pub enum EmbeddingError {
    #[error("embedding request failed: {0}")]
    RequestFailed(String),
    #[error("no embedding in response")]
    EmptyResponse,
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

/// OpenAI-compatible embedding request.
#[derive(Debug, Serialize)]
struct EmbeddingRequest {
    model: String,
    input: String,
}

/// OpenAI-compatible embedding response.
#[derive(Debug, Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingData>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingData {
    embedding: Vec<f32>,
}

/// Generate an embedding vector for the given text using a configured engine.
pub async fn generate_embedding(
    client: &reqwest::Client,
    engine: &EngineConfig,
    text: &str,
) -> Result<Vec<f32>, EmbeddingError> {
    let url = format!(
        "{}/v1/embeddings",
        engine.endpoint_url.trim_end_matches('/')
    );

    let request = EmbeddingRequest {
        model: engine.model_name.clone(),
        input: text.to_string(),
    };

    let mut http_req = client.post(&url).header("Content-Type", "application/json");

    // Apply auth
    if let Some(ref creds) = engine.credentials {
        http_req = match engine.auth_type {
            yoda_inference_router::AuthType::Bearer => {
                http_req.header("Authorization", format!("Bearer {}", creds))
            }
            yoda_inference_router::AuthType::ApiKey => http_req.header("x-api-key", creds),
            yoda_inference_router::AuthType::None => http_req,
        };
    }

    let response = http_req
        .json(&request)
        .send()
        .await
        .map_err(|e| EmbeddingError::RequestFailed(e.to_string()))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(EmbeddingError::RequestFailed(format!(
            "HTTP {}: {}",
            status, body
        )));
    }

    let emb_response: EmbeddingResponse = response
        .json()
        .await
        .map_err(|e| EmbeddingError::RequestFailed(format!("JSON parse: {}", e)))?;

    emb_response
        .data
        .first()
        .map(|d| d.embedding.clone())
        .ok_or(EmbeddingError::EmptyResponse)
}

/// Generate and store an embedding for a knowledge base entry.
pub async fn embed_and_store(
    client: &reqwest::Client,
    engine: &EngineConfig,
    db: &PgPool,
    entry_id: Uuid,
    text: &str,
) -> Result<(), EmbeddingError> {
    let embedding = generate_embedding(client, engine, text).await?;

    // pgvector stores vectors as text representation: [0.1, 0.2, ...]
    let embedding_str = format!(
        "[{}]",
        embedding
            .iter()
            .map(|v| v.to_string())
            .collect::<Vec<_>>()
            .join(",")
    );

    sqlx::query("UPDATE knowledge_base SET embedding = $1::vector WHERE id = $2")
        .bind(&embedding_str)
        .bind(entry_id)
        .execute(db)
        .await?;

    tracing::debug!(entry_id = %entry_id, dims = embedding.len(), "Stored embedding");
    Ok(())
}

/// Batch embed multiple entries (for backfill or re-indexing).
pub async fn embed_batch(
    client: &reqwest::Client,
    engine: &EngineConfig,
    db: &PgPool,
    entries: &[(Uuid, String)],
) -> Result<usize, EmbeddingError> {
    let mut success_count = 0;

    for (id, text) in entries {
        match embed_and_store(client, engine, db, *id, text).await {
            Ok(()) => success_count += 1,
            Err(e) => {
                tracing::warn!(entry_id = %id, error = %e, "Failed to embed entry");
            }
        }
    }

    tracing::info!(
        total = entries.len(),
        succeeded = success_count,
        "Batch embedding complete"
    );
    Ok(success_count)
}
