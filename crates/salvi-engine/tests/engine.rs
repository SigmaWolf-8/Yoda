//! Executable test suite for the Salvi engine.
//!
//! These run under an ordinary `cargo test`. They are integration tests rather
//! than an in-crate `#[cfg(test)]` module so the library target stays strictly
//! `no_std` — a `#[cfg(test)]` module would pull `std` back in through the test
//! harness and the `no_std` attribute would stop meaning anything.

use salvi_engine::*;

// ---------------------------------------------------------------------------
// Bijective Base-9
// ---------------------------------------------------------------------------

#[test]
fn zero_is_z_zero() {
    let z = BijectiveBase9::from_u64(0).unwrap();
    assert_eq!(z, BijectiveBase9::Z_ZERO);
    assert_eq!(z.digit_len(), 0);
    assert!(z.digits().is_empty());
    assert_eq!(z.digital_root_invariant(), 0);
    assert!(z.verify_digits());
}

#[test]
fn small_values_encode_to_single_digits() {
    for n in 1..=9u64 {
        let b = BijectiveBase9::from_u64(n).unwrap();
        assert_eq!(b.digits(), &[n as u8]);
        assert_eq!(b.raw(), n);
    }
    // 10 = 1*9 + 1 -> digits [1, 1] little-endian
    assert_eq!(BijectiveBase9::from_u64(10).unwrap().digits(), &[1, 1]);
    // 90 = 9*9 + 9 -> [9, 9]
    assert_eq!(BijectiveBase9::from_u64(90).unwrap().digits(), &[9, 9]);
}

#[test]
fn max_digit_length_of_u64() {
    // The specified buffer of 20 is too small; 21 is the tight bound.
    // max in 20 digits = (9^21 - 9)/8 = 13_677_373_641_439_044_901 < u64::MAX
    let b = BijectiveBase9::from_u64(u64::MAX).expect("u64::MAX must encode");
    assert!(b.verify_digits());
    assert_eq!(b.raw(), u64::MAX);
    assert_eq!(b.digit_len(), 21);
    assert!(b.digit_len() <= MAX_BIJECTIVE_DIGITS);
}

#[test]
fn twenty_digits_would_not_have_been_enough() {
    // Largest value representable in 20 bijective digits: (9^21 - 9) / 8.
    let boundary = 13_677_373_641_439_044_900u64;
    assert_eq!(
        BijectiveBase9::from_u64(boundary).unwrap().digit_len(),
        20,
        "largest 20-digit value"
    );
    assert_eq!(
        BijectiveBase9::from_u64(boundary + 1).unwrap().digit_len(),
        21,
        "first value that overflows a 20-digit buffer"
    );
}

#[test]
fn roundtrip_across_the_domain() {
    let samples = [
        0u64,
        1,
        8,
        9,
        10,
        81,
        90,
        243,
        882,
        1001,
        u32::MAX as u64,
        u64::MAX / 3,
        13_677_373_641_439_044_900,
        u64::MAX - 1,
        u64::MAX,
    ];
    for v in samples {
        let encoded = BijectiveBase9::from_u64(v).unwrap();
        let decoded = BijectiveBase9::from_bijective_digits(encoded.digits()).unwrap();
        assert_eq!(decoded.raw(), v, "roundtrip failed for {v}");
    }
}

#[test]
fn roundtrip_is_exact_over_a_dense_sweep() {
    for v in 0..20_000u64 {
        let e = BijectiveBase9::from_u64(v).unwrap();
        assert!(e.verify_digits());
        assert!(e.digits().iter().all(|&d| (1..=9).contains(&d)));
        assert_eq!(
            BijectiveBase9::from_bijective_digits(e.digits())
                .unwrap()
                .raw(),
            v
        );
    }
}

#[test]
fn decode_rejects_out_of_range_digits() {
    assert_eq!(
        BijectiveBase9::from_bijective_digits(&[0]),
        Err(EngineError::InvalidDigit(0))
    );
    assert_eq!(
        BijectiveBase9::from_bijective_digits(&[1, 10]),
        Err(EngineError::InvalidDigit(10))
    );
}

#[test]
fn decode_rejects_overlong_digit_strings() {
    let too_many = [9u8; MAX_BIJECTIVE_DIGITS + 1];
    assert_eq!(
        BijectiveBase9::from_bijective_digits(&too_many),
        Err(EngineError::IntegerOverflow)
    );
}

#[test]
fn decode_reports_overflow_rather_than_wrapping() {
    // 21 nines decodes to (9^22 - 9)/8, far beyond u64::MAX.
    let all_nines = [9u8; MAX_BIJECTIVE_DIGITS];
    assert_eq!(
        BijectiveBase9::from_bijective_digits(&all_nines),
        Err(EngineError::IntegerOverflow)
    );
}

#[test]
fn empty_digit_string_is_zero() {
    assert_eq!(
        BijectiveBase9::from_bijective_digits(&[]).unwrap(),
        BijectiveBase9::Z_ZERO
    );
}

#[test]
fn gcd_and_digital_root_invariants() {
    for k in 1..2_000u64 {
        let b = BijectiveBase9::from_u64(k * 9).unwrap();
        assert_eq!(b.gcd_9_invariant(), 9);
        assert_eq!(b.digital_root_invariant(), 9);
    }
    let b = BijectiveBase9::from_u64(243).unwrap();
    assert_eq!(b.gcd_9_invariant(), 9);
    assert_eq!(b.digital_root_invariant(), 9);

    let b = BijectiveBase9::from_u64(10).unwrap();
    assert_eq!(b.gcd_9_invariant(), 1);
    assert_eq!(b.digital_root_invariant(), 1);
}

// ---------------------------------------------------------------------------
// GCD
// ---------------------------------------------------------------------------

#[test]
fn gcd_basics() {
    assert_eq!(gcd_u64(0, 0), 0);
    assert_eq!(gcd_u64(12, 18), 6);
    assert_eq!(gcd_u64(17, 5), 1);
    assert_eq!(gcd_u64(u64::MAX, 0), u64::MAX);
    // 882 = 2 * 3^2 * 7^2, 243 = 3^5  ->  gcd = 9
    assert_eq!(checked_gcd(882, 243), 9);
}

#[test]
fn signed_gcd_survives_i64_min() {
    // i64::MIN.abs() panics in debug; the engine must not go near it.
    assert_eq!(checked_gcd_i64(i64::MIN, 2), Ok(2));
    assert_eq!(checked_gcd_i64(-12, 18), Ok(6));
    assert_eq!(checked_gcd_i64(0, -7), Ok(7));
    // The single non-representable result is reported, not saturated.
    assert_eq!(
        checked_gcd_i64(i64::MIN, i64::MIN),
        Err(EngineError::IntegerOverflow)
    );
}

// ---------------------------------------------------------------------------
// Rational projection
// ---------------------------------------------------------------------------

#[test]
fn identity_is_idempotent() {
    let identity = RationalMatrix2x2 {
        num: [[1, 0], [0, 1]],
        den: 1,
    };
    assert_eq!(identity.is_idempotent(), Ok(true));
}

#[test]
fn equilateral_projection_is_idempotent() {
    // P = 1/2 * [[1,1],[1,1]] projects onto the equal-weight line; P^2 = P.
    let p = RationalMatrix2x2 {
        num: [[1, 1], [1, 1]],
        den: 2,
    };
    assert_eq!(p.is_idempotent(), Ok(true));
    assert!(p.require_idempotent().is_ok());
}

#[test]
fn negative_denominator_normalises() {
    let a = RationalMatrix2x2 {
        num: [[1, 0], [0, 1]],
        den: 1,
    };
    let b = RationalMatrix2x2 {
        num: [[-1, 0], [0, -1]],
        den: -1,
    };
    // The same rational matrix written two ways must simplify identically,
    // otherwise structural equality is not a valid idempotence test.
    assert_eq!(a.simplify(), b.simplify());
    assert_eq!(b.is_idempotent(), Ok(true));
    assert!(b.simplify().unwrap().den > 0);
}

#[test]
fn common_factors_are_divided_out() {
    let m = RationalMatrix2x2 {
        num: [[4, 8], [12, 16]],
        den: 4,
    };
    let s = m.simplify().unwrap();
    assert_eq!(s.num, [[1, 2], [3, 4]]);
    assert_eq!(s.den, 1);
}

#[test]
fn non_projection_is_not_idempotent() {
    let m = RationalMatrix2x2 {
        num: [[2, 0], [0, 2]],
        den: 1,
    };
    assert_eq!(m.is_idempotent(), Ok(false));
    assert_eq!(m.require_idempotent(), Err(EngineError::NonIdempotentState));
}

#[test]
fn zero_denominator_is_rejected() {
    let m = RationalMatrix2x2 {
        num: [[1, 0], [0, 1]],
        den: 0,
    };
    assert_eq!(m.simplify(), Err(EngineError::DivisionByZero));
    assert_eq!(m.is_idempotent(), Err(EngineError::DivisionByZero));
}

#[test]
fn multiplication_reports_overflow_instead_of_wrapping() {
    let big = RationalMatrix2x2 {
        num: [[i64::MAX, i64::MAX], [i64::MAX, i64::MAX]],
        den: 1,
    };
    assert_eq!(big.checked_mul(&big), Err(EngineError::IntegerOverflow));
}

#[test]
fn simplify_is_a_fixed_point() {
    let m = RationalMatrix2x2 {
        num: [[6, -9], [15, 3]],
        den: -3,
    };
    let once = m.simplify().unwrap();
    assert_eq!(once.simplify(), Ok(once));
    assert!(once.den > 0);
}

// ---------------------------------------------------------------------------
// Seal
// ---------------------------------------------------------------------------

#[test]
fn seal_reduces_to_243() {
    let seal = TransactionHashSeal::new([0u8; 32]);
    assert_eq!(seal.compute_fx(), MILESIAN_SALVI_SUM);
    assert_eq!(seal.verify_state_seal(MILESIAN_SALVI_SUM), Ok(true));
}

#[test]
fn seal_is_constant_across_hashes() {
    // Documented consequence of `243 - rem + rem`: the seal does not bind the
    // hash. The residue is the term that does.
    let a = TransactionHashSeal::new([0u8; 32]);
    let b = TransactionHashSeal::new([0xFFu8; 32]);
    assert_eq!(a.compute_fx(), b.compute_fx());
    assert!(a.reduced_word_sum() < MILESIAN_SALVI_SUM);
    assert!(b.reduced_word_sum() < MILESIAN_SALVI_SUM);
}

#[test]
fn seal_rejects_a_mismatched_state() {
    let seal = TransactionHashSeal::new([7u8; 32]);
    assert_eq!(
        seal.verify_state_seal(242),
        Err(EngineError::HashVerificationFailed)
    );
    assert_eq!(
        seal.verify_state_seal(0),
        Err(EngineError::HashVerificationFailed)
    );
}

#[test]
fn word_sum_wraps_without_panicking() {
    let seal = TransactionHashSeal::new([0xFFu8; 32]);
    // Four copies of u64::MAX summed with wrapping addition.
    assert_eq!(seal.word_sum(), u64::MAX.wrapping_mul(4));
}

// ---------------------------------------------------------------------------
// Z = 0 and base-3 uniqueness
// ---------------------------------------------------------------------------

#[test]
fn zero_state_balance_holds_on_the_unity_residue() {
    // 131.04 - 96.96 CAD, in exact cents.
    let cost = 13_104u64;
    let market = 9_696u64;
    let clifford = 3_407u64;
    assert!(verify_zero_state_balance(cost, market, clifford));
    assert!(require_zero_state_balance(cost, market, clifford).is_ok());
}

#[test]
fn zero_state_balance_fails_closed() {
    assert!(!verify_zero_state_balance(100, 200, 0)); // cost < market
    assert!(verify_zero_state_balance(100, 50, 49)); // residue exactly 1
    assert!(!verify_zero_state_balance(100, 50, 48)); // residue 2
    assert!(!verify_zero_state_balance(100, 50, 100)); // underflow -> false, not a panic
    assert!(!verify_zero_state_balance(0, 0, 0)); // residue 0
    assert_eq!(
        require_zero_state_balance(0, 0, 0),
        Err(EngineError::NonZeroBalanceViolation)
    );
}

#[test]
fn base3_is_unique() {
    assert_eq!(verify_base3_uniqueness(), Ok(3));
}
