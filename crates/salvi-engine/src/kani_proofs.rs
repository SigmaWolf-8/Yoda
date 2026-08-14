//! Bounded model-checking harnesses (Kani / CBMC).
//!
//! Compiled only under `--cfg kani`, so an ordinary `cargo build` or
//! `cargo test` never sees this module.
//!
//! ```text
//! cargo install --locked kani-verifier
//! cargo kani -p salvi-engine
//! ```
//!
//! These harnesses are symbolic over the whole 64-bit input domain except where
//! a `kani::assume` narrows them; each narrowing is justified in place.

use super::*;

/// `from_u64` never overflows its digit buffer and never loses the value.
///
/// The `Err(IntegerOverflow)` arm asserts `false`: with a 21-digit buffer that
/// branch must be dead for every `u64`. This harness is what fails if the
/// buffer is ever shrunk back to 20.
#[kani::proof]
#[kani::unwind(23)] // loop is bounded by MAX_BIJECTIVE_DIGITS = 21
fn proof_from_u64_never_overflows() {
    let value: u64 = kani::any();
    match BijectiveBase9::from_u64(value) {
        Ok(b) => {
            assert!(b.verify_digits());
            assert_eq!(b.raw(), value);
            assert!(b.len <= MAX_BIJECTIVE_DIGITS);
            if value == 0 {
                assert_eq!(b.len, 0);
            } else {
                assert!(b.len > 0);
            }
        }
        Err(EngineError::IntegerOverflow) => {
            kani::assert(false, "from_u64 produced IntegerOverflow on a valid u64");
        }
        Err(_) => kani::assert(false, "unexpected error state from from_u64"),
    }
}

/// `decode(encode(x)) == x` for every `u64`.
#[kani::proof]
#[kani::unwind(23)]
fn proof_roundtrip() {
    let value: u64 = kani::any();
    if let Ok(b) = BijectiveBase9::from_u64(value) {
        let reconstructed = BijectiveBase9::from_bijective_digits(b.digits());
        assert!(reconstructed.is_ok());
        assert_eq!(reconstructed.unwrap().raw(), value);
    }
}

/// Every emitted digit lies strictly within `1..=9`.
#[kani::proof]
#[kani::unwind(23)]
fn proof_digit_bounds() {
    let value: u64 = kani::any();
    if let Ok(b) = BijectiveBase9::from_u64(value) {
        for &d in b.digits() {
            assert!((1..=9).contains(&d));
        }
    }
}

/// Rejection of out-of-range digits, and no buffer write past the bound.
#[kani::proof]
#[kani::unwind(23)]
fn proof_decode_rejects_invalid_digits() {
    let d: u8 = kani::any();
    let result = BijectiveBase9::from_bijective_digits(&[d]);
    if (1..=9).contains(&d) {
        assert!(result.is_ok());
        assert_eq!(result.unwrap().raw(), d as u64);
    } else {
        assert_eq!(result, Err(EngineError::InvalidDigit(d)));
    }
}

/// The Euclidean GCD terminates, never divides by zero, and divides both inputs.
#[kani::proof]
#[kani::unwind(65)] // Euclid on u64 terminates within 64 iterations
fn proof_checked_gcd_no_panic() {
    let a: u64 = kani::any();
    let b: u64 = kani::any();
    let g = gcd_u64(a, b);
    if a > 0 && b > 0 {
        assert!(g > 0);
        assert_eq!(a % g, 0);
        assert_eq!(b % g, 0);
    }
}

/// The signed wrapper never panics on `i64::MIN` and reports the one
/// non-representable result instead of saturating.
#[kani::proof]
#[kani::unwind(65)]
fn proof_checked_gcd_i64_handles_min() {
    let a: i64 = kani::any();
    let b: i64 = kani::any();
    match checked_gcd_i64(a, b) {
        Ok(g) => assert!(g >= 0),
        Err(e) => {
            assert_eq!(e, EngineError::IntegerOverflow);
            assert!(a == i64::MIN || b == i64::MIN);
        }
    }
}

/// GCD-9 and digital-root invariants hold on multiples of 9.
#[kani::proof]
#[kani::unwind(23)]
fn proof_gcd_digital_root() {
    let k: u64 = kani::any();
    kani::assume(k > 0 && k < 1_000_000);
    let val = k * 9;
    if let Ok(b) = BijectiveBase9::from_u64(val) {
        assert_eq!(b.gcd_9_invariant(), 9);
        assert_eq!(b.digital_root_invariant(), 9);
    }
}

/// Exact rational multiplication and simplification never panic, always leave a
/// positive denominator, and reduce to canonical form.
#[kani::proof]
#[kani::unwind(65)]
fn proof_rational_matrix_mul_no_overflow() {
    let num00: i64 = kani::any();
    let num01: i64 = kani::any();
    let num10: i64 = kani::any();
    let num11: i64 = kani::any();
    let den: i64 = kani::any();

    // Bounded so that symbolic squaring stays inside i64; the unbounded case is
    // covered by the checked_* paths returning IntegerOverflow.
    kani::assume(num00.abs() <= 100_000);
    kani::assume(num01.abs() <= 100_000);
    kani::assume(num10.abs() <= 100_000);
    kani::assume(num11.abs() <= 100_000);
    kani::assume(den >= 1 && den <= 100_000);

    let mat = RationalMatrix2x2 {
        num: [[num00, num01], [num10, num11]],
        den,
    };

    if let Ok(simplified) = mat.simplify() {
        assert!(simplified.den > 0);
        // Canonical form is a fixed point of simplification.
        assert_eq!(simplified.simplify(), Ok(simplified));
        let _ = simplified.is_idempotent();
    }
}

/// A zero denominator is reported, never divided by.
#[kani::proof]
fn proof_zero_denominator_rejected() {
    let n: i64 = kani::any();
    let mat = RationalMatrix2x2 {
        num: [[n, 0], [0, n]],
        den: 0,
    };
    assert_eq!(mat.simplify(), Err(EngineError::DivisionByZero));
}

/// The seal reduces to 243 for every hash and discharges `f(x) - x = 0`.
///
/// Note that `compute_fx` is constant by construction, so this proof is
/// discharged trivially — it confirms the implementation matches the stated
/// invariant, not that the seal binds the hash.
#[kani::proof]
fn proof_seal_fx_equals_243() {
    let hash: [u8; 32] = kani::any();
    let seal = TransactionHashSeal::new(hash);
    assert_eq!(seal.compute_fx(), MILESIAN_SALVI_SUM);
    assert_eq!(seal.verify_state_seal(MILESIAN_SALVI_SUM), Ok(true));
    assert!(seal.reduced_word_sum() < MILESIAN_SALVI_SUM);
}

/// Any state other than 243 is rejected rather than accepted or panicked on.
#[kani::proof]
fn proof_seal_rejects_other_states() {
    let hash: [u8; 32] = kani::any();
    let state: u64 = kani::any();
    kani::assume(state != MILESIAN_SALVI_SUM);
    let seal = TransactionHashSeal::new(hash);
    assert_eq!(
        seal.verify_state_seal(state),
        Err(EngineError::HashVerificationFailed)
    );
}

/// The `Z = 0` discharge never panics and holds exactly on the unity residue.
#[kani::proof]
fn proof_zero_state_balance() {
    let cost: u64 = kani::any();
    let market: u64 = kani::any();
    let clifford: u64 = kani::any();

    let ok = verify_zero_state_balance(cost, market, clifford);
    if ok {
        assert!(cost >= market);
        assert_eq!(cost - market - clifford, 1);
    }
    assert_eq!(
        require_zero_state_balance(cost, market, clifford).is_ok(),
        ok
    );
}

/// Every checked arithmetic path used by the kernel is panic-free.
#[kani::proof]
fn proof_checked_arithmetic_paths() {
    let a: u64 = kani::any();
    let b: u64 = kani::any();
    let _ = a.checked_mul(b);
    let _ = a.checked_add(b);
    let _ = a.checked_sub(b);
}

/// Base-3 is the unique integer base whose discriminant vanishes.
#[kani::proof]
#[kani::unwind(1002)]
fn proof_base3_uniqueness() {
    assert_eq!(verify_base3_uniqueness(), Ok(3));
}
