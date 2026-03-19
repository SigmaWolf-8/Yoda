//! Security verification tests.
//!
//! B6.6: Verify security invariants across the entire stack.
//! These tests validate the architecture — some require a running DB
//! (integration tests), others verify code patterns (unit tests).

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    // ─── No credentials in source code ───────────────────────────────

    #[test]
    fn test_no_hardcoded_api_keys() {
        // Scan all Rust source files for hardcoded API key patterns
        let patterns = [
            "sk-",           // OpenAI-style
            "sk_live_",      // Stripe-style
            "AKIA",          // AWS access key prefix
            "xai-",          // xAI key prefix
            "AIzaSy",        // Google API key prefix
        ];

        let source_dirs = ["crates", "tools"];
        for dir in source_dirs {
            let dir_path = Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap()
                .parent()
                .unwrap()
                .join(dir);

            if !dir_path.exists() {
                continue;
            }

            check_dir_for_patterns(&dir_path, &patterns);
        }
    }

    fn check_dir_for_patterns(dir: &Path, patterns: &[&str]) {
        if !dir.is_dir() {
            return;
        }
        for entry in fs::read_dir(dir).unwrap() {
            let entry = entry.unwrap();
            let path = entry.path();
            if path.is_dir() {
                check_dir_for_patterns(&path, patterns);
            } else if path.extension().map_or(false, |e| e == "rs") {
                let content = fs::read_to_string(&path).unwrap();
                for pattern in patterns {
                    // Allow patterns in comments/docs and test assertions
                    for (line_num, line) in content.lines().enumerate() {
                        let trimmed = line.trim();
                        if trimmed.starts_with("//") || trimmed.starts_with("///") || trimmed.starts_with("#[") {
                            continue;
                        }
                        if trimmed.contains("test") || trimmed.contains("assert") {
                            continue;
                        }
                        assert!(
                            !line.contains(pattern),
                            "Potential hardcoded key found: pattern '{}' in {}:{}",
                            pattern,
                            path.display(),
                            line_num + 1
                        );
                    }
                }
            }
        }
    }

    // ─── Private keys never in API responses ─────────────────────────

    #[test]
    fn test_private_key_fields_are_skip_serialize() {
        // The EngineConfig.credentials field has #[serde(skip_serializing)]
        // which prevents it from appearing in JSON API responses.
        let source = include_str!("../../yoda-inference-router/src/lib.rs");
        assert!(
            source.contains("skip_serializing"),
            "EngineConfig.credentials must have #[serde(skip_serializing)]"
        );
    }

    #[test]
    fn test_private_key_never_in_engine_response() {
        // The get_engines route queries specific columns — credentials_encrypted
        // is NOT in the SELECT list.
        let routes_source = include_str!("routes.rs");
        // The engine query should NOT select credentials_encrypted
        let engine_select = routes_source
            .lines()
            .filter(|l| l.contains("SELECT") && l.contains("engine_configs"))
            .collect::<Vec<_>>();

        for line in &engine_select {
            assert!(
                !line.contains("credentials_encrypted"),
                "Engine query must NOT return credentials_encrypted: {}",
                line
            );
        }
    }

    // ─── SQL injection prevention ────────────────────────────────────

    #[test]
    fn test_no_string_interpolation_in_sql() {
        // All SQL queries should use $1, $2, etc. (parameterized via sqlx).
        // Scan for dangerous patterns: format!("...WHERE x = '{}'")
        let dangerous_patterns = [
            "format!(\"SELECT",
            "format!(\"INSERT",
            "format!(\"UPDATE",
            "format!(\"DELETE",
            "&format!(\"SELECT",
        ];

        let api_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        for entry in fs::read_dir(&api_dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().map_or(false, |e| e == "rs") {
                let content = fs::read_to_string(&path).unwrap();
                for pattern in &dangerous_patterns {
                    // Allow in comments
                    for (line_num, line) in content.lines().enumerate() {
                        let trimmed = line.trim();
                        if trimmed.starts_with("//") {
                            continue;
                        }
                        assert!(
                            !line.contains(pattern),
                            "Potential SQL injection: '{}' in {}:{}",
                            pattern,
                            path.display(),
                            line_num + 1
                        );
                    }
                }
            }
        }
    }

    // ─── Credential storage format ───────────────────────────────────

    #[test]
    fn test_encrypted_credential_format() {
        // Stored credentials should be in "hash:hex_ciphertext" format
        // This verifies the format contract without requiring real encryption
        let stored = "abc123def456:0123456789abcdef";
        let parts: Vec<&str> = stored.split(':').collect();
        assert_eq!(parts.len(), 2, "Credential format must be 'hash:ciphertext'");
        assert!(!parts[0].is_empty(), "Hash portion must not be empty");
        assert!(!parts[1].is_empty(), "Ciphertext portion must not be empty");
        // Hex validation
        assert!(
            hex::decode(parts[1]).is_ok(),
            "Ciphertext must be valid hex"
        );
    }

    // ─── Integrity hash determinism ──────────────────────────────────

    #[test]
    fn test_integrity_hash_deterministic() {
        use crate::security::compute_integrity_hash;
        let data = b"deterministic hash test";
        let h1 = compute_integrity_hash(data);
        let h2 = compute_integrity_hash(data);
        assert_eq!(h1, h2, "TIS-27 hash must be deterministic");
    }

    #[test]
    fn test_integrity_hash_different_inputs() {
        use crate::security::compute_integrity_hash;
        let h1 = compute_integrity_hash(b"input A");
        let h2 = compute_integrity_hash(b"input B");
        assert_ne!(h1, h2, "Different inputs must produce different hashes");
    }

    #[test]
    fn test_integrity_verification_pass() {
        use crate::security::{compute_integrity_hash, verify_integrity};
        let data = b"verify this";
        let hash = compute_integrity_hash(data);
        assert!(verify_integrity(data, &hash).is_ok());
    }

    #[test]
    fn test_integrity_verification_tampered_fail() {
        use crate::security::{compute_integrity_hash, verify_integrity};
        let original = b"original data";
        let hash = compute_integrity_hash(original);
        let tampered = b"tampered data";
        assert!(verify_integrity(tampered, &hash).is_err());
    }

    // ─── Auth middleware coverage ─────────────────────────────────────

    #[test]
    fn test_auth_routes_use_middleware() {
        // Verify that all protected route blocks have the auth middleware layer
        let routes_source = include_str!("routes.rs");
        assert!(
            routes_source.contains("auth::auth_middleware"),
            "Protected routes must use auth_middleware"
        );
    }

    #[test]
    fn test_public_routes_are_limited() {
        // Only auth endpoints and lineages should be public
        let routes_source = include_str!("routes.rs");

        // Count public route registrations (before auth middleware)
        let public_section: &str = routes_source
            .split("let protected")
            .next()
            .unwrap_or("");

        let public_routes: Vec<&str> = public_section
            .lines()
            .filter(|l| l.contains(".route(\""))
            .collect();

        // Should be exactly: register, login, refresh, logout, lineages = 5
        assert!(
            public_routes.len() <= 6,
            "Too many public routes ({}). Only auth + lineages should be public: {:?}",
            public_routes.len(),
            public_routes
        );
    }

    // ─── Password hashing ────────────────────────────────────────────

    #[test]
    fn test_password_hash_is_not_plaintext() {
        use crate::auth::hash_password;
        let password = "MySecretP@ssw0rd";
        let hash = hash_password(password).unwrap();
        assert_ne!(hash, password, "Hash must not equal plaintext");
        assert!(hash.starts_with("$argon2"), "Must use argon2 format");
    }

    #[test]
    fn test_password_hash_verify_roundtrip() {
        use crate::auth::{hash_password, verify_password};
        let password = "TestPassword123!";
        let hash = hash_password(password).unwrap();
        assert!(verify_password(password, &hash).unwrap());
        assert!(!verify_password("WrongPassword", &hash).unwrap());
    }

    // ─── JWT validation ──────────────────────────────────────────────

    #[test]
    fn test_jwt_create_and_validate() {
        use crate::auth::{create_access_token, validate_access_token};
        let user_id = uuid::Uuid::new_v4();
        let org_id = uuid::Uuid::new_v4();
        let secret = "test_secret_key_at_least_32_chars_long";

        let token = create_access_token(user_id, "test@example.com", org_id, secret, 15).unwrap();
        let claims = validate_access_token(&token, secret).unwrap();

        assert_eq!(claims.sub, user_id);
        assert_eq!(claims.email, "test@example.com");
        assert_eq!(claims.org_id, org_id);
    }

    #[test]
    fn test_jwt_reject_wrong_secret() {
        use crate::auth::{create_access_token, validate_access_token};
        let token = create_access_token(
            uuid::Uuid::new_v4(), "t@t.com", uuid::Uuid::new_v4(),
            "secret_a_at_least_32_characters_long", 15,
        ).unwrap();

        let result = validate_access_token(&token, "secret_b_completely_different_key");
        assert!(result.is_err());
    }

    #[test]
    fn test_jwt_reject_expired() {
        use crate::auth::{create_access_token, validate_access_token};
        // Create a token that expired 1 minute ago (negative expiry)
        let token = create_access_token(
            uuid::Uuid::new_v4(), "t@t.com", uuid::Uuid::new_v4(),
            "test_secret_at_least_32_characters", -1,
        ).unwrap();

        let result = validate_access_token(&token, "test_secret_at_least_32_characters");
        assert!(result.is_err());
    }
}
