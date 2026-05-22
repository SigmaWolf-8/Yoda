//! Content-addressable response cache for engine calls.
//!
//! Keyed by the trit-hash of `(model_name, system_prompt, user_content)`.
//! Same request → cached `InferenceResponse`. Backed by `yoda-memory`'s
//! persistent AVL tree, so reads never block writes (snapshot semantics).
//!
//! Use case: idempotent prompt replay, identical adversarial reviewer
//! prompts across runs, structured-output validation retries.

use std::sync::{Arc, RwLock};
use yoda_memory::{Tree, trit_hash_str};
use crate::InferenceResponse;

/// What we store at each tree slot. The full composed key is kept so we
/// can verify on lookup and reject a hash collision rather than return a
/// false-positive cached response. Without this, two distinct prompts
/// whose SipHash digests collide (~2^-64 per pair, but real) would
/// silently exchange responses.
#[derive(Clone)]
struct Slot {
    composed_key: String,
    response: InferenceResponse,
}

/// Thread-safe response cache. Cheap to clone.
#[derive(Clone)]
pub struct ResponseCache {
    inner: Arc<RwLock<Arc<Tree<String, Slot>>>>,
}

impl Default for ResponseCache {
    fn default() -> Self { Self::new() }
}

impl ResponseCache {
    pub fn new() -> Self {
        ResponseCache { inner: Arc::new(RwLock::new(Tree::empty())) }
    }

    /// Length-prefixed canonical form of (model, system, user). Used as
    /// the exact-equality check on lookup; never compared modulo hash.
    fn composed_key(model: &str, system_prompt: &str, user_content: &str) -> String {
        format!(
            "{}\x1f{}\x1f{}\x1f{}\x1f{}\x1f{}",
            model.len(), model,
            system_prompt.len(), system_prompt,
            user_content.len(), user_content,
        )
    }

    /// Deterministic trit-hash of the composed key. Used as the AVL tree
    /// key (cheap and bounded-width). Hash collisions are caught at
    /// lookup time by comparing the full composed key.
    pub fn key(model: &str, system_prompt: &str, user_content: &str) -> String {
        trit_hash_str(&Self::composed_key(model, system_prompt, user_content))
    }

    /// Look up a cached response. O(log n). Returns `None` on miss *and*
    /// on hash collision (the stored composed key didn't match), so callers
    /// never see a wrong-cache hit.
    pub fn get(&self, model: &str, system_prompt: &str, user_content: &str)
        -> Option<InferenceResponse>
    {
        let composed = Self::composed_key(model, system_prompt, user_content);
        let hash_key = trit_hash_str(&composed);
        let root = self.inner.read().unwrap().clone();
        let slot = root.find(&hash_key)?;
        if slot.composed_key == composed {
            Some(slot.response.clone())
        } else {
            // Hash collision against a different prompt tuple. Treat as miss.
            None
        }
    }

    /// Insert a response. O(log n). On hash collision against an existing
    /// distinct prompt, the new entry overwrites the old (LRU-ish at the
    /// hash-bucket granularity). For an in-process cache this is fine.
    pub fn put(
        &self,
        model: &str,
        system_prompt: &str,
        user_content: &str,
        response: InferenceResponse,
    ) {
        let composed = Self::composed_key(model, system_prompt, user_content);
        let hash_key = trit_hash_str(&composed);
        let slot = Slot { composed_key: composed, response };
        let mut guard = self.inner.write().unwrap();
        let new_root = guard.insert(hash_key, slot);
        *guard = new_root;
    }

    /// How many entries are cached. Mainly for tests / metrics.
    pub fn len(&self) -> usize {
        fn count<K: Ord + Clone, V: Clone>(t: &Arc<Tree<K, V>>) -> usize {
            match t.as_ref() {
                Tree::Nil => 0,
                Tree::Node { left, right, .. } => 1 + count(left) + count(right),
            }
        }
        count(&*self.inner.read().unwrap())
    }

    pub fn is_empty(&self) -> bool { self.len() == 0 }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::EngineSlot;

    fn resp(content: &str) -> InferenceResponse {
        InferenceResponse {
            content: content.into(),
            engine_slot: EngineSlot::A,
            model_name: "test-model".into(),
            tis27_hash: String::new(),
            latency_ms: 0,
            censorship_flagged: false,
        }
    }

    #[test]
    fn key_is_deterministic() {
        assert_eq!(
            ResponseCache::key("m", "sys", "usr"),
            ResponseCache::key("m", "sys", "usr"),
        );
    }

    #[test]
    fn key_distinguishes_field_boundaries() {
        // ("ab","c") and ("a","bc") must not collide despite same total content.
        assert_ne!(
            ResponseCache::key("m", "ab", "c"),
            ResponseCache::key("m", "a", "bc"),
        );
    }

    #[test]
    fn put_then_get_hits() {
        let c = ResponseCache::new();
        assert!(c.is_empty());
        c.put("m", "sys", "usr", resp("hello"));
        assert_eq!(c.len(), 1);
        let got = c.get("m", "sys", "usr").unwrap();
        assert_eq!(got.content, "hello");
    }

    #[test]
    fn different_inputs_miss() {
        let c = ResponseCache::new();
        c.put("m", "sys", "usr", resp("x"));
        assert!(c.get("m", "sys", "other").is_none());
        assert!(c.get("other", "sys", "usr").is_none());
    }

    #[test]
    fn collision_is_treated_as_miss_not_wrong_hit() {
        // Force a synthetic hash collision by manipulating the inner tree
        // directly: insert a slot under hash_key("A") whose composed_key
        // is for tuple "B". A naive cache would return the slot's response
        // when queried for "A"; our verified-key path must return None.
        let c = ResponseCache::new();
        let composed_b = ResponseCache::composed_key("m", "sys", "B");
        let hash_a = ResponseCache::key("m", "sys", "A");
        let bogus_slot = Slot {
            composed_key: composed_b,
            response: resp("response-for-B"),
        };
        {
            let mut guard = c.inner.write().unwrap();
            *guard = guard.insert(hash_a, bogus_slot);
        }
        // Query for "A" — hash matches but composed key does not.
        assert!(c.get("m", "sys", "A").is_none(),
            "collision must not produce a false-positive hit");
    }
}
