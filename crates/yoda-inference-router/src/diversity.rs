//! Diversity enforcement via model lineage database.
//!
//! All three reviewers in every step MUST each run on a separate engine
//! family. Validated against model_lineages.json.

use crate::{EngineConfig, EngineSlot};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DiversityError {
    #[error("engines {0:?} and {1:?} are in the same family: {2}")]
    FamilyConflict(EngineSlot, EngineSlot, String),
    #[error("model '{0}' not found in lineage database and no family override set")]
    UnknownModel(String),
    #[error("failed to load lineage database: {0}")]
    LoadError(String),
    #[error("fewer than {0} distinct families configured (need {0} for diversity)")]
    InsufficientDiversity(usize),
}

/// Model lineage database: maps family names to model lists.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelLineageDb {
    #[serde(flatten)]
    pub families: HashMap<String, FamilyEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FamilyEntry {
    pub models: Vec<String>,
}

impl ModelLineageDb {
    /// Load from a JSON file.
    pub fn load(path: &Path) -> Result<Self, DiversityError> {
        let content = fs::read_to_string(path)
            .map_err(|e| DiversityError::LoadError(format!("{}: {}", path.display(), e)))?;
        serde_json::from_str(&content)
            .map_err(|e| DiversityError::LoadError(format!("JSON parse: {}", e)))
    }

    /// Look up which family a model belongs to.
    /// Returns None if the model is not in the database.
    pub fn lookup_family(&self, model_name: &str) -> Option<String> {
        let lower = model_name.to_lowercase();
        for (family, entry) in &self.families {
            for model in &entry.models {
                if model.to_lowercase() == lower {
                    return Some(family.clone());
                }
            }
        }
        None
    }

    /// Resolve the family for an engine, respecting manual overrides.
    pub fn resolve_family(&self, config: &EngineConfig) -> Result<String, DiversityError> {
        // Manual family override takes precedence
        if !config.model_family.is_empty() {
            return Ok(config.model_family.clone());
        }
        // Look up in lineage database
        self.lookup_family(&config.model_name)
            .ok_or_else(|| DiversityError::UnknownModel(config.model_name.clone()))
    }
}

/// Validate that N engines represent N distinct model families.
pub fn validate_diversity(
    engines: &[&EngineConfig],
    lineage_db: &ModelLineageDb,
) -> Result<Vec<DiversityResult>, DiversityError> {
    let mut results = Vec::new();
    let mut seen_families: Vec<(EngineSlot, String)> = Vec::new();

    for engine in engines {
        let family = lineage_db.resolve_family(engine)?;

        // Check for conflict with previously seen families
        for (prev_slot, prev_family) in &seen_families {
            if &family == prev_family {
                return Err(DiversityError::FamilyConflict(
                    *prev_slot,
                    engine.slot,
                    family.clone(),
                ));
            }
        }

        results.push(DiversityResult {
            slot: engine.slot,
            model_name: engine.model_name.clone(),
            family: family.clone(),
            status: DiversityStatus::Green,
        });

        seen_families.push((engine.slot, family));
    }

    Ok(results)
}

/// Quick check: are N engines diverse? Returns bool.
pub fn is_diverse(
    engines: &[&EngineConfig],
    lineage_db: &ModelLineageDb,
) -> bool {
    validate_diversity(engines, lineage_db).is_ok()
}

/// Result of diversity validation for a single engine slot.
#[derive(Debug, Clone, Serialize)]
pub struct DiversityResult {
    pub slot: EngineSlot,
    pub model_name: String,
    pub family: String,
    pub status: DiversityStatus,
}

/// Color-coded status for the Settings page diversity check.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DiversityStatus {
    /// Unique family — no conflicts.
    Green,
    /// Same family as another engine — conflict.
    Red,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AuthType, HealthStatus, HostingMode};

    fn make_db() -> ModelLineageDb {
        let json = r#"{
            "qwen": { "models": ["Qwen3.5-27B", "Qwen3.5-9B"] },
            "deepseek": { "models": ["DeepSeek-R1", "DeepSeek-R1-Distill-32B"] },
            "llama": { "models": ["Llama-3.1-70B", "Llama-3.1-8B"] },
            "claude": { "models": ["claude-sonnet-4-6"] }
        }"#;
        serde_json::from_str(json).unwrap()
    }

    fn make_engine(slot: EngineSlot, model: &str, family: &str) -> EngineConfig {
        EngineConfig {
            slot,
            hosting_mode: HostingMode::SelfHosted,
            endpoint_url: "http://localhost:8001".into(),
            auth_type: AuthType::None,
            credentials: None,
            model_name: model.into(),
            model_family: family.into(),
            health_status: HealthStatus::Online,
        }
    }

    #[test]
    fn test_three_distinct_families_pass() {
        let db = make_db();
        let a = make_engine(EngineSlot::A, "Qwen3.5-27B", "qwen");
        let b = make_engine(EngineSlot::B, "DeepSeek-R1", "deepseek");
        let c = make_engine(EngineSlot::C, "Llama-3.1-70B", "llama");

        let result = validate_diversity(&[&a, &b, &c], &db);
        assert!(result.is_ok());
        let results = result.unwrap();
        assert_eq!(results.len(), 3);
        assert!(results.iter().all(|r| r.status == DiversityStatus::Green));
    }

    #[test]
    fn test_same_family_conflict() {
        let db = make_db();
        let a = make_engine(EngineSlot::A, "Qwen3.5-27B", "qwen");
        let b = make_engine(EngineSlot::B, "Qwen3.5-9B", "qwen");  // same family!

        let result = validate_diversity(&[&a, &b], &db);
        assert!(result.is_err());
        match result.unwrap_err() {
            DiversityError::FamilyConflict(s1, s2, fam) => {
                assert_eq!(s1, EngineSlot::A);
                assert_eq!(s2, EngineSlot::B);
                assert_eq!(fam, "qwen");
            }
            e => panic!("Expected FamilyConflict, got: {:?}", e),
        }
    }

    #[test]
    fn test_lookup_family() {
        let db = make_db();
        assert_eq!(db.lookup_family("Qwen3.5-27B"), Some("qwen".into()));
        assert_eq!(db.lookup_family("DeepSeek-R1"), Some("deepseek".into()));
        assert_eq!(db.lookup_family("unknown-model"), None);
    }

    #[test]
    fn test_family_override() {
        let db = make_db();
        let engine = make_engine(EngineSlot::A, "custom-finetune", "deepseek");
        let family = db.resolve_family(&engine).unwrap();
        assert_eq!(family, "deepseek"); // uses override, not DB lookup
    }

    #[test]
    fn test_is_diverse_helper() {
        let db = make_db();
        let a = make_engine(EngineSlot::A, "x", "qwen");
        let b = make_engine(EngineSlot::B, "y", "deepseek");
        let c = make_engine(EngineSlot::C, "z", "llama");
        assert!(is_diverse(&[&a, &b, &c], &db));

        let d = make_engine(EngineSlot::C, "z", "qwen");
        assert!(!is_diverse(&[&a, &b, &d], &db));
    }
}
