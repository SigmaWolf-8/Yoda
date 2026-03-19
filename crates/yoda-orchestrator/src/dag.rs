//! Directed Acyclic Graph (DAG) orchestration.
//!
//! B3.4: DAG construction (tasks as nodes, deps as edges)
//! B3.5: Cycle detection (reject circular dependencies)
//! B3.6: Topological sort (execution ordering)
//! B3.7: Parallel execution engine (tokio::spawn per independent group)
//! B3.8: Dependency failure handling (escalate, don't deadlock)

use crate::decomposer::ProposedTask;
use crate::TaskStatus;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum DagError {
    #[error("circular dependency detected: {0}")]
    CyclicDependency(String),
    #[error("unknown dependency: task '{0}' depends on '{1}' which does not exist")]
    UnknownDependency(String, String),
    #[error("DAG is empty")]
    EmptyDag,
}

/// A node in the DAG representing one task.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DagNode {
    pub task_number: String,
    pub task_id: Option<Uuid>,
    /// Task numbers this node depends on (must complete before this runs).
    pub dependencies: Vec<String>,
    /// Task numbers that depend on this node (will unlock when this completes).
    pub dependents: Vec<String>,
    /// Current execution status.
    pub status: TaskStatus,
    /// Position in topological order (0-based).
    pub topo_order: Option<usize>,
}

/// The complete DAG structure for a decomposition.
#[derive(Debug, Clone)]
pub struct TaskDag {
    pub nodes: HashMap<String, DagNode>,
    /// Topologically sorted task numbers (execution order).
    pub topo_sorted: Vec<String>,
    /// Groups of tasks that can execute in parallel (same topo level).
    pub parallel_groups: Vec<Vec<String>>,
}

// ─── DAG Construction (B3.4) ─────────────────────────────────────────

/// Build a DAG from proposed tasks.
pub fn build_dag(tasks: &[ProposedTask]) -> Result<TaskDag, DagError> {
    if tasks.is_empty() {
        return Err(DagError::EmptyDag);
    }

    let mut nodes: HashMap<String, DagNode> = HashMap::new();
    let task_numbers: HashSet<String> = tasks.iter().map(|t| t.task_number.clone()).collect();

    // Create nodes
    for task in tasks {
        nodes.insert(
            task.task_number.clone(),
            DagNode {
                task_number: task.task_number.clone(),
                task_id: None,
                dependencies: task.dependencies.clone(),
                dependents: Vec::new(),
                status: TaskStatus::Queued,
                topo_order: None,
            },
        );
    }

    // Validate dependencies exist and build reverse edges (dependents)
    for task in tasks {
        for dep in &task.dependencies {
            if !task_numbers.contains(dep) {
                return Err(DagError::UnknownDependency(
                    task.task_number.clone(),
                    dep.clone(),
                ));
            }
            // Add reverse edge: dep → task (dep is depended upon by task)
            if let Some(dep_node) = nodes.get_mut(dep) {
                dep_node.dependents.push(task.task_number.clone());
            }
        }
    }

    // Detect cycles (B3.5)
    detect_cycles(&nodes)?;

    // Topological sort (B3.6)
    let topo_sorted = topological_sort(&nodes)?;

    // Assign topo order
    for (i, tn) in topo_sorted.iter().enumerate() {
        if let Some(node) = nodes.get_mut(tn) {
            node.topo_order = Some(i);
        }
    }

    // Build parallel groups (B3.7)
    let parallel_groups = build_parallel_groups(&nodes, &topo_sorted);

    Ok(TaskDag {
        nodes,
        topo_sorted,
        parallel_groups,
    })
}

// ─── Cycle Detection (B3.5) ─────────────────────────────────────────

/// Detect cycles using DFS with three-color marking.
/// White = unvisited, Gray = in current path, Black = fully explored.
fn detect_cycles(nodes: &HashMap<String, DagNode>) -> Result<(), DagError> {
    #[derive(Clone, Copy, PartialEq)]
    enum Color { White, Gray, Black }

    let mut colors: HashMap<&str, Color> = nodes
        .keys()
        .map(|k| (k.as_str(), Color::White))
        .collect();

    fn dfs<'a>(
        node: &'a str,
        nodes: &'a HashMap<String, DagNode>,
        colors: &mut HashMap<&'a str, Color>,
        path: &mut Vec<&'a str>,
    ) -> Result<(), DagError> {
        colors.insert(node, Color::Gray);
        path.push(node);

        if let Some(dag_node) = nodes.get(node) {
            for dep_tn in &dag_node.dependencies {
                match colors.get(dep_tn.as_str()) {
                    Some(Color::Gray) => {
                        // Found a cycle — build the cycle path for the error message
                        let cycle_start = path.iter().position(|&n| n == dep_tn.as_str()).unwrap_or(0);
                        let cycle: Vec<&str> = path[cycle_start..].to_vec();
                        return Err(DagError::CyclicDependency(
                            format!("{} → {}", cycle.join(" → "), dep_tn),
                        ));
                    }
                    Some(Color::White) | None => {
                        dfs(dep_tn, nodes, colors, path)?;
                    }
                    Some(Color::Black) => {
                        // Already fully explored — no cycle through this node
                    }
                }
            }
        }

        path.pop();
        colors.insert(node, Color::Black);
        Ok(())
    }

    let node_keys: Vec<String> = nodes.keys().cloned().collect();
    for key in &node_keys {
        if colors.get(key.as_str()) == Some(&Color::White) {
            let mut path = Vec::new();
            dfs(key, nodes, &mut colors, &mut path)?;
        }
    }

    Ok(())
}

// ─── Topological Sort (B3.6) ────────────────────────────────────────

/// Kahn's algorithm: BFS-based topological sort.
/// Returns tasks in execution order (dependencies before dependents).
fn topological_sort(nodes: &HashMap<String, DagNode>) -> Result<Vec<String>, DagError> {
    // Compute in-degrees
    let mut in_degree: HashMap<&str, usize> = HashMap::new();
    for (tn, node) in nodes {
        in_degree.entry(tn.as_str()).or_insert(0);
        for dep in &node.dependencies {
            // dep → tn (dep is a prerequisite of tn)
            // We want in-degree of tn to count its dependencies
        }
    }
    // Count incoming edges (how many deps each node has)
    for (tn, node) in nodes {
        *in_degree.entry(tn.as_str()).or_insert(0) = node.dependencies.len();
    }

    // Start with nodes that have no dependencies (in-degree 0)
    let mut queue: VecDeque<String> = in_degree
        .iter()
        .filter(|(_, &deg)| deg == 0)
        .map(|(&tn, _)| tn.to_string())
        .collect();
    queue.make_contiguous().sort(); // Deterministic ordering

    let mut sorted = Vec::new();

    while let Some(current) = queue.pop_front() {
        sorted.push(current.clone());

        // For each node that depends on `current`, decrement its in-degree
        if let Some(node) = nodes.get(&current) {
            let mut next_ready: Vec<String> = Vec::new();
            for dependent_tn in &node.dependents {
                if let Some(deg) = in_degree.get_mut(dependent_tn.as_str()) {
                    *deg = deg.saturating_sub(1);
                    if *deg == 0 {
                        next_ready.push(dependent_tn.clone());
                    }
                }
            }
            next_ready.sort(); // Deterministic
            for tn in next_ready {
                queue.push_back(tn);
            }
        }
    }

    // If sorted doesn't contain all nodes, there's a cycle
    // (already caught by detect_cycles, but belt-and-suspenders)
    if sorted.len() != nodes.len() {
        return Err(DagError::CyclicDependency(
            "Topological sort incomplete — cycle detected".into(),
        ));
    }

    Ok(sorted)
}

// ─── Parallel Groups (B3.7) ─────────────────────────────────────────

/// Group tasks into parallel execution batches.
/// Tasks in the same group have all dependencies satisfied by prior groups.
fn build_parallel_groups(
    nodes: &HashMap<String, DagNode>,
    topo_sorted: &[String],
) -> Vec<Vec<String>> {
    let mut groups: Vec<Vec<String>> = Vec::new();
    let mut node_to_level: HashMap<&str, usize> = HashMap::new();

    for tn in topo_sorted {
        let node = &nodes[tn];

        // This node's level = max(level of all dependencies) + 1
        let level = if node.dependencies.is_empty() {
            0
        } else {
            node.dependencies
                .iter()
                .map(|dep| node_to_level.get(dep.as_str()).copied().unwrap_or(0) + 1)
                .max()
                .unwrap_or(0)
        };

        node_to_level.insert(tn.as_str(), level);

        // Ensure groups vec is long enough
        while groups.len() <= level {
            groups.push(Vec::new());
        }
        groups[level].push(tn.clone());
    }

    groups
}

// ─── Execution State Tracking (B3.7, B3.8) ──────────────────────────

/// Track which tasks are ready, running, complete, or failed.
#[derive(Debug, Clone)]
pub struct ExecutionState {
    pub completed: HashSet<String>,
    pub failed: HashSet<String>,
    pub running: HashSet<String>,
}

impl ExecutionState {
    pub fn new() -> Self {
        Self {
            completed: HashSet::new(),
            failed: HashSet::new(),
            running: HashSet::new(),
        }
    }

    /// Get tasks that are ready to execute: all deps complete, not running, not done.
    pub fn ready_tasks(&self, dag: &TaskDag) -> Vec<String> {
        dag.topo_sorted
            .iter()
            .filter(|tn| {
                !self.completed.contains(*tn)
                    && !self.failed.contains(*tn)
                    && !self.running.contains(*tn)
            })
            .filter(|tn| {
                let node = &dag.nodes[*tn];
                node.dependencies.iter().all(|dep| self.completed.contains(dep))
            })
            .cloned()
            .collect()
    }

    /// Mark a task as complete.
    pub fn mark_complete(&mut self, task_number: &str) {
        self.running.remove(task_number);
        self.completed.insert(task_number.to_string());
    }

    /// Mark a task as failed (B3.8 — escalate, don't deadlock).
    /// Also marks all transitive dependents as failed.
    pub fn mark_failed(&mut self, task_number: &str, dag: &TaskDag) {
        self.running.remove(task_number);
        self.failed.insert(task_number.to_string());

        // Cascade failure to all dependents (they can never run)
        let mut to_fail: VecDeque<String> = VecDeque::new();
        if let Some(node) = dag.nodes.get(task_number) {
            for dep in &node.dependents {
                to_fail.push_back(dep.clone());
            }
        }
        while let Some(tn) = to_fail.pop_front() {
            if !self.failed.contains(&tn) {
                self.failed.insert(tn.clone());
                if let Some(node) = dag.nodes.get(&tn) {
                    for dep in &node.dependents {
                        to_fail.push_back(dep.clone());
                    }
                }
            }
        }
    }

    pub fn mark_running(&mut self, task_number: &str) {
        self.running.insert(task_number.to_string());
    }

    /// Check if all tasks are done (complete or failed).
    pub fn is_finished(&self, dag: &TaskDag) -> bool {
        dag.nodes.keys().all(|tn| self.completed.contains(tn) || self.failed.contains(tn))
    }
}

impl Default for ExecutionState {
    fn default() -> Self { Self::new() }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(num: &str, deps: &[&str]) -> ProposedTask {
        ProposedTask {
            task_number: num.into(),
            title: format!("Task {}", num),
            competencies: vec![],
            dependencies: deps.iter().map(|s| s.to_string()).collect(),
            parent_number: None,
            template_id: None,
        }
    }

    #[test]
    fn test_build_linear_dag() {
        let tasks = vec![task("1", &[]), task("2", &["1"]), task("3", &["2"])];
        let dag = build_dag(&tasks).unwrap();
        assert_eq!(dag.topo_sorted, vec!["1", "2", "3"]);
        assert_eq!(dag.parallel_groups.len(), 3); // each level has 1 task
    }

    #[test]
    fn test_build_parallel_dag() {
        let tasks = vec![
            task("1", &[]),
            task("2", &[]),
            task("3", &["1", "2"]),
        ];
        let dag = build_dag(&tasks).unwrap();
        assert_eq!(dag.parallel_groups.len(), 2);
        assert_eq!(dag.parallel_groups[0].len(), 2); // 1 and 2 in parallel
        assert_eq!(dag.parallel_groups[1].len(), 1); // 3 after both
    }

    #[test]
    fn test_cycle_detection() {
        let tasks = vec![
            task("1", &["3"]),
            task("2", &["1"]),
            task("3", &["2"]),
        ];
        let result = build_dag(&tasks);
        assert!(result.is_err());
        match result.unwrap_err() {
            DagError::CyclicDependency(msg) => assert!(msg.contains("→")),
            e => panic!("Expected CyclicDependency, got: {:?}", e),
        }
    }

    #[test]
    fn test_unknown_dependency() {
        let tasks = vec![task("1", &["nonexistent"])];
        let result = build_dag(&tasks);
        assert!(matches!(result.unwrap_err(), DagError::UnknownDependency(_, _)));
    }

    #[test]
    fn test_empty_dag() {
        let result = build_dag(&[]);
        assert!(matches!(result.unwrap_err(), DagError::EmptyDag));
    }

    #[test]
    fn test_diamond_dag() {
        //   1
        //  / \
        // 2   3
        //  \ /
        //   4
        let tasks = vec![
            task("1", &[]),
            task("2", &["1"]),
            task("3", &["1"]),
            task("4", &["2", "3"]),
        ];
        let dag = build_dag(&tasks).unwrap();
        assert_eq!(dag.parallel_groups.len(), 3);
        assert_eq!(dag.parallel_groups[0], vec!["1"]);
        let mut mid = dag.parallel_groups[1].clone();
        mid.sort();
        assert_eq!(mid, vec!["2", "3"]);
        assert_eq!(dag.parallel_groups[2], vec!["4"]);
    }

    #[test]
    fn test_execution_state_ready() {
        let tasks = vec![task("1", &[]), task("2", &["1"]), task("3", &["1"])];
        let dag = build_dag(&tasks).unwrap();
        let state = ExecutionState::new();

        let ready = state.ready_tasks(&dag);
        assert_eq!(ready, vec!["1"]); // only task 1 has no deps

        let mut state = state;
        state.mark_running("1");
        assert!(state.ready_tasks(&dag).is_empty());

        state.mark_complete("1");
        let ready = state.ready_tasks(&dag);
        assert_eq!(ready.len(), 2); // 2 and 3 now ready
    }

    #[test]
    fn test_failure_cascade() {
        let tasks = vec![
            task("1", &[]),
            task("2", &["1"]),
            task("3", &["2"]),
            task("4", &[]),  // independent
        ];
        let dag = build_dag(&tasks).unwrap();
        let mut state = ExecutionState::new();

        state.mark_failed("1", &dag);
        assert!(state.failed.contains("1"));
        assert!(state.failed.contains("2")); // cascaded
        assert!(state.failed.contains("3")); // cascaded
        assert!(!state.failed.contains("4")); // independent, unaffected
    }

    #[test]
    fn test_is_finished() {
        let tasks = vec![task("1", &[]), task("2", &[])];
        let dag = build_dag(&tasks).unwrap();
        let mut state = ExecutionState::new();

        assert!(!state.is_finished(&dag));
        state.mark_complete("1");
        assert!(!state.is_finished(&dag));
        state.mark_complete("2");
        assert!(state.is_finished(&dag));
    }

    #[test]
    fn test_complex_dag() {
        let tasks = vec![
            task("1.1", &[]),
            task("1.2", &[]),
            task("1.3", &["1.1"]),
            task("1.4", &["1.1", "1.2"]),
            task("2.1", &["1.3", "1.4"]),
            task("2.2", &["1.4"]),
            task("3.1", &["2.1", "2.2"]),
        ];
        let dag = build_dag(&tasks).unwrap();
        assert_eq!(dag.topo_sorted.len(), 7);
        // 1.1 and 1.2 must come before everything else
        let pos = |tn: &str| dag.topo_sorted.iter().position(|t| t == tn).unwrap();
        assert!(pos("1.1") < pos("1.3"));
        assert!(pos("1.1") < pos("1.4"));
        assert!(pos("1.2") < pos("1.4"));
        assert!(pos("1.3") < pos("2.1"));
        assert!(pos("1.4") < pos("2.1"));
        assert!(pos("1.4") < pos("2.2"));
        assert!(pos("2.1") < pos("3.1"));
        assert!(pos("2.2") < pos("3.1"));
    }
}
