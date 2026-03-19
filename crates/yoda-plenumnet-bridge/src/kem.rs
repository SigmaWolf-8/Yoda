//! TL-KEM key encapsulation — calls `ternary_math::tl_kem`.
//!
//! Lattice-based key encapsulation mechanism with three security levels:
//! - TlKem512  — NIST Level 1, 128-bit (lightweight)
//! - TlKem768  — NIST Level 3, 192-bit (balanced)
//! - TlKem1024 — NIST Level 5, 256-bit (maximum security)
//!
//! The bridge from TL-KEM into Phase Encryption:
//! `SharedSecret::to_bytes_32()` → `phase_encryption::derive_key_from_kem_secret()`

use serde::{Deserialize, Serialize};
use ternary_math::tl_kem::{
    self,
    TlKemVariant,
    TlKemPublicKey as NativePublicKey,
    TlKemSecretKey as NativeSecretKey,
    TlKemCiphertext as NativeCiphertext,
    SharedSecret as NativeSharedSecret,
    TlKemError as NativeError,
};
use thiserror::Error;

/// Default variant for YODA: TlKem1024 (NIST Level 5, maximum security).
pub const DEFAULT_VARIANT: TlKemVariant = TlKemVariant::TlKem1024;

#[derive(Debug, Error)]
pub enum KemError {
    #[error("TL-KEM error: {0}")]
    Native(String),
    #[error("key deserialization failed: {0}")]
    Deserialization(String),
}

impl From<NativeError> for KemError {
    fn from(e: NativeError) -> Self {
        KemError::Native(format!("{:?}", e))
    }
}

/// TL-KEM public key (serializable for transport/storage).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicKey {
    pub variant: String,
    pub bytes: Vec<u8>,
}

/// TL-KEM secret key (serializable for encrypted storage).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretKey {
    pub variant: String,
    pub bytes: Vec<u8>,
}

/// TL-KEM ciphertext (encapsulated shared secret).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ciphertext {
    pub variant: String,
    pub bytes: Vec<u8>,
}

/// Shared secret derived from TL-KEM encapsulation.
#[derive(Debug, Clone)]
pub struct SharedSecret {
    /// Raw shared secret as 32 bytes — feeds into `derive_key_from_kem_secret`.
    pub bytes_32: [u8; 32],
}

/// Generate a TL-KEM keypair at the default security level (TlKem1024).
pub fn keygen() -> Result<(PublicKey, SecretKey), KemError> {
    keygen_variant(DEFAULT_VARIANT)
}

/// Generate a TL-KEM keypair at a specific security level.
pub fn keygen_variant(variant: TlKemVariant) -> Result<(PublicKey, SecretKey), KemError> {
    let (npk, nsk) = tl_kem::keygen(variant)?;

    Ok((
        PublicKey {
            variant: variant.name().to_string(),
            bytes: npk.to_bytes(),
        },
        SecretKey {
            variant: variant.name().to_string(),
            bytes: nsk.to_bytes(),
        },
    ))
}

/// Encapsulate: generate a shared secret for a recipient's public key.
///
/// Returns (ciphertext, shared_secret). The ciphertext is sent to the
/// recipient, who decapsulates it with their secret key to recover
/// the same shared secret.
pub fn encapsulate(pk: &PublicKey) -> Result<(Ciphertext, SharedSecret), KemError> {
    let native_pk = NativePublicKey::from_bytes(&pk.bytes)
        .map_err(|e| KemError::Deserialization(format!("{:?}", e)))?;

    let (ct, ss) = tl_kem::encapsulate(&native_pk)?;

    Ok((
        Ciphertext {
            variant: pk.variant.clone(),
            bytes: ct.to_bytes(),
        },
        SharedSecret {
            bytes_32: ss.to_bytes_32(),
        },
    ))
}

/// Decapsulate: recover the shared secret from a ciphertext.
pub fn decapsulate(ct: &Ciphertext, sk: &SecretKey) -> Result<SharedSecret, KemError> {
    let native_ct = NativeCiphertext::from_bytes(&ct.bytes)
        .map_err(|e| KemError::Deserialization(format!("{:?}", e)))?;
    let native_sk = NativeSecretKey::from_bytes(&sk.bytes)
        .map_err(|e| KemError::Deserialization(format!("{:?}", e)))?;

    let ss = tl_kem::decapsulate(&native_ct, &native_sk)?;

    Ok(SharedSecret {
        bytes_32: ss.to_bytes_32(),
    })
}

/// Full TL-KEM → Phase Encryption key establishment flow:
///
/// 1. Generate KEM keypair
/// 2. Encapsulate to produce shared secret
/// 3. Derive Phase Encryption key from shared secret
///
/// Returns the derived 32-byte key ready for `encryption::encrypt()`.
pub fn establish_encryption_key(pk: &PublicKey) -> Result<(Ciphertext, [u8; 32]), KemError> {
    let (ct, ss) = encapsulate(pk)?;
    let enc_key = crate::encryption::derive_key_from_kem(&ss.bytes_32);
    Ok((ct, enc_key))
}

/// Get key/ciphertext sizes for a variant (for documentation/validation).
pub fn sizes(variant: TlKemVariant) -> KemSizes {
    KemSizes {
        public_key: tl_kem::public_key_size(variant),
        secret_key: tl_kem::secret_key_size(variant),
        ciphertext: tl_kem::ciphertext_size(variant),
        shared_secret: tl_kem::shared_secret_size(variant),
    }
}

/// Size information for a TL-KEM variant.
#[derive(Debug, Clone, Serialize)]
pub struct KemSizes {
    pub public_key: usize,
    pub secret_key: usize,
    pub ciphertext: usize,
    pub shared_secret: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keygen_default() {
        let (pk, sk) = keygen().unwrap();
        assert!(!pk.bytes.is_empty(), "Public key must not be empty");
        assert!(!sk.bytes.is_empty(), "Secret key must not be empty");
        assert_eq!(pk.variant, "TL-KEM-1024");
    }

    #[test]
    fn test_encapsulate_decapsulate_roundtrip() {
        let (pk, sk) = keygen().unwrap();
        let (ct, ss_enc) = encapsulate(&pk).unwrap();
        let ss_dec = decapsulate(&ct, &sk).unwrap();
        assert_eq!(
            ss_enc.bytes_32, ss_dec.bytes_32,
            "Encapsulated and decapsulated shared secrets must match"
        );
    }

    #[test]
    fn test_wrong_secret_key_fails() {
        let (pk1, _sk1) = keygen().unwrap();
        let (_pk2, sk2) = keygen().unwrap();
        let (ct, _ss) = encapsulate(&pk1).unwrap();

        // Decapsulate with wrong key — should produce different shared secret
        // (TL-KEM uses implicit rejection, not an error)
        let ss_wrong = decapsulate(&ct, &sk2).unwrap();
        let ss_correct = {
            let (_pk1b, sk1b) = (pk1.clone(), _sk1);
            decapsulate(&ct, &sk1b).unwrap()
        };
        // With implicit rejection, the wrong key produces a deterministic
        // but incorrect shared secret
        assert_ne!(
            ss_wrong.bytes_32, ss_correct.bytes_32,
            "Wrong key must produce different shared secret"
        );
    }

    #[test]
    fn test_establish_encryption_key() {
        let (pk, _sk) = keygen().unwrap();
        let (ct, enc_key) = establish_encryption_key(&pk).unwrap();
        assert_eq!(enc_key.len(), 32, "Derived key must be 32 bytes");
        assert!(!ct.bytes.is_empty(), "Ciphertext must not be empty");
    }

    #[test]
    fn test_variant_512() {
        let (pk, sk) = keygen_variant(TlKemVariant::TlKem512).unwrap();
        assert_eq!(pk.variant, "TL-KEM-512");
        let (ct, ss_enc) = encapsulate(&pk).unwrap();
        let ss_dec = decapsulate(&ct, &sk).unwrap();
        assert_eq!(ss_enc.bytes_32, ss_dec.bytes_32);
    }

    #[test]
    fn test_variant_768() {
        let (pk, sk) = keygen_variant(TlKemVariant::TlKem768).unwrap();
        assert_eq!(pk.variant, "TL-KEM-768");
        let (ct, ss_enc) = encapsulate(&pk).unwrap();
        let ss_dec = decapsulate(&ct, &sk).unwrap();
        assert_eq!(ss_enc.bytes_32, ss_dec.bytes_32);
    }

    #[test]
    fn test_sizes() {
        let s = sizes(TlKemVariant::TlKem1024);
        assert!(s.public_key > 0);
        assert!(s.secret_key > 0);
        assert!(s.ciphertext > 0);
        assert!(s.shared_secret > 0);
        // Level 5 keys should be substantial
        assert!(s.public_key > s.shared_secret);
    }

    #[test]
    fn test_shared_secret_is_32_bytes() {
        let (pk, _sk) = keygen().unwrap();
        let (_ct, ss) = encapsulate(&pk).unwrap();
        assert_eq!(ss.bytes_32.len(), 32);
    }
}
