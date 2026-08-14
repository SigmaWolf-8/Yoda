//! The Capomastro sovereign ledger, computed rather than remembered.
//!
//! The workbook is a historical artefact: it states positions — cash, gold
//! bars, obligations, descendants, cross-balance legs. It does **not** state
//! the answers; the formula cells shipped with their cached values stripped.
//! Everything derived from those positions — totals, reserve composition, fine
//! gold mass and its fair value, the descendant digital root, the cross-balance
//! X — is arithmetic, and arithmetic that is stored is arithmetic that can
//! silently go stale.
//!
//! So this crate recomputes the summary from the workbook cells on demand, in
//! exact base-10 fixed point, with the integer invariants discharged by the
//! `salvi-engine` no_std kernel. Nothing here reads a precomputed total back.
//!
//! The extraction script still runs, and still publishes its own summary. That
//! block is now a *seal*, not a source: [`live::compute`] recomputes
//! independently and reports, field by field, whether the live figures agree
//! with the sealed ones. Two independent implementations agreeing on every
//! figure is a stronger statement than either one alone.

/// Exact base-10 decimal arithmetic. Money never touches a float.
pub mod dec;
/// Recomputation of the ledger summary from workbook cells.
pub mod live;
