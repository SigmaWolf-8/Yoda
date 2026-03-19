//! Inference dispatch — single-engine calls and concurrent review dispatch.
//!
//! B1.2.2: Single-engine call (system prompt + user content → response)
//! B1.2.4: Concurrent review dispatch (tokio::try_join!)
//! B1.2.6: Auto-retry on token-limit truncation (2× max_tokens)
//! B1.2.9: Review intensity support (Full/Medium/Light)

use crate::censorship::CensorshipDetector;
use crate::config::{ChatCompletionRequest, ChatCompletionResponse, ChatMessage};
use crate::validation::{ValidationResult, Validator};
use crate::{AuthType, EngineConfig, EngineSlot, HealthStatus, HostingMode, InferenceResponse, ReviewIntensity};
use std::time::Instant;
use thiserror::Error;
use tracing;

#[derive(Debug, Error)]
pub enum DispatchError {
    #[error("engine {0:?} is offline")]
    EngineOffline(EngineSlot),
    #[error("HTTP request failed for engine {0:?}: {1}")]
    HttpError(EngineSlot, String),
    #[error("no response content from engine {0:?}")]
    EmptyResponse(EngineSlot),
    #[error("validation failed for engine {0:?} after {1} retries: {2}")]
    ValidationFailed(EngineSlot, u32, String),
    #[error("all review engines failed")]
    AllReviewsFailed,
}

/// Maximum retries for structured output validation failures.
const MAX_RETRIES_SELF_HOSTED: u32 = 5;
const MAX_RETRIES_COMMERCIAL: u32 = 3;

/// Default max_tokens for initial request.
const DEFAULT_MAX_TOKENS: u32 = 4096;

/// Call a single engine with a system prompt and user content.
///
/// Handles auth type abstraction, TIS-27 hashing on receipt,
/// censorship detection, and structured output validation with retry.
pub async fn call_engine(
    client: &reqwest::Client,
    config: &EngineConfig,
    system_prompt: &str,
    user_content: &str,
    max_tokens: Option<u32>,
) -> Result<InferenceResponse, DispatchError> {
    if config.health_status == HealthStatus::Offline {
        return Err(DispatchError::EngineOffline(config.slot));
    }

    let start = Instant::now();
    let mut current_max_tokens = max_tokens.unwrap_or(DEFAULT_MAX_TOKENS);
    let max_retries = match config.hosting_mode {
        HostingMode::SelfHosted => MAX_RETRIES_SELF_HOSTED,
        HostingMode::Commercial | HostingMode::FreeTier => MAX_RETRIES_COMMERCIAL,
    };

    let mut last_error = String::new();

    for attempt in 0..=max_retries {
        if attempt > 0 {
            tracing::info!(
                slot = ?config.slot,
                attempt,
                max_tokens = current_max_tokens,
                "Retrying inference request"
            );
        }

        // Build the request payload (OpenAI-compatible)
        let request = ChatCompletionRequest {
            model: config.model_name.clone(),
            messages: vec![
                ChatMessage { role: "system".into(), content: system_prompt.to_string() },
                ChatMessage { role: "user".into(), content: user_content.to_string() },
            ],
            max_tokens: Some(current_max_tokens),
            temperature: Some(0.3),
        };

        // Build HTTP request with auth
        let mut http_req = client
            .post(&format!("{}/v1/chat/completions", config.endpoint_url.trim_end_matches('/')))
            .header("Content-Type", "application/json");

        // Apply auth type
        if let Some(ref creds) = config.credentials {
            http_req = match config.auth_type {
                AuthType::Bearer => http_req.header("Authorization", format!("Bearer {}", creds)),
                AuthType::ApiKey => http_req.header("x-api-key", creds),
                AuthType::None => http_req,
            };
        }

        // Send
        let http_response = http_req
            .json(&request)
            .send()
            .await
            .map_err(|e| DispatchError::HttpError(config.slot, e.to_string()))?;

        if !http_response.status().is_success() {
            let status = http_response.status();
            let body = http_response.text().await.unwrap_or_default();
            last_error = format!("HTTP {}: {}", status, body);
            tracing::warn!(slot = ?config.slot, status = %status, "Engine returned error");
            continue;
        }

        // Parse response
        let response: ChatCompletionResponse = http_response
            .json()
            .await
            .map_err(|e| DispatchError::HttpError(config.slot, format!("JSON parse: {}", e)))?;

        let content = response
            .choices
            .first()
            .map(|c| c.message.content.clone())
            .ok_or(DispatchError::EmptyResponse(config.slot))?;

        let finish_reason = response
            .choices
            .first()
            .and_then(|c| c.finish_reason.clone());

        let latency_ms = start.elapsed().as_millis() as u64;

        // TIS-27 hash the raw response on receipt (B1.1.2 — calls bridge stub for now)
        let tis27_hash = yoda_plenumnet_bridge::hashing::hash_bytes(content.as_bytes());

        // Validate structured output (B1.2.5)
        match Validator::validate(&content, current_max_tokens, finish_reason.as_deref()) {
            ValidationResult::Valid => {
                // Check for censorship (B1.2.7 — commercial/free-tier only)
                let censorship_flagged = match config.hosting_mode {
                    HostingMode::SelfHosted => false,
                    _ => CensorshipDetector::check(&content),
                };

                if censorship_flagged {
                    tracing::warn!(
                        slot = ?config.slot,
                        model = %config.model_name,
                        "Censorship detected — response flagged (not retried)"
                    );
                }

                return Ok(InferenceResponse {
                    content,
                    engine_slot: config.slot,
                    model_name: config.model_name.clone(),
                    tis27_hash,
                    latency_ms,
                    censorship_flagged,
                });
            }
            ValidationResult::Truncated => {
                // Auto-retry with 2× max_tokens (B1.2.6)
                tracing::info!(
                    slot = ?config.slot,
                    old_max = current_max_tokens,
                    new_max = current_max_tokens * 2,
                    "Token-limit truncation detected — retrying with larger max_tokens"
                );
                current_max_tokens *= 2;
                last_error = "token-limit truncation".into();
                continue;
            }
            ValidationResult::Malformed(reason) => {
                last_error = reason.clone();
                tracing::warn!(slot = ?config.slot, reason, "Malformed response");
                continue;
            }
        }
    }

    Err(DispatchError::ValidationFailed(
        config.slot,
        max_retries,
        last_error,
    ))
}

/// Dispatch reviews to N engines concurrently (B1.2.4).
///
/// Returns results for all engines. Errors are collected, not short-circuited.
/// At least one successful review is required.
pub async fn dispatch_reviews(
    client: &reqwest::Client,
    engines: &[&EngineConfig],
    system_prompts: &[&str],
    review_content: &str,
) -> Result<Vec<InferenceResponse>, DispatchError> {
    assert_eq!(engines.len(), system_prompts.len(), "engines and prompts must match");

    let futures: Vec<_> = engines
        .iter()
        .zip(system_prompts.iter())
        .map(|(engine, prompt)| {
            call_engine(client, engine, prompt, review_content, None)
        })
        .collect();

    // Execute all concurrently
    let results = futures::future::join_all(futures).await;

    let mut successes = Vec::new();
    let mut errors = Vec::new();

    for (i, result) in results.into_iter().enumerate() {
        match result {
            Ok(response) => successes.push(response),
            Err(e) => {
                tracing::error!(
                    engine = ?engines[i].slot,
                    error = %e,
                    "Review dispatch failed"
                );
                errors.push(e);
            }
        }
    }

    if successes.is_empty() {
        return Err(DispatchError::AllReviewsFailed);
    }

    // Log if any reviews failed but we still have partial results
    if !errors.is_empty() {
        tracing::warn!(
            succeeded = successes.len(),
            failed = errors.len(),
            "Partial review results — some engines failed"
        );
    }

    Ok(successes)
}

/// Select reviewers based on intensity level (B1.2.9).
///
/// Returns the engine slots to use for reviews at the given intensity.
/// Diversity is enforced by the caller via the diversity module.
pub fn select_reviewer_count(intensity: ReviewIntensity) -> usize {
    match intensity {
        ReviewIntensity::Full => 3,
        ReviewIntensity::Medium => 2,
        ReviewIntensity::Light => 1,
    }
}

/// Expected inference calls per task at the given intensity.
/// Per TM-2026-020.1 §3.5:
///   Full:   3 review steps × (1 prod + 3 review) + 1 final = 13
///   Medium: 3 review steps × (1 prod + 2 review) = 9
///   Light:  2 review steps × (1 prod + 1 review) + 1 final = 5
pub fn expected_calls_per_task(intensity: ReviewIntensity) -> usize {
    match intensity {
        ReviewIntensity::Full => 13,
        ReviewIntensity::Medium => 9,
        ReviewIntensity::Light => 5,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_reviewer_count() {
        assert_eq!(select_reviewer_count(ReviewIntensity::Full), 3);
        assert_eq!(select_reviewer_count(ReviewIntensity::Medium), 2);
        assert_eq!(select_reviewer_count(ReviewIntensity::Light), 1);
    }

    #[test]
    fn test_expected_calls() {
        assert_eq!(expected_calls_per_task(ReviewIntensity::Full), 13);
        assert_eq!(expected_calls_per_task(ReviewIntensity::Medium), 9);
        assert_eq!(expected_calls_per_task(ReviewIntensity::Light), 5);
    }
}
