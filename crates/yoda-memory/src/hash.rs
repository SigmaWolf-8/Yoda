//! Deterministic string → trit-hash, for content-addressable cache keys.
//!
//! Uses Rust's stable `DefaultHasher` (SipHash 1-3) to fold arbitrary bytes
//! into a 64-bit value, then converts to a fixed-width base-3 string via
//! the standard ternary gate. Collision-resistant enough for in-process
//! caches; not a cryptographic hash.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

/// Hash an arbitrary byte slice into a fixed-width trit-hash string.
///
/// The returned string is a base-3 representation of the SipHash 1-3 digest,
/// padded to 41 trits (the max width of a u64 in base 3). Two different
/// byte slices may collide, but the probability is ~2^-64 per pair.
pub fn trit_hash_str(input: &str) -> String {
    let mut h = DefaultHasher::new();
    input.hash(&mut h);
    let mut v: u64 = h.finish();

    if v == 0 { return "0".repeat(41); }

    let mut trits: Vec<char> = Vec::with_capacity(41);
    while v > 0 {
        trits.push(match v % 3 {
            0 => '0',
            1 => '1',
            _ => '2',
        });
        v /= 3;
    }
    while trits.len() < 41 {
        trits.push('0');
    }
    trits.iter().rev().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic() {
        assert_eq!(trit_hash_str("hello"), trit_hash_str("hello"));
    }

    #[test]
    fn different_inputs_differ() {
        assert_ne!(trit_hash_str("hello"), trit_hash_str("world"));
    }

    #[test]
    fn fixed_width() {
        assert_eq!(trit_hash_str("").len(), 41);
        assert_eq!(trit_hash_str("a").len(), 41);
        assert_eq!(trit_hash_str(&"x".repeat(10000)).len(), 41);
    }

    #[test]
    fn all_trits_in_alphabet() {
        let h = trit_hash_str("anything goes here 12345 αβγ");
        assert!(h.chars().all(|c| c == '0' || c == '1' || c == '2'));
    }
}
