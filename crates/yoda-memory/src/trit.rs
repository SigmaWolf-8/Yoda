use std::cmp::Ordering;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Trit { Zero, One, Two }

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct TritSeq(pub Box<[Trit]>);

impl TritSeq {
    /// The gate: binary integers are used freely inside to extract
    /// the scalar from Rust's `char` primitive. Outside this gate,
    /// no `u32` participates in any computation or comparison.
    pub fn from_char(c: char) -> Self {
        let cp = c as u32;
        if cp == 0 {
            return TritSeq(Box::new([Trit::Zero]));
        }
        let mut trits = Vec::new();
        let mut n = cp;
        while n > 0 {
            trits.push(match n % 3 {
                0 => Trit::Zero,
                1 => Trit::One,
                _ => Trit::Two,
            });
            n /= 3;
        }
        trits.reverse();
        TritSeq(trits.into_boxed_slice())
    }

    /// Lossless base-3 hash string. Useful as a content-addressable key
    /// for memory entries (deterministic, collision-free per code point).
    pub fn to_hash_string(&self) -> String {
        self.0.iter().map(|t| match t {
            Trit::Zero => '0',
            Trit::One  => '1',
            Trit::Two  => '2',
        }).collect()
    }

    fn to_le_trits(&self) -> Vec<Trit> {
        let mut v = self.0.to_vec();
        v.reverse();
        v
    }

    fn from_le_trits(le: &[Trit]) -> Self {
        let mut msb_first: Vec<Trit> = le.iter().rev().copied().collect();
        while msb_first.len() > 1 && msb_first[0] == Trit::Zero {
            msb_first.remove(0);
        }
        if msb_first.is_empty() {
            msb_first.push(Trit::Zero);
        }
        TritSeq(msb_first.into_boxed_slice())
    }

    /// Pure ternary addition via 27-entry lookup table.
    /// No `as u8` casts, no binary arithmetic.
    pub fn add(a: &TritSeq, b: &TritSeq) -> TritSeq {
        use Trit::*;

        fn trit_full_add(a: Trit, b: Trit, c: Trit) -> (Trit, Trit) {
            match (a, b, c) {
                (Zero, Zero, Zero) => (Zero, Zero),
                (One,  Zero, Zero) => (One,  Zero),
                (Zero, One,  Zero) => (One,  Zero),
                (Zero, Zero, One)  => (One,  Zero),
                (Two,  Zero, Zero) => (Two,  Zero),
                (Zero, Two,  Zero) => (Two,  Zero),
                (Zero, Zero, Two)  => (Two,  Zero),
                (One,  One,  Zero) => (Two,  Zero),
                (One,  Zero, One)  => (Two,  Zero),
                (Zero, One,  One)  => (Two,  Zero),
                (One,  One,  One)  => (Zero, One),
                (Two,  One,  Zero) => (Zero, One),
                (Two,  Zero, One)  => (Zero, One),
                (One,  Two,  Zero) => (Zero, One),
                (Zero, Two,  One)  => (Zero, One),
                (One,  Zero, Two)  => (Zero, One),
                (Zero, One,  Two)  => (Zero, One),
                (Two,  Two,  Zero) => (One,  One),
                (Two,  Zero, Two)  => (One,  One),
                (Zero, Two,  Two)  => (One,  One),
                (Two,  One,  One)  => (One,  One),
                (One,  Two,  One)  => (One,  One),
                (One,  One,  Two)  => (One,  One),
                (Two,  Two,  One)  => (Two,  One),
                (Two,  One,  Two)  => (Two,  One),
                (One,  Two,  Two)  => (Two,  One),
                (Two,  Two,  Two)  => (Zero, Two),
            }
        }

        let a_le = a.to_le_trits();
        let b_le = b.to_le_trits();
        let max_len = a_le.len().max(b_le.len());
        let mut result_le = Vec::with_capacity(max_len + 1);
        let mut carry = Trit::Zero;
        for i in 0..max_len {
            let ai = a_le.get(i).copied().unwrap_or(Trit::Zero);
            let bi = b_le.get(i).copied().unwrap_or(Trit::Zero);
            let (digit, new_carry) = trit_full_add(ai, bi, carry);
            result_le.push(digit);
            carry = new_carry;
        }
        if carry != Trit::Zero {
            result_le.push(carry);
        }
        TritSeq::from_le_trits(&result_le)
    }

    /// Groups trits into blocks of 3 (right-aligned, zero-padded).
    /// Returns base-27 digits (0-26). Compact wire/log format: 3 trits
    /// per byte, still human-debuggable.
    pub fn to_base27_digits(&self) -> Vec<u8> {
        let len = self.0.len();
        let padded_len = if len % 3 == 0 { len } else { len + (3 - len % 3) };
        let mut padded = vec![Trit::Zero; padded_len - len];
        padded.extend_from_slice(&self.0);
        let mut digits = Vec::new();
        for chunk in padded.chunks(3) {
            let h = chunk[0] as u8;
            let m = chunk[1] as u8;
            let l = chunk[2] as u8;
            digits.push(h * 9 + m * 3 + l);
        }
        digits
    }
}

impl Ord for TritSeq {
    fn cmp(&self, other: &Self) -> Ordering {
        match (self.0.len(), other.0.len()) {
            (1, 1) if self.0[0] == Trit::Zero && other.0[0] == Trit::Zero =>
                Ordering::Equal,
            (1, _) if self.0[0] == Trit::Zero => Ordering::Less,
            (_, 1) if other.0[0] == Trit::Zero => Ordering::Greater,
            (a, b) if a != b => a.cmp(&b),
            _ => self.0.iter().cmp(other.0.iter()),
        }
    }
}

impl PartialOrd for TritSeq {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> { Some(self.cmp(other)) }
}
