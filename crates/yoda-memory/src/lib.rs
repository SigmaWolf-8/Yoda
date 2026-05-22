//! # yoda-memory
//!
//! Ternary-native, immutable, persistent indexing primitives for YODA agent
//! memory. Built around four pieces:
//!
//! - [`Trit`] / [`TritSeq`]: variable-width base-3 representation aligned with
//!   the PlenumNET Rep A/B/C trit encoding. Includes a correct 27-entry
//!   ternary full-adder and lossless base-27 chunking.
//! - [`Tree`]: a persistent AVL tree over `Arc`, `Send + Sync`, with O(log n)
//!   `find`/`insert` and structural sharing. Use as a snapshot store — every
//!   write returns a new root; old roots remain queryable, fork freely.
//! - [`IndexedTritSeq`]: a 10-layer indexed key (lexicographic, geometrical,
//!   algebraic, Milesian, historical, element, marker, Greek tier, oracle,
//!   manifold) suitable as the key type for the snapshot tree.
//! - [`ManifoldOrd`] + [`manifold_cmp`]: layered comparator pattern; bring
//!   your own ranker by implementing the trait on your own key type.
//!
//! Source: the `aasc` crate (Capomastro), adapted for async-safe use in the
//! YODA workspace (`Rc` → `Arc`).

pub mod trit;
pub mod tree;
pub mod cascade;
pub mod indexed;
pub mod isomorphic;

pub use trit::{Trit, TritSeq};
pub use tree::Tree;
pub use cascade::{ManifoldOrd, manifold_cmp};
pub use indexed::IndexedTritSeq;
pub use isomorphic::is_isomorphic_immutable;
