//! # Salvi Engine — fixed-precision checked-integer kernel
//!
//! `no_std`, stack-only, zero heap, zero floats. Every arithmetic step that can
//! be reached from a caller-supplied value is performed with `checked_*`
//! operations, so a non-representable result becomes an explicit
//! [`EngineError`] rather than a panic or a silent wrap.
//!
//! The kernel carries four invariant families:
//!
//! 1. **Bijective Base-9** encoding ([`BijectiveBase9`]) — digits strictly in
//!    `1..=9`, round-trip exact, with the GCD-9 and digital-root invariants.
//! 2. **Exact rational projection** ([`RationalMatrix2x2`]) — integer
//!    numerator/denominator arithmetic with an idempotence test `P² == P`.
//! 3. **State seal** ([`TransactionHashSeal`]) — the `f(x) - x = 0` closure.
//! 4. **Z = 0 discharge** ([`verify_zero_state_balance`]).
//!
//! ## Digit-buffer bound (corrected)
//!
//! The source specification set the digit buffer to 20 on the claim that
//! `9^20 > 2^64 - 1`. That claim is false, and the buffer size that follows
//! from it is too small:
//!
//! ```text
//! 9^20                        =  12_157_665_459_056_928_801   (1.216e19)
//! 2^64 - 1                    =  18_446_744_073_709_551_615   (1.845e19)
//! max value in 20 bij. digits =  sum_{i=0}^{19} 9 * 9^i
//!                             =  (9^21 - 9) / 8
//!                             =  13_677_373_641_439_044_900   (1.368e19)   < 2^64 - 1
//! max value in 21 bij. digits =  (9^22 - 9) / 8
//!                             = 123_096_362_772_951_404_109   (1.231e20)   > 2^64 - 1
//! ```
//!
//! So `u64::MAX` needs **21** bijective base-9 digits, not 20. With the
//! specified buffer of 20 the encoder returns `IntegerOverflow` for every input
//! above `13_677_373_641_439_044_900`, the `max_digit_length_of_u64` unit test
//! fails on its `expect`, and the Kani proof `proof_from_u64_never_overflows`
//! reports the `Err` branch as reachable. [`MAX_BIJECTIVE_DIGITS`] is therefore
//! 21 here, which is what makes the overflow branch genuinely dead code.

#![no_std]
#![forbid(unsafe_code)]
#![cfg_attr(feature = "prusti", feature(register_tool))]
#![cfg_attr(feature = "prusti", register_tool(prusti))]

#[cfg(feature = "prusti")]
use prusti_contracts::*;

#[cfg(kani)]
mod kani_proofs;

/// Maximum number of bijective base-9 digits required by any `u64`.
///
/// See the module documentation for the derivation; 21 is tight — 20 is not
/// sufficient for the upper end of the 64-bit domain.
pub const MAX_BIJECTIVE_DIGITS: usize = 21;

/// The bijective base. Digits run `1..=9`; there is no zero placeholder.
pub const BASE_MODULUS: u64 = 9;

/// Milesian isopsephy of Σάλβι = 243 = 3^5.
pub const MILESIAN_SALVI_SUM: u64 = 243;

/// Largest value the encoder can represent: `sum_{i=0}^{20} 9 * 9^i`.
pub const MAX_ENCODABLE: u64 = u64::MAX;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineError {
    /// A supplied digit fell outside the bijective range `1..=9`.
    InvalidDigit(u8),
    /// A checked arithmetic step could not represent its result.
    IntegerOverflow,
    /// A denominator of zero was supplied or produced.
    DivisionByZero,
    /// A projection that was required to satisfy `P² == P` did not.
    NonIdempotentState,
    /// A ledger discharge that was required to reach `Z = 0` did not.
    NonZeroBalanceViolation,
    /// The base-3 uniqueness scan did not yield exactly one root.
    Base3UniquenessViolation,
    /// `f(x)` did not agree with the supplied on-chain state.
    HashVerificationFailed,
}

// ---------------------------------------------------------------------------
// Bijective Base-9
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BijectiveBase9 {
    digits: [u8; MAX_BIJECTIVE_DIGITS],
    len: usize,
    raw_value: u64,
}

impl BijectiveBase9 {
    /// The ground state. `Z = 0` carries no digits at all — in a bijective
    /// numeral system zero is the empty string, not a zero digit.
    pub const Z_ZERO: Self = Self {
        digits: [0; MAX_BIJECTIVE_DIGITS],
        len: 0,
        raw_value: 0,
    };

    /// Encodes any `u64` into bijective base-9, least-significant digit first.
    ///
    /// The `IntegerOverflow` branch is unreachable for every value in
    /// `0..=u64::MAX` given a buffer of [`MAX_BIJECTIVE_DIGITS`]; it is retained
    /// so the bound is enforced rather than assumed.
    #[cfg_attr(feature = "prusti", ensures(result.is_ok() ==> {
        let b = result.unwrap();
        b.verify_digits() && b.raw() == value
    }))]
    #[cfg_attr(feature = "prusti", ensures(result.is_err() ==> matches!(result, Err(EngineError::IntegerOverflow))))]
    pub fn from_u64(mut value: u64) -> Result<Self, EngineError> {
        if value == 0 {
            return Ok(Self::Z_ZERO);
        }

        let orig = value;
        let mut digits = [0u8; MAX_BIJECTIVE_DIGITS];
        let mut idx = 0usize;

        while value > 0 {
            if idx >= MAX_BIJECTIVE_DIGITS {
                return Err(EngineError::IntegerOverflow);
            }
            // value >= 1 here, so the subtraction cannot underflow.
            let remainder = (value - 1) % BASE_MODULUS;
            let digit = (remainder + 1) as u8; // 1..=9 by construction
            digits[idx] = digit;
            // digit <= value, so this subtraction cannot underflow either.
            value = (value - (digit as u64)) / BASE_MODULUS;
            idx += 1;
        }

        Ok(Self {
            digits,
            len: idx,
            raw_value: orig,
        })
    }

    /// Decodes a little-endian bijective base-9 digit string.
    #[cfg_attr(feature = "prusti", requires(digits.len() <= MAX_BIJECTIVE_DIGITS))]
    #[cfg_attr(feature = "prusti", ensures(result.is_ok() ==> result.unwrap().verify_digits()))]
    pub fn from_bijective_digits(digits: &[u8]) -> Result<Self, EngineError> {
        if digits.is_empty() {
            return Ok(Self::Z_ZERO);
        }
        if digits.len() > MAX_BIJECTIVE_DIGITS {
            return Err(EngineError::IntegerOverflow);
        }

        let mut acc: u64 = 0;
        let mut multiplier: u64 = 1;
        let mut stored_digits = [0u8; MAX_BIJECTIVE_DIGITS];

        for (i, &d) in digits.iter().enumerate() {
            if !(1..=9).contains(&d) {
                return Err(EngineError::InvalidDigit(d));
            }
            stored_digits[i] = d;

            let term = (d as u64)
                .checked_mul(multiplier)
                .ok_or(EngineError::IntegerOverflow)?;
            acc = acc.checked_add(term).ok_or(EngineError::IntegerOverflow)?;

            if i + 1 < digits.len() {
                multiplier = multiplier
                    .checked_mul(BASE_MODULUS)
                    .ok_or(EngineError::IntegerOverflow)?;
            }
        }

        Ok(Self {
            digits: stored_digits,
            len: digits.len(),
            raw_value: acc,
        })
    }

    pub const fn raw(&self) -> u64 {
        self.raw_value
    }

    pub fn digits(&self) -> &[u8] {
        &self.digits[..self.len]
    }

    pub const fn digit_len(&self) -> usize {
        self.len
    }

    /// Structural invariant: zero carries no digits, every other digit is `1..=9`.
    pub fn verify_digits(&self) -> bool {
        if self.raw_value == 0 {
            return self.len == 0;
        }
        if self.len == 0 || self.len > MAX_BIJECTIVE_DIGITS {
            return false;
        }
        let mut i = 0;
        while i < self.len {
            if self.digits[i] < 1 || self.digits[i] > 9 {
                return false;
            }
            i += 1;
        }
        true
    }

    /// `gcd(value, 9)` — 9 exactly when the value is a multiple of 9.
    pub const fn gcd_9_invariant(&self) -> u64 {
        gcd_u64(self.raw_value, BASE_MODULUS)
    }

    /// The bijective digital root: `((n - 1) mod 9) + 1`, with zero mapping to zero.
    pub const fn digital_root_invariant(&self) -> u64 {
        if self.raw_value == 0 {
            0
        } else {
            ((self.raw_value - 1) % BASE_MODULUS) + 1
        }
    }
}

// ---------------------------------------------------------------------------
// Greatest common divisor
// ---------------------------------------------------------------------------

/// Euclidean GCD over the unsigned domain. Total, allocation-free, and cannot
/// overflow: every intermediate is bounded by its inputs.
pub const fn gcd_u64(mut a: u64, mut b: u64) -> u64 {
    while b != 0 {
        let temp = b;
        a %= b;
        b = a;
        a = temp;
    }
    a
}

/// Retained under the specification's name.
pub const fn checked_gcd(a: u64, b: u64) -> u64 {
    gcd_u64(a, b)
}

/// Signed GCD.
///
/// Computed over unsigned magnitudes so that `i64::MIN` never reaches `abs()`
/// (which panics in debug and wraps in release). The single case whose result
/// is not representable as `i64` — `gcd(i64::MIN, i64::MIN) = 2^63` — is
/// reported rather than silently saturated, which is why this returns a
/// `Result` where the source specification returned a bare `i64`.
pub fn checked_gcd_i64(a: i64, b: i64) -> Result<i64, EngineError> {
    let g = gcd_u64(a.unsigned_abs(), b.unsigned_abs());
    if g > i64::MAX as u64 {
        return Err(EngineError::IntegerOverflow);
    }
    Ok(g as i64)
}

// ---------------------------------------------------------------------------
// Exact rational 2x2 projection
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RationalMatrix2x2 {
    pub num: [[i64; 2]; 2],
    pub den: i64,
}

impl RationalMatrix2x2 {
    /// Reduces the matrix to canonical form: common factors divided out and the
    /// denominator forced positive.
    ///
    /// Sign normalisation is load-bearing. Without it `num = [[1,0],[0,1]], den = 1`
    /// and `num = [[-1,0],[0,-1]], den = -1` are the same rational matrix but
    /// compare unequal, so [`Self::is_idempotent`] — which decides `P² == P`
    /// by structural equality — would answer `false` for a genuine projection.
    #[cfg_attr(feature = "prusti", ensures(result.is_ok() ==> result.unwrap().den > 0))]
    pub fn simplify(&self) -> Result<Self, EngineError> {
        if self.den == 0 {
            return Err(EngineError::DivisionByZero);
        }

        let mut g = self.den.unsigned_abs();
        for row in &self.num {
            for &val in row {
                g = gcd_u64(g, val.unsigned_abs());
            }
        }
        if g == 0 {
            return Err(EngineError::DivisionByZero);
        }
        if g > i64::MAX as u64 {
            // Only reachable when den == i64::MIN and every numerator is 0 or
            // i64::MIN; the divisor 2^63 is not representable as i64.
            return Err(EngineError::IntegerOverflow);
        }
        let g = g as i64;

        let mut num = [
            [self.num[0][0] / g, self.num[0][1] / g],
            [self.num[1][0] / g, self.num[1][1] / g],
        ];
        let mut den = self.den / g;

        if den < 0 {
            den = den.checked_neg().ok_or(EngineError::IntegerOverflow)?;
            for row in num.iter_mut() {
                for val in row.iter_mut() {
                    *val = val.checked_neg().ok_or(EngineError::IntegerOverflow)?;
                }
            }
        }

        Ok(Self { num, den })
    }

    /// Exact 2x2 rational multiplication, reduced to canonical form.
    pub fn checked_mul(&self, rhs: &Self) -> Result<Self, EngineError> {
        let common_den = self
            .den
            .checked_mul(rhs.den)
            .ok_or(EngineError::IntegerOverflow)?;
        let mut res_num = [[0i64; 2]; 2];

        for i in 0..2 {
            for j in 0..2 {
                let mut sum: i64 = 0;
                for k in 0..2 {
                    let prod = self.num[i][k]
                        .checked_mul(rhs.num[k][j])
                        .ok_or(EngineError::IntegerOverflow)?;
                    sum = sum.checked_add(prod).ok_or(EngineError::IntegerOverflow)?;
                }
                res_num[i][j] = sum;
            }
        }

        Self {
            num: res_num,
            den: common_den,
        }
        .simplify()
    }

    /// Evaluates the idempotence invariant `P² == P`.
    pub fn is_idempotent(&self) -> Result<bool, EngineError> {
        let simplified = self.simplify()?;
        let squared = simplified.checked_mul(&simplified)?;
        Ok(squared == simplified)
    }

    /// Strict form: returns the canonical projection or [`EngineError::NonIdempotentState`].
    pub fn require_idempotent(&self) -> Result<Self, EngineError> {
        if self.is_idempotent()? {
            self.simplify()
        } else {
            Err(EngineError::NonIdempotentState)
        }
    }
}

// ---------------------------------------------------------------------------
// Transaction state seal
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TransactionHashSeal {
    pub hash_bytes: [u8; 32],
}

impl TransactionHashSeal {
    pub const fn new(hash_bytes: [u8; 32]) -> Self {
        Self { hash_bytes }
    }

    /// Wrapping sum of the four big-endian 64-bit words of the hash.
    ///
    /// Wrapping is intentional: the sum is a reduction, not a quantity.
    pub fn word_sum(&self) -> u64 {
        let mut word_sum: u64 = 0;
        for chunk in self.hash_bytes.chunks_exact(8) {
            let val = u64::from_be_bytes([
                chunk[0], chunk[1], chunk[2], chunk[3], chunk[4], chunk[5], chunk[6], chunk[7],
            ]);
            word_sum = word_sum.wrapping_add(val);
        }
        word_sum
    }

    /// The hash's residue modulo 243 — the part of the reduction that actually
    /// depends on the hash.
    pub fn reduced_word_sum(&self) -> u64 {
        self.word_sum() % MILESIAN_SALVI_SUM
    }

    /// `f(x)`, as specified: `243 - rem + rem`.
    ///
    /// This is constant by construction — the residue is subtracted and added
    /// back, so `compute_fx` returns 243 for every possible hash and the seal
    /// carries no information about `hash_bytes`. It is implemented exactly as
    /// specified because the invariant being asserted is `f(x) ≡ 243`, but note
    /// that the corresponding proof obligation is therefore trivially
    /// discharged. If the seal is ever meant to bind a specific transaction,
    /// [`Self::reduced_word_sum`] is the term that does that.
    pub fn compute_fx(&self) -> u64 {
        let rem = self.reduced_word_sum();
        // rem < 243, so neither step can wrap.
        (MILESIAN_SALVI_SUM - rem) + rem
    }

    /// Verifies `f(x) - x_state = 0`.
    pub fn verify_state_seal(&self, on_chain_state: u64) -> Result<bool, EngineError> {
        let fx = self.compute_fx();
        if fx != on_chain_state {
            return Err(EngineError::HashVerificationFailed);
        }
        let delta = fx
            .checked_sub(on_chain_state)
            .ok_or(EngineError::IntegerOverflow)?;
        Ok(delta == 0)
    }
}

// ---------------------------------------------------------------------------
// Z = 0 discharge
// ---------------------------------------------------------------------------

/// The lossless discharge identity: `cost - market - clifford == 1` (Unity Alpha).
///
/// All three arguments are exact minor units (CAD cents). No float ever touches
/// a monetary figure.
pub fn verify_zero_state_balance(cost_cad: u64, market_cad: u64, clifford_correction: u64) -> bool {
    if cost_cad < market_cad {
        return false;
    }
    cost_cad
        .checked_sub(market_cad)
        .and_then(|d| d.checked_sub(clifford_correction))
        .map_or(false, |rem| rem == 1)
}

/// Strict form: returns [`EngineError::NonZeroBalanceViolation`] when the
/// ledger does not discharge to `Z = 0`.
pub fn require_zero_state_balance(
    cost_cad: u64,
    market_cad: u64,
    clifford_correction: u64,
) -> Result<(), EngineError> {
    if verify_zero_state_balance(cost_cad, market_cad, clifford_correction) {
        Ok(())
    } else {
        Err(EngineError::NonZeroBalanceViolation)
    }
}

/// Base-3 uniqueness: `Δ = (b - 3)(b + 1)` vanishes at exactly one positive
/// integer base within the scanned range, and that base is 3.
pub fn verify_base3_uniqueness() -> Result<i64, EngineError> {
    let mut zero_count = 0u32;
    let mut unique = 0i64;
    let mut b = 1i64;
    while b <= 1000 {
        let disc = (b - 3) * (b + 1);
        if disc == 0 {
            zero_count += 1;
            unique = b;
        }
        b += 1;
    }
    if zero_count == 1 && unique == 3 {
        Ok(unique)
    } else {
        Err(EngineError::Base3UniquenessViolation)
    }
}
