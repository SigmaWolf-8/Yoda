//! Task state machine — all 11 states with validated transitions.
//!
//! B2.1.1: TaskStatus enum
//! B2.1.2: State transition logic with timestamp logging

use crate::TaskStatus;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum StateError {
    #[error("invalid transition: {0:?} → {1:?} for task {2}")]
    InvalidTransition(TaskStatus, TaskStatus, Uuid),
    #[error("task {0} is in terminal state {1:?}")]
    TerminalState(Uuid, TaskStatus),
}

/// Record of a single state transition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateTransition {
    pub task_id: Uuid,
    pub from_state: TaskStatus,
    pub to_state: TaskStatus,
    pub timestamp: DateTime<Utc>,
    pub reason: Option<String>,
}

/// Validate that a state transition is legal.
pub fn validate_transition(
    task_id: Uuid,
    from: TaskStatus,
    to: TaskStatus,
) -> Result<(), StateError> {
    // Terminal states cannot transition
    if matches!(from, TaskStatus::Final | TaskStatus::Escalated) {
        return Err(StateError::TerminalState(task_id, from));
    }

    let valid = match from {
        TaskStatus::Decomposing => matches!(to, TaskStatus::Queued),
        TaskStatus::Queued => matches!(to, TaskStatus::Assigned),
        TaskStatus::Assigned => matches!(to, TaskStatus::Step1Production),
        TaskStatus::Step1Production => matches!(to, TaskStatus::Step1Review),
        TaskStatus::Step1Review => matches!(to, TaskStatus::Step2Production | TaskStatus::Escalated),
        TaskStatus::Step2Production => matches!(to, TaskStatus::Step2Review),
        TaskStatus::Step2Review => matches!(to, TaskStatus::Step3Production | TaskStatus::Escalated),
        TaskStatus::Step3Production => matches!(to, TaskStatus::Step3Review),
        TaskStatus::Step3Review => matches!(to, TaskStatus::Step4FinalOutput | TaskStatus::Escalated),
        TaskStatus::Step4FinalOutput => matches!(to, TaskStatus::Final),
        TaskStatus::Final | TaskStatus::Escalated => false,
    };

    if valid {
        Ok(())
    } else {
        Err(StateError::InvalidTransition(from, to, task_id))
    }
}

/// Create a state transition record.
pub fn transition(
    task_id: Uuid,
    from: TaskStatus,
    to: TaskStatus,
    reason: Option<String>,
) -> Result<StateTransition, StateError> {
    validate_transition(task_id, from, to)?;

    let t = StateTransition {
        task_id,
        from_state: from,
        to_state: to,
        timestamp: Utc::now(),
        reason,
    };

    tracing::info!(
        task_id = %t.task_id,
        from = ?t.from_state,
        to = ?t.to_state,
        "Task state transition"
    );

    Ok(t)
}

/// Check if a status is terminal (no further transitions possible).
pub fn is_terminal(status: TaskStatus) -> bool {
    matches!(status, TaskStatus::Final | TaskStatus::Escalated)
}

/// Check if a status is in a review phase.
pub fn is_review_phase(status: TaskStatus) -> bool {
    matches!(
        status,
        TaskStatus::Step1Review | TaskStatus::Step2Review | TaskStatus::Step3Review
    )
}

/// Get the next production state after a review phase.
pub fn next_production_state(review_state: TaskStatus) -> Option<TaskStatus> {
    match review_state {
        TaskStatus::Step1Review => Some(TaskStatus::Step2Production),
        TaskStatus::Step2Review => Some(TaskStatus::Step3Production),
        TaskStatus::Step3Review => Some(TaskStatus::Step4FinalOutput),
        _ => None,
    }
}

/// Get the step number (1-4) from a status, if applicable.
pub fn step_number(status: TaskStatus) -> Option<u8> {
    match status {
        TaskStatus::Step1Production | TaskStatus::Step1Review => Some(1),
        TaskStatus::Step2Production | TaskStatus::Step2Review => Some(2),
        TaskStatus::Step3Production | TaskStatus::Step3Review => Some(3),
        TaskStatus::Step4FinalOutput => Some(4),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_full_path() {
        let id = Uuid::new_v4();
        let path = [
            (TaskStatus::Decomposing, TaskStatus::Queued),
            (TaskStatus::Queued, TaskStatus::Assigned),
            (TaskStatus::Assigned, TaskStatus::Step1Production),
            (TaskStatus::Step1Production, TaskStatus::Step1Review),
            (TaskStatus::Step1Review, TaskStatus::Step2Production),
            (TaskStatus::Step2Production, TaskStatus::Step2Review),
            (TaskStatus::Step2Review, TaskStatus::Step3Production),
            (TaskStatus::Step3Production, TaskStatus::Step3Review),
            (TaskStatus::Step3Review, TaskStatus::Step4FinalOutput),
            (TaskStatus::Step4FinalOutput, TaskStatus::Final),
        ];
        for (from, to) in path {
            assert!(validate_transition(id, from, to).is_ok(), "Failed: {:?} → {:?}", from, to);
        }
    }

    #[test]
    fn test_escalation_from_reviews() {
        let id = Uuid::new_v4();
        assert!(validate_transition(id, TaskStatus::Step1Review, TaskStatus::Escalated).is_ok());
        assert!(validate_transition(id, TaskStatus::Step2Review, TaskStatus::Escalated).is_ok());
        assert!(validate_transition(id, TaskStatus::Step3Review, TaskStatus::Escalated).is_ok());
    }

    #[test]
    fn test_invalid_skip() {
        let id = Uuid::new_v4();
        assert!(validate_transition(id, TaskStatus::Queued, TaskStatus::Step1Production).is_err());
        assert!(validate_transition(id, TaskStatus::Step1Review, TaskStatus::Step3Review).is_err());
    }

    #[test]
    fn test_terminal_states() {
        let id = Uuid::new_v4();
        assert!(validate_transition(id, TaskStatus::Final, TaskStatus::Queued).is_err());
        assert!(validate_transition(id, TaskStatus::Escalated, TaskStatus::Queued).is_err());
    }

    #[test]
    fn test_is_terminal() {
        assert!(is_terminal(TaskStatus::Final));
        assert!(is_terminal(TaskStatus::Escalated));
        assert!(!is_terminal(TaskStatus::Step2Review));
    }

    #[test]
    fn test_step_number() {
        assert_eq!(step_number(TaskStatus::Step1Production), Some(1));
        assert_eq!(step_number(TaskStatus::Step3Review), Some(3));
        assert_eq!(step_number(TaskStatus::Step4FinalOutput), Some(4));
        assert_eq!(step_number(TaskStatus::Queued), None);
    }
}
