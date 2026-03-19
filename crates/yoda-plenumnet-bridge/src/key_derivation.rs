//! TLSponge-385 key derivation — calls `ternary_math::tlsponge385`.
//!
//! Derives cryptographic keys from input material using the TLSponge-385
//! sponge construction. 385-bit post-quantum security.
//!
//! Two main entry points:
//! - `derive_key` — general-purpose key derivation (48 bytes / 385 bits)
//! - `derive_key_with_context` — domain-separated key derivation

use ternary_math::tlsponge385::{derive_key_bulk_tis, hash_bulk_tis};

/// Default key length: 48 bytes = 384 bits ≈ 385-bit security level.
pub const KEY_LEN_48: usize = 48;

/// Standard 32-byte key for Phase Encryption compatibility.
pub const KEY_LEN_32: usize = 32;

/// Derive a 48-byte (385-bit) key from input material.
///
/// This is the primary key derivation function for PlenumNET.
/// Used for CON tunnel keys, project encryption keys, etc.
pub fn derive_key(input: &[u8]) -> [u8; 48] {
    let key_vec = derive_key_bulk_tis(b"yoda-key", input, KEY_LEN_48);
    let mut key = [0u8; 48];
    key.copy_from_slice(&key_vec[..48]);
    key
}

/// Derive a 32-byte key from input material.
///
/// Used when the consumer needs exactly 32 bytes (e.g., Phase Encryption).
pub fn derive_key_32(input: &[u8]) -> [u8; 32] {
    let key_vec = derive_key_bulk_tis(b"yoda-key-32", input, KEY_LEN_32);
    let mut key = [0u8; 32];
    key.copy_from_slice(&key_vec[..32]);
    key
}

/// Derive a key with explicit domain separation context.
///
/// `context` — a domain label (e.g., "project-key", "credential-enc")
/// `material` — the key material to derive from
/// `output_len` — desired output length in bytes
///
/// The context is prepended to the material internally, providing
/// domain separation so the same material produces different keys
/// for different purposes.
pub fn derive_key_with_context(context: &[u8], material: &[u8], output_len: usize) -> Vec<u8> {
    derive_key_bulk_tis(context, material, output_len)
}

/// Derive a key specifically for a project (deterministic from project ID).
pub fn derive_project_key(project_id_bytes: &[u8]) -> [u8; 32] {
    let key_vec = derive_key_bulk_tis(b"yoda-project", project_id_bytes, KEY_LEN_32);
    let mut key = [0u8; 32];
    key.copy_from_slice(&key_vec[..32]);
    key
}

/// Derive a key specifically for credential encryption.
pub fn derive_credential_key(context_label: &[u8]) -> [u8; 32] {
    let key_vec = derive_key_bulk_tis(b"yoda-credential", context_label, KEY_LEN_32);
    let mut key = [0u8; 32];
    key.copy_from_slice(&key_vec[..32]);
    key
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_derive_key_deterministic() {
        let k1 = derive_key(b"same input");
        let k2 = derive_key(b"same input");
        assert_eq!(k1, k2, "Same input must derive same key");
    }

    #[test]
    fn test_derive_key_different_inputs() {
        let k1 = derive_key(b"input A");
        let k2 = derive_key(b"input B");
        assert_ne!(k1, k2, "Different inputs must derive different keys");
    }

    #[test]
    fn test_derive_key_length() {
        let k = derive_key(b"test");
        assert_eq!(k.len(), 48, "Default key must be 48 bytes");
    }

    #[test]
    fn test_derive_key_32_length() {
        let k = derive_key_32(b"test");
        assert_eq!(k.len(), 32, "32-byte key must be 32 bytes");
    }

    #[test]
    fn test_context_separation() {
        let material = b"same material";
        let k1 = derive_key_with_context(b"context-A", material, 32);
        let k2 = derive_key_with_context(b"context-B", material, 32);
        assert_ne!(k1, k2, "Different contexts must produce different keys");
    }

    #[test]
    fn test_variable_output_length() {
        let k16 = derive_key_with_context(b"ctx", b"mat", 16);
        let k64 = derive_key_with_context(b"ctx", b"mat", 64);
        assert_eq!(k16.len(), 16);
        assert_eq!(k64.len(), 64);
    }

    #[test]
    fn test_project_key_deterministic() {
        let pid = b"550e8400-e29b-41d4-a716-446655440000";
        let k1 = derive_project_key(pid);
        let k2 = derive_project_key(pid);
        assert_eq!(k1, k2);
    }

    #[test]
    fn test_credential_key_differs_from_project_key() {
        let material = b"same-material";
        let pk = derive_project_key(material);
        let ck = derive_credential_key(material);
        assert_ne!(pk, ck, "Different domain contexts must produce different keys");
    }
}
