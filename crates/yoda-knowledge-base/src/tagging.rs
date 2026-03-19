//! Hierarchical tagging with auto-suggest.
//!
//! B4.6: User-created tags, searchable, filterable, hierarchical.
//! Tags like "crypto/TL-DSA" — child inherits parent membership.
//! Auto-suggested based on content analysis, user confirms/rejects.

use sqlx::PgPool;
use std::collections::{HashMap, HashSet};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum TagError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

/// Tag with hierarchy info.
#[derive(Debug, Clone, serde::Serialize)]
pub struct TagInfo {
    pub tag: String,
    pub parent: Option<String>,
    pub children: Vec<String>,
    pub entry_count: usize,
}

/// Get all tags used in a project with hierarchy and counts.
pub async fn get_project_tags(
    db: &PgPool,
    project_id: Uuid,
) -> Result<Vec<TagInfo>, TagError> {
    // Fetch all tags from the project's entries
    let rows = sqlx::query_as::<_, (serde_json::Value,)>(
        "SELECT tags FROM knowledge_base WHERE project_id = $1 AND archived = FALSE"
    )
    .bind(project_id)
    .fetch_all(db)
    .await?;

    // Count occurrences of each tag
    let mut tag_counts: HashMap<String, usize> = HashMap::new();
    for (tags_json,) in &rows {
        if let Ok(tags) = serde_json::from_value::<Vec<String>>(tags_json.clone()) {
            for tag in tags {
                *tag_counts.entry(tag).or_insert(0) += 1;
            }
        }
    }

    // Build hierarchy
    let mut tag_infos: Vec<TagInfo> = Vec::new();
    let all_tags: Vec<String> = tag_counts.keys().cloned().collect();

    for tag in &all_tags {
        let parent = extract_parent(tag);
        let children: Vec<String> = all_tags
            .iter()
            .filter(|t| extract_parent(t).as_deref() == Some(tag.as_str()))
            .cloned()
            .collect();

        tag_infos.push(TagInfo {
            tag: tag.clone(),
            parent,
            children,
            entry_count: *tag_counts.get(tag).unwrap_or(&0),
        });
    }

    // Sort by tag name for consistent display
    tag_infos.sort_by(|a, b| a.tag.cmp(&b.tag));
    Ok(tag_infos)
}

/// Extract the parent from a hierarchical tag.
/// "crypto/TL-DSA" → Some("crypto")
/// "crypto" → None
fn extract_parent(tag: &str) -> Option<String> {
    tag.rfind('/').map(|i| tag[..i].to_string())
}

/// Check if a tag matches a filter, considering hierarchy.
/// "crypto" matches "crypto/TL-DSA" (parent matches child).
pub fn tag_matches_filter(entry_tags: &[String], filter_tag: &str) -> bool {
    entry_tags.iter().any(|t| {
        t == filter_tag || t.starts_with(&format!("{}/", filter_tag))
    })
}

/// Auto-suggest tags based on content analysis.
///
/// Scans content for known patterns and suggests hierarchical tags.
/// These are SUGGESTIONS — user confirms or rejects.
pub fn suggest_tags(content: &str) -> Vec<String> {
    let lower = content.to_lowercase();
    let mut suggestions = HashSet::new();

    // Domain-specific patterns
    let patterns: &[(&str, &str)] = &[
        // Crypto
        ("tis-27", "crypto/TIS-27"),
        ("tl-dsa", "crypto/TL-DSA"),
        ("tlsponge", "crypto/TLSponge-385"),
        ("phase encryption", "crypto/phase-encryption"),
        ("tl-kem", "crypto/TL-KEM"),
        ("post-quantum", "crypto"),
        ("cryptograph", "crypto"),
        ("encrypt", "crypto"),
        ("signature", "crypto"),
        // Architecture
        ("api", "architecture/api"),
        ("database", "architecture/database"),
        ("microservice", "architecture/microservices"),
        ("monolith", "architecture/monolith"),
        ("event-driven", "architecture/event-driven"),
        // Languages
        ("rust", "language/rust"),
        ("python", "language/python"),
        ("typescript", "language/typescript"),
        ("javascript", "language/javascript"),
        ("sql", "language/sql"),
        // Infrastructure
        ("docker", "infrastructure/docker"),
        ("kubernetes", "infrastructure/kubernetes"),
        ("ci/cd", "infrastructure/ci-cd"),
        ("deploy", "infrastructure/deployment"),
        // Security
        ("authentication", "security/authentication"),
        ("authorization", "security/authorization"),
        ("vulnerability", "security/vulnerability"),
        ("threat model", "security/threat-model"),
        // PlenumNET
        ("plenumnet", "plenumnet"),
        ("hypercube", "plenumnet/topology"),
        ("inter-cube", "plenumnet/inter-cube"),
        ("tdns", "plenumnet/tdns"),
        ("ternary", "plenumnet/ternary"),
    ];

    for (keyword, tag) in patterns {
        if lower.contains(keyword) {
            suggestions.insert(tag.to_string());
            // Also add parent tag
            if let Some(parent) = extract_parent(tag) {
                suggestions.insert(parent);
            }
        }
    }

    let mut sorted: Vec<String> = suggestions.into_iter().collect();
    sorted.sort();
    sorted
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_parent() {
        assert_eq!(extract_parent("crypto/TL-DSA"), Some("crypto".into()));
        assert_eq!(extract_parent("crypto"), None);
        assert_eq!(
            extract_parent("infra/cloud/aws"),
            Some("infra/cloud".into())
        );
    }

    #[test]
    fn test_tag_matches_filter() {
        let tags = vec!["crypto/TL-DSA".into(), "language/rust".into()];

        assert!(tag_matches_filter(&tags, "crypto"));          // parent matches child
        assert!(tag_matches_filter(&tags, "crypto/TL-DSA"));   // exact match
        assert!(tag_matches_filter(&tags, "language/rust"));    // exact match
        assert!(!tag_matches_filter(&tags, "security"));        // no match
    }

    #[test]
    fn test_suggest_tags_crypto() {
        let suggestions = suggest_tags("This module uses TL-DSA signatures and Phase Encryption for data at rest.");
        assert!(suggestions.contains(&"crypto/TL-DSA".to_string()));
        assert!(suggestions.contains(&"crypto/phase-encryption".to_string()));
        assert!(suggestions.contains(&"crypto".to_string())); // parent auto-included
    }

    #[test]
    fn test_suggest_tags_mixed() {
        let suggestions = suggest_tags("Build a REST API in Rust with PostgreSQL database and Docker deployment.");
        assert!(suggestions.contains(&"language/rust".to_string()));
        assert!(suggestions.contains(&"architecture/api".to_string()));
        assert!(suggestions.contains(&"architecture/database".to_string()));
        assert!(suggestions.contains(&"infrastructure/docker".to_string()));
    }

    #[test]
    fn test_suggest_tags_empty() {
        let suggestions = suggest_tags("Just a regular sentence with nothing technical.");
        assert!(suggestions.is_empty());
    }

    #[test]
    fn test_suggest_tags_plenumnet() {
        let suggestions = suggest_tags("Configure the PlenumNET hypercube with TDNS addressing and Inter-Cube tunnels.");
        assert!(suggestions.contains(&"plenumnet".to_string()));
        assert!(suggestions.contains(&"plenumnet/topology".to_string()));
        assert!(suggestions.contains(&"plenumnet/tdns".to_string()));
        assert!(suggestions.contains(&"plenumnet/inter-cube".to_string()));
    }
}
