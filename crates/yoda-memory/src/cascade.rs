use std::cmp::Ordering;
use crate::trit::TritSeq;

/// The 10-layer Compendium ordering cascade.
///
/// Layered comparator pattern: each layer is consulted in order; the first
/// layer that produces a non-`Equal` result wins. Bring-your-own ranker by
/// implementing this trait for a custom key type — e.g. recall pipelines
/// that combine exact match, semantic similarity, recency, and provenance
/// tier as successive layers.
pub trait ManifoldOrd {
    /// 1. Lexicographic — the trit hash string
    fn lexicographic(&self) -> &str;
    /// 2. Geometrical — spatial coordinates as trit sequences
    fn geometrical(&self) -> Option<&[TritSeq]>;
    /// 3. Algebraic — structural invariant as TritSeq
    fn algebraic(&self) -> &TritSeq;
    /// 4. Milesian — Greek-letter numeric sum as TritSeq
    fn milesian_value(&self) -> &TritSeq;
    /// 5. Historical Figures — (group, period) as TritSeq pair
    fn historical_figure(&self) -> Option<(&TritSeq, &TritSeq)>;
    /// 6. Chemical Elements — atomic number as TritSeq
    fn chemical_element(&self) -> Option<&TritSeq>;
    /// 7. Marker Records — unique identifier string
    fn marker_record(&self) -> &str;
    /// 8. Greek Tier — Alpha/Beta/Gamma register as TritSeq
    fn greek_tier(&self) -> &TritSeq;
    /// 9. Alphabetical Oracle — oracle response string
    fn alphabetical_oracle(&self) -> &str;
    /// 10. Manifold Coordinates — vector of TritSeq
    fn manifold_coords(&self) -> &[TritSeq];
}

/// Compare two values using the full 10-layer cascade.
///
/// Every layer uses only TritSeq or str comparisons — no binary integers.
///
/// **Total-order over optional layers**: when only one side has the
/// enrichment, we fall back to `Option`'s natural order (`None < Some`),
/// matching `#[derive(Ord)]` on `Option<T>`. This preserves antisymmetry
/// and transitivity, which is required because this comparator is the
/// `Ord` impl used as the AVL key for `IndexedTritSeq`.
pub fn manifold_cmp<T: ManifoldOrd>(a: &T, b: &T) -> Ordering {
    let cmp = a.lexicographic().cmp(b.lexicographic());
    if cmp != Ordering::Equal { return cmp; }

    let cmp = a.geometrical().cmp(&b.geometrical());
    if cmp != Ordering::Equal { return cmp; }

    let cmp = a.algebraic().cmp(b.algebraic());
    if cmp != Ordering::Equal { return cmp; }

    let cmp = a.milesian_value().cmp(b.milesian_value());
    if cmp != Ordering::Equal { return cmp; }

    let cmp = a.historical_figure().cmp(&b.historical_figure());
    if cmp != Ordering::Equal { return cmp; }

    let cmp = a.chemical_element().cmp(&b.chemical_element());
    if cmp != Ordering::Equal { return cmp; }

    let cmp = a.marker_record().cmp(b.marker_record());
    if cmp != Ordering::Equal { return cmp; }

    let cmp = a.greek_tier().cmp(b.greek_tier());
    if cmp != Ordering::Equal { return cmp; }

    let cmp = a.alphabetical_oracle().cmp(b.alphabetical_oracle());
    if cmp != Ordering::Equal { return cmp; }

    a.manifold_coords().iter().cmp(b.manifold_coords().iter())
}
