//! In-memory snapshot cache for `KBEntry`, backed by `yoda-memory`'s
//! persistent AVL tree.
//!
//! The Postgres store remains authoritative. This cache lives in front of
//! it to: (a) avoid round-tripping for repeated lookups by entry id, and
//! (b) hold an always-resident snapshot of pinned entries that must be
//! merged into every search response.
//!
//! Snapshot semantics: every `put` returns a new root via structural
//! sharing. Old roots remain valid and can be handed to read-only
//! consumers (e.g. a long-running search) without blocking writers.

use std::sync::{Arc, RwLock};
use uuid::Uuid;
use yoda_memory::Tree;
use crate::KBEntry;

/// Thread-safe cache. Cheap to clone (`Arc` inside).
#[derive(Clone)]
pub struct MemoryCache {
    inner: Arc<RwLock<Arc<Tree<String, KBEntry>>>>,
}

impl Default for MemoryCache {
    fn default() -> Self { Self::new() }
}

impl MemoryCache {
    pub fn new() -> Self {
        MemoryCache { inner: Arc::new(RwLock::new(Tree::empty())) }
    }

    /// Look up an entry by its UUID. Returns a clone; O(log n).
    pub fn get(&self, id: &Uuid) -> Option<KBEntry> {
        let root = self.inner.read().unwrap().clone();
        root.find(&id.to_string()).cloned()
    }

    /// Insert or replace an entry. O(log n). Other threads holding the
    /// previous snapshot are unaffected.
    pub fn put(&self, entry: KBEntry) {
        let mut guard = self.inner.write().unwrap();
        let new_root = guard.insert(entry.id.to_string(), entry);
        *guard = new_root;
    }

    /// Take a point-in-time snapshot. Cheap (`Arc` clone). Subsequent
    /// `put` calls don't affect what this snapshot sees.
    pub fn snapshot(&self) -> Arc<Tree<String, KBEntry>> {
        self.inner.read().unwrap().clone()
    }

    /// Replace the live root with a forked snapshot. Useful for
    /// transactional rebuilds (build new snapshot off-line, swap in).
    pub fn replace_root(&self, new_root: Arc<Tree<String, KBEntry>>) {
        *self.inner.write().unwrap() = new_root;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn entry(name: &str) -> KBEntry {
        KBEntry {
            id: Uuid::new_v4(),
            project_id: Uuid::nil(),
            content: name.into(),
            summary: name.into(),
            tags: vec![],
            archived: false,
            pinned: false,
            boost_score: 1.0,
            source_task_id: None,
            source_mode: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn put_then_get_roundtrips() {
        let cache = MemoryCache::new();
        let e = entry("alpha");
        let id = e.id;
        cache.put(e.clone());
        assert_eq!(cache.get(&id).unwrap().content, "alpha");
    }

    #[test]
    fn snapshot_is_isolated_from_subsequent_writes() {
        let cache = MemoryCache::new();
        let e1 = entry("first");
        let id1 = e1.id;
        cache.put(e1);
        let snap = cache.snapshot();

        let e2 = entry("second");
        cache.put(e2.clone());

        // Snapshot still sees only e1, not e2.
        assert!(snap.find(&id1.to_string()).is_some());
        assert!(snap.find(&e2.id.to_string()).is_none());

        // But the live cache sees both.
        assert!(cache.get(&id1).is_some());
        assert!(cache.get(&e2.id).is_some());
    }

    #[test]
    fn miss_returns_none() {
        let cache = MemoryCache::new();
        assert!(cache.get(&Uuid::new_v4()).is_none());
    }
}
