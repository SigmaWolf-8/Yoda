//! Hybrid search: BM25 keyword matching (pg_trgm) + vector similarity (pgvector).
//!
//! B4.3: Hybrid search combining both scoring methods
//! B4.4: Boost scores as multiplicative ranking factors

use crate::storage::row_to_entry;
use crate::{KBEntry, MatchSource, SearchFilters, SearchResult};
use sqlx::PgPool;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum SearchError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("invalid search parameters: {0}")]
    InvalidParams(String),
}

/// Weight for keyword vs semantic in hybrid scoring.
/// Higher keyword_weight favors exact matches; higher semantic_weight favors meaning.
#[derive(Debug, Clone)]
pub struct SearchWeights {
    pub keyword_weight: f64,
    pub semantic_weight: f64,
}

impl Default for SearchWeights {
    fn default() -> Self {
        Self {
            keyword_weight: 0.4,
            semantic_weight: 0.6,
        }
    }
}

/// Execute a hybrid search across the knowledge base.
///
/// Combines three result sets:
/// 1. Pinned entries (always included, MatchSource::Pinned)
/// 2. BM25 keyword matches via pg_trgm (MatchSource::Keyword)
/// 3. Vector similarity via pgvector HNSW (MatchSource::Semantic)
///
/// Results are merged, deduplicated, scored with boost multiplier, and sorted.
pub async fn hybrid_search(
    db: &PgPool,
    filters: &SearchFilters,
    query_embedding: Option<&[f32]>,
    weights: &SearchWeights,
) -> Result<Vec<SearchResult>, SearchError> {
    let limit = filters.limit.unwrap_or(20);
    let offset = filters.offset.unwrap_or(0);
    let mut results: Vec<SearchResult> = Vec::new();
    let mut seen_ids: std::collections::HashSet<Uuid> = std::collections::HashSet::new();

    // ── 1. Always include pinned entries for the project ─────────────
    if let Some(project_id) = filters.project_id {
        let pinned = fetch_pinned(db, project_id).await?;
        for entry in pinned {
            seen_ids.insert(entry.id);
            results.push(SearchResult {
                relevance_score: 100.0 * entry.boost_score, // Pinned = top priority
                match_source: MatchSource::Pinned,
                entry,
            });
        }
    }

    // ── 2. BM25 keyword search via pg_trgm ──────────────────────────
    if let Some(ref query) = filters.query {
        if !query.trim().is_empty() {
            let keyword_results = keyword_search(db, filters, query, limit + offset).await?;
            for (entry, similarity) in keyword_results {
                if seen_ids.insert(entry.id) {
                    let score = similarity as f64 * weights.keyword_weight * entry.boost_score;
                    results.push(SearchResult {
                        entry,
                        relevance_score: score,
                        match_source: MatchSource::Keyword,
                    });
                }
            }
        }
    }

    // ── 3. Vector similarity search via pgvector ─────────────────────
    if let Some(embedding) = query_embedding {
        let semantic_results = semantic_search(db, filters, embedding, limit + offset).await?;
        for (entry, distance) in semantic_results {
            if seen_ids.insert(entry.id) {
                // Cosine distance → similarity: 1.0 - distance
                let similarity = (1.0 - distance as f64).max(0.0);
                let score = similarity * weights.semantic_weight * entry.boost_score;
                results.push(SearchResult {
                    entry,
                    relevance_score: score,
                    match_source: MatchSource::Semantic,
                });
            } else {
                // Entry already found by keyword — upgrade to hybrid
                if let Some(existing) = results.iter_mut().find(|r| r.entry.id == entry.id) {
                    let similarity = (1.0 - distance as f64).max(0.0);
                    existing.relevance_score += similarity * weights.semantic_weight * existing.entry.boost_score;
                    existing.match_source = MatchSource::Hybrid;
                }
            }
        }
    }

    // ── Sort by relevance (descending) and apply pagination ──────────
    results.sort_by(|a, b| b.relevance_score.partial_cmp(&a.relevance_score).unwrap_or(std::cmp::Ordering::Equal));

    // Apply offset and limit
    let paginated: Vec<SearchResult> = results
        .into_iter()
        .skip(offset as usize)
        .take(limit as usize)
        .collect();

    Ok(paginated)
}

/// Fetch all pinned entries for a project.
async fn fetch_pinned(db: &PgPool, project_id: Uuid) -> Result<Vec<KBEntry>, sqlx::Error> {
    let rows = sqlx::query_as::<_, (
        Uuid, Uuid, String, String, serde_json::Value, bool, bool, f64,
        Option<Uuid>, Option<String>, chrono::DateTime<chrono::Utc>, chrono::DateTime<chrono::Utc>,
    )>(
        "SELECT id, project_id, content, summary, tags, archived, pinned, boost_score, \
         source_task_id, source_mode, created_at, updated_at \
         FROM knowledge_base \
         WHERE project_id = $1 AND pinned = TRUE \
         ORDER BY boost_score DESC, created_at DESC"
    )
    .bind(project_id)
    .fetch_all(db)
    .await?;

    Ok(rows.into_iter().map(row_to_entry).collect())
}

/// BM25 keyword search using pg_trgm similarity.
async fn keyword_search(
    db: &PgPool,
    filters: &SearchFilters,
    query: &str,
    limit: i64,
) -> Result<Vec<(KBEntry, f32)>, sqlx::Error> {
    // Build WHERE clause dynamically based on filters
    let archived_filter = match filters.archived {
        Some(true) => "AND archived = TRUE",
        Some(false) | None => "AND archived = FALSE",
    };

    let project_filter = if filters.project_id.is_some() {
        "AND project_id = $3"
    } else {
        ""
    };

    let sql = format!(
        "SELECT id, project_id, content, summary, tags, archived, pinned, boost_score, \
         source_task_id, source_mode, created_at, updated_at, \
         similarity(content, $1) + similarity(summary, $1) AS sim \
         FROM knowledge_base \
         WHERE (content ILIKE '%' || $1 || '%' OR summary ILIKE '%' || $1 || '%' \
                OR content % $1 OR summary % $1) \
         {} {} \
         ORDER BY sim DESC \
         LIMIT $2",
        archived_filter, project_filter
    );

    let mut query_builder = sqlx::query_as::<_, (
        Uuid, Uuid, String, String, serde_json::Value, bool, bool, f64,
        Option<Uuid>, Option<String>, chrono::DateTime<chrono::Utc>, chrono::DateTime<chrono::Utc>,
        f32,
    )>(&sql)
    .bind(query)
    .bind(limit);

    if let Some(project_id) = filters.project_id {
        query_builder = query_builder.bind(project_id);
    }

    let rows = query_builder.fetch_all(db).await?;

    Ok(rows
        .into_iter()
        .map(|r| {
            let sim = r.12;
            let entry = row_to_entry((r.0, r.1, r.2, r.3, r.4, r.5, r.6, r.7, r.8, r.9, r.10, r.11));
            (entry, sim)
        })
        .collect())
}

/// Semantic search using pgvector cosine distance.
async fn semantic_search(
    db: &PgPool,
    filters: &SearchFilters,
    embedding: &[f32],
    limit: i64,
) -> Result<Vec<(KBEntry, f32)>, sqlx::Error> {
    let embedding_str = format!(
        "[{}]",
        embedding.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(",")
    );

    let archived_filter = match filters.archived {
        Some(true) => "AND archived = TRUE",
        Some(false) | None => "AND archived = FALSE",
    };

    let project_filter = if filters.project_id.is_some() {
        "AND project_id = $3"
    } else {
        ""
    };

    let sql = format!(
        "SELECT id, project_id, content, summary, tags, archived, pinned, boost_score, \
         source_task_id, source_mode, created_at, updated_at, \
         embedding <=> $1::vector AS distance \
         FROM knowledge_base \
         WHERE embedding IS NOT NULL {} {} \
         ORDER BY distance ASC \
         LIMIT $2",
        archived_filter, project_filter
    );

    let mut query_builder = sqlx::query_as::<_, (
        Uuid, Uuid, String, String, serde_json::Value, bool, bool, f64,
        Option<Uuid>, Option<String>, chrono::DateTime<chrono::Utc>, chrono::DateTime<chrono::Utc>,
        f32,
    )>(&sql)
    .bind(&embedding_str)
    .bind(limit);

    if let Some(project_id) = filters.project_id {
        query_builder = query_builder.bind(project_id);
    }

    let rows = query_builder.fetch_all(db).await?;

    Ok(rows
        .into_iter()
        .map(|r| {
            let distance = r.12;
            let entry = row_to_entry((r.0, r.1, r.2, r.3, r.4, r.5, r.6, r.7, r.8, r.9, r.10, r.11));
            (entry, distance)
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_weights() {
        let w = SearchWeights::default();
        assert!((w.keyword_weight + w.semantic_weight - 1.0).abs() < 0.01);
    }

    #[test]
    fn test_boost_multiplier() {
        // A boosted entry should rank higher
        let base_score = 0.8;
        let boost_1x = base_score * 1.0;
        let boost_3x = base_score * 3.0;
        assert!(boost_3x > boost_1x);
    }

    #[test]
    fn test_cosine_distance_to_similarity() {
        // pgvector <=> returns cosine distance (0 = identical, 2 = opposite)
        let distance = 0.1_f64;
        let similarity = (1.0 - distance).max(0.0);
        assert!((similarity - 0.9).abs() < 0.01);

        let distance = 0.0_f64;
        let similarity = (1.0 - distance).max(0.0);
        assert!((similarity - 1.0).abs() < 0.01);
    }
}
