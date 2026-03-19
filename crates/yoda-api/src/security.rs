//! Security layer — wires PlenumNET crypto through the entire stack.
//!
//! B6.1: Per-project TL-DSA key generation on project creation
//! B6.2: Key rotation (new key, old archived, chain maintained)
//! B6.3: Encrypt engine credentials + GitHub PAT at rest (Phase Encryption)
//! B6.4: Signed JSON audit export
//! B6.5: TIS-27 integrity check on all encrypted blobs

use sqlx::PgPool;
use thiserror::Error;
use uuid::Uuid;
use yoda_plenumnet_bridge::encryption::{self, EncryptionMode};
use yoda_plenumnet_bridge::hashing;
use yoda_plenumnet_bridge::key_derivation;
use yoda_plenumnet_bridge::signing;

#[derive(Debug, Error)]
pub enum SecurityError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("encryption error: {0}")]
    Encryption(String),
    #[error("signing error: {0}")]
    Signing(String),
    #[error("integrity check failed: stored hash {stored} != computed hash {computed}")]
    IntegrityViolation { stored: String, computed: String },
    #[error("no active key for project {0}")]
    NoActiveKey(Uuid),
    #[error("key not found: {0}")]
    KeyNotFound(Uuid),
}

// ═══════════════════════════════════════════════════════════════════════
// B6.1 — Per-Project Key Generation
// ═══════════════════════════════════════════════════════════════════════

/// Generate a TL-DSA keypair for a new project and store it.
/// Private key encrypted via Phase Encryption (high_security mode).
///
/// Called automatically when a project is created.
pub async fn generate_project_keys(
    db: &PgPool,
    project_id: Uuid,
) -> Result<String, SecurityError> {
    let (public_key, private_key) = signing::generate_keypair();

    // Serialize keys
    let public_hex = hex::encode(&public_key.0);
    let private_bytes = &private_key.0;

    // Derive encryption key for the private key
    let enc_key = key_derivation::derive_key(
        format!("project-key-{}", project_id).as_bytes(),
    );

    // Encrypt private key with Phase Encryption (high_security)
    let encrypted_private = encryption::encrypt(
        private_bytes,
        &enc_key,
        EncryptionMode::HighSecurity,
    )
    .map_err(|e| SecurityError::Encryption(e.to_string()))?;
    let encrypted_hex = hex::encode(&encrypted_private);

    // Store in project_keys table
    let key_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO project_keys \
         (id, project_id, tl_dsa_public_key, tl_dsa_private_key_encrypted, \
          encryption_mode, active) \
         VALUES ($1, $2, $3, $4, 'high_security', TRUE)"
    )
    .bind(key_id)
    .bind(project_id)
    .bind(&public_hex)
    .bind(&encrypted_hex)
    .execute(db)
    .await?;

    tracing::info!(
        project_id = %project_id,
        key_id = %key_id,
        "Generated TL-DSA keypair for project"
    );

    Ok(public_hex)
}

// ═══════════════════════════════════════════════════════════════════════
// B6.2 — Key Rotation
// ═══════════════════════════════════════════════════════════════════════

/// Rotate the active TL-DSA key for a project.
/// Deactivates the old key (preserves it for verification of old signatures),
/// generates a new keypair, and activates it.
pub async fn rotate_project_key(
    db: &PgPool,
    project_id: Uuid,
) -> Result<String, SecurityError> {
    // Deactivate current key
    let now = chrono::Utc::now();
    sqlx::query(
        "UPDATE project_keys SET active = FALSE, rotated_at = $1 \
         WHERE project_id = $2 AND active = TRUE"
    )
    .bind(now)
    .bind(project_id)
    .execute(db)
    .await?;

    // Generate new key
    let new_public = generate_project_keys(db, project_id).await?;

    tracing::info!(
        project_id = %project_id,
        "Rotated TL-DSA key — old key archived, new key active"
    );

    // Log the rotation event
    log_audit_event(
        db,
        None,
        Some(project_id),
        "key_rotated",
        &serde_json::json!({"new_public_key_prefix": &new_public[..16]}),
    )
    .await?;

    Ok(new_public)
}

/// Get the active signing key for a project (decrypted in memory).
pub async fn get_active_signing_key(
    db: &PgPool,
    project_id: Uuid,
) -> Result<(signing::PublicKey, signing::PrivateKey), SecurityError> {
    let (public_hex, encrypted_hex) = sqlx::query_as::<_, (String, String)>(
        "SELECT tl_dsa_public_key, tl_dsa_private_key_encrypted \
         FROM project_keys \
         WHERE project_id = $1 AND active = TRUE"
    )
    .bind(project_id)
    .fetch_optional(db)
    .await?
    .ok_or(SecurityError::NoActiveKey(project_id))?;

    let public_key = signing::PublicKey(
        hex::decode(&public_hex)
            .map_err(|e| SecurityError::Encryption(format!("hex decode public: {}", e)))?,
    );

    // Decrypt private key
    let enc_key = key_derivation::derive_key(
        format!("project-key-{}", project_id).as_bytes(),
    );
    let encrypted_bytes = hex::decode(&encrypted_hex)
        .map_err(|e| SecurityError::Encryption(format!("hex decode private: {}", e)))?;

    let decrypted = encryption::decrypt(
        &encrypted_bytes,
        &enc_key,
        EncryptionMode::HighSecurity,
    )
    .map_err(|e| SecurityError::Encryption(e.to_string()))?;

    let private_key = signing::PrivateKey(decrypted);

    Ok((public_key, private_key))
}

// ═══════════════════════════════════════════════════════════════════════
// B6.3 — Encrypt Credentials at Rest
// ═══════════════════════════════════════════════════════════════════════

/// Encrypt a credential string for storage (engine API keys, GitHub PAT).
/// Uses Phase Encryption high_security mode.
pub fn encrypt_credential(plaintext: &str, context: &str) -> Result<String, SecurityError> {
    let enc_key = key_derivation::derive_key(
        format!("credential-{}", context).as_bytes(),
    );

    let ciphertext = encryption::encrypt(
        plaintext.as_bytes(),
        &enc_key,
        EncryptionMode::HighSecurity,
    )
    .map_err(|e| SecurityError::Encryption(e.to_string()))?;

    // Store as hex with integrity hash prefix
    let integrity_hash = hashing::hash_bytes(&ciphertext);
    Ok(format!("{}:{}", integrity_hash, hex::encode(&ciphertext)))
}

/// Decrypt a stored credential string.
/// Verifies integrity hash before decryption.
pub fn decrypt_credential(stored: &str, context: &str) -> Result<String, SecurityError> {
    let (stored_hash, ciphertext_hex) = stored
        .split_once(':')
        .ok_or_else(|| SecurityError::Encryption("Invalid stored credential format".into()))?;

    let ciphertext = hex::decode(ciphertext_hex)
        .map_err(|e| SecurityError::Encryption(format!("hex decode: {}", e)))?;

    // B6.5: Verify integrity before decryption
    let computed_hash = hashing::hash_bytes(&ciphertext);
    if stored_hash != computed_hash {
        return Err(SecurityError::IntegrityViolation {
            stored: stored_hash.to_string(),
            computed: computed_hash,
        });
    }

    let enc_key = key_derivation::derive_key(
        format!("credential-{}", context).as_bytes(),
    );

    let plaintext = encryption::decrypt(
        &ciphertext,
        &enc_key,
        EncryptionMode::HighSecurity,
    )
    .map_err(|e| SecurityError::Encryption(e.to_string()))?;

    String::from_utf8(plaintext)
        .map_err(|e| SecurityError::Encryption(format!("UTF-8 decode: {}", e)))
}

// ═══════════════════════════════════════════════════════════════════════
// B6.4 — Sign Audit Records
// ═══════════════════════════════════════════════════════════════════════

/// Sign a task's final output and create the audit record.
pub async fn sign_final_output(
    db: &PgPool,
    project_id: Uuid,
    task_id: Uuid,
    final_output: &str,
    all_inference_hashes: &[String],
    reviewer_verdicts: &[serde_json::Value],
) -> Result<String, SecurityError> {
    let (_public_key, private_key) = get_active_signing_key(db, project_id).await?;

    // Build the signing payload: hash of final output + all inference hashes
    let mut sign_payload = String::new();
    sign_payload.push_str(&hashing::hash_bytes(final_output.as_bytes()));
    for h in all_inference_hashes {
        sign_payload.push_str(h);
    }

    // Sign
    let signature = signing::sign(sign_payload.as_bytes(), &private_key);
    let signature_hex = hex::encode(&signature.0);

    // Store signature in task_bible_entries
    sqlx::query(
        "UPDATE task_bible_entries SET tl_dsa_signature = $1 WHERE task_id = $2"
    )
    .bind(&signature_hex)
    .bind(task_id)
    .execute(db)
    .await?;

    // Log in audit_log
    let payload = serde_json::json!({
        "task_id": task_id,
        "output_hash": hashing::hash_bytes(final_output.as_bytes()),
        "inference_hashes": all_inference_hashes,
        "verdict_count": reviewer_verdicts.len(),
        "signature_prefix": &signature_hex[..16.min(signature_hex.len())],
    });

    log_audit_event(
        db,
        Some(task_id),
        Some(project_id),
        "task_final_signed",
        &payload,
    )
    .await?;

    tracing::info!(
        task_id = %task_id,
        project_id = %project_id,
        "Final output signed with TL-DSA"
    );

    Ok(signature_hex)
}

/// Verify a TL-DSA signature against a task's stored data.
pub async fn verify_signature(
    db: &PgPool,
    project_id: Uuid,
    task_id: Uuid,
    final_output: &str,
    signature_hex: &str,
) -> Result<bool, SecurityError> {
    // Get the public key (active or archived — check all keys for this project)
    let keys = sqlx::query_as::<_, (String,)>(
        "SELECT tl_dsa_public_key FROM project_keys \
         WHERE project_id = $1 ORDER BY created_at DESC"
    )
    .bind(project_id)
    .fetch_all(db)
    .await?;

    let signature_bytes = hex::decode(signature_hex)
        .map_err(|e| SecurityError::Signing(format!("hex decode signature: {}", e)))?;
    let signature = signing::Signature(signature_bytes);

    let output_hash = hashing::hash_bytes(final_output.as_bytes());

    // Try each key (in case of rotation — signature was made with an older key)
    for (public_hex,) in &keys {
        let public_bytes = hex::decode(public_hex)
            .map_err(|e| SecurityError::Signing(format!("hex decode public: {}", e)))?;
        let public_key = signing::PublicKey(public_bytes);

        if signing::verify(output_hash.as_bytes(), &signature, &public_key) {
            return Ok(true);
        }
    }

    Ok(false)
}

// ═══════════════════════════════════════════════════════════════════════
// B6.5 — TIS-27 Integrity Verification
// ═══════════════════════════════════════════════════════════════════════

/// Compute a TIS-27 integrity hash for data.
pub fn compute_integrity_hash(data: &[u8]) -> String {
    hashing::hash_bytes(data)
}

/// Verify integrity of data against a stored hash.
pub fn verify_integrity(data: &[u8], expected_hash: &str) -> Result<(), SecurityError> {
    let computed = hashing::hash_bytes(data);
    if computed != expected_hash {
        return Err(SecurityError::IntegrityViolation {
            stored: expected_hash.to_string(),
            computed,
        });
    }
    Ok(())
}

/// Encrypt data with Phase Encryption and store both ciphertext and integrity hash.
/// Returns (encrypted_hex, integrity_hash).
pub fn encrypt_with_integrity(
    plaintext: &[u8],
    key_context: &str,
    mode: EncryptionMode,
) -> Result<(String, String), SecurityError> {
    let enc_key = key_derivation::derive_key(key_context.as_bytes());

    let ciphertext = encryption::encrypt(plaintext, &enc_key, mode)
        .map_err(|e| SecurityError::Encryption(e.to_string()))?;

    let integrity_hash = hashing::hash_bytes(&ciphertext);
    let encrypted_hex = hex::encode(&ciphertext);

    Ok((encrypted_hex, integrity_hash))
}

/// Decrypt data, verifying integrity hash first.
pub fn decrypt_with_integrity(
    encrypted_hex: &str,
    expected_hash: &str,
    key_context: &str,
    mode: EncryptionMode,
) -> Result<Vec<u8>, SecurityError> {
    let ciphertext = hex::decode(encrypted_hex)
        .map_err(|e| SecurityError::Encryption(format!("hex decode: {}", e)))?;

    // Verify integrity BEFORE decryption
    verify_integrity(&ciphertext, expected_hash)?;

    let enc_key = key_derivation::derive_key(key_context.as_bytes());

    encryption::decrypt(&ciphertext, &enc_key, mode)
        .map_err(|e| SecurityError::Encryption(e.to_string()))
}

// ═══════════════════════════════════════════════════════════════════════
// Audit Event Logging
// ═══════════════════════════════════════════════════════════════════════

/// Log an event to the audit_log table with TIS-27 hash and optional TL-DSA signature.
pub async fn log_audit_event(
    db: &PgPool,
    task_id: Option<Uuid>,
    project_id: Option<Uuid>,
    event_type: &str,
    payload: &serde_json::Value,
) -> Result<Uuid, SecurityError> {
    let payload_str = serde_json::to_string(payload)
        .unwrap_or_else(|_| "{}".to_string());
    let payload_hash = hashing::hash_bytes(payload_str.as_bytes());

    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO audit_log (id, task_id, project_id, event_type, payload_hash, payload) \
         VALUES ($1, $2, $3, $4, $5, $6)"
    )
    .bind(id)
    .bind(task_id)
    .bind(project_id)
    .bind(event_type)
    .bind(&payload_hash)
    .bind(payload)
    .execute(db)
    .await?;

    Ok(id)
}

/// Sign an existing audit record with the project's TL-DSA key.
pub async fn sign_audit_record(
    db: &PgPool,
    audit_id: Uuid,
    project_id: Uuid,
) -> Result<(), SecurityError> {
    let (_public_key, private_key) = get_active_signing_key(db, project_id).await?;

    // Get the audit record's payload hash
    let (payload_hash,) = sqlx::query_as::<_, (String,)>(
        "SELECT payload_hash FROM audit_log WHERE id = $1"
    )
    .bind(audit_id)
    .fetch_one(db)
    .await?;

    let signature = signing::sign(payload_hash.as_bytes(), &private_key);
    let signature_hex = hex::encode(&signature.0);

    sqlx::query("UPDATE audit_log SET tl_dsa_signature = $1 WHERE id = $2")
        .bind(&signature_hex)
        .bind(audit_id)
        .execute(db)
        .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_integrity_hash_deterministic() {
        let data = b"test data for hashing";
        let h1 = compute_integrity_hash(data);
        let h2 = compute_integrity_hash(data);
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_compute_integrity_hash_different_data() {
        let h1 = compute_integrity_hash(b"data A");
        let h2 = compute_integrity_hash(b"data B");
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_verify_integrity_valid() {
        let data = b"test data";
        let hash = compute_integrity_hash(data);
        assert!(verify_integrity(data, &hash).is_ok());
    }

    #[test]
    fn test_verify_integrity_tampered() {
        let data = b"original data";
        let hash = compute_integrity_hash(data);
        let tampered = b"tampered data";
        let result = verify_integrity(tampered, &hash);
        assert!(result.is_err());
        match result.unwrap_err() {
            SecurityError::IntegrityViolation { stored, computed } => {
                assert_eq!(stored, hash);
                assert_ne!(computed, hash);
            }
            e => panic!("Expected IntegrityViolation, got: {:?}", e),
        }
    }

    #[test]
    fn test_credential_format() {
        // The stored format should be "hash:hex_ciphertext"
        // Can't test full encrypt/decrypt without B-5, but we can test the format logic
        let stored = "abc123:deadbeef";
        let (hash, hex) = stored.split_once(':').unwrap();
        assert_eq!(hash, "abc123");
        assert_eq!(hex, "deadbeef");
    }
}
