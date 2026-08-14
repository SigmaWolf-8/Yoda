//! HTTP surface for the Salvi fixed-precision engine (`salvi-engine`).
//!
//! Every endpoint here is pure computation over the caller's input — no
//! database, no network, no state. They exist so the kernel's invariants can be
//! exercised from the Lattice Assayer page and from an auditor's shell without
//! a Rust toolchain.
//!
//! ## What these endpoints do not claim
//!
//! `/seal/inspect` is named inspection, not verification, and returns
//! `binds_hash: false`. The specified `f(x)` cancels its own hash-dependent
//! term, so a "match" is true for every possible hash. Presenting it as
//! verification would be presenting a forgeable check as a proof.
//!
//! ## Exactness at the wire
//!
//! JSON numbers are IEEE-754 doubles in every browser, so any 64-bit value
//! above 2^53 loses precision in transit. Requests may therefore give integers
//! either as JSON numbers or as decimal strings, and every 64-bit figure in a
//! response is returned as a **string**. Nothing in this module converts a
//! value to floating point at any point.

use axum::{
    extract::{DefaultBodyLimit, Json as JsonBody},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use salvi_engine::{
    gcd_u64, verify_base3_uniqueness, verify_zero_state_balance, BijectiveBase9, EngineError,
    RationalMatrix2x2, TransactionHashSeal, BASE_MODULUS, MAX_BIJECTIVE_DIGITS,
    MILESIAN_SALVI_SUM,
};

use crate::error::AppError;
use crate::state::AppState;

/// Every request to this group is a handful of integers. Anything larger is a
/// caller trying to make an anonymous endpoint allocate on their behalf, so the
/// body is capped well below the framework default and over-limit bodies are
/// rejected with 413 before any handler runs.
const MAX_ENGINE_BODY_BYTES: usize = 2 * 1024;

/// A decimal `u64` is at most 20 characters, a signed one 20 plus a sign. The
/// cap exists so an error message cannot be used to echo back a large string.
const MAX_SCALAR_CHARS: usize = 24;

/// Bijective base-9 needs 21 digits to cover `u64`; the kernel enforces this
/// too, but rejecting here keeps an oversized array from being walked at all.
const MAX_DECODE_DIGITS: usize = 21;

/// Routes for the fixed-precision kernel. Public and unauthenticated by
/// design — they compute over the caller's own input and read nothing — but
/// rate-limited by body size rather than left open-ended.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/salvi/engine/attestation", get(attestation))
        .route("/api/salvi/engine/bijective/encode", post(encode))
        .route("/api/salvi/engine/bijective/decode", post(decode))
        .route("/api/salvi/engine/matrix/idempotent", post(matrix_idempotent))
        .route("/api/salvi/engine/seal/inspect", post(inspect_seal))
        .route("/api/salvi/engine/zero-balance", post(zero_balance))
        .layer(DefaultBodyLimit::max(MAX_ENGINE_BODY_BYTES))
}

/// An integer supplied either as a JSON number or as a decimal string.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum Scalar {
    Text(String),
    Signed(i64),
    Unsigned(u64),
}

impl Scalar {
    fn as_u64(&self, field: &str) -> Result<u64, AppError> {
        match self {
            Scalar::Text(s) => {
                let t = s.trim();
                if t.len() > MAX_SCALAR_CHARS {
                    return Err(AppError::Validation(format!(
                        "`{field}` is longer than {MAX_SCALAR_CHARS} characters"
                    )));
                }
                t.parse::<u64>().map_err(|_| {
                    AppError::Validation(format!(
                        "`{field}` must be a whole number in 0..=18446744073709551615, got \"{t}\""
                    ))
                })
            }
            Scalar::Signed(v) => u64::try_from(*v).map_err(|_| {
                AppError::Validation(format!("`{field}` must not be negative, got {v}"))
            }),
            Scalar::Unsigned(v) => Ok(*v),
        }
    }

    fn as_i64(&self, field: &str) -> Result<i64, AppError> {
        match self {
            Scalar::Text(s) => {
                let t = s.trim();
                if t.len() > MAX_SCALAR_CHARS {
                    return Err(AppError::Validation(format!(
                        "`{field}` is longer than {MAX_SCALAR_CHARS} characters"
                    )));
                }
                t.parse::<i64>().map_err(|_| {
                    AppError::Validation(format!(
                        "`{field}` must be a whole number in -9223372036854775808..=9223372036854775807, got \"{t}\""
                    ))
                })
            }
            Scalar::Signed(v) => Ok(*v),
            Scalar::Unsigned(v) => i64::try_from(*v).map_err(|_| {
                AppError::Validation(format!("`{field}` is too large for a signed 64-bit integer: {v}"))
            }),
        }
    }
}

/// Engine faults are caller-visible facts, not server failures: a 400 with the
/// exact variant, so an operator can see *which* invariant refused.
fn engine_error(context: &str, e: EngineError) -> AppError {
    let (code, detail) = match e {
        EngineError::InvalidDigit(d) => (
            "INVALID_DIGIT",
            format!("digit {d} is outside the bijective range 1..=9"),
        ),
        EngineError::IntegerOverflow => (
            "INTEGER_OVERFLOW",
            "the result is not representable in 64 bits; the engine refused rather than wrapping"
                .to_string(),
        ),
        EngineError::DivisionByZero => ("DIVISION_BY_ZERO", "denominator is zero".to_string()),
        EngineError::NonIdempotentState => (
            "NON_IDEMPOTENT_STATE",
            "the matrix does not satisfy P² = P".to_string(),
        ),
        EngineError::NonZeroBalanceViolation => (
            "NON_ZERO_BALANCE",
            "the ledger does not discharge to Z = 0".to_string(),
        ),
        EngineError::Base3UniquenessViolation => (
            "BASE3_UNIQUENESS",
            "the discriminant scan did not yield exactly one root at b = 3".to_string(),
        ),
        EngineError::HashVerificationFailed => (
            "HASH_VERIFICATION_FAILED",
            "f(x) does not equal the supplied on-chain state".to_string(),
        ),
    };
    AppError::Validation(format!("{context}: {code} — {detail}"))
}

// ── Attestation ─────────────────────────────────────────────────────────

/// What the kernel guarantees, and what it does not. Read-only, no input.
pub async fn attestation() -> Json<serde_json::Value> {
    let max_20_digits = 13_677_373_641_439_044_900u64;
    Json(json!({
        "kernel": "salvi-engine",
        "properties": {
            "no_std": true,
            "heap_allocations": 0,
            "floating_point_operations": 0,
            "arithmetic": "checked u64 / i64; non-representable results return EngineError, never wrap or panic"
        },
        "constants": {
            "max_bijective_digits": MAX_BIJECTIVE_DIGITS,
            "base_modulus": BASE_MODULUS.to_string(),
            "milesian_salvi_sum": MILESIAN_SALVI_SUM.to_string()
        },
        "digit_buffer_bound": {
            "corrected_from": 20,
            "corrected_to": MAX_BIJECTIVE_DIGITS,
            "reason": "9^20 = 12157665459056928801 < 2^64-1 = 18446744073709551615. The largest value expressible in 20 bijective base-9 digits is (9^21-9)/8 = 13677373641439044900, which is below u64::MAX, so a 20-digit buffer rejects every input above it. 21 digits is the tight bound.",
            "largest_value_in_20_digits": max_20_digits.to_string(),
            "largest_u64": u64::MAX.to_string()
        },
        "verification": {
            "unit_and_property_tests": "cargo test -p salvi-engine",
            "bounded_model_checking": "cargo kani -p salvi-engine (harnesses compiled under --cfg kani)",
            "deductive_contracts": "cargo prusti with --features prusti (contracts are inert otherwise)",
            "status": "the test suite is executed in CI; the Kani and Prusti runs require their toolchains and are not executed here"
        },
        "known_vacuity": {
            "compute_fx": "f(x) is specified as 243 - rem + rem, which is 243 for every hash. The seal therefore does not bind hash_bytes, and any proof of f(x) = 243 is discharged trivially. reduced_word_sum is the term that actually depends on the hash.",
            "base3_uniqueness": "the scan is bounded to b in 1..=1000; it is a check over that range, not a proof over all integers."
        },
        "base3_uniqueness_root": verify_base3_uniqueness().map(|v| v.to_string()).unwrap_or_else(|_| "violated".to_string())
    }))
}

// ── Bijective Base-9 ────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct EncodeRequest {
    pub value: Scalar,
}

#[derive(Debug, Serialize)]
pub struct EncodeResponse {
    /// Exact input, echoed as a decimal string.
    pub value: String,
    /// Least-significant digit first, each in `1..=9`.
    pub digits: Vec<u8>,
    /// Most-significant digit first — the human reading order.
    pub digits_msd_first: Vec<u8>,
    pub digit_count: usize,
    pub digital_root: String,
    pub gcd_with_9: String,
    pub is_zero_state: bool,
}

pub async fn encode(
    JsonBody(req): JsonBody<EncodeRequest>,
) -> Result<Json<EncodeResponse>, AppError> {
    let value = req.value.as_u64("value")?;
    let b = BijectiveBase9::from_u64(value).map_err(|e| engine_error("encode", e))?;
    let digits = b.digits().to_vec();
    let mut msd = digits.clone();
    msd.reverse();

    Ok(Json(EncodeResponse {
        value: value.to_string(),
        digits,
        digits_msd_first: msd,
        digit_count: b.digit_len(),
        digital_root: b.digital_root_invariant().to_string(),
        gcd_with_9: b.gcd_9_invariant().to_string(),
        is_zero_state: b.digit_len() == 0,
    }))
}

#[derive(Debug, Deserialize)]
pub struct DecodeRequest {
    /// Least-significant digit first, each in `1..=9`.
    pub digits: Vec<u8>,
}

#[derive(Debug, Serialize)]
pub struct DecodeResponse {
    pub value: String,
    pub digits: Vec<u8>,
    pub roundtrip_exact: bool,
}

pub async fn decode(
    JsonBody(req): JsonBody<DecodeRequest>,
) -> Result<Json<DecodeResponse>, AppError> {
    if req.digits.len() > MAX_DECODE_DIGITS {
        return Err(AppError::Validation(format!(
            "`digits` holds {} entries; no u64 needs more than {MAX_DECODE_DIGITS} bijective base-9 digits",
            req.digits.len()
        )));
    }
    let b = BijectiveBase9::from_bijective_digits(&req.digits)
        .map_err(|e| engine_error("decode", e))?;
    let value = b.raw();
    // Re-encode and compare: the response states whether the round trip closed,
    // it does not assume it.
    let roundtrip_exact = BijectiveBase9::from_u64(value)
        .map(|re| re.digits() == b.digits())
        .unwrap_or(false);

    Ok(Json(DecodeResponse {
        value: value.to_string(),
        digits: b.digits().to_vec(),
        roundtrip_exact,
    }))
}

// ── Exact rational projection ───────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct MatrixRequest {
    /// Row-major 2x2 numerator.
    pub num: [[Scalar; 2]; 2],
    pub den: Scalar,
}

#[derive(Debug, Serialize)]
pub struct MatrixResponse {
    pub simplified_num: [[String; 2]; 2],
    pub simplified_den: String,
    pub is_idempotent: bool,
}

pub async fn matrix_idempotent(
    JsonBody(req): JsonBody<MatrixRequest>,
) -> Result<Json<MatrixResponse>, AppError> {
    let mut num = [[0i64; 2]; 2];
    for (i, row) in req.num.iter().enumerate() {
        for (j, cell) in row.iter().enumerate() {
            num[i][j] = cell.as_i64(&format!("num[{i}][{j}]"))?;
        }
    }
    let den = req.den.as_i64("den")?;

    let m = RationalMatrix2x2 { num, den };
    let simplified = m.simplify().map_err(|e| engine_error("simplify", e))?;
    let is_idempotent = m
        .is_idempotent()
        .map_err(|e| engine_error("idempotence", e))?;

    Ok(Json(MatrixResponse {
        simplified_num: [
            [
                simplified.num[0][0].to_string(),
                simplified.num[0][1].to_string(),
            ],
            [
                simplified.num[1][0].to_string(),
                simplified.num[1][1].to_string(),
            ],
        ],
        simplified_den: simplified.den.to_string(),
        is_idempotent,
    }))
}

// ── State seal ──────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct SealRequest {
    /// 32 bytes, 64 hex characters, with or without a `0x` prefix.
    pub hash_hex: String,
    /// Defaults to 243 when omitted.
    pub on_chain_state: Option<Scalar>,
}

#[derive(Debug, Serialize)]
pub struct SealResponse {
    pub hash_hex: String,
    pub word_sum: String,
    pub reduced_word_sum: String,
    pub fx: String,
    pub on_chain_state: String,
    /// Whether `f(x)` equals the supplied state. NOT a hash verification: see
    /// `binds_hash`.
    pub fx_equals_state: bool,
    /// Always false. `f(x) = 243 - rem + rem` cancels the only hash-dependent
    /// term, so `fx_equals_state` is true for *every* 32-byte input whenever
    /// `on_chain_state` is 243, and is trivially forgeable. This field is here
    /// so a caller can detect that in code rather than by reading prose.
    pub binds_hash: bool,
    pub note: &'static str,
}

fn parse_hash_32(input: &str) -> Result<[u8; 32], AppError> {
    let s = input.trim().trim_start_matches("0x").trim_start_matches("0X");
    if s.len() != 64 {
        return Err(AppError::Validation(format!(
            "`hash_hex` must be exactly 64 hex characters (32 bytes), got {}",
            s.len()
        )));
    }
    let bytes = s.as_bytes();
    let mut out = [0u8; 32];
    for i in 0..32 {
        let hi = (bytes[2 * i] as char).to_digit(16).ok_or_else(|| {
            AppError::Validation(format!(
                "`hash_hex` contains a non-hex character at position {}",
                2 * i
            ))
        })?;
        let lo = (bytes[2 * i + 1] as char).to_digit(16).ok_or_else(|| {
            AppError::Validation(format!(
                "`hash_hex` contains a non-hex character at position {}",
                2 * i + 1
            ))
        })?;
        out[i] = ((hi << 4) | lo) as u8;
    }
    Ok(out)
}

pub async fn inspect_seal(
    JsonBody(req): JsonBody<SealRequest>,
) -> Result<Json<SealResponse>, AppError> {
    let hash = parse_hash_32(&req.hash_hex)?;
    let state = match &req.on_chain_state {
        Some(s) => s.as_u64("on_chain_state")?,
        None => MILESIAN_SALVI_SUM,
    };

    let seal = TransactionHashSeal::new(hash);
    let fx = seal.compute_fx();
    // A mismatch is a verdict, not a server error: report it rather than
    // failing the request.
    let fx_equals_state = matches!(seal.verify_state_seal(state), Ok(true));

    Ok(Json(SealResponse {
        hash_hex: req.hash_hex.trim().to_string(),
        word_sum: seal.word_sum().to_string(),
        reduced_word_sum: seal.reduced_word_sum().to_string(),
        fx: fx.to_string(),
        on_chain_state: state.to_string(),
        fx_equals_state,
        binds_hash: false,
        note: "Inspection, not verification. f(x) is constant at 243 by construction, so fx_equals_state holds for every hash and proves nothing about this one. reduced_word_sum is the only returned term that depends on hash_hex.",
    }))
}

// ── Z = 0 discharge ─────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct BalanceRequest {
    /// Exact minor units (CAD cents). No float ever touches a monetary figure.
    pub cost_cad_cents: Scalar,
    pub market_cad_cents: Scalar,
    pub clifford_correction: Scalar,
}

#[derive(Debug, Serialize)]
pub struct BalanceResponse {
    pub cost_cad_cents: String,
    pub market_cad_cents: String,
    pub clifford_correction: String,
    /// `cost - market - clifford`, or `null` when that subtraction would go
    /// below zero (the engine refuses rather than wrapping).
    pub residue: Option<String>,
    pub required_residue: &'static str,
    pub discharged: bool,
    pub gcd_of_inputs: String,
    pub note: &'static str,
}

pub async fn zero_balance(
    JsonBody(req): JsonBody<BalanceRequest>,
) -> Result<Json<BalanceResponse>, AppError> {
    let cost = req.cost_cad_cents.as_u64("cost_cad_cents")?;
    let market = req.market_cad_cents.as_u64("market_cad_cents")?;
    let clifford = req.clifford_correction.as_u64("clifford_correction")?;

    let residue = cost
        .checked_sub(market)
        .and_then(|d| d.checked_sub(clifford));

    Ok(Json(BalanceResponse {
        cost_cad_cents: cost.to_string(),
        market_cad_cents: market.to_string(),
        clifford_correction: clifford.to_string(),
        residue: residue.map(|r| r.to_string()),
        required_residue: "1",
        discharged: verify_zero_state_balance(cost, market, clifford),
        gcd_of_inputs: gcd_u64(gcd_u64(cost, market), clifford).to_string(),
        note: "Despite the name, the discharge condition is cost - market - clifford = 1 (Unity Alpha), not 0, as specified. A residue of 0 is therefore NOT discharged.",
    }))
}
