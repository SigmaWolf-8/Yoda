//! Hierarchical task-number index, backed by `yoda-memory`'s persistent
//! AVL tree.
//!
//! Maps the hierarchical task number string (e.g. `"1.3.2.1"`) to the
//! Bible entry's UUID, with O(log n) exact lookup and O(n + k) prefix
//! scan (`"1.3."` returns every entry under sub-tree 1.3.*).
//!
//! The Bible itself stays in Postgres (append-only, signature chain
//! integrity). This index is an in-memory accelerator built on top.

use std::sync::{Arc, RwLock};
use uuid::Uuid;
use yoda_memory::Tree;

/// Thread-safe number → id index. Cheap to clone.
#[derive(Clone)]
pub struct TaskNumberIndex {
    inner: Arc<RwLock<Arc<Tree<String, Uuid>>>>,
}

impl Default for TaskNumberIndex {
    fn default() -> Self { Self::new() }
}

impl TaskNumberIndex {
    pub fn new() -> Self {
        TaskNumberIndex { inner: Arc::new(RwLock::new(Tree::empty())) }
    }

    /// O(log n) exact lookup. Returns the entry id for the given task number.
    pub fn lookup(&self, task_number: &str) -> Option<Uuid> {
        self.inner.read().unwrap().find(&task_number.to_string()).copied()
    }

    /// O(log n) insert. Replaces any prior id for the same task number.
    pub fn insert(&self, task_number: impl Into<String>, entry_id: Uuid) {
        let mut guard = self.inner.write().unwrap();
        let new_root = guard.insert(task_number.into(), entry_id);
        *guard = new_root;
    }

    /// Returns every (task_number, entry_id) whose number starts with
    /// `prefix`. E.g. `prefix_scan("1.3.")` yields all of 1.3.x, 1.3.x.y…
    /// O(n) over the tree, O(k) over the matches. Result is sorted.
    pub fn prefix_scan(&self, prefix: &str) -> Vec<(String, Uuid)> {
        let mut out = Vec::new();
        Self::walk(&self.inner.read().unwrap(), prefix, &mut out);
        out
    }

    fn walk(node: &Arc<Tree<String, Uuid>>, prefix: &str, out: &mut Vec<(String, Uuid)>) {
        match node.as_ref() {
            Tree::Nil => {}
            Tree::Node { key, value, left, right, .. } => {
                Self::walk(left, prefix, out);
                if key.starts_with(prefix) {
                    out.push((key.clone(), *value));
                }
                Self::walk(right, prefix, out);
            }
        }
    }

    /// How many entries are indexed. Mainly for tests / metrics.
    pub fn len(&self) -> usize {
        fn count(t: &Arc<Tree<String, Uuid>>) -> usize {
            match t.as_ref() {
                Tree::Nil => 0,
                Tree::Node { left, right, .. } => 1 + count(left) + count(right),
            }
        }
        count(&self.inner.read().unwrap())
    }

    pub fn is_empty(&self) -> bool { self.len() == 0 }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_lookup() {
        let idx = TaskNumberIndex::new();
        let id = Uuid::new_v4();
        idx.insert("1.2.3", id);
        assert_eq!(idx.lookup("1.2.3"), Some(id));
        assert_eq!(idx.lookup("1.2.4"), None);
    }

    #[test]
    fn prefix_scan_returns_only_matching_subtree() {
        let idx = TaskNumberIndex::new();
        let ids: Vec<Uuid> = (0..6).map(|_| Uuid::new_v4()).collect();
        idx.insert("1",       ids[0]);
        idx.insert("1.1",     ids[1]);
        idx.insert("1.3.1",   ids[2]);
        idx.insert("1.3.2",   ids[3]);
        idx.insert("1.3.2.1", ids[4]);
        idx.insert("2.1",     ids[5]);

        let under_1_3 = idx.prefix_scan("1.3.");
        let nums: Vec<&str> = under_1_3.iter().map(|(s, _)| s.as_str()).collect();
        assert_eq!(nums, vec!["1.3.1", "1.3.2", "1.3.2.1"]);

        let under_2 = idx.prefix_scan("2.");
        assert_eq!(under_2.len(), 1);
        assert_eq!(under_2[0].0, "2.1");

        let none = idx.prefix_scan("9.");
        assert!(none.is_empty());
    }

    #[test]
    fn index_is_send_and_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<TaskNumberIndex>();
    }
}
