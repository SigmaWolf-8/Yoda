//! # YODA Orchestrator
//!
//! DAG execution engine with hierarchical task decomposition, four-step
//! adversarial refinement protocol, parallel execution, and assembly.
//!
//! Core responsibilities:
//! - Task decomposition (query → hierarchical task tree)
//! - Hierarchical numbering (1.1.1.1)
//! - DAG construction, cycle detection, topological sort
//! - Parallel execution with dependency resolution
//! - Four-step adversarial refinement (13 inference calls per task at Full)
//! - Assembly: Yoda (reports) and Ronin (reports + code blocks)
//! - Mode promotion (Yoda→Ronin) and escalation (Ronin→Yoda)
//! - Agent config loading and role assignment
//!
//! Copyright (c) 2026 Capomastro Holdings Ltd. — Applied Physics Division

pub mod agent;
pub mod assembly;
pub mod dag;
pub mod decomposer;
pub mod protocol;
pub mod state;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// All possible task states in the four-step protocol.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TaskStatus {
    Decomposing,
    Queued,
    Assigned,
    Step1Production,
    Step1Review,
    Step2Production,
    Step2Review,
    Step3Production,
    Step3Review,
    Step4FinalOutput,
    Final,
    Escalated,
}

/// Operating mode — determines what Assembly produces.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    /// Research, analysis, strategy documents.
    Yoda,
    /// Same + implementation instructions + compilable code blocks.
    Ronin,
}

/// A single task in the decomposition tree.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: Uuid,
    pub project_id: Uuid,
    /// Hierarchical number: "1.3.2.1"
    pub task_number: String,
    pub title: String,
    pub competencies: Vec<String>,
    pub dependencies: Vec<String>,
    pub status: TaskStatus,
    pub parent_task_id: Option<Uuid>,
    /// Position in global execution order.
    pub workflow_position: Option<i32>,
    pub mode: Mode,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// A code block produced by Ronin mode.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeBlock {
    pub filename: String,
    pub language: String,
    pub content: String,
    pub version: String,
    pub line_count: i32,
}

/// Compiled agent configuration loaded from agents/compiled/*.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub agent_id: String,
    pub display_name: String,
    pub division: String,
    /// Short human-readable prose description of the agent's role.
    #[serde(default)]
    pub description: String,
    pub system_prompt: String,
    pub competencies: Vec<String>,
    pub input_schema: serde_json::Value,
    pub output_schema: serde_json::Value,
    pub review_criteria: Vec<String>,
    pub compatible_reviewers: Vec<String>,
    pub source: String,
    pub license: String,
}
