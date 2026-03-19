//! # YODA Knowledge Base
//!
//! Per-user cumulative intelligence derived from past projects and queries.
//!
//! Storage rule: decomposed = saved, not decomposed = throwaway. No ambiguity.
//!
//! Copyright (c) 2026 Capomastro Holdings Ltd. — Applied Physics Division

pub mod context;
pub mod embedding;
pub mod retention;
pub mod search;
pub mod storage;
pub mod tagging;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A knowledge base entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KBEntry {
    pub id: Uuid,
    pub project_id: Uuid,
    pub content: String,
    pub summary: String,
    pub tags: Vec<String>,
    pub archived: bool,
    pub pinned: bool,
    pub boost_score: f64,
    pub source_task_id: Option<Uuid>,
    pub source_mode: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Search filters for knowledge base queries.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SearchFilters {
    pub query: Option<String>,
    pub project_id: Option<Uuid>,
    pub tags: Option<Vec<String>>,
    pub archived: Option<bool>,
    pub pinned: Option<bool>,
    pub mode: Option<String>,
    pub date_from: Option<DateTime<Utc>>,
    pub date_to: Option<DateTime<Utc>>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// A search result with relevance score.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub entry: KBEntry,
    pub relevance_score: f64,
    pub match_source: MatchSource,
}

/// How this result was matched.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchSource {
    /// BM25 keyword match (pg_trgm).
    Keyword,
    /// Vector similarity match (pgvector).
    Semantic,
    /// Combined keyword + semantic.
    Hybrid,
    /// Pinned entry (always included).
    Pinned,
}
