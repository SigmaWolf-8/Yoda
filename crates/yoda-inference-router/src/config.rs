//! Engine configuration management.
//!
//! Loads, validates, and manages the three engine slot configurations.

use crate::{AuthType, EngineConfig, EngineSlot, HostingMode};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("engine slot {0:?} not configured")]
    SlotNotConfigured(EngineSlot),
    #[error("invalid endpoint URL for slot {0:?}: {1}")]
    InvalidEndpoint(EngineSlot, String),
    #[error("missing credentials for commercial/free-tier engine {0:?}")]
    MissingCredentials(EngineSlot),
}

/// The full set of three engine configurations.
#[derive(Debug, Clone, Default)]
pub struct EngineSet {
    pub engines: [Option<EngineConfig>; 3],
}

impl EngineSet {
    pub fn new() -> Self {
        Self { engines: [None, None, None] }
    }

    pub fn get(&self, slot: EngineSlot) -> Option<&EngineConfig> {
        self.engines[slot_index(slot)].as_ref()
    }

    pub fn set(&mut self, slot: EngineSlot, config: EngineConfig) {
        self.engines[slot_index(slot)] = Some(config);
    }

    pub fn configured(&self) -> Vec<&EngineConfig> {
        self.engines.iter().filter_map(|e| e.as_ref()).collect()
    }

    pub fn validate(&self) -> Result<(), ConfigError> {
        for engine in self.configured() {
            if engine.endpoint_url.is_empty() {
                return Err(ConfigError::InvalidEndpoint(engine.slot, "empty URL".into()));
            }
            if matches!(engine.hosting_mode, HostingMode::Commercial | HostingMode::FreeTier)
                && engine.credentials.is_none()
                && engine.auth_type != AuthType::None
            {
                return Err(ConfigError::MissingCredentials(engine.slot));
            }
        }
        Ok(())
    }
}

fn slot_index(slot: EngineSlot) -> usize {
    match slot { EngineSlot::A => 0, EngineSlot::B => 1, EngineSlot::C => 2 }
}

/// OpenAI-compatible chat completion request.
#[derive(Debug, Clone, Serialize)]
pub struct ChatCompletionRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// OpenAI-compatible chat completion response.
#[derive(Debug, Clone, Deserialize)]
pub struct ChatCompletionResponse {
    pub id: Option<String>,
    pub choices: Vec<Choice>,
    pub usage: Option<Usage>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Choice {
    pub message: ChoiceMessage,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChoiceMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Usage {
    pub prompt_tokens: Option<u32>,
    pub completion_tokens: Option<u32>,
    pub total_tokens: Option<u32>,
}
