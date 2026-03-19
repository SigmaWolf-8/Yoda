//! Phase Encryption wrapper — Adaptive Dual-Phase Quantum Encryption.
//!
//! Calls `ternary_math::phase_encryption::{encrypt, decrypt, decrypt_implicit}`.
//!
//! Four modes:
//! - `HighSecurity` — Task Bible entries, code blocks, TL-DSA private keys, audit logs
//! - `Balanced` — Knowledge base entries, project metadata
//! - `Performance` — High-throughput intermediate state (review cycle buffers)
//! - `Adaptive` — Auto-selects mode based on data classification
//!
//! Guardian phase provides τ-derived tamper detection on all encrypted blobs.

use serde::{Deserialize, Serialize};
use ternary_math::phase_encryption::{
    self as pe,
    EncryptionMode as PeMode,
    PhaseCiphertext,
    PhaseError as PeError,
};
use thiserror::Error;

/// Encryption mode selector (mirrors ternary-math's EncryptionMode).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EncryptionMode {
    HighSecurity,
    Balanced,
    Performance,
    Adaptive,
}

impl EncryptionMode {
    /// Convert to the ternary-math native enum.
    fn to_pe_mode(self) -> PeMode {
        match self {
            EncryptionMode::HighSecurity => PeMode::HighSecurity,
            EncryptionMode::Balanced => PeMode::Balanced,
            EncryptionMode::Performance => PeMode::Performance,
            EncryptionMode::Adaptive => PeMode::Adaptive,
        }
    }

    /// Human-readable name.
    pub fn name(&self) -> &'static str {
        match self {
            EncryptionMode::HighSecurity => "high_security",
            EncryptionMode::Balanced => "balanced",
            EncryptionMode::Performance => "performance",
            EncryptionMode::Adaptive => "adaptive",
        }
    }
}

#[derive(Debug, Error)]
pub enum EncryptionError {
    #[error("encryption failed: {0}")]
    EncryptFailed(String),
    #[error("decryption failed: {0}")]
    DecryptFailed(String),
    #[error("tamper detected: Guardian phase τ-verification failed")]
    TamperDetected,
    #[error("MAC verification failed")]
    MacMismatch,
    #[error("invalid ciphertext format")]
    InvalidCiphertext,
    #[error("serialization error: {0}")]
    SerializationError(String),
}

impl From<PeError> for EncryptionError {
    fn from(e: PeError) -> Self {
        match e {
            PeError::MacMismatch => EncryptionError::MacMismatch,
            PeError::GuardianFailed => EncryptionError::TamperDetected,
            PeError::InvalidCiphertext => EncryptionError::InvalidCiphertext,
            PeError::MissingGuardian => EncryptionError::TamperDetected,
            other => EncryptionError::DecryptFailed(format!("{:?}", other)),
        }
    }
}

/// Encrypt plaintext with Phase Encryption.
///
/// `key` must be exactly 32 bytes (derived via `derive_key_from_secret`
/// or `derive_key_from_kem_secret`).
///
/// Returns the serialized ciphertext as bytes (includes both phases,
/// MAC, nonce, and Guardian hash).
pub fn encrypt(
    plaintext: &[u8],
    key: &[u8],
    mode: EncryptionMode,
) -> Result<Vec<u8>, EncryptionError> {
    let key_arr: [u8; 32] = key
        .try_into()
        .map_err(|_| EncryptionError::EncryptFailed(
            format!("key must be 32 bytes, got {}", key.len()),
        ))?;

    let ciphertext = pe::encrypt(plaintext, &key_arr, mode.to_pe_mode())?;

    // Serialize PhaseCiphertext to bytes for storage
    serialize_ciphertext(&ciphertext)
}

/// Decrypt ciphertext with Phase Encryption.
///
/// Verifies MAC and Guardian phase before returning plaintext.
/// Returns error if tampered.
pub fn decrypt(
    ciphertext_bytes: &[u8],
    key: &[u8],
    mode: EncryptionMode,
) -> Result<Vec<u8>, EncryptionError> {
    let key_arr: [u8; 32] = key
        .try_into()
        .map_err(|_| EncryptionError::DecryptFailed(
            format!("key must be 32 bytes, got {}", key.len()),
        ))?;

    let ciphertext = deserialize_ciphertext(ciphertext_bytes)?;
    let plaintext = pe::decrypt(&ciphertext, &key_arr, mode.to_pe_mode())?;
    Ok(plaintext)
}

/// Decrypt without explicitly specifying mode — mode is embedded in the ciphertext config.
pub fn decrypt_implicit(
    ciphertext_bytes: &[u8],
    key: &[u8],
) -> Result<Vec<u8>, EncryptionError> {
    let key_arr: [u8; 32] = key
        .try_into()
        .map_err(|_| EncryptionError::DecryptFailed(
            format!("key must be 32 bytes, got {}", key.len()),
        ))?;

    let ciphertext = deserialize_ciphertext(ciphertext_bytes)?;
    let plaintext = pe::decrypt_implicit(&ciphertext, &key_arr)?;
    Ok(plaintext)
}

/// Derive a 32-byte encryption key from a secret.
///
/// Wraps `phase_encryption::derive_key_from_secret`.
pub fn derive_key(secret: &[u8]) -> [u8; 32] {
    pe::derive_key_from_secret(secret)
}

/// Derive a 32-byte encryption key from a TL-KEM shared secret.
///
/// Wraps `phase_encryption::derive_key_from_kem_secret`.
pub fn derive_key_from_kem(kem_shared: &[u8; 32]) -> [u8; 32] {
    pe::derive_key_from_kem_secret(kem_shared)
}

// ─── Serialization Helpers ───────────────────────────────────────────

/// Serialize a PhaseCiphertext to bytes via the TS wire format.
///
/// Uses JSON serialization of the wire format for portable storage.
fn serialize_ciphertext(ct: &PhaseCiphertext) -> Result<Vec<u8>, EncryptionError> {
    let wire = ct.to_ts_wire_format();
    serde_json::to_vec(&wire)
        .map_err(|e| EncryptionError::SerializationError(e.to_string()))
}

/// Deserialize a PhaseCiphertext from bytes.
fn deserialize_ciphertext(bytes: &[u8]) -> Result<PhaseCiphertext, EncryptionError> {
    let wire: ternary_math::phase_encryption::TsWireFormat = serde_json::from_slice(bytes)
        .map_err(|e| EncryptionError::InvalidCiphertext)?;
    PhaseCiphertext::from_ts_wire_format(&wire)
        .map_err(|_| EncryptionError::InvalidCiphertext)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_key() -> [u8; 32] {
        derive_key(b"YODA test encryption key material")
    }

    #[test]
    fn test_encrypt_decrypt_high_security() {
        let key = test_key();
        let plaintext = b"Task Bible entry with code blocks — high security";
        let encrypted = encrypt(plaintext, &key, EncryptionMode::HighSecurity).unwrap();
        assert_ne!(encrypted, plaintext, "Ciphertext must differ from plaintext");

        let decrypted = decrypt(&encrypted, &key, EncryptionMode::HighSecurity).unwrap();
        assert_eq!(decrypted, plaintext, "Decrypted must match original");
    }

    #[test]
    fn test_encrypt_decrypt_balanced() {
        let key = test_key();
        let plaintext = b"Knowledge base entry content";
        let encrypted = encrypt(plaintext, &key, EncryptionMode::Balanced).unwrap();
        let decrypted = decrypt(&encrypted, &key, EncryptionMode::Balanced).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_encrypt_decrypt_performance() {
        let key = test_key();
        let plaintext = b"Review cycle buffer — performance mode";
        let encrypted = encrypt(plaintext, &key, EncryptionMode::Performance).unwrap();
        let decrypted = decrypt(&encrypted, &key, EncryptionMode::Performance).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_encrypt_decrypt_adaptive() {
        let key = test_key();
        let plaintext = b"Auto-classified data";
        let encrypted = encrypt(plaintext, &key, EncryptionMode::Adaptive).unwrap();
        let decrypted = decrypt(&encrypted, &key, EncryptionMode::Adaptive).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_decrypt_implicit() {
        let key = test_key();
        let plaintext = b"Implicit mode decryption test";
        let encrypted = encrypt(plaintext, &key, EncryptionMode::Balanced).unwrap();
        // Decrypt without specifying mode — mode is in the ciphertext config
        let decrypted = decrypt_implicit(&encrypted, &key).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_wrong_key_fails() {
        let key1 = derive_key(b"key one");
        let key2 = derive_key(b"key two");
        let plaintext = b"encrypted with key1";
        let encrypted = encrypt(plaintext, &key1, EncryptionMode::HighSecurity).unwrap();

        let result = decrypt(&encrypted, &key2, EncryptionMode::HighSecurity);
        assert!(result.is_err(), "Wrong key must fail decryption");
    }

    #[test]
    fn test_tampered_ciphertext_detected() {
        let key = test_key();
        let plaintext = b"tamper detection test";
        let mut encrypted = encrypt(plaintext, &key, EncryptionMode::HighSecurity).unwrap();

        // Tamper with the ciphertext
        if encrypted.len() > 20 {
            encrypted[10] ^= 0xFF;
        }

        let result = decrypt(&encrypted, &key, EncryptionMode::HighSecurity);
        assert!(result.is_err(), "Tampered ciphertext must be rejected");
    }

    #[test]
    fn test_key_derivation_deterministic() {
        let k1 = derive_key(b"same secret");
        let k2 = derive_key(b"same secret");
        assert_eq!(k1, k2, "Same secret must derive same key");
    }

    #[test]
    fn test_key_derivation_different_secrets() {
        let k1 = derive_key(b"secret A");
        let k2 = derive_key(b"secret B");
        assert_ne!(k1, k2, "Different secrets must derive different keys");
    }

    #[test]
    fn test_invalid_key_length() {
        let short_key = vec![0u8; 16]; // 16 bytes, need 32
        let result = encrypt(b"test", &short_key, EncryptionMode::HighSecurity);
        assert!(result.is_err(), "Short key must be rejected");
    }

    #[test]
    fn test_mode_name() {
        assert_eq!(EncryptionMode::HighSecurity.name(), "high_security");
        assert_eq!(EncryptionMode::Balanced.name(), "balanced");
        assert_eq!(EncryptionMode::Performance.name(), "performance");
        assert_eq!(EncryptionMode::Adaptive.name(), "adaptive");
    }
}
