//! Per-task forkable scratchpad, backed by `yoda-memory`'s persistent
//! AVL tree.
//!
//! Each task in the four-step protocol gets a `Scratchpad<V>` containing
//! "what I know so far." Child tasks (decomposition, parallel reviewers)
//! call [`Scratchpad::fork`] to inherit a snapshot of the parent's state;
//! their writes don't leak back, and they share unchanged subtrees with
//! the parent via `Arc`. Cancelled or escalated tasks simply drop their
//! root — no cleanup, no lock contention with siblings.
//!
//! This is the textbook use case for a persistent tree: cheap forks,
//! cheap snapshots, immutable history.

use std::sync::Arc;
use yoda_memory::Tree;

/// A persistent key-value scratchpad. Keys are strings (use any
/// deterministic encoding — task numbers, hashes, etc.).
///
/// `V` must be `Clone` so that snapshots can be read into local owned
/// values; it should typically be cheap-to-clone (e.g. `Arc<Inner>` or
/// `serde_json::Value`).
#[derive(Clone)]
pub struct Scratchpad<V: Clone> {
    root: Arc<Tree<String, V>>,
}

impl<V: Clone> Default for Scratchpad<V> {
    fn default() -> Self { Self::new() }
}

impl<V: Clone> Scratchpad<V> {
    pub fn new() -> Self {
        Scratchpad { root: Tree::empty() }
    }

    /// O(log n). Returns a clone if the key is present.
    pub fn get(&self, key: &str) -> Option<V> {
        self.root.find(&key.to_string()).cloned()
    }

    /// Returns a NEW scratchpad with the write applied. Self is unchanged.
    /// O(log n). Unchanged subtrees are shared via `Arc`.
    #[must_use = "persistent: returns new root, does not mutate"]
    pub fn put(&self, key: impl Into<String>, value: V) -> Self {
        Scratchpad { root: self.root.insert(key.into(), value) }
    }

    /// Cheap snapshot fork. The returned scratchpad starts identical to
    /// `self` but their futures diverge — writes to either do not affect
    /// the other.
    pub fn fork(&self) -> Self {
        Scratchpad { root: Arc::clone(&self.root) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn put_returns_new_root_and_does_not_mutate_self() {
        let parent = Scratchpad::<String>::new().put("k", "v1".into());
        let child  = parent.put("k", "v2".into());
        assert_eq!(parent.get("k").as_deref(), Some("v1"));
        assert_eq!(child.get("k").as_deref(), Some("v2"));
    }

    #[test]
    fn fork_isolates_subsequent_writes() {
        let root_task = Scratchpad::<i32>::new()
            .put("step1.result", 10);
        let reviewer_a = root_task.fork().put("review.score", 90);
        let reviewer_b = root_task.fork().put("review.score", 70);

        // Sibling reviewers don't see each other.
        assert_eq!(reviewer_a.get("review.score"), Some(90));
        assert_eq!(reviewer_b.get("review.score"), Some(70));
        // Parent sees neither review.
        assert!(root_task.get("review.score").is_none());
        // But all inherit step1.
        assert_eq!(root_task.get("step1.result"), Some(10));
        assert_eq!(reviewer_a.get("step1.result"), Some(10));
        assert_eq!(reviewer_b.get("step1.result"), Some(10));
    }

    #[test]
    fn scratchpad_is_send_and_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<Scratchpad<String>>();
        assert_send_sync::<Scratchpad<i32>>();
    }
}
