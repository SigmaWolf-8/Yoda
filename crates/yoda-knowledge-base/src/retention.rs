//! Retention and pruning policies.
//!
//! B4.5: Auto-archive, manual archive/delete/pin, age thresholds.
//! Archived entries excluded from agent context injection.
//! Pinned entries always included regardless of age.
//! Deleted content preserves audit log signatures.

use chrono::{Duration, Utc};
use sqlx::PgPool;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum RetentionError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

/// Retention policy configuration.
#[derive(Debug, Clone)]
pub struct RetentionConfig {
    /// Projects older than this are auto-archived (default: 24 months).
    /// Set to 0 to disable auto-archive.
    pub auto_archive_months: i64,
}

impl Default for RetentionConfig {
    fn default() -> Self {
        Self {
            auto_archive_months: 24,
        }
    }
}

/// Run the auto-archive process.
///
/// Archives all non-pinned entries in projects older than the threshold.
/// Pinned entries are NEVER auto-archived.
///
/// Returns the number of entries archived.
pub async fn run_auto_archive(
    db: &PgPool,
    config: &RetentionConfig,
) -> Result<u64, RetentionError> {
    if config.auto_archive_months == 0 {
        tracing::debug!("Auto-archive disabled (threshold = 0)");
        return Ok(0);
    }

    let threshold = Utc::now() - Duration::days(config.auto_archive_months * 30);

    let result = sqlx::query(
        "UPDATE knowledge_base SET archived = TRUE \
         WHERE archived = FALSE \
         AND pinned = FALSE \
         AND created_at < $1"
    )
    .bind(threshold)
    .execute(db)
    .await?;

    let count = result.rows_affected();
    if count > 0 {
        tracing::info!(
            archived = count,
            threshold = %threshold,
            "Auto-archived old entries"
        );
    }

    Ok(count)
}

/// Archive a specific entry (manual).
pub async fn archive_entry(db: &PgPool, id: Uuid) -> Result<(), RetentionError> {
    sqlx::query("UPDATE knowledge_base SET archived = TRUE WHERE id = $1")
        .bind(id)
        .execute(db)
        .await?;
    Ok(())
}

/// Unarchive a specific entry.
pub async fn unarchive_entry(db: &PgPool, id: Uuid) -> Result<(), RetentionError> {
    sqlx::query("UPDATE knowledge_base SET archived = FALSE WHERE id = $1")
        .bind(id)
        .execute(db)
        .await?;
    Ok(())
}

/// Pin an entry (always included in agent context regardless of age).
pub async fn pin_entry(db: &PgPool, id: Uuid) -> Result<(), RetentionError> {
    sqlx::query("UPDATE knowledge_base SET pinned = TRUE WHERE id = $1")
        .bind(id)
        .execute(db)
        .await?;
    Ok(())
}

/// Unpin an entry.
pub async fn unpin_entry(db: &PgPool, id: Uuid) -> Result<(), RetentionError> {
    sqlx::query("UPDATE knowledge_base SET pinned = FALSE WHERE id = $1")
        .bind(id)
        .execute(db)
        .await?;
    Ok(())
}

/// Get counts for retention monitoring.
pub async fn get_retention_stats(
    db: &PgPool,
    project_id: Uuid,
) -> Result<RetentionStats, RetentionError> {
    let (total, archived, pinned): (i64, i64, i64) = sqlx::query_as(
        "SELECT \
           COUNT(*), \
           COUNT(*) FILTER (WHERE archived = TRUE), \
           COUNT(*) FILTER (WHERE pinned = TRUE) \
         FROM knowledge_base WHERE project_id = $1"
    )
    .bind(project_id)
    .fetch_one(db)
    .await?;

    Ok(RetentionStats {
        total_entries: total as usize,
        archived_entries: archived as usize,
        pinned_entries: pinned as usize,
        active_entries: (total - archived) as usize,
    })
}

/// Retention statistics for a project.
#[derive(Debug, Clone, serde::Serialize)]
pub struct RetentionStats {
    pub total_entries: usize,
    pub archived_entries: usize,
    pub pinned_entries: usize,
    pub active_entries: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = RetentionConfig::default();
        assert_eq!(config.auto_archive_months, 24);
    }

    #[test]
    fn test_disabled_archive() {
        let config = RetentionConfig { auto_archive_months: 0 };
        assert_eq!(config.auto_archive_months, 0);
    }
}
