//! # yoda-memory
//!
//! Ternary-native, immutable, persistent indexing primitives for YODA agent
//! memory. Built around four pieces:
//!
//! - [`Trit`] / [`TritSeq`]: variable-width base-3 representation aligned with
//!   the PlenumNET Rep A/B/C trit encoding. Includes a correct 27-entry
//!   ternary full-adder and lossless base-27 chunking.
//! - [`Tree`]: a persistent AVL tree over `Arc`, `Send + Sync` when K/V are,
//!   with O(log n) `find`/`insert` and structural sharing. Use as a snapshot
//!   store — every write returns a new root; old roots remain queryable.
//!   Fork freely.
//! - [`IndexedTritSeq`]: a 10-layer indexed key (lexicographic, geometrical,
//!   algebraic, Milesian, historical, element, marker, Greek tier, oracle,
//!   manifold). Plenum convention — every layer is required; neutral values
//!   are `Trit::Zero`. This guarantees total ordering at the type level.
//! - [`ManifoldOrd`] + [`manifold_cmp`]: layered comparator pattern; bring
//!   your own ranker by implementing the trait on your own key type.
//!
//! Source: the `aasc` crate (Capomastro v0.1.0-final), adapted for
//! async-safe use in the YODA workspace (`Rc` → `Arc`).
//!
//! See the integration modules in `yoda-knowledge-base::memory_cache`,
//! `yoda-orchestrator::scratchpad`, `yoda-inference-router::response_cache`,
//! and `yoda-task-bible::number_index` for usage patterns.

pub mod trit;
pub mod tree;
pub mod cascade;
pub mod indexed;
pub mod isomorphic;
pub mod hash;

pub use trit::{Trit, TritSeq};
pub use tree::Tree;
pub use cascade::{ManifoldOrd, manifold_cmp};
pub use indexed::IndexedTritSeq;
pub use isomorphic::is_isomorphic_immutable;
pub use hash::trit_hash_str;
