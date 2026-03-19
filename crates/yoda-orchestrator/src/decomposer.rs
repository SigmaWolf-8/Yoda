//! Task decomposition: query → hierarchical task tree.
//!
//! B3.1: Decompose query into tasks with numbered hierarchy (1.1.1.1)
//! B3.2: Decomposition budget (default 30, configurable, disableable)
//! B3.3: Task merging for repetitive patterns (template once, replicate)

use crate::{AgentConfig, Mode, Task, TaskStatus};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;
use yoda_inference_router::dispatch::call_engine;
use yoda_inference_router::EngineConfig;

#[derive(Debug, Error)]
pub enum DecomposeError {
    #[error("budget exceeded: {proposed} tasks proposed, budget is {budget}")]
    BudgetExceeded { proposed: usize, budget: usize },
    #[error("decomposition produced no tasks")]
    EmptyDecomposition,
    #[error("inference error during decomposition: {0}")]
    InferenceError(String),
    #[error("failed to parse decomposition response: {0}")]
    ParseError(String),
}

/// Configuration for the decomposer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecomposeConfig {
    /// Maximum atomic tasks per decomposition. 0 = unlimited.
    pub budget: usize,
    /// Enable task merging for repetitive patterns.
    pub enable_merging: bool,
}

impl Default for DecomposeConfig {
    fn default() -> Self {
        Self { budget: 30, enable_merging: true }
    }
}

/// A proposed task in the decomposition tree (before DB persistence).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProposedTask {
    pub task_number: String,
    pub title: String,
    pub competencies: Vec<String>,
    pub dependencies: Vec<String>,
    pub parent_number: Option<String>,
    /// If this task was merged from a template, the template ID.
    pub template_id: Option<String>,
}

/// Result of decomposition — the full proposed task tree.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecompositionResult {
    pub tasks: Vec<ProposedTask>,
    pub merged_templates: Vec<MergedTemplate>,
    pub budget_used: usize,
    pub budget_limit: usize,
    pub budget_exceeded: bool,
}

/// A merged template: one reviewed task replicated with variable substitution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergedTemplate {
    pub template_id: String,
    pub base_title: String,
    pub variables: Vec<String>,
    pub instance_count: usize,
}

/// Decompose a user query into a hierarchical task tree via inference.
pub async fn decompose_query(
    client: &reqwest::Client,
    engine: &EngineConfig,
    orchestrator_agent: &AgentConfig,
    query: &str,
    project_id: Uuid,
    mode: Mode,
    config: &DecomposeConfig,
) -> Result<DecompositionResult, DecomposeError> {
    let prompt = build_decomposition_prompt(query, mode, config);

    let response = call_engine(client, engine, &orchestrator_agent.system_prompt, &prompt, None)
        .await
        .map_err(|e| DecomposeError::InferenceError(e.to_string()))?;

    let mut tasks = parse_decomposition(&response.content)?;
    if tasks.is_empty() {
        return Err(DecomposeError::EmptyDecomposition);
    }

    // Apply task merging (B3.3)
    let merged_templates = if config.enable_merging {
        detect_and_merge_patterns(&mut tasks)
    } else {
        Vec::new()
    };

    let budget_exceeded = config.budget > 0 && tasks.len() > config.budget;

    Ok(DecompositionResult {
        budget_used: tasks.len(),
        budget_limit: config.budget,
        budget_exceeded,
        tasks,
        merged_templates,
    })
}

/// Simple decomposition without inference — query becomes one atomic task.
pub fn decompose_simple(query: &str, _project_id: Uuid, _mode: Mode) -> Vec<ProposedTask> {
    vec![ProposedTask {
        task_number: "1".to_string(),
        title: query.to_string(),
        competencies: infer_competencies(query),
        dependencies: vec![],
        parent_number: None,
        template_id: None,
    }]
}

/// Convert proposed tasks into real Task structs for DB persistence.
pub fn materialize_tasks(proposed: &[ProposedTask], project_id: Uuid, mode: Mode) -> Vec<Task> {
    proposed.iter().enumerate().map(|(i, p)| Task {
        id: Uuid::new_v4(),
        project_id,
        task_number: p.task_number.clone(),
        title: p.title.clone(),
        competencies: p.competencies.clone(),
        dependencies: p.dependencies.clone(),
        status: TaskStatus::Queued,
        parent_task_id: None,
        workflow_position: Some(i as i32 + 1),
        mode,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }).collect()
}

fn build_decomposition_prompt(query: &str, mode: Mode, config: &DecomposeConfig) -> String {
    let mode_str = match mode {
        Mode::Yoda => "research, analysis, and strategic recommendations",
        Mode::Ronin => "implementation instructions with compilable code blocks",
    };
    let budget_str = if config.budget > 0 {
        format!("Generate at most {} atomic tasks.", config.budget)
    } else {
        "No task limit — generate as many tasks as needed.".into()
    };

    format!(
        "## Decomposition Request\n\n\
         Decompose the following query into a hierarchical task tree for {mode_str}.\n\n\
         ### Query\n{query}\n\n\
         ### Instructions\n\
         - Use hierarchical numbering: 1, 1.1, 1.1.1, 1.1.1.1 (unlimited depth)\n\
         - Each leaf task must be atomic — executable by a single agent in one step\n\
         - Assign competency tags to each task\n\
         - Specify dependencies between tasks using task numbers\n\
         - {budget_str}\n\
         - If you detect repetitive patterns, note them for merging\n\n\
         ### Required Response Format\n\
         Respond ONLY with a JSON array of task objects:\n\
         [{{\"task_number\": \"1\", \"title\": \"...\", \"competencies\": [\"...\"], \
         \"dependencies\": [], \"parent_number\": null}}]\n"
    )
}

fn parse_decomposition(content: &str) -> Result<Vec<ProposedTask>, DecomposeError> {
    // Try direct JSON parse
    if let Ok(tasks) = serde_json::from_str::<Vec<ProposedTask>>(content) {
        return Ok(tasks);
    }
    // Try extracting JSON from mixed content
    if let Some(start) = content.find('[') {
        if let Some(end) = content.rfind(']') {
            let json_str = &content[start..=end];
            if let Ok(tasks) = serde_json::from_str::<Vec<ProposedTask>>(json_str) {
                return Ok(tasks);
            }
        }
    }
    // Single task object fallback
    if let Ok(task) = serde_json::from_str::<ProposedTask>(content) {
        return Ok(vec![task]);
    }
    Err(DecomposeError::ParseError("Could not extract task list from response".into()))
}

/// Detect structurally identical tasks and mark them with template IDs.
fn detect_and_merge_patterns(tasks: &mut Vec<ProposedTask>) -> Vec<MergedTemplate> {
    let mut templates = Vec::new();
    let mut pattern_groups: std::collections::HashMap<String, Vec<usize>> =
        std::collections::HashMap::new();

    for (i, task) in tasks.iter().enumerate() {
        let pattern = normalize_title_pattern(&task.title);
        pattern_groups.entry(pattern).or_default().push(i);
    }

    for (pattern, indices) in &pattern_groups {
        if indices.len() >= 3 {
            let template_id = format!("tpl_{}", Uuid::new_v4().to_string()[..8].to_string());
            let variables: Vec<String> = indices.iter()
                .map(|&i| extract_variable(&tasks[i].title))
                .collect();

            templates.push(MergedTemplate {
                template_id: template_id.clone(),
                base_title: pattern.clone(),
                variables: variables.clone(),
                instance_count: indices.len(),
            });
            for &idx in indices {
                tasks[idx].template_id = Some(template_id.clone());
            }
        }
    }
    templates
}

fn normalize_title_pattern(title: &str) -> String {
    let words: Vec<&str> = title.split_whitespace().collect();
    if words.len() <= 2 { return title.to_lowercase(); }
    let mut p = words[..words.len() - 1].to_vec();
    p.push("{var}");
    p.join(" ").to_lowercase()
}

fn extract_variable(title: &str) -> String {
    title.split_whitespace().last().unwrap_or(title).to_string()
}

fn infer_competencies(query: &str) -> Vec<String> {
    let lower = query.to_lowercase();
    let mut comps = Vec::new();
    let checks: &[(&str, &str)] = &[
        ("api", "api-design"), ("rest", "rest-api"), ("database", "database"),
        ("postgres", "postgresql"), ("react", "react"), ("frontend", "frontend"),
        ("rust", "rust"), ("python", "python"), ("typescript", "typescript"),
        ("security", "security"), ("auth", "authentication"), ("test", "testing"),
        ("deploy", "devops"), ("docker", "docker"), ("webhook", "backend"),
        ("retry", "backend"), ("queue", "backend"), ("encrypt", "cryptography"),
        ("plenumnet", "plenumnet"), ("tl-dsa", "tl-dsa"), ("tis-27", "tis-27"),
    ];
    for (kw, tag) in checks {
        if lower.contains(kw) && !comps.contains(&tag.to_string()) {
            comps.push(tag.to_string());
        }
    }
    if comps.is_empty() { comps.push("general".into()); }
    comps
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decompose_simple() {
        let tasks = decompose_simple("Build a REST API", Uuid::new_v4(), Mode::Ronin);
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].task_number, "1");
        assert!(tasks[0].competencies.contains(&"rest-api".to_string()));
    }

    #[test]
    fn test_parse_json_array() {
        let json = r#"[{"task_number":"1","title":"Setup","competencies":["rust"],"dependencies":[],"parent_number":null}]"#;
        let tasks = parse_decomposition(json).unwrap();
        assert_eq!(tasks.len(), 1);
    }

    #[test]
    fn test_parse_embedded_json() {
        let content = "Here:\n\n```json\n[{\"task_number\":\"1\",\"title\":\"T\",\"competencies\":[],\"dependencies\":[],\"parent_number\":null}]\n```";
        assert!(parse_decomposition(content).is_ok());
    }

    #[test]
    fn test_parse_failure() {
        assert!(parse_decomposition("No tasks.").is_err());
    }

    #[test]
    fn test_materialize() {
        let proposed = vec![ProposedTask {
            task_number: "1".into(), title: "A".into(), competencies: vec!["rust".into()],
            dependencies: vec![], parent_number: None, template_id: None,
        }];
        let tasks = materialize_tasks(&proposed, Uuid::new_v4(), Mode::Ronin);
        assert_eq!(tasks[0].status, TaskStatus::Queued);
        assert_eq!(tasks[0].workflow_position, Some(1));
    }

    #[test]
    fn test_merge_patterns() {
        let mut tasks = vec![
            ProposedTask { task_number: "1".into(), title: "Implement CRUD for Users".into(), competencies: vec![], dependencies: vec![], parent_number: None, template_id: None },
            ProposedTask { task_number: "2".into(), title: "Implement CRUD for Products".into(), competencies: vec![], dependencies: vec![], parent_number: None, template_id: None },
            ProposedTask { task_number: "3".into(), title: "Implement CRUD for Orders".into(), competencies: vec![], dependencies: vec![], parent_number: None, template_id: None },
            ProposedTask { task_number: "4".into(), title: "Write docs".into(), competencies: vec![], dependencies: vec![], parent_number: None, template_id: None },
        ];
        let templates = detect_and_merge_patterns(&mut tasks);
        assert_eq!(templates.len(), 1);
        assert_eq!(templates[0].instance_count, 3);
        assert!(tasks[0].template_id.is_some());
        assert!(tasks[3].template_id.is_none());
    }

    #[test]
    fn test_infer_competencies() {
        let c = infer_competencies("Build REST API with PostgreSQL");
        assert!(c.contains(&"rest-api".to_string()));
        assert!(c.contains(&"postgresql".to_string()));
    }
}
