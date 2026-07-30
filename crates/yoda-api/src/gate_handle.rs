// ─────────────────────────────────────────────────────────────────────────────
// Gate handles — opaque, fixed-size session references for the Torus Gate.
//
// The Gate does not issue JWTs. A JWT is base64-encoded JSON carrying claims
// the client can read and the server must re-parse on every request; that is
// exactly the shape this flow rejects.
//
// A gate handle is 32 bytes of CSPRNG entropy and nothing else. It carries no
// claims, no structure and no meaning — all authority lives server-side in the
// `gate_sessions` row keyed by the handle's digest. The wire form is the raw
// hex of those bytes.
//
// Discipline in this module:
//   * every value is a fixed-size array on the stack — no heap, no `String`,
//     no serde, no allocation on the hot path;
//   * nothing borrows: `to_hex` and `digest` return owned fixed-size arrays,
//     so no reference to secret material outlives the call that made it;
//   * secret bytes are zeroed on drop (best-effort — see `Drop` below);
//   * the core is `no_std`-compatible — only `generate` and `digest` reach for
//     platform entropy and hashing.
// ─────────────────────────────────────────────────────────────────────────────

use rand::RngCore;
use sha2::{Digest, Sha256};

/// Raw entropy in a handle. 256 bits — unguessable, and the same width as the
/// digest we store, so neither side is the weak link.
pub const HANDLE_BYTES: usize = 32;

/// Hex characters in the wire form.
pub const HANDLE_HEX: usize = HANDLE_BYTES * 2;

const HEX_LOWER: &[u8; 16] = b"0123456789abcdef";

/// An opaque gate session handle.
///
/// Deliberately not `Copy`: a handle is secret material with a `Drop` that
/// zeroes it, and implicit bitwise copies would scatter un-zeroed duplicates
/// across the stack.
pub struct GateHandle([u8; HANDLE_BYTES]);

impl GateHandle {
    /// Mint a fresh handle from the OS CSPRNG.
    pub fn generate() -> Self {
        let mut bytes = [0u8; HANDLE_BYTES];
        rand::rngs::OsRng.fill_bytes(&mut bytes);
        Self(bytes)
    }

    /// Render the wire form into an owned fixed-size buffer. Allocation-free;
    /// the caller decides whether it ever becomes a `String`.
    pub fn to_hex(&self) -> [u8; HANDLE_HEX] {
        let mut out = [0u8; HANDLE_HEX];
        for (i, byte) in self.0.iter().enumerate() {
            out[i * 2] = HEX_LOWER[(byte >> 4) as usize];
            out[i * 2 + 1] = HEX_LOWER[(byte & 0x0f) as usize];
        }
        out
    }

    /// Parse a wire-form handle. Returns `None` for anything that is not
    /// exactly `HANDLE_HEX` lowercase-or-uppercase hex characters.
    pub fn parse_hex(s: &str) -> Option<Self> {
        let src = s.as_bytes();
        if src.len() != HANDLE_HEX {
            return None;
        }
        let mut bytes = [0u8; HANDLE_BYTES];
        for i in 0..HANDLE_BYTES {
            let hi = hex_val(src[i * 2])?;
            let lo = hex_val(src[i * 2 + 1])?;
            bytes[i] = (hi << 4) | lo;
        }
        Some(Self(bytes))
    }

    /// Cheap shape test used to route a bearer credential to the gate path
    /// instead of the JWT path. A JWT always contains `.` separators, so it can
    /// never be mistaken for a handle.
    pub fn looks_like(s: &str) -> bool {
        s.len() == HANDLE_HEX && s.bytes().all(|b| hex_val(b).is_some())
    }

    /// One-way digest — this, never the handle itself, is what the database
    /// stores. A dump of `gate_sessions` therefore yields no usable sessions.
    ///
    /// SHA-256 is the right primitive here (not a password KDF): the input is
    /// 256 bits of uniform entropy, so there is no dictionary to slow down, and
    /// this runs on every authenticated request.
    pub fn digest(&self) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(self.0);
        hasher.finalize().into()
    }
}

impl Drop for GateHandle {
    /// Overwrite secret material rather than leaving it in freed stack.
    /// `write_volatile` keeps the optimiser from eliding a "dead" store.
    ///
    /// Best-effort, not a guarantee: this zeroes only *this* copy. Bytes the
    /// compiler or allocator moved elsewhere (spills, reallocated buffers, the
    /// hex rendering) are out of reach. It reduces the window, it does not
    /// close it.
    fn drop(&mut self) {
        for byte in self.0.iter_mut() {
            unsafe { core::ptr::write_volatile(byte, 0) };
        }
    }
}

#[inline]
fn hex_val(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_round_trips() {
        let h = GateHandle::generate();
        let hex = h.to_hex();
        let text = core::str::from_utf8(&hex).unwrap();
        assert_eq!(text.len(), HANDLE_HEX);
        let back = GateHandle::parse_hex(text).expect("round trip");
        assert_eq!(back.digest(), h.digest());
    }

    #[test]
    fn generates_distinct_handles() {
        let a = GateHandle::generate();
        let b = GateHandle::generate();
        assert_ne!(a.digest(), b.digest());
    }

    #[test]
    fn rejects_malformed_wire_forms() {
        assert!(GateHandle::parse_hex("").is_none());
        assert!(GateHandle::parse_hex("abc").is_none());
        // Right length, non-hex character.
        assert!(GateHandle::parse_hex(&"z".repeat(HANDLE_HEX)).is_none());
        // Hex, but one character short.
        assert!(GateHandle::parse_hex(&"a".repeat(HANDLE_HEX - 1)).is_none());
    }

    #[test]
    fn a_jwt_is_never_mistaken_for_a_handle() {
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl";
        assert!(!GateHandle::looks_like(jwt));
        assert!(GateHandle::looks_like(&"a1B2".repeat(HANDLE_HEX / 4)));
    }
}
