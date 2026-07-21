//! Three-Factor Authentication — Knowledge · Possession · Codepoint.
//!
//! Task #39: the Crystal (Array3 Cubes) page becomes the spec's "transparent
//! phone book" where a selected cube's coordinates form the third auth factor.
//!
//! Design constraints (from the attached spec):
//!   * Integer-only, deterministic, null-entropy core — no floats, no `rand`
//!     inside the security functions. Every value derives from a secret and a
//!     moving factor via an exact `lossless_mix` / `combine` mixer.
//!   * `Rational` (i64 num/den), `Codepoint { x, y, z }` with `to_scalar()`.
//!   * A `SmsSender` trait so the possession factor can be delivered by any
//!     gateway (Twilio, AWS SNS, PlenumLAN relay). A dev/console sender ships
//!     here so the flow is testable end-to-end without a carrier.
//!
//! CRYPTO SWAP-POINT: `lossless_mix` is the single place to drop in the real
//! PT26-DSA / ternary sponge primitive. Everything else composes on top of it.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

// ─── Lossless integer mixer (the swap-point) ──────────────────────────────

/// Exact, deterministic 64-bit mixer built from wrapping mul / xor / rotate.
/// Zero precision loss, no entropy source. Replace the body with a call to the
/// native ternary sponge for "Plenum+" grade — the callers do not change.
pub fn lossless_mix(mut x: u64) -> u64 {
    x = x.wrapping_mul(0x9E37_79B9_7F4A_7C15);
    x ^= x.rotate_left(31);
    x = x.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x ^= x.rotate_right(27);
    x = x.wrapping_mul(0x94D0_49BB_1331_11EB);
    x ^= x.rotate_left(17);
    x
}

/// Combine two scalars losslessly and deterministically.
pub fn combine(a: u64, b: u64) -> u64 {
    lossless_mix(a ^ b.rotate_left(32) ^ b.rotate_right(11))
}

// ─── Rational (integer num/den, normalized) ───────────────────────────────

/// A rational integer: exact `num/den`, sign carried on `num`, reduced by gcd.
/// No floats anywhere.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rational {
    pub num: i64,
    pub den: i64,
}

fn gcd(mut a: i64, mut b: i64) -> i64 {
    a = a.abs();
    b = b.abs();
    while b != 0 {
        let t = b;
        b = a % b;
        a = t;
    }
    if a == 0 {
        1
    } else {
        a
    }
}

impl Rational {
    /// Construct a normalized rational. `den == 0` is coerced to `1` (treated as
    /// an integer) so the mixer never divides by zero.
    pub fn new(num: i64, den: i64) -> Self {
        let den = if den == 0 { 1 } else { den };
        // Push sign onto the numerator.
        let (num, den) = if den < 0 { (-num, -den) } else { (num, den) };
        let g = gcd(num, den);
        Rational {
            num: num / g,
            den: den / g,
        }
    }

    /// Whole-number convenience constructor.
    pub fn int(n: i64) -> Self {
        Rational { num: n, den: 1 }
    }

    /// Lossless projection to a single unsigned scalar — mixes the reduced
    /// numerator and denominator so distinct rationals map to distinct scalars
    /// with vanishing collision probability.
    pub fn to_scalar(&self) -> u64 {
        combine(self.num as u64, self.den as u64)
    }
}

// ─── Codepoint (geometric third factor) ───────────────────────────────────

/// A geometric point on the Crystal — the third auth factor. `x/y/z` are the
/// selected cube's coordinates (Rep C trit coordinates 1..=3 in the Array3
/// case, but any rational is accepted).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Codepoint {
    pub x: Rational,
    pub y: Rational,
    pub z: Rational,
}

impl Codepoint {
    /// Construct from integer coordinates (the Crystal's common case).
    pub fn new(x: i64, y: i64, z: i64) -> Self {
        Codepoint {
            x: Rational::int(x),
            y: Rational::int(y),
            z: Rational::int(z),
        }
    }

    /// Lossless projection of the 3-D point to a single scalar.
    pub fn to_scalar(&self) -> u64 {
        combine(combine(self.x.to_scalar(), self.y.to_scalar()), self.z.to_scalar())
    }
}

// ─── Deterministic hashing / codes (null entropy) ─────────────────────────

/// Hash an arbitrary byte string (e.g. a PIN) to a stable 64-bit value.
pub fn hash_bytes(bytes: &[u8]) -> u64 {
    let mut acc: u64 = 0xCBF2_9CE4_8422_2325; // FNV offset basis, then mixed
    for &b in bytes {
        acc = combine(acc, b as u64);
    }
    lossless_mix(acc)
}

/// Hash a PIN / passphrase into the stored knowledge hash.
pub fn hash_knowledge(pin: &str) -> u64 {
    hash_bytes(pin.as_bytes())
}

/// Deterministic 6-digit possession code for a `(secret, moving_factor)` pair.
/// Pure function — identical inputs always yield the identical code.
pub fn generate_auth_code(secret: u64, moving_factor: u64) -> u32 {
    let h = combine(secret, moving_factor);
    (h % 1_000_000) as u32
}

// ─── SmsSender trait + dev/console sender ─────────────────────────────────

/// Delivery abstraction for the possession factor. Any carrier or relay can
/// implement this; the flow logic never changes.
pub trait SmsSender: Send + Sync {
    /// Deliver `code` to `phone`. Returns `Ok(Some(code))` when the sender is a
    /// dev/console fallback that echoes the code back (non-production only), or
    /// `Ok(None)` when a real carrier delivered it out of band.
    fn send_code(&self, phone: &str, code: u32) -> Result<Option<u32>, String>;
}

/// Dev/console sender — logs the code and returns it so the flow is testable
/// without a carrier. MUST NOT be used in production (it echoes the OTP).
pub struct ConsoleSmsSender;

impl SmsSender for ConsoleSmsSender {
    fn send_code(&self, phone: &str, code: u32) -> Result<Option<u32>, String> {
        tracing::info!(phone = %phone, code = code, "3FA possession code (dev console sender)");
        Ok(Some(code))
    }
}

// ─── ThreeFactorAuthenticator ─────────────────────────────────────────────

/// The authenticator. Generic over the delivery mechanism so a real gateway
/// drops in without touching verification logic.
pub struct ThreeFactorAuthenticator<S: SmsSender> {
    sms: S,
    /// Possession drift window (± steps) tolerated on the moving factor.
    drift: u64,
}

impl<S: SmsSender> ThreeFactorAuthenticator<S> {
    pub fn new(sms: S) -> Self {
        ThreeFactorAuthenticator { sms, drift: 1 }
    }

    /// Factor 1 — Knowledge. Verify a PIN against the stored hash.
    pub fn verify_knowledge(&self, stored_hash: u64, pin: &str) -> bool {
        hash_knowledge(pin) == stored_hash
    }

    /// Factor 2 — Possession (request). Generate the code and hand it to the
    /// sender. Returns whatever the sender echoes back (dev only).
    pub fn request_possession_code(
        &self,
        phone: &str,
        secret: u64,
        moving_factor: u64,
    ) -> Result<Option<u32>, String> {
        let code = generate_auth_code(secret, moving_factor);
        self.sms.send_code(phone, code)
    }

    /// Factor 2 — Possession (verify) with a symmetric drift window.
    pub fn verify_possession_code(&self, secret: u64, moving_factor: u64, code: u32) -> bool {
        let lo = moving_factor.saturating_sub(self.drift);
        let hi = moving_factor.saturating_add(self.drift);
        (lo..=hi).any(|mf| generate_auth_code(secret, mf) == code)
    }

    /// Factor 3 — Codepoint. Verify the point projects to the expected scalar.
    /// `moving_factor` binds the geometric factor to the session so a replayed
    /// point from a different session does not validate.
    pub fn verify_codepoint_factor(
        &self,
        point: &Codepoint,
        expected_scalar: u64,
        moving_factor: u64,
    ) -> bool {
        combine(point.to_scalar(), moving_factor) == expected_scalar
    }

    /// Expected codepoint scalar for a known-good point (used to seed a
    /// credential and to compute the value stored server-side).
    pub fn expected_codepoint_scalar(point: &Codepoint, moving_factor: u64) -> u64 {
        combine(point.to_scalar(), moving_factor)
    }

    /// Full presence scalar for a completed session / capability token.
    pub fn derive_presence_scalar(
        &self,
        knowledge_hash: u64,
        possession_secret: u64,
        codepoint: &Codepoint,
        moving_factor: u64,
    ) -> u64 {
        let a = combine(knowledge_hash, possession_secret);
        let b = combine(codepoint.to_scalar(), moving_factor);
        combine(a, b)
    }
}

// ─── Session state (in-memory, per-flow) ──────────────────────────────────

/// One in-flight 3FA session. Holds the seeded demo credential plus the
/// per-factor progress. Never leaks secrets to the client.
#[derive(Debug, Clone)]
pub struct ThreeFactorSession {
    pub phone: String,
    pub knowledge_hash: u64,
    pub possession_secret: u64,
    /// Expected codepoint (integer coordinates) — used to seed the scalar.
    pub expected_codepoint: Codepoint,
    /// Session nonce (moving factor at start). Binds the codepoint factor to the
    /// session so a point replayed from another session does not validate. The
    /// possession OTP is NOT anchored here — it is verified against the *current*
    /// moving factor so codes are genuinely time-windowed.
    pub moving_factor: u64,
    pub knowledge_ok: bool,
    pub possession_ok: bool,
    pub code_requested: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// Failed-attempt counters — cap brute force on each factor.
    pub knowledge_attempts: u32,
    pub possession_attempts: u32,
}

impl ThreeFactorSession {
    /// True once the session has outlived its TTL and must be rejected.
    pub fn is_expired(&self) -> bool {
        (chrono::Utc::now() - self.created_at).num_seconds() > SESSION_TTL_SECS
    }
}

/// How long an in-flight 3FA session stays valid before it must be restarted.
pub const SESSION_TTL_SECS: i64 = 300;
/// Hard cap on concurrently-tracked sessions — bounds the in-memory map so
/// unauthenticated `/start` calls cannot exhaust memory.
pub const MAX_ACTIVE_SESSIONS: usize = 1000;
/// Max failed attempts per factor before the session is burned.
pub const MAX_FACTOR_ATTEMPTS: u32 = 5;

/// Remove all expired sessions from the map. Called opportunistically on
/// `/start` so stale/abandoned sessions never accumulate unboundedly.
pub fn prune_expired(map: &mut HashMap<Uuid, ThreeFactorSession>) {
    map.retain(|_, s| !s.is_expired());
}

/// Sessions keyed by id. Cloneable handle shared in `AppState`.
pub type ThreeFactorSessions = Arc<RwLock<HashMap<Uuid, ThreeFactorSession>>>;

pub fn new_sessions() -> ThreeFactorSessions {
    Arc::new(RwLock::new(HashMap::new()))
}

/// Moving factor for the current instant — a 30-second TOTP-style step.
pub fn current_moving_factor() -> u64 {
    (chrono::Utc::now().timestamp().max(0) as u64) / 30
}

// ─── Seeded demo credential ───────────────────────────────────────────────
//
// Enrollment UI is future work (out of scope), so a single demo credential is
// seeded server-side. The Crystal flow is exercisable against these values.
// NOTE: dev/demo only — real credentials come from an enrollment step later.

/// Demo PIN (Factor 1).
pub const DEMO_PIN: &str = "1379";
/// Demo phone (Factor 2 delivery target).
pub const DEMO_PHONE: &str = "+15551234567";
/// Demo possession secret (Factor 2 seed).
pub const DEMO_POSSESSION_SECRET: u64 = 0x0FED_CBA9_8765_4321;
/// Demo codepoint coordinates (Factor 3) — a cube on the Crystal (N-agnostic
/// Rep C trit coordinates 1..=3).
pub const DEMO_CODEPOINT: (i64, i64, i64) = (1, 3, 2);

/// Build a fresh session from the seeded demo credential.
pub fn new_demo_session() -> ThreeFactorSession {
    let moving_factor = current_moving_factor();
    let (cx, cy, cz) = DEMO_CODEPOINT;
    ThreeFactorSession {
        phone: DEMO_PHONE.to_string(),
        knowledge_hash: hash_knowledge(DEMO_PIN),
        possession_secret: DEMO_POSSESSION_SECRET,
        expected_codepoint: Codepoint::new(cx, cy, cz),
        moving_factor,
        knowledge_ok: false,
        possession_ok: false,
        code_requested: false,
        created_at: chrono::Utc::now(),
        knowledge_attempts: 0,
        possession_attempts: 0,
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rational_normalizes_sign_and_gcd() {
        let r = Rational::new(4, -8);
        assert_eq!(r.num, -1);
        assert_eq!(r.den, 2);
        // den == 0 coerced to 1
        assert_eq!(Rational::new(5, 0).den, 1);
    }

    #[test]
    fn codepoint_scalar_is_deterministic_and_distinct() {
        let a = Codepoint::new(1, 3, 2);
        let b = Codepoint::new(1, 3, 2);
        let c = Codepoint::new(2, 3, 1);
        assert_eq!(a.to_scalar(), b.to_scalar());
        assert_ne!(a.to_scalar(), c.to_scalar());
    }

    #[test]
    fn knowledge_factor_verifies_and_rejects() {
        let auth = ThreeFactorAuthenticator::new(ConsoleSmsSender);
        let stored = hash_knowledge("fratello");
        assert!(auth.verify_knowledge(stored, "fratello"));
        assert!(!auth.verify_knowledge(stored, "wrong"));
    }

    #[test]
    fn possession_code_roundtrip_with_drift() {
        let auth = ThreeFactorAuthenticator::new(ConsoleSmsSender);
        let secret = 0xDEAD_BEEF;
        let mf = 1000;
        let code = auth
            .request_possession_code("+15551234567", secret, mf)
            .unwrap()
            .expect("console sender echoes code");
        assert!(auth.verify_possession_code(secret, mf, code));
        // Within drift window (previous step).
        let prev = generate_auth_code(secret, mf - 1);
        assert!(auth.verify_possession_code(secret, mf, prev));
        // Wrong code rejected.
        assert!(!auth.verify_possession_code(secret, mf, code.wrapping_add(1) % 1_000_000));
    }

    #[test]
    fn codepoint_factor_verifies_and_rejects() {
        let auth = ThreeFactorAuthenticator::new(ConsoleSmsSender);
        let mf = 42;
        let point = Codepoint::new(1, 3, 2);
        let expected =
            ThreeFactorAuthenticator::<ConsoleSmsSender>::expected_codepoint_scalar(&point, mf);
        assert!(auth.verify_codepoint_factor(&point, expected, mf));
        // Wrong point rejected.
        let wrong = Codepoint::new(3, 2, 1);
        assert!(!auth.verify_codepoint_factor(&wrong, expected, mf));
        // Right point, wrong moving factor rejected (replay protection).
        assert!(!auth.verify_codepoint_factor(&point, expected, mf + 1));
    }

    #[test]
    fn full_three_factor_flow() {
        let auth = ThreeFactorAuthenticator::new(ConsoleSmsSender);
        let mut session = new_demo_session();
        let mf = session.moving_factor;

        // Factor 1 — Knowledge.
        assert!(auth.verify_knowledge(session.knowledge_hash, DEMO_PIN));
        session.knowledge_ok = true;

        // Factor 2 — Possession.
        let code = auth
            .request_possession_code(&session.phone, session.possession_secret, mf)
            .unwrap()
            .unwrap();
        session.code_requested = true;
        assert!(auth.verify_possession_code(session.possession_secret, mf, code));
        session.possession_ok = true;

        // Factor 3 — Codepoint.
        let point = session.expected_codepoint;
        let expected =
            ThreeFactorAuthenticator::<ConsoleSmsSender>::expected_codepoint_scalar(&point, mf);
        assert!(auth.verify_codepoint_factor(&point, expected, mf));

        // Presence scalar is deterministic for the completed session.
        let p1 = auth.derive_presence_scalar(
            session.knowledge_hash,
            session.possession_secret,
            &point,
            mf,
        );
        let p2 = auth.derive_presence_scalar(
            session.knowledge_hash,
            session.possession_secret,
            &point,
            mf,
        );
        assert_eq!(p1, p2);
        assert_ne!(p1, 0);
    }
}
