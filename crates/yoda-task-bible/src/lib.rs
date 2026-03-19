//! # YODA Task Bible
//!
//! Persistent, auditable record of every decomposition, assignment, and review.
//! Ronin code blocks are nested inline as JSONB on the task record.
//!
//! Activates automatically when a query decomposes into sub-tasks
//! (same trigger as knowledge base storage).
//!
//! Optional Maestro ERP bridge for construction document management.
//!
//! Copyright (c) 2026 Capomastro Holdings Ltd. — Applied Physics Division

pub mod crud;
pub mod maestro;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use yoda_orchestrator::CodeBlock;
use yoda_plenumnet_bridge::signing::Signature;

/// A complete Task Bible entry with inline code blocks and signature chain.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskBibleEntry {
    pub id: Uuid,
    pub task_id: Uuid,
    pub task_number: String,
    pub title: String,
    pub competencies: Vec<String>,
    pub dependencies: Vec<String>,
    /// All four result versions (Result 1, 2, 3, Final).
    pub results: Vec<serde_json::Value>,
    /// All nine review assessments.
    pub reviews: Vec<serde_json::Value>,
    pub final_output: String,
    /// Ronin mode: inline code blocks. Yoda mode: empty vec.
    pub code_blocks: Vec<CodeBlock>,
    pub tl_dsa_signature: Option<Signature>,
    pub signature_chain: Vec<Signature>,
    pub timestamps: Vec<serde_json::Value>,
}
