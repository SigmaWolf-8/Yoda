use std::cmp::Ordering;
use lazy_static::lazy_static;
use crate::trit::{Trit, TritSeq};
use crate::cascade::{ManifoldOrd, manifold_cmp};

// ── Gate: binary-to-trit conversion ────────────────────────────────
// All u32 dies here. Nothing escapes.

fn u32_to_tritseq(n: u32) -> TritSeq {
    if n == 0 { return TritSeq(Box::new([Trit::Zero])); }
    let mut trits = Vec::new();
    let mut v = n;
    while v > 0 {
        trits.push(match v % 3 { 0 => Trit::Zero, 1 => Trit::One, _ => Trit::Two });
        v /= 3;
    }
    trits.reverse();
    TritSeq(trits.into_boxed_slice())
}

// ── Constants ──────────────────────────────────────────────────────

lazy_static! {
    static ref TRIT_ONE:   TritSeq = TritSeq(Box::new([Trit::One]));
    static ref TRIT_TWO:   TritSeq = TritSeq(Box::new([Trit::Two]));
    static ref TRIT_THREE: TritSeq = TritSeq(Box::new([Trit::One, Trit::Zero]));
    /// The plenum value — `Trit::Zero` — used as the neutral element
    /// when a layer carries no enrichment for this key.
    static ref PLENUM: TritSeq = TritSeq(Box::new([Trit::Zero]));
}

// ── The indexed key: all 10 layers, no Options, no builders ────────
//
// Architectural choice (from `aasc` v0.1.0-final): every layer is a
// required `TritSeq`. Where a key carries no real enrichment, the
// field holds the plenum (`Trit::Zero`). This guarantees a total order
// on `Ord` at the type level — no `Option` dance in the comparator,
// no equivalence-class hazards in the AVL tree.

#[derive(Clone, Debug)]
pub struct IndexedTritSeq {
    // Layer 1: Lexicographic
    pub lex_string: String,
    // Layer 2: Geometrical (Plane, Row, Column)
    pub geo: Vec<TritSeq>,
    // Layer 3: Algebraic
    pub trits: TritSeq,
    // Layer 4: Milesian
    pub milesian: TritSeq,
    // Layer 5: Historical Figures (group, position) — plenum when neutral
    pub hist_group: TritSeq,
    pub hist_position: TritSeq,
    // Layer 6: Chemical Element (atomic number Z) — plenum when neutral
    pub element_z: TritSeq,
    // Layer 7: Marker Record
    pub marker: String,
    // Layer 8: Greek Tier
    pub greek_tier_val: TritSeq,
    // Layer 9: Alphabetical Oracle
    pub oracle: String,
    // Layer 10: Manifold Coordinates — empty vec when neutral
    pub manifold: Vec<TritSeq>,
}

impl IndexedTritSeq {
    /// Full constructor. All 10 layers. All TritSeq. No u32 outside the gate.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        trits: TritSeq,
        geo: Vec<TritSeq>,
        milesian: TritSeq,
        hist_group: TritSeq,
        hist_position: TritSeq,
        element_z: TritSeq,
        marker: String,
        greek_tier_val: TritSeq,
        oracle: String,
        manifold: Vec<TritSeq>,
    ) -> Self {
        let lex_string = trits.to_hash_string();
        IndexedTritSeq {
            lex_string, geo, trits, milesian,
            hist_group, hist_position, element_z,
            marker, greek_tier_val, oracle, manifold,
        }
    }

    /// Gate constructor from char.
    /// Layers 5, 6, 10 default to the plenum. Layers 1-4, 7-9 are derived.
    pub fn from_char(c: char) -> Self {
        let cp = c as u32;
        let trits = TritSeq::from_char(c);
        let lex_string = trits.to_hash_string();

        // Layer 2: Geometrical
        let plane = cp >> 16;
        let row   = (cp >> 8) & 0xFF;
        let col   = cp & 0xFF;
        let geo = vec![
            u32_to_tritseq(plane),
            u32_to_tritseq(row),
            u32_to_tritseq(col),
        ];

        // Layer 4: Milesian
        let milesian = lex_string.chars()
            .map(|ch| match ch {
                '0' => TRIT_ONE.clone(),
                '1' => TRIT_TWO.clone(),
                '2' => TRIT_THREE.clone(),
                _   => PLENUM.clone(),
            })
            .reduce(|a, b| TritSeq::add(&a, &b))
            .unwrap_or_else(|| PLENUM.clone());

        // Layer 7: Marker
        let marker = if cp <= 0xFFFF {
            format!("U+{:04X}", cp)
        } else {
            format!("U+{:06X}", cp)
        };

        // Layer 8: Greek Tier
        let digits = trits.to_base27_digits();
        let first_d = digits.first().copied().unwrap_or(0);
        let register = if first_d == 0 { 0 } else { (first_d - 1) / 9 };
        let greek_tier_val = u32_to_tritseq((register + 1) as u32);

        // Layer 9: Oracle
        let oracle = format!("P{}R{}C{}", plane, row, col);

        // u32 is now dead. Everything below is TritSeq/str.
        IndexedTritSeq {
            lex_string,
            geo,
            trits,
            milesian,
            hist_group: PLENUM.clone(),
            hist_position: PLENUM.clone(),
            element_z: PLENUM.clone(),
            marker,
            greek_tier_val,
            oracle,
            manifold: Vec::new(),
        }
    }
}

// ── ManifoldOrd: all 10 layers, all live ───────────────────────────

impl ManifoldOrd for IndexedTritSeq {
    fn lexicographic(&self) -> &str { &self.lex_string }
    fn geometrical(&self) -> Option<&[TritSeq]> { Some(&self.geo) }
    fn algebraic(&self) -> &TritSeq { &self.trits }
    fn milesian_value(&self) -> &TritSeq { &self.milesian }
    fn historical_figure(&self) -> Option<(&TritSeq, &TritSeq)> {
        // Always present. Plenum values compare as equal (neutral).
        Some((&self.hist_group, &self.hist_position))
    }
    fn chemical_element(&self) -> Option<&TritSeq> { Some(&self.element_z) }
    fn marker_record(&self) -> &str { &self.marker }
    fn greek_tier(&self) -> &TritSeq { &self.greek_tier_val }
    fn alphabetical_oracle(&self) -> &str { &self.oracle }
    fn manifold_coords(&self) -> &[TritSeq] { &self.manifold }
}

// ── Ordering ───────────────────────────────────────────────────────

impl Ord for IndexedTritSeq {
    fn cmp(&self, other: &Self) -> Ordering { manifold_cmp(self, other) }
}
impl PartialOrd for IndexedTritSeq {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> { Some(self.cmp(other)) }
}
impl PartialEq for IndexedTritSeq {
    fn eq(&self, other: &Self) -> bool { self.cmp(other) == Ordering::Equal }
}
impl Eq for IndexedTritSeq {}
