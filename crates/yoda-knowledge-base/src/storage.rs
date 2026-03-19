//! Storage rules — the binary trigger for knowledge persistence.
//!
//! B4.1: decomposed queries → ALL sub-results stored automatically.
//!       non-decomposed queries → nothing stored (throwaway).
//!
//! No manual save action. Decomposition IS the trigger.

use crate::KBEntry;
use chrono::Utc;
use sqlx::PgPool;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("entry not found: {0}")]
    NotFound(Uuid),
}

/// Determine if a query result should be stored.
///
/// The rule is binary:
/// - `task_count > 0` (query decomposed) → store everything
/// - `task_count == 0` (no decomposition) → store nothing
pub fn should_store(task_count: usize) -> bool {
    task_count > 0
}

/// Store a knowledge base entry from a completed task.
pub async fn store_entry(
    db: &PgPool,
    project_id: Uuid,
    content: &str,
    summary: &str,
    tags: &[String],
    source_task_id: Option<Uuid>,
    source_mode: Option<&str>,
) -> Result<KBEntry, StorageError> {
    let id = Uuid::new_v4();
    let now = Utc::now();
    let tags_json = serde_json::to_value(tags).unwrap_or_default();

    sqlx::query(
        "INSERT INTO knowledge_base \
         (id, project_id, content, summary, tags, source_task_id, source_mode, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)"
    )
    .bind(id)
    .bind(project_id)
    .bind(content)
    .bind(summary)
    .bind(&tags_json)
    .bind(source_task_id)
    .bind(source_mode)
    .bind(now)
    .execute(db)
    .await?;

    Ok(KBEntry {
        id,
        project_id,
        content: content.to_string(),
        summary: summary.to_string(),
        tags: tags.to_vec(),
        archived: false,
        pinned: false,
        boost_score: 1.0,
        source_task_id,
        source_mode: source_mode.map(|s| s.to_string()),
        created_at: now,
        updated_at: now,
    })
}

/// Store all results from a decomposed query.
/// Called after assembly — stores each task's final output as a KB entry.
pub async fn store_decomposition_results(
    db: &PgPool,
    project_id: Uuid,
    task_results: &[(Uuid, String, String, Vec<String>, Option<&str>)],
) -> Result<Vec<KBEntry>, StorageError> {
    let mut entries = Vec::new();

    for (task_id, content, summary, tags, mode) in task_results {
        let entry = store_entry(
            db,
            project_id,
            content,
            summary,
            tags,
            Some(*task_id),
            *mode,
        )
        .await?;
        entries.push(entry);
    }

    tracing::info!(
        project_id = %project_id,
        entries = entries.len(),
        "Stored decomposition results in knowledge base"
    );

    Ok(entries)
}

/// Get a single entry by ID.
pub async fn get_entry(db: &PgPool, id: Uuid) -> Result<KBEntry, StorageError> {
    let row = sqlx::query_as::<_, (
        Uuid, Uuid, String, String, serde_json::Value, bool, bool, f64,
        Option<Uuid>, Option<String>, chrono::DateTime<Utc>, chrono::DateTime<Utc>,
    )>(
        "SELECT id, project_id, content, summary, tags, archived, pinned, boost_score, \
         source_task_id, source_mode, created_at, updated_at \
         FROM knowledge_base WHERE id = $1"
    )
    .bind(id)
    .fetch_optional(db)
    .await?
    .ok_or(StorageError::NotFound(id))?;

    Ok(row_to_entry(row))
}

/// Update an entry's metadata (tags, boost, archive, pin).
pub async fn update_entry(
    db: &PgPool,
    id: Uuid,
    tags: Option<&[String]>,
    boost_score: Option<f64>,
    archived: Option<bool>,
    pinned: Option<bool>,
) -> Result<(), StorageError> {
    // Build dynamic update
    if let Some(tags) = tags {
        let tags_json = serde_json::to_value(tags).unwrap_or_default();
        sqlx::query("UPDATE knowledge_base SET tags = $1 WHERE id = $2")
            .bind(&tags_json)
            .bind(id)
            .execute(db)
            .await?;
    }
    if let Some(boost) = boost_score {
        sqlx::query("UPDATE knowledge_base SET boost_score = $1 WHERE id = $2")
            .bind(boost)
            .bind(id)
            .execute(db)
            .await?;
    }
    if let Some(archived) = archived {
        sqlx::query("UPDATE knowledge_base SET archived = $1 WHERE id = $2")
            .bind(archived)
            .bind(id)
            .execute(db)
            .await?;
    }
    if let Some(pinned) = pinned {
        sqlx::query("UPDATE knowledge_base SET pinned = $1 WHERE id = $2")
            .bind(pinned)
            .bind(id)
            .execute(db)
            .await?;
    }
    Ok(())
}

/// Delete an entry permanently.
/// Note: TL-DSA signatures are preserved in audit_log even after deletion.
pub async fn delete_entry(db: &PgPool, id: Uuid) -> Result<(), StorageError> {
    let result = sqlx::query("DELETE FROM knowledge_base WHERE id = $1")
        .bind(id)
        .execute(db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(StorageError::NotFound(id));
    }
    Ok(())
}

/// Helper: convert a query row tuple into a KBEntry.
pub(crate) fn row_to_entry(
    row: (Uuid, Uuid, String, String, serde_json::Value, bool, bool, f64,
          Option<Uuid>, Option<String>, chrono::DateTime<Utc>, chrono::DateTime<Utc>),
) -> KBEntry {
    let tags: Vec<String> = serde_json::from_value(row.4.clone()).unwrap_or_default();
    KBEntry {
        id: row.0,
        project_id: row.1,
        content: row.2,
        summary: row.3,
        tags,
        archived: row.5,
        pinned: row.6,
        boost_score: row.7,
        source_task_id: row.8,
        source_mode: row.9,
        created_at: row.10,
        updated_at: row.11,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_should_store_decomposed() {
        assert!(should_store(1));
        assert!(should_store(50));
    }

    #[test]
    fn test_should_not_store_simple() {
        assert!(!should_store(0));
    }
}
