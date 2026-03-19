//! # YODA PlenumNET Bridge
//!
//! Zero-FFI Rust wrappers around PlenumNET's five cryptographic primitives
//! via the `ternary-math` crate. All calls are direct — no stubs, no FFI.
//!
//! - **TIS-27** — `hash_bulk_tis` (variable-length sponge hash)
//! - **TL-DSA** — `TlDsa87` (post-quantum signatures, NIST PQC Level 5)
//! - **Phase Encryption** — Adaptive Dual-Phase Quantum Encryption (4 modes)
//! - **TLSponge-385** — `derive_key_bulk_tis` (key derivation)
//! - **TL-KEM** — Lattice-based key encapsulation (3 variants)
//!
//! Copyright (c) 2026 Capomastro Holdings Ltd. — Applied Physics Division

pub mod audit;
pub mod encryption;
pub mod hashing;
pub mod kem;
pub mod key_derivation;
pub mod signing;

// Re-exports for ergonomic access
pub use audit::{AuditRecord, SignedAuditRecord};
pub use encryption::EncryptionMode;
pub use hashing::TIS27_DEFAULT_OUTPUT_LEN;
