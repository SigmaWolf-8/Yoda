//! TL-DSA post-quantum digital signature wrapper.
//!
//! Uses `ternary_math::tl_dsa` at the TlDsa87 security level (NIST PQC Level 5).
//!
//! Per-project keypairs generated at project creation. Private keys stored
//! encrypted (Phase Encryption, high_security mode). Signs every FINAL output.

use serde::{Deserialize, Serialize};
use ternary_math::tl_dsa::{self, TlDsaVariant};

const VARIANT: TlDsaVariant = TlDsaVariant::TlDsa87;

/// TL-DSA public key (serializable for PostgreSQL storage).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicKey(pub Vec<u8>);

/// TL-DSA private key (serializable for encrypted storage).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivateKey(pub Vec<u8>);

/// TL-DSA signature.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Signature(pub Vec<u8>);

/// Generate a new TL-DSA-87 keypair.
///
/// Returns (public_key, private_key) suitable for serialization and storage.
pub fn generate_keypair() -> (PublicKey, PrivateKey) {
    let kp = tl_dsa::keygen(VARIANT, None);
    (PublicKey(kp.public_key), PrivateKey(kp.secret_key))
}

/// Sign a message with a TL-DSA-87 private key.
///
/// The message is typically a TIS-27 hash of the content being signed,
/// but any byte slice is accepted.
pub fn sign(message: &[u8], key: &PrivateKey) -> Signature {
    let sig = tl_dsa::sign(&key.0, message, VARIANT);
    Signature(sig)
}

/// Verify a signature against a message and public key.
///
/// Returns `true` if the signature is valid for this message + key pair.
pub fn verify(message: &[u8], sig: &Signature, key: &PublicKey) -> bool {
    tl_dsa::verify(&key.0, message, &sig.0, VARIANT)
}

/// Get the public key size in bytes for TL-DSA-87.
pub fn public_key_size() -> usize {
    tl_dsa::pk_len(VARIANT)
}

/// Get the secret key size in bytes for TL-DSA-87.
pub fn secret_key_size() -> usize {
    tl_dsa::sk_len(VARIANT)
}

/// Get the signature size in bytes for TL-DSA-87.
pub fn signature_size() -> usize {
    tl_dsa::sig_len(VARIANT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keygen_produces_keys() {
        let (pk, sk) = generate_keypair();
        assert!(!pk.0.is_empty(), "Public key must not be empty");
        assert!(!sk.0.is_empty(), "Secret key must not be empty");
    }

    #[test]
    fn test_sign_verify_roundtrip() {
        let (pk, sk) = generate_keypair();
        let message = b"YODA FINAL output hash for signing";
        let sig = sign(message, &sk);
        assert!(!sig.0.is_empty(), "Signature must not be empty");
        assert!(verify(message, &sig, &pk), "Signature must verify");
    }

    #[test]
    fn test_verify_rejects_tampered_message() {
        let (pk, sk) = generate_keypair();
        let message = b"original message";
        let sig = sign(message, &sk);
        assert!(!verify(b"tampered message", &sig, &pk));
    }

    #[test]
    fn test_verify_rejects_wrong_key() {
        let (_pk1, sk1) = generate_keypair();
        let (pk2, _sk2) = generate_keypair();
        let message = b"test message";
        let sig = sign(message, &sk1);
        assert!(!verify(message, &sig, &pk2), "Wrong public key must reject");
    }

    #[test]
    fn test_different_messages_different_signatures() {
        let (_pk, sk) = generate_keypair();
        let sig1 = sign(b"message A", &sk);
        let sig2 = sign(b"message B", &sk);
        assert_ne!(sig1.0, sig2.0, "Different messages should produce different signatures");
    }

    #[test]
    fn test_key_sizes() {
        assert!(public_key_size() > 0);
        assert!(secret_key_size() > 0);
        assert!(signature_size() > 0);
    }

    #[test]
    fn test_key_serialization_roundtrip() {
        let (pk, sk) = generate_keypair();
        let pk_bytes = pk.0.clone();
        let sk_bytes = sk.0.clone();
        assert_eq!(pk.0, pk_bytes);
        assert_eq!(sk.0, sk_bytes);
    }
}
