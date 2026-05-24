//! Agent configuration loading and role selection.
//!
//! B2.2.1: Load compiled JSON agent configs from disk
//! B2.2.2: Select best agent role for a task based on competency matching

use crate::AgentConfig;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AgentError {
    #[error("no agents loaded")]
    NoAgentsLoaded,
    #[error("agent not found: {0}")]
    AgentNotFound(String),
    #[error("no agent matches competencies: {0:?}")]
    NoMatch(Vec<String>),
    #[error("failed to load agent config: {0}")]
    LoadError(String),
}

/// Registry of all compiled agent configurations.
///
/// Holds agents in an `Arc<RwLock<HashMap>>` so the in-memory roster can be
/// hot-reloaded from disk (e.g. after a user uploads new `.md` files and the
/// compiler regenerates `agents/compiled/*.json`) without restarting the API.
#[derive(Debug, Clone)]
pub struct AgentRegistry {
    agents: Arc<RwLock<HashMap<String, AgentConfig>>>,
    compiled_dir: Arc<PathBuf>,
}

impl AgentRegistry {
    /// Load all agent configs from a directory of JSON files.
    pub fn load(compiled_dir: &Path) -> Result<Self, AgentError> {
        let map = Self::load_map(compiled_dir)?;
        tracing::info!("Loaded {} agent configs", map.len());
        Ok(Self {
            agents: Arc::new(RwLock::new(map)),
            compiled_dir: Arc::new(compiled_dir.to_path_buf()),
        })
    }

    /// Re-read all JSON configs from the directory this registry was loaded
    /// from and atomically swap in the new map. Returns the new count.
    pub fn reload_from_disk(&self) -> Result<usize, AgentError> {
        let map = Self::load_map(self.compiled_dir.as_path())?;
        let count = map.len();
        let mut guard = self
            .agents
            .write()
            .map_err(|_| AgentError::LoadError("registry lock poisoned".into()))?;
        *guard = map;
        tracing::info!("Reloaded {} agent configs from {}", count, self.compiled_dir.display());
        Ok(count)
    }

    fn load_map(compiled_dir: &Path) -> Result<HashMap<String, AgentConfig>, AgentError> {
        let mut agents = HashMap::new();

        if !compiled_dir.exists() {
            tracing::warn!("Agent compiled directory does not exist: {}", compiled_dir.display());
            return Ok(agents);
        }

        let entries = fs::read_dir(compiled_dir)
            .map_err(|e| AgentError::LoadError(format!("{}: {}", compiled_dir.display(), e)))?;

        for entry in entries {
            let entry = entry.map_err(|e| AgentError::LoadError(e.to_string()))?;
            let path = entry.path();

            if path.extension().map_or(false, |e| e == "json") {
                match fs::read_to_string(&path) {
                    Ok(content) => match serde_json::from_str::<AgentConfig>(&content) {
                        Ok(config) => {
                            // R1-A1-1: Validate system prompt length to prevent
                            // oversized or injection-laden prompts from compiled JSON.
                            const MAX_SYSTEM_PROMPT_CHARS: usize = 32_768;
                            if config.system_prompt.len() > MAX_SYSTEM_PROMPT_CHARS {
                                tracing::warn!(
                                    agent_id = %config.agent_id,
                                    len = config.system_prompt.len(),
                                    max = MAX_SYSTEM_PROMPT_CHARS,
                                    "Agent system prompt exceeds maximum length — skipping"
                                );
                                continue;
                            }
                            tracing::debug!(agent_id = %config.agent_id, "Loaded agent config");
                            agents.insert(config.agent_id.clone(), config);
                        }
                        Err(e) => {
                            tracing::warn!(path = %path.display(), error = %e, "Skipping malformed agent config");
                        }
                    },
                    Err(e) => {
                        tracing::warn!(path = %path.display(), error = %e, "Failed to read agent config");
                    }
                }
            }
        }

        Ok(agents)
    }

    fn read(&self) -> std::sync::RwLockReadGuard<'_, HashMap<String, AgentConfig>> {
        self.agents.read().expect("agent registry lock poisoned")
    }

    /// Get a clone of an agent by ID.
    pub fn get(&self, agent_id: &str) -> Option<AgentConfig> {
        self.read().get(agent_id).cloned()
    }

    /// Find the best agent for a set of required competencies.
    ///
    /// Scores each agent by how many required competencies it covers.
    /// Returns the agent with the highest coverage.
    /// R3-1: On ties, prefers Capomastro agents over upstream, then
    /// breaks by lexicographic agent_id for deterministic selection.
    pub fn find_best_match(&self, required_competencies: &[String]) -> Result<AgentConfig, AgentError> {
        let map = self.read();
        if map.is_empty() {
            return Err(AgentError::NoAgentsLoaded);
        }

        let mut best: Option<(&AgentConfig, usize)> = None;

        for config in map.values() {
            let score = required_competencies
                .iter()
                .filter(|req| config.competencies.contains(req))
                .count();

            if score > 0 {
                let dominated = if let Some((best_config, best_score)) = &best {
                    if score > *best_score {
                        true
                    } else if score == *best_score {
                        // Tie-break: Capomastro (proprietary) preferred over upstream (MIT)
                        let config_is_capomastro = config.division == "capomastro" || config.license != "MIT";
                        let best_is_capomastro = best_config.division == "capomastro" || best_config.license != "MIT";
                        if config_is_capomastro && !best_is_capomastro {
                            true
                        } else if config_is_capomastro == best_is_capomastro {
                            // Same division class — lexicographic agent_id for stability
                            config.agent_id < best_config.agent_id
                        } else {
                            false
                        }
                    } else {
                        false
                    }
                } else {
                    true // No best yet
                };

                if dominated {
                    best = Some((config, score));
                }
            }
        }

        best.map(|(config, _)| config.clone())
            .ok_or_else(|| AgentError::NoMatch(required_competencies.to_vec()))
    }

    /// Find compatible reviewer agents for a given primary agent.
    pub fn find_reviewers(&self, primary: &AgentConfig, count: usize) -> Vec<AgentConfig> {
        let map = self.read();
        let mut reviewers: Vec<(AgentConfig, usize)> = Vec::new();

        for reviewer_id in &primary.compatible_reviewers {
            if let Some(config) = map.get(reviewer_id) {
                let score = config.review_criteria.len();
                reviewers.push((config.clone(), score));
            }
        }

        reviewers.sort_by(|a, b| b.1.cmp(&a.1));
        reviewers.into_iter().take(count).map(|(c, _)| c).collect()
    }

    /// List all loaded agent IDs (cloned).
    pub fn list_ids(&self) -> Vec<String> {
        self.read().keys().cloned().collect()
    }

    /// Total number of loaded agents.
    pub fn count(&self) -> usize {
        self.read().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_agent(id: &str, competencies: &[&str], reviewers: &[&str]) -> AgentConfig {
        AgentConfig {
            agent_id: id.into(),
            display_name: id.into(),
            division: "test".into(),
            system_prompt: "You are a test agent.".into(),
            competencies: competencies.iter().map(|s| s.to_string()).collect(),
            input_schema: serde_json::json!({}),
            output_schema: serde_json::json!({}),
            review_criteria: vec!["correctness".into()],
            compatible_reviewers: reviewers.iter().map(|s| s.to_string()).collect(),
            source: "test".into(),
            license: "MIT".into(),
        }
    }

    fn registry_from(items: Vec<AgentConfig>) -> AgentRegistry {
        let mut map = HashMap::new();
        for a in items { map.insert(a.agent_id.clone(), a); }
        AgentRegistry {
            agents: Arc::new(RwLock::new(map)),
            compiled_dir: Arc::new(PathBuf::from("/dev/null")),
        }
    }

    #[test]
    fn test_find_best_match() {
        let registry = registry_from(vec![
            make_agent("backend", &["rust", "api-design", "database"], &[]),
            make_agent("frontend", &["react", "typescript", "css"], &[]),
            make_agent("security", &["security", "cryptography"], &[]),
        ]);

        let result = registry.find_best_match(&["rust".into(), "api-design".into()]);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().agent_id, "backend");

        let result = registry.find_best_match(&["react".into()]);
        assert_eq!(result.unwrap().agent_id, "frontend");
    }

    #[test]
    fn test_no_match() {
        let registry = registry_from(vec![]);
        assert!(registry.find_best_match(&["quantum-physics".into()]).is_err());
    }

    #[test]
    fn test_find_reviewers() {
        let registry = registry_from(vec![
            make_agent("security", &["security"], &[]),
            make_agent("tester", &["testing"], &[]),
            make_agent("backend", &["rust"], &["security", "tester"]),
        ]);

        let primary = registry.get("backend").unwrap();
        let reviewers = registry.find_reviewers(&primary, 2);
        assert_eq!(reviewers.len(), 2);
    }
}
