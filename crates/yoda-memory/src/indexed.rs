use std::cmp::Ordering;
use lazy_static::lazy_static;
use crate::trit::{Trit, TritSeq};
use crate::cascade::{ManifoldOrd, manifold_cmp};

// ── Gate helpers ────────────────────────────────────────────────────
// Binary-to-trit conversion lives here (inside the gate).
// No u32 escapes these functions into the cascade.

fn u32_to_tritseq(n: u32) -> TritSeq {
    if n == 0 { return TritSeq(Box::new([Trit::Zero])); }
    let mut trits = Vec::new();
    let mut v = n;
    while v > 0 {
        trits.push(match v % 3 {
            0 => Trit::Zero,
            1 => Trit::One,
            _ => Trit::Two,
        });
        v /= 3;
    }
    trits.reverse();
    TritSeq(trits.into_boxed_slice())
}

fn format_u32_hex(n: u32) -> String {
    if n <= 0xFFFF {
        format!("U+{:04X}", n)
    } else {
        format!("U+{:06X}", n)
    }
}

// ── Milesian constants ─────────────────────────────────────────────

lazy_static! {
    static ref TRIT_ONE:   TritSeq = TritSeq(Box::new([Trit::One]));
    static ref TRIT_TWO:   TritSeq = TritSeq(Box::new([Trit::Two]));
    static ref TRIT_THREE: TritSeq = TritSeq(Box::new([Trit::One, Trit::Zero]));
}

// ── The full indexed key ───────────────────────────────────────────

#[derive(Clone, Debug)]
pub struct IndexedTritSeq {
    // Layer 1: Lexicographic
    pub lex_string: String,
    // Layer 2: Geometrical (Plane, Row, Column)
    pub geo: Vec<TritSeq>,
    // Layer 3: Algebraic (the raw TritSeq)
    pub trits: TritSeq,
    // Layer 4: Milesian (trit-digit weight sum)
    pub milesian: TritSeq,
    // Layer 5: Historical Figures (enrichment, optional)
    pub hist_generation: Option<TritSeq>,
    pub hist_position: Option<TritSeq>,
    // Layer 6: Chemical Element (enrichment, optional)
    pub element_z: Option<TritSeq>,
    // Layer 7: Marker Record (deterministic ID)
    pub marker: String,
    // Layer 8: Greek Tier
    pub greek_tier_val: TritSeq,
    // Layer 9: Alphabetical Oracle (3D coordinate string)
    pub oracle: String,
    // Layer 10: Manifold Coordinates (enrichment, optional)
    pub manifold: Vec<TritSeq>,
}

impl IndexedTritSeq {
    /// Construct from a char. The gate: all u32 extraction happens here.
    /// Every field is precomputed. Outside this function, no binary
    /// integer participates in any computation or comparison.
    pub fn from_char(c: char) -> Self {
        let cp = c as u32;

        // Layer 3: Algebraic
        let trits = TritSeq::from_char(c);

        // Layer 1: Lexicographic
        let lex_string = trits.to_hash_string();

        // Layer 2: Geometrical (3D Unicode space)
        let plane = cp >> 16;
        let row   = (cp >> 8) & 0xFF;
        let col   = cp & 0xFF;
        let geo = vec![
            u32_to_tritseq(plane),
            u32_to_tritseq(row),
            u32_to_tritseq(col),
        ];

        // Layer 4: Milesian (trit-digit weight sum via pure trit addition)
        let milesian = lex_string.chars()
            .map(|ch| match ch {
                '0' => TRIT_ONE.clone(),
                '1' => TRIT_TWO.clone(),
                '2' => TRIT_THREE.clone(),
                _   => TritSeq(Box::new([Trit::Zero])),
            })
            .reduce(|a, b| TritSeq::add(&a, &b))
            .unwrap_or_else(|| TritSeq(Box::new([Trit::Zero])));

        // Layer 7: Marker Record (deterministic Unicode ID)
        let marker = format_u32_hex(cp);

        // Layer 8: Greek Tier (register of first base-27 digit)
        let digits = trits.to_base27_digits();
        let first_d = digits.first().copied().unwrap_or(0);
        let register = if first_d == 0 { 0 } else { (first_d - 1) / 9 };
        let greek_tier_val = u32_to_tritseq((register + 1) as u32);

        // Layer 9: Alphabetical Oracle (3D coordinate string)
        let oracle = format!("P{}R{}C{}", plane, row, col);

        IndexedTritSeq {
            lex_string,
            geo,
            trits,
            milesian,
            hist_generation: None,
            hist_position: None,
            element_z: None,
            marker,
            greek_tier_val,
            oracle,
            manifold: Vec::new(),
        }
    }

    // ── Enrichment builders (return new immutable copies) ──────────

    pub fn with_historical_figure(mut self, generation: u32, position: u32) -> Self {
        self.hist_generation = Some(u32_to_tritseq(generation));
        self.hist_position = Some(u32_to_tritseq(position));
        self
    }

    pub fn with_element(mut self, z: u32) -> Self {
        self.element_z = Some(u32_to_tritseq(z));
        self
    }

    pub fn with_manifold_coords(mut self, coords: Vec<TritSeq>) -> Self {
        self.manifold = coords;
        self
    }

    pub fn with_manifold_u32(mut self, coords: &[u32]) -> Self {
        self.manifold = coords.iter().map(|&n| u32_to_tritseq(n)).collect();
        self
    }

    pub fn with_marker(mut self, marker: String) -> Self {
        self.marker = marker;
        self
    }

    pub fn with_oracle(mut self, oracle: String) -> Self {
        self.oracle = oracle;
        self
    }
}

// ── ManifoldOrd implementation (all 10 layers live) ────────────────

impl ManifoldOrd for IndexedTritSeq {
    fn lexicographic(&self) -> &str { &self.lex_string }
    fn geometrical(&self) -> Option<&[TritSeq]> { Some(&self.geo) }
    fn algebraic(&self) -> &TritSeq { &self.trits }
    fn milesian_value(&self) -> &TritSeq { &self.milesian }
    fn historical_figure(&self) -> Option<(&TritSeq, &TritSeq)> {
        match (&self.hist_generation, &self.hist_position) {
            (Some(g), Some(p)) => Some((g, p)),
            _ => None,
        }
    }
    fn chemical_element(&self) -> Option<&TritSeq> { self.element_z.as_ref() }
    fn marker_record(&self) -> &str { &self.marker }
    fn greek_tier(&self) -> &TritSeq { &self.greek_tier_val }
    fn alphabetical_oracle(&self) -> &str { &self.oracle }
    fn manifold_coords(&self) -> &[TritSeq] { &self.manifold }
}

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
