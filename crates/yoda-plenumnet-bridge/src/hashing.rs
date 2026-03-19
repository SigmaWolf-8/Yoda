//! TIS-27 integrity hashing — calls `ternary_math::tlsponge385::hash_bulk_tis`.
//!
//! Every inference response is hashed on receipt. Every encrypted blob
//! is integrity-verified via TIS-27.
//!
//! `hash_bulk_tis(input, output_len)` returns a `Vec<u8>` of exactly
//! `output_len` bytes, squeezed from the TLSponge-385 sponge.

use ternary_math::tlsponge385::hash_bulk_tis;

/// Default output length in bytes for TIS-27 hashes.
/// 27 bytes = 216 bits (aligned with ternary 54-trit digest).
pub const TIS27_DEFAULT_OUTPUT_LEN: usize = 27;

/// Hash arbitrary bytes using TIS-27, returning a hex-encoded digest.
///
/// Uses the default output length (27 bytes / 54 trits).
pub fn hash_bytes(data: &[u8]) -> String {
    let digest = hash_bulk_tis(data, TIS27_DEFAULT_OUTPUT_LEN);
    hex::encode(&digest)
}

/// Hash arbitrary bytes using TIS-27 with a custom output length.
///
/// Returns the raw byte vector (not hex-encoded).
pub fn hash_bytes_raw(data: &[u8], output_len: usize) -> Vec<u8> {
    hash_bulk_tis(data, output_len)
}

/// Hash a string, returning hex-encoded TIS-27 digest.
pub fn hash_str(data: &str) -> String {
    hash_bytes(data.as_bytes())
}

/// Verify that data matches an expected TIS-27 hex digest.
pub fn verify_hash(data: &[u8], expected_hex: &str) -> bool {
    hash_bytes(data) == expected_hex
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_deterministic() {
        let data = b"YODA test data for TIS-27 hashing";
        let h1 = hash_bytes(data);
        let h2 = hash_bytes(data);
        assert_eq!(h1, h2, "TIS-27 hash must be deterministic");
    }

    #[test]
    fn test_hash_different_inputs() {
        let h1 = hash_bytes(b"input A");
        let h2 = hash_bytes(b"input B");
        assert_ne!(h1, h2, "Different inputs must produce different hashes");
    }

    #[test]
    fn test_hash_output_length() {
        let digest = hash_bytes(b"test");
        // 27 bytes → 54 hex chars
        assert_eq!(digest.len(), TIS27_DEFAULT_OUTPUT_LEN * 2);
    }

    #[test]
    fn test_hash_raw_output_length() {
        let raw = hash_bytes_raw(b"test", 32);
        assert_eq!(raw.len(), 32);

        let raw16 = hash_bytes_raw(b"test", 16);
        assert_eq!(raw16.len(), 16);
    }

    #[test]
    fn test_verify_hash() {
        let data = b"verify this data";
        let hash = hash_bytes(data);
        assert!(verify_hash(data, &hash));
        assert!(!verify_hash(b"tampered", &hash));
    }

    #[test]
    fn test_hash_empty_input() {
        let h = hash_bytes(b"");
        assert_eq!(h.len(), TIS27_DEFAULT_OUTPUT_LEN * 2);
        // Empty input should still produce a valid hash
        assert!(!h.is_empty());
    }

    #[test]
    fn test_hash_str() {
        let h1 = hash_str("hello");
        let h2 = hash_bytes(b"hello");
        assert_eq!(h1, h2, "hash_str and hash_bytes must agree");
    }
}
