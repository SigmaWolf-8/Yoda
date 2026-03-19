//! Four-step adversarial refinement protocol.
//!
//! B2.2.3: Engine selection with diversity enforcement
//! B2.2.4: Single-task four-step execution loop
//! B2.2.5: TIS-27 hashing on every response
//! B2.2.6: TL-DSA signing on FINAL output
//! B2.2.7: Phase Encryption on stored artifacts
//! B2.2.8: Audit record assembly

use crate::agent::AgentRegistry;
use crate::state::{self, StateTransition};
use crate::{AgentConfig, CodeBlock, Mode, Task, TaskStatus};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;
use yoda_inference_router::dispatch::{call_engine, dispatch_reviews, select_reviewer_count};
use yoda_inference_router::{EngineConfig, EngineSlot, InferenceResponse, ReviewIntensity};

#[derive(Debug, Error)]
pub enum ProtocolError {
    #[error("dispatch error: {0}")]
    Dispatch(#[from] yoda_inference_router::dispatch::DispatchError),
    #[error("state transition error: {0}")]
    State(#[from] state::StateError),
    #[error("no engines configured")]
    NoEngines,
    #[error("insufficient engines for diversity (need {0}, have {1})")]
    InsufficientEngines(usize, usize),
    #[error("agent not found for competencies: {0:?}")]
    AgentNotFound(Vec<String>),
    #[error("task {0} escalated after review disagreement at step {1}")]
    Escalated(Uuid, u8),
}

/// Complete result of running a task through the four-step protocol.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolResult {
    pub task_id: Uuid,
    pub results: Vec<StepResult>,
    pub reviews: Vec<StepReviews>,
    pub final_output: String,
    pub final_tis27_hash: String,
    pub state_transitions: Vec<StateTransition>,
    pub escalated: bool,
    pub escalation_step: Option<u8>,
}

/// Result of a single production step.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepResult {
    pub step: u8,
    pub response: InferenceResponse,
}

/// Reviews for a single step (1-3 reviews depending on intensity).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepReviews {
    pub step: u8,
    pub reviews: Vec<ReviewAssessment>,
    pub all_approved: bool,
}

/// A single reviewer's assessment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewAssessment {
    pub engine_slot: EngineSlot,
    pub agent_role: String,
    pub response: InferenceResponse,
    pub approved: bool,
    pub confidence: f64,
}

/// Execute the complete four-step protocol for a single task.
///
/// Step 1: Produce Result 1, review with N engines
/// Step 2: Incorporate feedback → Result 2, review with N engines
/// Step 3: Incorporate feedback → Result 3, review with N engines
///         If all approve → Step 4. If disagreement → ESCALATE.
/// Step 4: Incorporate final feedback → FINAL RESULT
pub async fn execute_four_step(
    client: &reqwest::Client,
    task: &Task,
    primary_agent: &AgentConfig,
    reviewer_agents: &[&AgentConfig],
    primary_engine: &EngineConfig,
    reviewer_engines: &[&EngineConfig],
    intensity: ReviewIntensity,
) -> Result<ProtocolResult, ProtocolError> {
    let reviewer_count = select_reviewer_count(intensity);
    if reviewer_engines.len() < reviewer_count {
        return Err(ProtocolError::InsufficientEngines(
            reviewer_count,
            reviewer_engines.len(),
        ));
    }

    let mut all_results: Vec<StepResult> = Vec::new();
    let mut all_reviews: Vec<StepReviews> = Vec::new();
    let mut transitions: Vec<StateTransition> = Vec::new();
    let mut accumulated_feedback = String::new();

    // ── Steps 1-3: Production + Review ───────────────────────────────
    for step in 1u8..=3 {
        let prod_status = match step {
            1 => TaskStatus::Step1Production,
            2 => TaskStatus::Step2Production,
            3 => TaskStatus::Step3Production,
            _ => unreachable!(),
        };
        let review_status = match step {
            1 => TaskStatus::Step1Review,
            2 => TaskStatus::Step2Review,
            3 => TaskStatus::Step3Review,
            _ => unreachable!(),
        };

        // Transition to production
        transitions.push(state::transition(
            task.id,
            if step == 1 { TaskStatus::Assigned } else { all_reviews.last().map(|_| match step { 2 => TaskStatus::Step1Review, 3 => TaskStatus::Step2Review, _ => unreachable!() }).unwrap_or(TaskStatus::Assigned) },
            prod_status,
            Some(format!("Step {} production", step)),
        )?);

        // Build production prompt
        let user_content = build_production_prompt(task, &accumulated_feedback, step);

        // Call primary engine
        tracing::info!(task_id = %task.id, step, "Step {} production", step);
        let production_response = call_engine(
            client,
            primary_engine,
            &primary_agent.system_prompt,
            &user_content,
            None,
        )
        .await?;

        all_results.push(StepResult {
            step,
            response: production_response.clone(),
        });

        // Transition to review
        transitions.push(state::transition(
            task.id,
            prod_status,
            review_status,
            Some(format!("Step {} review", step)),
        )?);

        // Dispatch concurrent reviews
        let review_prompts: Vec<String> = reviewer_agents
            .iter()
            .take(reviewer_count)
            .map(|agent| agent.system_prompt.clone())
            .collect();
        let review_prompt_refs: Vec<&str> = review_prompts.iter().map(|s| s.as_str()).collect();

        let review_content = build_review_prompt(
            task,
            &production_response.content,
            step,
            &accumulated_feedback,
        );

        tracing::info!(task_id = %task.id, step, reviewers = reviewer_count, "Step {} review dispatch", step);
        let review_responses = dispatch_reviews(
            client,
            &reviewer_engines[..reviewer_count],
            &review_prompt_refs,
            &review_content,
        )
        .await?;

        // Parse review assessments
        let assessments: Vec<ReviewAssessment> = review_responses
            .into_iter()
            .zip(reviewer_agents.iter())
            .map(|(response, agent)| {
                let (approved, confidence) = parse_review_verdict(&response.content);
                ReviewAssessment {
                    engine_slot: response.engine_slot,
                    agent_role: agent.agent_id.clone(),
                    response,
                    approved,
                    confidence,
                }
            })
            .collect();

        let all_approved = assessments.iter().all(|a| a.approved);

        // Accumulate feedback for next step
        accumulated_feedback = assessments
            .iter()
            .map(|a| format!(
                "[{:?} / {}] Approved: {} | Confidence: {:.2}\n{}",
                a.engine_slot, a.agent_role, a.approved, a.confidence, a.response.content
            ))
            .collect::<Vec<_>>()
            .join("\n\n---\n\n");

        all_reviews.push(StepReviews {
            step,
            reviews: assessments,
            all_approved,
        });

        // Step 3 consensus check
        if step == 3 && !all_approved {
            tracing::warn!(task_id = %task.id, "Step 3 disagreement — ESCALATING");
            transitions.push(state::transition(
                task.id,
                review_status,
                TaskStatus::Escalated,
                Some("Reviewer disagreement at Step 3".into()),
            )?);

            return Ok(ProtocolResult {
                task_id: task.id,
                results: all_results,
                reviews: all_reviews,
                final_output: String::new(),
                final_tis27_hash: String::new(),
                state_transitions: transitions,
                escalated: true,
                escalation_step: Some(3),
            });
        }
    }

    // ── Step 4: Final Output ─────────────────────────────────────────
    transitions.push(state::transition(
        task.id,
        TaskStatus::Step3Review,
        TaskStatus::Step4FinalOutput,
        Some("Step 4 final production".into()),
    )?);

    let final_prompt = build_production_prompt(task, &accumulated_feedback, 4);
    tracing::info!(task_id = %task.id, "Step 4 final production");
    let final_response = call_engine(
        client,
        primary_engine,
        &primary_agent.system_prompt,
        &final_prompt,
        None,
    )
    .await?;

    let final_tis27 = final_response.tis27_hash.clone();
    let final_content = final_response.content.clone();

    all_results.push(StepResult {
        step: 4,
        response: final_response,
    });

    // Transition to FINAL
    transitions.push(state::transition(
        task.id,
        TaskStatus::Step4FinalOutput,
        TaskStatus::Final,
        Some("Four-step protocol complete".into()),
    )?);

    // TL-DSA signing happens at the persistence layer (B2.2.6)
    // Phase Encryption happens at the persistence layer (B2.2.7)
    // Audit record assembly happens at the persistence layer (B2.2.8)

    Ok(ProtocolResult {
        task_id: task.id,
        results: all_results,
        reviews: all_reviews,
        final_output: final_content,
        final_tis27_hash: final_tis27,
        state_transitions: transitions,
        escalated: false,
        escalation_step: None,
    })
}

/// Build the production prompt for a given step.
fn build_production_prompt(task: &Task, prior_feedback: &str, step: u8) -> String {
    let mut prompt = format!(
        "## Task\n\nTask Number: {}\nTitle: {}\nMode: {:?}\n\n## Requirements\n\n{}\n",
        task.task_number, task.title, task.mode, task.title
    );

    if !task.competencies.is_empty() {
        prompt.push_str(&format!(
            "\n## Required Competencies\n\n{}\n",
            task.competencies.join(", ")
        ));
    }

    if step > 1 && !prior_feedback.is_empty() {
        prompt.push_str(&format!(
            "\n## Feedback from Step {} Reviews\n\n\
             Incorporate ALL of the following feedback into your revised output. \
             Address every issue raised. Preserve improvements from prior versions.\n\n{}\n",
            step - 1,
            prior_feedback
        ));
    }

    if step == 4 {
        prompt.push_str(
            "\n## Final Output\n\n\
             This is the FINAL production step. Incorporate all feedback from the three \
             prior review cycles. This output will be signed and stored permanently.\n"
        );
    }

    prompt
}

/// Build the review prompt for evaluating a production result.
fn build_review_prompt(task: &Task, result_content: &str, step: u8, prior_feedback: &str) -> String {
    let mut prompt = format!(
        "## Review Assignment\n\n\
         You are reviewing Step {} output for Task {} ({}).\n\n\
         ## Output to Review\n\n{}\n\n\
         ## Evaluation Criteria\n\n\
         1. Does the output meet the task requirements?\n\
         2. Are there errors, gaps, or vulnerabilities?\n\
         3. Can the response be enriched and improved?\n\
         4. Did the producer address issues from prior reviews?\n",
        step, task.task_number, task.title, result_content
    );

    if step > 1 && !prior_feedback.is_empty() {
        prompt.push_str(&format!(
            "\n## Prior Review Feedback (for context)\n\n{}\n",
            prior_feedback
        ));
    }

    prompt.push_str(
        "\n## Required Response Format\n\n\
         Respond with a JSON object:\n\
         {\n  \
           \"approved\": true/false,\n  \
           \"confidence\": 0.0-1.0,\n  \
           \"issues\": [{\"description\": \"...\", \"severity\": \"critical|major|minor\"}],\n  \
           \"suggestions\": [\"...\"],\n  \
           \"enrichments\": [\"...\"]\n\
         }\n"
    );

    prompt
}

/// Parse a reviewer's verdict from their response content.
/// Attempts JSON parsing first, falls back to heuristic.
fn parse_review_verdict(content: &str) -> (bool, f64) {
    // Try JSON parsing
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(content) {
        let approved = value.get("approved").and_then(|v| v.as_bool()).unwrap_or(false);
        let confidence = value.get("confidence").and_then(|v| v.as_f64()).unwrap_or(0.5);
        return (approved, confidence);
    }

    // Try extracting JSON from markdown code blocks
    if let Some(json_start) = content.find('{') {
        if let Some(json_end) = content.rfind('}') {
            let json_str = &content[json_start..=json_end];
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(json_str) {
                let approved = value.get("approved").and_then(|v| v.as_bool()).unwrap_or(false);
                let confidence = value.get("confidence").and_then(|v| v.as_f64()).unwrap_or(0.5);
                return (approved, confidence);
            }
        }
    }

    // Heuristic fallback: look for approval signals in text
    let lower = content.to_lowercase();
    let approved = lower.contains("approved") || lower.contains("looks good") || lower.contains("no issues");
    let confidence = if approved { 0.7 } else { 0.3 };
    (approved, confidence)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_verdict_json() {
        let content = r#"{"approved": true, "confidence": 0.92, "issues": []}"#;
        let (approved, confidence) = parse_review_verdict(content);
        assert!(approved);
        assert!((confidence - 0.92).abs() < 0.01);
    }

    #[test]
    fn test_parse_verdict_json_in_markdown() {
        let content = "Here is my review:\n\n```json\n{\"approved\": false, \"confidence\": 0.4}\n```";
        let (approved, confidence) = parse_review_verdict(content);
        assert!(!approved);
        assert!((confidence - 0.4).abs() < 0.01);
    }

    #[test]
    fn test_parse_verdict_heuristic() {
        let (approved, _) = parse_review_verdict("This looks good. Approved with minor suggestions.");
        assert!(approved);

        let (approved, _) = parse_review_verdict("Several critical issues found. Needs revision.");
        assert!(!approved);
    }

    #[test]
    fn test_build_production_prompt_step1() {
        let task = Task {
            id: Uuid::new_v4(),
            project_id: Uuid::new_v4(),
            task_number: "1.1.1".into(),
            title: "Implement retry logic".into(),
            competencies: vec!["rust".into(), "backend".into()],
            dependencies: vec![],
            status: TaskStatus::Assigned,
            parent_task_id: None,
            workflow_position: Some(1),
            mode: Mode::Ronin,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };
        let prompt = build_production_prompt(&task, "", 1);
        assert!(prompt.contains("1.1.1"));
        assert!(prompt.contains("Implement retry logic"));
        assert!(prompt.contains("rust, backend"));
        assert!(!prompt.contains("Feedback")); // No feedback on step 1
    }

    #[test]
    fn test_build_production_prompt_step3_with_feedback() {
        let task = Task {
            id: Uuid::new_v4(), project_id: Uuid::new_v4(),
            task_number: "1.1".into(), title: "Build API".into(),
            competencies: vec![], dependencies: vec![],
            status: TaskStatus::Step3Production, parent_task_id: None,
            workflow_position: None, mode: Mode::Yoda,
            created_at: chrono::Utc::now(), updated_at: chrono::Utc::now(),
        };
        let prompt = build_production_prompt(&task, "Fix the error handling", 3);
        assert!(prompt.contains("Feedback from Step 2"));
        assert!(prompt.contains("Fix the error handling"));
    }
}
