//! Audit record assembly and signing.
//!
//! Each FINAL output carries a signed audit record containing:
//! - Task ID and hierarchical position
//! - All inference request hashes (TIS-27)
//! - All reviewer verdicts with engine identifiers
//! - All result versions with diffs
//! - Timestamps for every state transition
//! - TL-DSA signature chain

use crate::hashing;
use crate::signing::{self, PrivateKey, PublicKey, Signature};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Complete audit record for a FINAL task output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditRecord {
    pub task_id: Uuid,
    pub task_number: String,
    pub inference_hashes: Vec<String>,
    pub reviewer_verdicts: Vec<serde_json::Value>,
    pub result_versions: Vec<String>,
    pub engine_ids: Vec<String>,
    pub model_versions: Vec<String>,
    pub state_transitions: Vec<StateTransition>,
}

/// Timestamp for a task state transition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateTransition {
    pub from_state: String,
    pub to_state: String,
    pub timestamp: DateTime<Utc>,
}

/// Audit record with TL-DSA signature chain.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedAuditRecord {
    pub record: AuditRecord,
    pub record_hash: String,
    pub signature: Signature,
    pub signature_chain: Vec<Signature>,
}

/// Build an audit record from task completion data.
pub fn build_audit_record(
    task_id: Uuid,
    task_number: &str,
    inference_hashes: Vec<String>,
    reviewer_verdicts: Vec<serde_json::Value>,
    result_versions: Vec<String>,
    engine_ids: Vec<String>,
    model_versions: Vec<String>,
    state_transitions: Vec<StateTransition>,
) -> AuditRecord {
    AuditRecord {
        task_id,
        task_number: task_number.to_string(),
        inference_hashes,
        reviewer_verdicts,
        result_versions,
        engine_ids,
        model_versions,
        state_transitions,
    }
}

/// Sign an audit record with TL-DSA, appending to the signature chain.
///
/// The signing payload is the TIS-27 hash of the serialized record,
/// creating a hash chain: record → hash → signature → chain.
pub fn sign_audit_record(
    record: AuditRecord,
    private_key: &PrivateKey,
    prior_chain: Vec<Signature>,
) -> SignedAuditRecord {
    // Serialize the record to JSON for hashing
    let record_json = serde_json::to_string(&record)
        .unwrap_or_else(|_| format!("{:?}", record));

    // Hash the record with TIS-27
    let record_hash = hashing::hash_bytes(record_json.as_bytes());

    // Build the signing payload: record hash + prior chain hashes
    let mut sign_payload = record_hash.clone();
    for prior_sig in &prior_chain {
        sign_payload.push_str(&hex::encode(&prior_sig.0));
    }

    // Sign with TL-DSA
    let signature = signing::sign(sign_payload.as_bytes(), private_key);

    // Append to chain
    let mut chain = prior_chain;
    chain.push(signature.clone());

    SignedAuditRecord {
        record,
        record_hash,
        signature,
        signature_chain: chain,
    }
}

/// Verify a signed audit record against a public key.
///
/// Recomputes the record hash, reconstructs the signing payload,
/// and verifies the TL-DSA signature.
pub fn verify_audit_record(
    signed: &SignedAuditRecord,
    public_key: &PublicKey,
) -> bool {
    // Recompute the record hash
    let record_json = serde_json::to_string(&signed.record)
        .unwrap_or_else(|_| format!("{:?}", signed.record));
    let computed_hash = hashing::hash_bytes(record_json.as_bytes());

    // Verify hash matches
    if computed_hash != signed.record_hash {
        return false;
    }

    // Reconstruct the signing payload
    let mut sign_payload = signed.record_hash.clone();
    // All chain entries EXCEPT the last one (which is the current signature)
    for prior_sig in signed.signature_chain.iter().take(signed.signature_chain.len().saturating_sub(1)) {
        sign_payload.push_str(&hex::encode(&prior_sig.0));
    }

    // Verify the signature
    signing::verify(sign_payload.as_bytes(), &signed.signature, public_key)
}

/// Compute the TIS-27 hash of a complete audit record for integrity tracking.
pub fn hash_audit_record(record: &AuditRecord) -> String {
    let json = serde_json::to_string(record).unwrap_or_default();
    hashing::hash_bytes(json.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_record() -> AuditRecord {
        build_audit_record(
            Uuid::new_v4(),
            "1.3.2.1",
            vec!["hash_a".into(), "hash_b".into()],
            vec![serde_json::json!({"approved": true})],
            vec!["result_v1".into(), "result_final".into()],
            vec!["engine_a".into()],
            vec!["Qwen3.5-27B".into()],
            vec![StateTransition {
                from_state: "ASSIGNED".into(),
                to_state: "STEP_1_PRODUCTION".into(),
                timestamp: Utc::now(),
            }],
        )
    }

    #[test]
    fn test_build_audit_record() {
        let record = sample_record();
        assert_eq!(record.task_number, "1.3.2.1");
        assert_eq!(record.inference_hashes.len(), 2);
        assert_eq!(record.state_transitions.len(), 1);
    }

    #[test]
    fn test_sign_and_verify_audit_record() {
        let (pk, sk) = signing::generate_keypair();
        let record = sample_record();

        let signed = sign_audit_record(record, &sk, vec![]);

        assert!(!signed.record_hash.is_empty());
        assert!(!signed.signature.0.is_empty());
        assert_eq!(signed.signature_chain.len(), 1);

        assert!(
            verify_audit_record(&signed, &pk),
            "Signed audit record must verify"
        );
    }

    #[test]
    fn test_verify_rejects_tampered_record() {
        let (pk, sk) = signing::generate_keypair();
        let record = sample_record();
        let mut signed = sign_audit_record(record, &sk, vec![]);

        // Tamper with the record
        signed.record.task_number = "TAMPERED".into();

        assert!(
            !verify_audit_record(&signed, &pk),
            "Tampered record must fail verification"
        );
    }

    #[test]
    fn test_verify_rejects_wrong_key() {
        let (_pk1, sk1) = signing::generate_keypair();
        let (pk2, _sk2) = signing::generate_keypair();
        let record = sample_record();
        let signed = sign_audit_record(record, &sk1, vec![]);

        assert!(
            !verify_audit_record(&signed, &pk2),
            "Wrong key must fail verification"
        );
    }

    #[test]
    fn test_signature_chain_growth() {
        let (_pk, sk) = signing::generate_keypair();

        let record1 = sample_record();
        let signed1 = sign_audit_record(record1, &sk, vec![]);
        assert_eq!(signed1.signature_chain.len(), 1);

        let record2 = sample_record();
        let signed2 = sign_audit_record(record2, &sk, signed1.signature_chain);
        assert_eq!(signed2.signature_chain.len(), 2);

        let record3 = sample_record();
        let signed3 = sign_audit_record(record3, &sk, signed2.signature_chain);
        assert_eq!(signed3.signature_chain.len(), 3);
    }

    #[test]
    fn test_hash_audit_record_deterministic() {
        let record = sample_record();
        let h1 = hash_audit_record(&record);
        let h2 = hash_audit_record(&record);
        assert_eq!(h1, h2);
    }
}
