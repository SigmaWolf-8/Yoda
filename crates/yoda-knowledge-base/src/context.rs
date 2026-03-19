//! Agent context injection — surface relevant prior work during inference.
//!
//! B4.7: Before each inference call, query KB and inject relevant prior
//! work into the user content portion of the prompt. This gives agents
//! effective long-term memory scoped to each user/project.

use crate::search::{hybrid_search, SearchWeights};
use crate::SearchFilters;
use sqlx::PgPool;
use uuid::Uuid;

/// Maximum tokens of context to inject (rough estimate: 4 chars ≈ 1 token).
const MAX_CONTEXT_CHARS: usize = 8000;

/// Maximum number of KB entries to consider for context.
const MAX_CONTEXT_ENTRIES: i64 = 10;

/// Configuration for context injection.
#[derive(Debug, Clone)]
pub struct ContextConfig {
    /// Max characters of KB content to inject.
    pub max_chars: usize,
    /// Max entries to pull.
    pub max_entries: i64,
    /// Include tags matching these filters (empty = no tag filter).
    pub tag_filters: Vec<String>,
    /// Search weights for hybrid retrieval.
    pub search_weights: SearchWeights,
}

impl Default for ContextConfig {
    fn default() -> Self {
        Self {
            max_chars: MAX_CONTEXT_CHARS,
            max_entries: MAX_CONTEXT_ENTRIES,
            tag_filters: Vec::new(),
            search_weights: SearchWeights::default(),
        }
    }
}

/// Retrieve relevant context from the knowledge base for a task.
///
/// Returns a formatted string ready to be prepended to the inference prompt.
/// If no relevant context is found, returns an empty string (no injection).
pub async fn retrieve_context(
    db: &PgPool,
    project_id: Uuid,
    task_title: &str,
    task_competencies: &[String],
    query_embedding: Option<&[f32]>,
    config: &ContextConfig,
) -> String {
    // Build a search query from task title + competencies
    let search_query = format!(
        "{} {}",
        task_title,
        task_competencies.join(" ")
    );

    let filters = SearchFilters {
        query: Some(search_query),
        project_id: Some(project_id),
        archived: Some(false), // Exclude archived
        limit: Some(config.max_entries),
        ..Default::default()
    };

    let results = match hybrid_search(db, &filters, query_embedding, &config.search_weights).await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = %e, "KB context retrieval failed — proceeding without context");
            return String::new();
        }
    };

    if results.is_empty() {
        return String::new();
    }

    // Build context string, respecting max_chars budget
    let mut context = String::from("## Prior Knowledge (from past projects)\n\n");
    let mut total_chars = context.len();

    for result in &results {
        let entry_header = format!(
            "### {} (relevance: {:.2})\n",
            if !result.entry.summary.is_empty() {
                &result.entry.summary
            } else {
                "Related entry"
            },
            result.relevance_score
        );

        // Truncate content if needed to stay within budget
        let remaining = config.max_chars.saturating_sub(total_chars + entry_header.len() + 10);
        if remaining < 50 {
            break; // Not enough room for meaningful content
        }

        let content = if result.entry.content.len() > remaining {
            format!("{}...", &result.entry.content[..remaining])
        } else {
            result.entry.content.clone()
        };

        context.push_str(&entry_header);
        context.push_str(&content);
        context.push_str("\n\n");

        total_chars = context.len();
        if total_chars >= config.max_chars {
            break;
        }
    }

    tracing::debug!(
        entries = results.len(),
        chars = context.len(),
        "Injecting KB context into inference prompt"
    );

    context
}

/// Build the complete user prompt with injected context.
///
/// Format:
/// ```text
/// [KB context if available]
///
/// ## Current Task
/// [original task content]
/// ```
pub fn build_prompt_with_context(
    kb_context: &str,
    task_content: &str,
) -> String {
    if kb_context.is_empty() {
        return task_content.to_string();
    }

    format!(
        "{}\n---\n\n## Current Task\n\n{}",
        kb_context, task_content
    )
}

/// Extract user preferences from KB entries.
///
/// Looks for patterns in stored entries that indicate user preferences:
/// coding style, frameworks, naming conventions, architectural patterns.
pub fn extract_preferences(entries: &[crate::KBEntry]) -> UserPreferences {
    let mut prefs = UserPreferences::default();

    for entry in entries {
        let lower = entry.content.to_lowercase();

        // Detect language preferences
        if lower.contains("rust") {
            prefs.preferred_languages.insert("rust".into());
        }
        if lower.contains("typescript") {
            prefs.preferred_languages.insert("typescript".into());
        }
        if lower.contains("python") {
            prefs.preferred_languages.insert("python".into());
        }

        // Detect framework preferences
        if lower.contains("axum") {
            prefs.preferred_frameworks.insert("axum".into());
        }
        if lower.contains("react") {
            prefs.preferred_frameworks.insert("react".into());
        }
        if lower.contains("sqlx") {
            prefs.preferred_frameworks.insert("sqlx".into());
        }

        // Detect architectural patterns
        if lower.contains("microservice") {
            prefs.architectural_patterns.insert("microservices".into());
        }
        if lower.contains("event-driven") || lower.contains("event driven") {
            prefs.architectural_patterns.insert("event-driven".into());
        }
    }

    prefs
}

/// Detected user preferences from KB history.
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct UserPreferences {
    pub preferred_languages: std::collections::HashSet<String>,
    pub preferred_frameworks: std::collections::HashSet<String>,
    pub architectural_patterns: std::collections::HashSet<String>,
}

impl UserPreferences {
    /// Format preferences as a context string for injection.
    pub fn as_context_string(&self) -> String {
        let mut parts = Vec::new();

        if !self.preferred_languages.is_empty() {
            let langs: Vec<&str> = self.preferred_languages.iter().map(|s| s.as_str()).collect();
            parts.push(format!("Preferred languages: {}", langs.join(", ")));
        }
        if !self.preferred_frameworks.is_empty() {
            let fws: Vec<&str> = self.preferred_frameworks.iter().map(|s| s.as_str()).collect();
            parts.push(format!("Preferred frameworks: {}", fws.join(", ")));
        }
        if !self.architectural_patterns.is_empty() {
            let pats: Vec<&str> = self.architectural_patterns.iter().map(|s| s.as_str()).collect();
            parts.push(format!("Architectural patterns: {}", pats.join(", ")));
        }

        if parts.is_empty() {
            String::new()
        } else {
            format!("## User Preferences\n\n{}\n", parts.join("\n"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::KBEntry;
    use chrono::Utc;

    #[test]
    fn test_build_prompt_with_context() {
        let context = "## Prior Knowledge\n\nSome relevant info.\n";
        let task = "Implement the retry logic.";
        let result = build_prompt_with_context(context, task);
        assert!(result.contains("Prior Knowledge"));
        assert!(result.contains("Current Task"));
        assert!(result.contains("retry logic"));
    }

    #[test]
    fn test_build_prompt_without_context() {
        let result = build_prompt_with_context("", "Just the task.");
        assert_eq!(result, "Just the task.");
        assert!(!result.contains("Prior Knowledge"));
    }

    #[test]
    fn test_extract_preferences() {
        let entries = vec![
            KBEntry {
                id: Uuid::new_v4(), project_id: Uuid::new_v4(),
                content: "Built with Rust and Axum, using sqlx for database.".into(),
                summary: String::new(), tags: vec![], archived: false,
                pinned: false, boost_score: 1.0, source_task_id: None,
                source_mode: None, created_at: Utc::now(), updated_at: Utc::now(),
            },
            KBEntry {
                id: Uuid::new_v4(), project_id: Uuid::new_v4(),
                content: "React frontend with TypeScript, microservice architecture.".into(),
                summary: String::new(), tags: vec![], archived: false,
                pinned: false, boost_score: 1.0, source_task_id: None,
                source_mode: None, created_at: Utc::now(), updated_at: Utc::now(),
            },
        ];

        let prefs = extract_preferences(&entries);
        assert!(prefs.preferred_languages.contains("rust"));
        assert!(prefs.preferred_languages.contains("typescript"));
        assert!(prefs.preferred_frameworks.contains("axum"));
        assert!(prefs.preferred_frameworks.contains("react"));
        assert!(prefs.preferred_frameworks.contains("sqlx"));
        assert!(prefs.architectural_patterns.contains("microservices"));
    }

    #[test]
    fn test_preferences_as_context() {
        let mut prefs = UserPreferences::default();
        prefs.preferred_languages.insert("rust".into());
        prefs.preferred_frameworks.insert("axum".into());

        let ctx = prefs.as_context_string();
        assert!(ctx.contains("User Preferences"));
        assert!(ctx.contains("rust"));
        assert!(ctx.contains("axum"));
    }

    #[test]
    fn test_empty_preferences() {
        let prefs = UserPreferences::default();
        assert!(prefs.as_context_string().is_empty());
    }
}
