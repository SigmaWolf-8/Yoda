use std::sync::Arc;
use crate::indexed::IndexedTritSeq;
use crate::tree::Tree;

/// Purely functional isomorphic string check.
/// No `mut` anywhere. Builds a fresh tree for each new mapping
/// via persistent insertion.
///
/// Use case in YODA: agent trace deduplication — are two execution traces
/// structurally the same regardless of concrete tool names / arg values?
pub fn is_isomorphic_immutable(s: &str, t: &str) -> bool {
    let s_seqs: Vec<IndexedTritSeq> = s.chars().map(IndexedTritSeq::from_char).collect();
    let t_seqs: Vec<IndexedTritSeq> = t.chars().map(IndexedTritSeq::from_char).collect();
    if s_seqs.len() != t_seqs.len() { return false; }

    fn recurse(
        idx: usize,
        s_seqs: &[IndexedTritSeq],
        t_seqs: &[IndexedTritSeq],
        map: Arc<Tree<IndexedTritSeq, IndexedTritSeq>>,
        used: Arc<Tree<IndexedTritSeq, IndexedTritSeq>>,
    ) -> bool {
        if idx == s_seqs.len() { return true; }
        let sc = &s_seqs[idx];
        let tc = &t_seqs[idx];

        match map.find(sc) {
            Some(mapped) if mapped != tc => false,
            Some(_) => recurse(idx + 1, s_seqs, t_seqs, map, used),
            None => {
                if used.find(tc).is_some() { return false; }
                let new_map = map.insert(sc.clone(), tc.clone());
                let new_used = used.insert(tc.clone(), tc.clone());
                recurse(idx + 1, s_seqs, t_seqs, new_map, new_used)
            }
        }
    }

    let empty = Tree::empty();
    recurse(0, &s_seqs, &t_seqs, Arc::clone(&empty), Arc::clone(&empty))
}
