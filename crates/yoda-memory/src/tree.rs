//! Persistent immutable AVL tree, `Arc`-backed. `Arc<Tree<K, V>>` is
//! `Send + Sync` *iff* `K` and `V` are `Send + Sync`, so it can cross
//! `tokio` await boundaries and live in shared async state whenever the
//! key/value types allow it. (`IndexedTritSeq` satisfies this — see the
//! `tree_is_send_and_sync` test.)
//!
//! Adapted from the `aasc` crate (`Rc` → `Arc`). All other semantics
//! identical: every `insert` returns a new root in O(log n) with
//! structural sharing of unchanged subtrees.

use std::sync::Arc;
use std::cmp::Ordering;

#[derive(Clone, PartialEq, Eq)]
pub enum Tree<K: Ord + Clone, V: Clone> {
    Nil,
    Node {
        key: K,
        value: V,
        left: Arc<Tree<K, V>>,
        right: Arc<Tree<K, V>>,
        height: usize,
    },
}

impl<K: Ord + Clone, V: Clone> Tree<K, V> {
    /// Returns a fresh empty root. Cheap: shares the same `Nil` per call.
    pub fn empty() -> Arc<Self> {
        Arc::new(Tree::Nil)
    }

    fn height(&self) -> usize {
        match self { Tree::Nil => 0, Tree::Node { height, .. } => *height }
    }

    fn new_node(key: K, value: V, left: Arc<Self>, right: Arc<Self>) -> Arc<Self> {
        let h = 1 + left.height().max(right.height());
        Arc::new(Tree::Node { key, value, left, right, height: h })
    }

    pub fn find<'a>(self: &'a Arc<Self>, key: &K) -> Option<&'a V> {
        match self.as_ref() {
            Tree::Nil => None,
            Tree::Node { key: k, value: v, left, right, .. } => match key.cmp(k) {
                Ordering::Less    => left.find(key),
                Ordering::Greater => right.find(key),
                Ordering::Equal   => Some(v),
            },
        }
    }

    pub fn insert(self: &Arc<Self>, key: K, value: V) -> Arc<Self> {
        match self.as_ref() {
            Tree::Nil => Tree::new_node(key, value, Arc::new(Tree::Nil), Arc::new(Tree::Nil)),
            Tree::Node { key: k, value: v, left, right, .. } => {
                match key.cmp(k) {
                    Ordering::Less => {
                        let new_left = left.insert(key, value);
                        Self::rebalance(k.clone(), v.clone(), new_left, Arc::clone(right))
                    }
                    Ordering::Greater => {
                        let new_right = right.insert(key, value);
                        Self::rebalance(k.clone(), v.clone(), Arc::clone(left), new_right)
                    }
                    Ordering::Equal => Tree::new_node(key, value, Arc::clone(left), Arc::clone(right)),
                }
            }
        }
    }

    fn rebalance(key: K, value: V, left: Arc<Self>, right: Arc<Self>) -> Arc<Self> {
        let node = Tree::new_node(key, value, left, right);
        let bf = node.balance_factor();
        if bf == 2 {
            match node.as_ref() {
                Tree::Node { left, .. } if left.balance_factor() >= 0 => {
                    Self::rotate_right(&node)
                }
                Tree::Node { key, value, left, right, .. } => {
                    let left_rot = Self::rotate_left(left);
                    let nn = Tree::new_node(key.clone(), value.clone(),
                        left_rot, Arc::clone(right));
                    Self::rotate_right(&nn)
                }
                _ => node,
            }
        } else if bf == -2 {
            match node.as_ref() {
                Tree::Node { right, .. } if right.balance_factor() <= 0 => {
                    Self::rotate_left(&node)
                }
                Tree::Node { key, value, left, right, .. } => {
                    let right_rot = Self::rotate_right(right);
                    let nn = Tree::new_node(key.clone(), value.clone(),
                        Arc::clone(left), right_rot);
                    Self::rotate_left(&nn)
                }
                _ => node,
            }
        } else {
            node
        }
    }

    fn balance_factor(&self) -> i8 {
        match self {
            Tree::Nil => 0,
            Tree::Node { left, right, .. } => left.height() as i8 - right.height() as i8,
        }
    }

    fn rotate_left(node: &Arc<Self>) -> Arc<Self> {
        if let Tree::Node { key, value, left, right, .. } = node.as_ref() {
            if let Tree::Node { key: rk, value: rv, left: rl, right: rr, .. } = right.as_ref() {
                let nl = Tree::new_node(key.clone(), value.clone(),
                    Arc::clone(left), Arc::clone(rl));
                return Tree::new_node(rk.clone(), rv.clone(), nl, Arc::clone(rr));
            }
        }
        Arc::clone(node)
    }

    fn rotate_right(node: &Arc<Self>) -> Arc<Self> {
        if let Tree::Node { key, value, left, right, .. } = node.as_ref() {
            if let Tree::Node { key: lk, value: lv, left: ll, right: lr, .. } = left.as_ref() {
                let nr = Tree::new_node(key.clone(), value.clone(),
                    Arc::clone(lr), Arc::clone(right));
                return Tree::new_node(lk.clone(), lv.clone(), Arc::clone(ll), nr);
            }
        }
        Arc::clone(node)
    }
}
