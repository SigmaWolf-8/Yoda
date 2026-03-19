//! # YODA Inference Router
//!
//! Engine-agnostic async HTTP client that dispatches chat completion requests
//! to configured engine endpoints. Supports self-hosted (llama-server),
//! commercial API, and free-tier engines.
//!
//! Key responsibilities:
//! - Single-engine call (system prompt + user content → structured response)
//! - Concurrent review dispatch (tokio::try_join! for 3 engines)
//! - Diversity enforcement via model lineage database
//! - Structured output validation with auto-retry on truncation
//! - Censorship detection for commercial/free-tier engines
//! - Health monitoring (background task)
//! - Review intensity support (Full/Medium/Light)
//!
//! Copyright (c) 2026 Capomastro Holdings Ltd. — Applied Physics Division

pub mod censorship;
pub mod config;
pub mod dispatch;
pub mod diversity;
pub mod health;
pub mod validation;

use serde::{Deserialize, Serialize};

/// Hosting mode for an inference engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HostingMode {
    SelfHosted,
    Commercial,
    FreeTier,
}

/// Authentication type for engine endpoints.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthType {
    Bearer,
    ApiKey,
    None,
}

/// Engine slot identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EngineSlot {
    A,
    B,
    C,
}

/// Review intensity level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewIntensity {
    /// 3 reviewers per step, 13 calls per task.
    Full,
    /// 2 reviewers per step, 9 calls per task.
    Medium,
    /// 1 reviewer per step, 5 calls per task.
    Light,
}

/// Configuration for a single inference engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineConfig {
    pub slot: EngineSlot,
    pub hosting_mode: HostingMode,
    pub endpoint_url: String,
    pub auth_type: AuthType,
    /// Encrypted at rest via Phase Encryption. Decrypted in memory only.
    #[serde(skip_serializing)]
    pub credentials: Option<String>,
    pub model_name: String,
    pub model_family: String,
    pub health_status: HealthStatus,
}

/// Engine health status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthStatus {
    Online,
    Offline,
    Suspect,
}

/// Response from an inference engine call.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InferenceResponse {
    pub content: String,
    pub engine_slot: EngineSlot,
    pub model_name: String,
    pub tis27_hash: String,
    pub latency_ms: u64,
    pub censorship_flagged: bool,
}
