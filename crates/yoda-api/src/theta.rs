// ─────────────────────────────────────────────────────────────────────────────
// Θ-LOCK — the unified epoch and the fixed base-time theta angle.
//
// The Gate's possession factor is DERIVED, not delivered. There is no SMS, no
// carrier, no phone number and no third party in the trust path.
//
// Both sides — the operator's Crystal and the Gate — read the same clock and
// resolve it to the same angle on the ternary circle. Time is not transmitted;
// it is agreed. What the operator proves is that they hold the enrolled seed
// at this station of the revolution.
//
// The angular system is the Salvi Framework's, not the decimal one:
//
//   * a full circle is 364° = 111111₃  (six-digit base-3 repunit)
//   * one ternary radian is 13° = 111₃ (also T₇, the seventh Tribonacci number)
//   * the circle therefore holds exactly 28 stations — the cyclic group Z₂₈
//
// Everything below follows from those axioms and the fixed base time.
// ─────────────────────────────────────────────────────────────────────────────

use hmac::{Hmac, Mac};
use sha2::Sha256;

// ══════════════════════════════════════════════════════════════
// THE FIXED BASE TIME
// ══════════════════════════════════════════════════════════════

/// **The unified epoch.** The single fixed instant from which every theta
/// angle in the system is measured, expressed as a UTC Unix timestamp.
///
/// This is a *constant of the system*, not a configuration value: change it
/// and every previously issued reading moves. It is stated here once so that
/// every party — Gate, Crystal, and any future PlenumNET peer — measures from
/// the same origin rather than from whatever their local platform calls zero.
///
/// Set to the Unix origin (1970-01-01T00:00:00Z). To re-anchor the system to a
/// different base time, change this one value; nothing else needs to move.
pub const UNIFIED_EPOCH_UNIX: i64 = 0;

/// Seconds the angle dwells at each of the 28 stations: **169 = 13²**.
///
/// A ternary radian of a ternary radian. This is the lifetime of a reading —
/// long enough for an operator to read the angle off the painted torus and
/// pass, short enough that a captured reading is worthless by the next
/// revolution.
pub const STATION_DWELL_SECS: i64 = 169;

// ══════════════════════════════════════════════════════════════
// THE TERNARY CIRCLE (Salvi Framework axioms)
// ══════════════════════════════════════════════════════════════

/// A full circle: 364° = `111111₃`.
pub const FULL_CIRCLE_DEG: i64 = 364;

/// One ternary radian: 13° = `111₃`.
pub const RADIAN_DEG: i64 = 13;

/// Stations per revolution — the order of Z₂₈. 364 / 13 = 28.
pub const CYCLIC_ORDER: i64 = FULL_CIRCLE_DEG / RADIAN_DEG;

/// One full revolution of the theta angle, in seconds: 28 × 169 = 4732.
pub const REVOLUTION_SECS: i64 = CYCLIC_ORDER * STATION_DWELL_SECS;

/// Digits in a theta reading.
pub const READING_DIGITS: u32 = 6;

const READING_MODULUS: u32 = 1_000_000; // 10^READING_DIGITS

// ══════════════════════════════════════════════════════════════
// ANGLE
// ══════════════════════════════════════════════════════════════

/// Where the system stands on the circle at a given UTC instant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Theta {
    /// Revolutions completed since the unified epoch.
    pub revolution: i64,
    /// Station within the revolution, `0..28`.
    pub station: i64,
    /// The angle itself in ternary degrees, `0..364`, always a multiple of 13.
    pub degrees: i64,
}

impl Theta {
    /// Monotonic index of this station since the unified epoch. This — not the
    /// wall clock — is what a reading is bound to.
    pub fn absolute_station(&self) -> i64 {
        self.revolution * CYCLIC_ORDER + self.station
    }
}

/// Resolve a UTC Unix timestamp to its theta angle.
///
/// Uses Euclidean division so instants *before* the unified epoch resolve to a
/// sensible angle rather than a negative station.
pub fn theta_at(unix_seconds: i64) -> Theta {
    let elapsed = unix_seconds - UNIFIED_EPOCH_UNIX;
    let absolute = elapsed.div_euclid(STATION_DWELL_SECS);
    let revolution = absolute.div_euclid(CYCLIC_ORDER);
    let station = absolute.rem_euclid(CYCLIC_ORDER);
    Theta {
        revolution,
        station,
        degrees: station * RADIAN_DEG,
    }
}

/// The current theta angle.
pub fn theta_now() -> Theta {
    theta_at(chrono::Utc::now().timestamp())
}

/// Seconds remaining before the angle advances to the next station.
pub fn secs_to_next_station(unix_seconds: i64) -> i64 {
    let elapsed = unix_seconds - UNIFIED_EPOCH_UNIX;
    STATION_DWELL_SECS - elapsed.rem_euclid(STATION_DWELL_SECS)
}

// ══════════════════════════════════════════════════════════════
// READING — proof that the operator holds the seed at this station
// ══════════════════════════════════════════════════════════════

/// Derive the reading for a seed at an absolute station.
///
/// `HMAC-SHA256(seed, station_be_bytes)` truncated to six digits. Deliberately
/// an ordinary, exactly-specified construction: the Crystal computes this in
/// the browser with Web Crypto and the Gate computes it here, and the two must
/// agree bit for bit. Cleverness in this function would only create drift.
pub fn reading(seed: &[u8], absolute_station: i64) -> u32 {
    let mut mac = <Hmac<Sha256>>::new_from_slice(seed).expect("HMAC accepts any key length");
    mac.update(&absolute_station.to_be_bytes());
    let tag = mac.finalize().into_bytes();

    // RFC-4226-style dynamic truncation: the low nibble of the last byte picks
    // the offset, so no fixed slice of the tag is ever the whole answer.
    let offset = (tag[tag.len() - 1] & 0x0f) as usize;
    let truncated = u32::from_be_bytes([
        tag[offset] & 0x7f,
        tag[offset + 1],
        tag[offset + 2],
        tag[offset + 3],
    ]);
    truncated % READING_MODULUS
}

/// How many stations back a reading is still honoured.
///
/// One station of grace: an operator who reads the angle just as it advances
/// must not be turned away for the Gate's own timing. Two would double the
/// window an intercepted reading stays live, which is not worth it.
pub const GRACE_STATIONS: i64 = 1;

/// Verify a presented reading and report **which** station it belongs to.
///
/// The caller needs the station, not just a yes: a reading is only single-use
/// if the station it was drawn from can be recorded as spent.
///
/// Every candidate is compared in constant time and the loop always runs to
/// completion — a reading is a secret for the length of its station, and
/// early exit would leak its digits through timing.
pub fn verify_reading_station(seed: &[u8], presented: u32, now_unix: i64) -> Option<i64> {
    let current = theta_at(now_unix).absolute_station();
    let mut matched: i64 = -1;
    let mut found = false;
    for back in 0..=GRACE_STATIONS {
        let candidate = current - back;
        let hit = ct_eq_u32(reading(seed, candidate), presented);
        // Record the newest match without branching out of the loop.
        if hit && !found {
            matched = candidate;
            found = true;
        }
    }
    found.then_some(matched)
}

/// Verify a presented reading against the seed, allowing the grace window.
///
/// Does not enforce single-use on its own — see `verify_reading_station` and
/// the replay ledger in the gate handler.
pub fn verify_reading(seed: &[u8], presented: u32, now_unix: i64) -> bool {
    verify_reading_station(seed, presented, now_unix).is_some()
}

/// Constant-time equality for a reading.
#[inline]
fn ct_eq_u32(a: u32, b: u32) -> bool {
    let diff = a ^ b;
    // diff == 0  ⇒  result 1, otherwise 0, without branching on the value.
    (((diff | diff.wrapping_neg()) >> 31) ^ 1) == 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn circle_follows_the_salvi_axioms() {
        assert_eq!(FULL_CIRCLE_DEG, 364, "full circle is 111111 base 3");
        assert_eq!(RADIAN_DEG, 13, "one ternary radian is 111 base 3");
        assert_eq!(CYCLIC_ORDER, 28, "the circle holds Z28");
        assert_eq!(REVOLUTION_SECS, 4732);
    }

    #[test]
    fn angle_advances_one_station_per_dwell() {
        let base = UNIFIED_EPOCH_UNIX;
        assert_eq!(theta_at(base).station, 0);
        assert_eq!(theta_at(base).degrees, 0);
        assert_eq!(theta_at(base + STATION_DWELL_SECS - 1).station, 0);
        assert_eq!(theta_at(base + STATION_DWELL_SECS).station, 1);
        assert_eq!(theta_at(base + STATION_DWELL_SECS).degrees, 13);
    }

    #[test]
    fn angle_wraps_at_a_full_revolution() {
        let base = UNIFIED_EPOCH_UNIX;
        let one_turn = theta_at(base + REVOLUTION_SECS);
        assert_eq!(one_turn.station, 0);
        assert_eq!(one_turn.revolution, 1);
        assert_eq!(one_turn.absolute_station(), CYCLIC_ORDER);

        let last = theta_at(base + REVOLUTION_SECS - 1);
        assert_eq!(last.station, CYCLIC_ORDER - 1);
        assert_eq!(last.degrees, 351); // 27 * 13
    }

    #[test]
    fn degrees_are_always_a_whole_ternary_radian() {
        for s in [0, 1, 500, 100_000, 1_785_000_000] {
            let t = theta_at(s);
            assert_eq!(t.degrees % RADIAN_DEG, 0);
            assert!(t.degrees < FULL_CIRCLE_DEG);
        }
    }

    #[test]
    fn instants_before_the_epoch_still_resolve() {
        let t = theta_at(UNIFIED_EPOCH_UNIX - 1);
        assert!(t.station >= 0 && t.station < CYCLIC_ORDER);
        assert_eq!(t.station, CYCLIC_ORDER - 1);
    }

    #[test]
    fn reading_is_six_digits_and_station_bound() {
        let seed = b"a-seed-of-no-particular-length";
        let a = reading(seed, 100);
        let b = reading(seed, 101);
        assert!(a < 1_000_000 && b < 1_000_000);
        assert_ne!(a, b, "the angle must move the reading");
    }

    #[test]
    fn reading_is_seed_bound() {
        assert_ne!(reading(b"seed-one", 42), reading(b"seed-two", 42));
    }

    #[test]
    fn verify_accepts_current_and_one_station_of_grace() {
        let seed = b"enrolled-crystal-seed";
        let now = UNIFIED_EPOCH_UNIX + STATION_DWELL_SECS * 9;
        let station = theta_at(now).absolute_station();

        assert!(verify_reading(seed, reading(seed, station), now));
        assert!(verify_reading(seed, reading(seed, station - 1), now));
        // Two stations stale is outside the window.
        assert!(!verify_reading(seed, reading(seed, station - 2), now));
        // A future station must not be honoured.
        assert!(!verify_reading(seed, reading(seed, station + 1), now));
        // Another Crystal's reading never passes.
        assert!(!verify_reading(seed, reading(b"other-seed", station), now));
    }

    #[test]
    fn constant_time_equality_is_still_equality() {
        assert!(ct_eq_u32(0, 0));
        assert!(ct_eq_u32(999_999, 999_999));
        assert!(!ct_eq_u32(0, 1));
        assert!(!ct_eq_u32(u32::MAX, 0));
    }
}
