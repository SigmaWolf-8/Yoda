//! Assembly: collect FINAL outputs, order by task number, produce mode-specific output.
//!
//! B3.9:  Yoda mode — reports, analysis, recommendations
//! B3.10: Ronin mode — same + implementation instructions + compilable code blocks
//! B3.11: Mode promotion (Yoda→Ronin) and escalation (Ronin→Yoda)

use crate::protocol::ProtocolResult;
use crate::{CodeBlock, Mode, Task};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The assembled output — what the user receives at the end.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssembledOutput {
    pub project_id: Uuid,
    pub mode: Mode,
    /// Ordered task results (by task number).
    pub sections: Vec<AssembledSection>,
    /// Implementation instructions (Ronin only — empty in Yoda mode).
    pub implementation_guide: Option<ImplementationGuide>,
    /// Summary statistics.
    pub stats: AssemblyStats,
}

/// One section of the assembled output, corresponding to one task.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssembledSection {
    pub task_number: String,
    pub title: String,
    pub content: String,
    /// Code blocks (Ronin only — empty vec in Yoda mode).
    pub code_blocks: Vec<CodeBlock>,
    pub status: String,
    /// Whether this task was escalated (human review needed).
    pub escalated: bool,
}

/// Ordered implementation guide for Ronin mode.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImplementationGuide {
    /// Steps ordered by task number with instructions and code.
    pub steps: Vec<ImplementationStep>,
    /// Total files generated.
    pub file_count: usize,
    /// Total lines of code across all code blocks.
    pub total_lines: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImplementationStep {
    pub step_number: usize,
    pub task_number: String,
    pub title: String,
    pub instructions: String,
    pub code_blocks: Vec<CodeBlock>,
    pub dependencies_met: Vec<String>,
}

/// Assembly statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssemblyStats {
    pub total_tasks: usize,
    pub completed_tasks: usize,
    pub escalated_tasks: usize,
    pub total_inference_calls: usize,
    pub total_code_blocks: usize,
    pub total_code_lines: usize,
}

/// Assemble results from completed protocol runs into a final output.
///
/// Yoda mode: sections contain analysis, recommendations, reports.
/// Ronin mode: sections also contain code blocks + an implementation guide.
pub fn assemble(
    project_id: Uuid,
    mode: Mode,
    tasks: &[Task],
    results: &[ProtocolResult],
) -> AssembledOutput {
    // Match results to tasks by task_id
    let mut sections: Vec<AssembledSection> = Vec::new();
    let mut all_code_blocks: Vec<CodeBlock> = Vec::new();
    let mut total_inference_calls = 0;
    let mut escalated_count = 0;

    // Sort tasks by task_number for ordered output
    let mut sorted_tasks = tasks.to_vec();
    sorted_tasks.sort_by(|a, b| {
        compare_task_numbers(&a.task_number, &b.task_number)
    });

    for task in &sorted_tasks {
        let result = results.iter().find(|r| r.task_id == task.id);

        let (content, code_blocks, escalated) = match result {
            Some(r) => {
                total_inference_calls += r.results.len() + r.reviews.iter().map(|sr| sr.reviews.len()).sum::<usize>();

                let code_blocks = if mode == Mode::Ronin {
                    extract_code_blocks(&r.final_output)
                } else {
                    Vec::new()
                };
                all_code_blocks.extend(code_blocks.clone());

                (r.final_output.clone(), code_blocks, r.escalated)
            }
            None => {
                // Task not yet processed or missing result
                (String::new(), Vec::new(), false)
            }
        };

        if escalated {
            escalated_count += 1;
        }

        sections.push(AssembledSection {
            task_number: task.task_number.clone(),
            title: task.title.clone(),
            content,
            code_blocks,
            status: if escalated { "ESCALATED".into() } else { "FINAL".into() },
            escalated,
        });
    }

    // Build implementation guide for Ronin mode (B3.10)
    let implementation_guide = if mode == Mode::Ronin {
        Some(build_implementation_guide(&sections))
    } else {
        None
    };

    let total_code_lines: usize = all_code_blocks.iter().map(|cb| cb.line_count as usize).sum();

    AssembledOutput {
        project_id,
        mode,
        sections,
        implementation_guide,
        stats: AssemblyStats {
            total_tasks: sorted_tasks.len(),
            completed_tasks: sorted_tasks.len() - escalated_count,
            escalated_tasks: escalated_count,
            total_inference_calls,
            total_code_blocks: all_code_blocks.len(),
            total_code_lines,
        },
    }
}

/// Build an ordered implementation guide from assembled sections.
fn build_implementation_guide(sections: &[AssembledSection]) -> ImplementationGuide {
    let mut steps: Vec<ImplementationStep> = Vec::new();
    let mut file_count = 0;
    let mut total_lines = 0;

    for (i, section) in sections.iter().enumerate() {
        if section.escalated || section.content.is_empty() {
            continue;
        }

        file_count += section.code_blocks.len();
        total_lines += section.code_blocks.iter().map(|cb| cb.line_count as usize).sum::<usize>();

        steps.push(ImplementationStep {
            step_number: i + 1,
            task_number: section.task_number.clone(),
            title: section.title.clone(),
            instructions: section.content.clone(),
            code_blocks: section.code_blocks.clone(),
            dependencies_met: vec![], // Populated from DAG info if available
        });
    }

    ImplementationGuide { steps, file_count, total_lines }
}

/// Extract code blocks from a result string.
/// Looks for markdown fenced code blocks: ```lang\n...\n```
fn extract_code_blocks(content: &str) -> Vec<CodeBlock> {
    let mut blocks = Vec::new();
    let mut in_block = false;
    let mut current_lang = String::new();
    let mut current_content = String::new();
    let mut block_index = 0;

    for line in content.lines() {
        if line.starts_with("```") && !in_block {
            // Start of code block
            in_block = true;
            current_lang = line.trim_start_matches('`').trim().to_string();
            current_content.clear();
        } else if line.starts_with("```") && in_block {
            // End of code block
            in_block = false;
            if !current_content.is_empty() {
                let line_count = current_content.lines().count() as i32;
                let language = if current_lang.is_empty() {
                    "text".into()
                } else {
                    current_lang.clone()
                };
                let filename = infer_filename(block_index, &language, &current_content);

                blocks.push(CodeBlock {
                    filename,
                    language,
                    content: current_content.clone(),
                    version: "final".into(),
                    line_count,
                });
                block_index += 1;
            }
        } else if in_block {
            if !current_content.is_empty() {
                current_content.push('\n');
            }
            current_content.push_str(line);
        }
    }

    blocks
}

/// Infer a filename from the language and content of a code block.
fn infer_filename(index: usize, language: &str, content: &str) -> String {
    // Try to extract from common patterns like "// filename: X" or "# filename: X"
    for line in content.lines().take(3) {
        let trimmed = line.trim();
        if let Some(name) = trimmed.strip_prefix("// ")
            .or_else(|| trimmed.strip_prefix("# "))
            .or_else(|| trimmed.strip_prefix("-- "))
        {
            if let Some(fname) = name.strip_prefix("filename:").or_else(|| name.strip_prefix("file:")) {
                return fname.trim().to_string();
            }
        }
    }

    // Default: generate from language
    let ext = match language {
        "rust" | "rs" => "rs",
        "python" | "py" => "py",
        "typescript" | "ts" => "ts",
        "javascript" | "js" => "js",
        "sql" => "sql",
        "toml" => "toml",
        "yaml" | "yml" => "yaml",
        "json" => "json",
        "bash" | "sh" => "sh",
        "html" => "html",
        "css" => "css",
        _ => "txt",
    };
    format!("block_{}.{}", index, ext)
}

// ─── Mode Promotion / Escalation (B3.11) ─────────────────────────────

/// Promote a Yoda project to Ronin mode.
/// All existing context is preserved — mode just changes what Assembly produces.
pub fn promote_to_ronin(project_mode: &mut Mode) -> bool {
    if *project_mode == Mode::Yoda {
        *project_mode = Mode::Ronin;
        true
    } else {
        false // already Ronin
    }
}

/// Escalate a Ronin task back to Yoda mode for analysis.
/// Returns a new Mode::Yoda task scope without changing the project mode.
pub fn escalate_to_yoda(task_title: &str, constraint: &str) -> (Mode, String) {
    let analysis_title = format!(
        "Analyze technical constraint for '{}': {}",
        task_title, constraint
    );
    (Mode::Yoda, analysis_title)
}

// ─── Task Number Comparison ──────────────────────────────────────────

/// Compare hierarchical task numbers for sorting: "1.2.3" < "1.10.1" < "2.1"
fn compare_task_numbers(a: &str, b: &str) -> std::cmp::Ordering {
    let a_parts: Vec<u32> = a.split('.').filter_map(|p| p.parse().ok()).collect();
    let b_parts: Vec<u32> = b.split('.').filter_map(|p| p.parse().ok()).collect();

    for (ap, bp) in a_parts.iter().zip(b_parts.iter()) {
        match ap.cmp(bp) {
            std::cmp::Ordering::Equal => continue,
            other => return other,
        }
    }
    a_parts.len().cmp(&b_parts.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::TaskStatus;
    use chrono::Utc;

    #[test]
    fn test_compare_task_numbers() {
        assert_eq!(compare_task_numbers("1", "2"), std::cmp::Ordering::Less);
        assert_eq!(compare_task_numbers("1.1", "1.2"), std::cmp::Ordering::Less);
        assert_eq!(compare_task_numbers("1.2.3", "1.10.1"), std::cmp::Ordering::Less);
        assert_eq!(compare_task_numbers("2", "1.1.1"), std::cmp::Ordering::Greater);
        assert_eq!(compare_task_numbers("1.1", "1.1"), std::cmp::Ordering::Equal);
        assert_eq!(compare_task_numbers("1", "1.1"), std::cmp::Ordering::Less);
    }

    #[test]
    fn test_extract_code_blocks() {
        let content = "Here is the code:\n\n```rust\nfn main() {\n    println!(\"hello\");\n}\n```\n\nAnd some SQL:\n\n```sql\nSELECT * FROM users;\n```\n";
        let blocks = extract_code_blocks(content);
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0].language, "rust");
        assert_eq!(blocks[0].line_count, 3);
        assert_eq!(blocks[1].language, "sql");
        assert_eq!(blocks[1].line_count, 1);
    }

    #[test]
    fn test_extract_code_blocks_with_filename() {
        let content = "```rust\n// filename: webhook_retry.rs\npub fn retry() {}\n```";
        let blocks = extract_code_blocks(content);
        assert_eq!(blocks[0].filename, "webhook_retry.rs");
    }

    #[test]
    fn test_extract_code_blocks_empty() {
        let blocks = extract_code_blocks("No code here, just text.");
        assert!(blocks.is_empty());
    }

    #[test]
    fn test_promote_to_ronin() {
        let mut mode = Mode::Yoda;
        assert!(promote_to_ronin(&mut mode));
        assert_eq!(mode, Mode::Ronin);

        // Already Ronin — no change
        assert!(!promote_to_ronin(&mut mode));
    }

    #[test]
    fn test_escalate_to_yoda() {
        let (mode, title) = escalate_to_yoda("Build webhook", "Rate limiting constraint");
        assert_eq!(mode, Mode::Yoda);
        assert!(title.contains("webhook"));
        assert!(title.contains("Rate limiting"));
    }

    #[test]
    fn test_assemble_yoda_mode() {
        let project_id = Uuid::new_v4();
        let task = Task {
            id: Uuid::new_v4(), project_id, task_number: "1".into(),
            title: "Research competitors".into(), competencies: vec![],
            dependencies: vec![], status: TaskStatus::Final, parent_task_id: None,
            workflow_position: Some(1), mode: Mode::Yoda,
            created_at: Utc::now(), updated_at: Utc::now(),
        };
        let result = ProtocolResult {
            task_id: task.id,
            results: vec![],
            reviews: vec![],
            final_output: "Competitor analysis shows...".into(),
            final_tis27_hash: "abc123".into(),
            state_transitions: vec![],
            escalated: false,
            escalation_step: None,
        };

        let output = assemble(project_id, Mode::Yoda, &[task], &[result]);
        assert_eq!(output.sections.len(), 1);
        assert_eq!(output.sections[0].content, "Competitor analysis shows...");
        assert!(output.sections[0].code_blocks.is_empty()); // Yoda = no code
        assert!(output.implementation_guide.is_none()); // Yoda = no guide
    }

    #[test]
    fn test_assemble_ronin_mode() {
        let project_id = Uuid::new_v4();
        let task = Task {
            id: Uuid::new_v4(), project_id, task_number: "1".into(),
            title: "Build retry logic".into(), competencies: vec![],
            dependencies: vec![], status: TaskStatus::Final, parent_task_id: None,
            workflow_position: Some(1), mode: Mode::Ronin,
            created_at: Utc::now(), updated_at: Utc::now(),
        };
        let result = ProtocolResult {
            task_id: task.id,
            results: vec![],
            reviews: vec![],
            final_output: "Implement retry:\n\n```rust\npub fn retry() {\n    // backoff\n}\n```\n".into(),
            final_tis27_hash: "def456".into(),
            state_transitions: vec![],
            escalated: false,
            escalation_step: None,
        };

        let output = assemble(project_id, Mode::Ronin, &[task], &[result]);
        assert_eq!(output.sections.len(), 1);
        assert_eq!(output.sections[0].code_blocks.len(), 1);
        assert_eq!(output.sections[0].code_blocks[0].language, "rust");
        assert!(output.implementation_guide.is_some());
        let guide = output.implementation_guide.unwrap();
        assert_eq!(guide.steps.len(), 1);
        assert_eq!(guide.file_count, 1);
    }

    #[test]
    fn test_infer_filename() {
        assert_eq!(infer_filename(0, "rust", "fn main() {}"), "block_0.rs");
        assert_eq!(infer_filename(1, "python", "import os"), "block_1.py");
        assert_eq!(infer_filename(0, "typescript", "const x = 1"), "block_0.ts");
    }
}
