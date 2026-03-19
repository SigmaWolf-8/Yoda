//! Structured output validation.
//!
//! After every inference response, validates the content against expected
//! structure. Distinguishes between valid output, token-limit truncation
//! (auto-retryable), and malformed output (retry with same params).

/// Result of validating an inference response.
#[derive(Debug, Clone, PartialEq)]
pub enum ValidationResult {
    /// Response is valid structured output.
    Valid,
    /// Response was truncated due to token limit — retry with larger max_tokens.
    Truncated,
    /// Response is malformed — retry with same params.
    Malformed(String),
}

pub struct Validator;

impl Validator {
    /// Validate an inference response.
    ///
    /// Checks for:
    /// - Empty content
    /// - Token-limit truncation (response near max_tokens and JSON incomplete)
    /// - Malformed JSON (if JSON expected — missing braces, unterminated strings)
    pub fn validate(content: &str, max_tokens: u32, finish_reason: Option<&str>) -> ValidationResult {
        // Empty response
        if content.trim().is_empty() {
            return ValidationResult::Malformed("empty response".into());
        }

        // Check finish reason — "length" means token limit hit
        if finish_reason == Some("length") {
            return ValidationResult::Truncated;
        }

        // Heuristic: if content looks like JSON, check structural completeness
        let trimmed = content.trim();
        if trimmed.starts_with('{') || trimmed.starts_with('[') {
            if let Some(issue) = check_json_completeness(trimmed) {
                // Could be truncation or could be malformed
                // If content length is close to estimated token limit, assume truncation
                let estimated_tokens = content.len() / 4; // rough char-to-token ratio
                let threshold = (max_tokens as f64 * 0.9) as usize;
                if estimated_tokens >= threshold {
                    return ValidationResult::Truncated;
                }
                return ValidationResult::Malformed(issue);
            }
        }

        ValidationResult::Valid
    }
}

/// Check if JSON content is structurally complete.
/// Returns Some(reason) if incomplete, None if complete.
fn check_json_completeness(content: &str) -> Option<String> {
    // Quick check: try parsing as JSON
    match serde_json::from_str::<serde_json::Value>(content) {
        Ok(_) => None,
        Err(e) => {
            // Distinguish between truncation and malformation
            let err_str = e.to_string();
            if err_str.contains("EOF") || err_str.contains("unexpected end") {
                Some("incomplete JSON — truncated".into())
            } else {
                Some(format!("malformed JSON: {}", err_str))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_response() {
        let result = Validator::validate(
            r#"{"analysis": "looks good", "confidence": 0.9}"#,
            4096,
            Some("stop"),
        );
        assert_eq!(result, ValidationResult::Valid);
    }

    #[test]
    fn test_valid_non_json() {
        let result = Validator::validate("This is a text response.", 4096, Some("stop"));
        assert_eq!(result, ValidationResult::Valid);
    }

    #[test]
    fn test_empty_response() {
        let result = Validator::validate("", 4096, Some("stop"));
        assert_eq!(result, ValidationResult::Malformed("empty response".into()));
    }

    #[test]
    fn test_whitespace_only() {
        let result = Validator::validate("   \n  ", 4096, Some("stop"));
        assert_eq!(result, ValidationResult::Malformed("empty response".into()));
    }

    #[test]
    fn test_finish_reason_length_is_truncation() {
        let result = Validator::validate(
            r#"{"partial": "data"#,
            4096,
            Some("length"),
        );
        assert_eq!(result, ValidationResult::Truncated);
    }

    #[test]
    fn test_incomplete_json_short_content() {
        // Short content with incomplete JSON — malformed, not truncated
        let result = Validator::validate(r#"{"key": "val"#, 4096, Some("stop"));
        assert!(matches!(result, ValidationResult::Malformed(_)));
    }

    #[test]
    fn test_complete_json_object() {
        let result = Validator::validate(r#"{"key": "value"}"#, 4096, None);
        assert_eq!(result, ValidationResult::Valid);
    }

    #[test]
    fn test_complete_json_array() {
        let result = Validator::validate(r#"[1, 2, 3]"#, 4096, None);
        assert_eq!(result, ValidationResult::Valid);
    }
}
