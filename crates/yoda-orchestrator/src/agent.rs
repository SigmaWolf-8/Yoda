//! Agent configuration loading and role selection.
//!
//! B2.2.1: Load compiled JSON agent configs from disk
//! B2.2.2: Select best agent role for a task based on competency matching

use crate::AgentConfig;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
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
#[derive(Debug, Clone)]
pub struct AgentRegistry {
    agents: HashMap<String, AgentConfig>,
}

impl AgentRegistry {
    /// Load all agent configs from a directory of JSON files.
    pub fn load(compiled_dir: &Path) -> Result<Self, AgentError> {
        let mut agents = HashMap::new();

        if !compiled_dir.exists() {
            tracing::warn!("Agent compiled directory does not exist: {}", compiled_dir.display());
            return Ok(Self { agents });
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

        tracing::info!("Loaded {} agent configs", agents.len());
        Ok(Self { agents })
    }

    /// Get an agent by ID.
    pub fn get(&self, agent_id: &str) -> Option<&AgentConfig> {
        self.agents.get(agent_id)
    }

    /// Find the best agent for a set of required competencies.
    ///
    /// Scores each agent by how many required competencies it covers.
    /// Returns the agent with the highest coverage.
    pub fn find_best_match(&self, required_competencies: &[String]) -> Result<&AgentConfig, AgentError> {
        if self.agents.is_empty() {
            return Err(AgentError::NoAgentsLoaded);
        }

        let mut best: Option<(&AgentConfig, usize)> = None;

        for config in self.agents.values() {
            let score = required_competencies
                .iter()
                .filter(|req| config.competencies.contains(req))
                .count();

            if score > 0 {
                if let Some((_, best_score)) = &best {
                    if score > *best_score {
                        best = Some((config, score));
                    }
                } else {
                    best = Some((config, score));
                }
            }
        }

        best.map(|(config, _)| config)
            .ok_or_else(|| AgentError::NoMatch(required_competencies.to_vec()))
    }

    /// Find compatible reviewer agents for a given primary agent.
    pub fn find_reviewers(&self, primary: &AgentConfig, count: usize) -> Vec<&AgentConfig> {
        let mut reviewers: Vec<(&AgentConfig, usize)> = Vec::new();

        for reviewer_id in &primary.compatible_reviewers {
            if let Some(config) = self.agents.get(reviewer_id) {
                // Score reviewers by how relevant their review criteria are
                let score = config.review_criteria.len();
                reviewers.push((config, score));
            }
        }

        // Sort by score descending, take top N
        reviewers.sort_by(|a, b| b.1.cmp(&a.1));
        reviewers.into_iter().take(count).map(|(c, _)| c).collect()
    }

    /// List all loaded agent IDs.
    pub fn list_ids(&self) -> Vec<&str> {
        self.agents.keys().map(|s| s.as_str()).collect()
    }

    /// Total number of loaded agents.
    pub fn count(&self) -> usize {
        self.agents.len()
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

    #[test]
    fn test_find_best_match() {
        let mut registry = AgentRegistry { agents: HashMap::new() };
        registry.agents.insert("backend".into(), make_agent("backend", &["rust", "api-design", "database"], &[]));
        registry.agents.insert("frontend".into(), make_agent("frontend", &["react", "typescript", "css"], &[]));
        registry.agents.insert("security".into(), make_agent("security", &["security", "cryptography"], &[]));

        let result = registry.find_best_match(&["rust".into(), "api-design".into()]);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().agent_id, "backend");

        let result = registry.find_best_match(&["react".into()]);
        assert_eq!(result.unwrap().agent_id, "frontend");
    }

    #[test]
    fn test_no_match() {
        let registry = AgentRegistry { agents: HashMap::new() };
        assert!(registry.find_best_match(&["quantum-physics".into()]).is_err());
    }

    #[test]
    fn test_find_reviewers() {
        let mut registry = AgentRegistry { agents: HashMap::new() };
        registry.agents.insert("security".into(), make_agent("security", &["security"], &[]));
        registry.agents.insert("tester".into(), make_agent("tester", &["testing"], &[]));
        registry.agents.insert("backend".into(), make_agent("backend", &["rust"], &["security", "tester"]));

        let primary = registry.get("backend").unwrap();
        let reviewers = registry.find_reviewers(primary, 2);
        assert_eq!(reviewers.len(), 2);
    }
}
