//! Censorship detection for commercial and free-tier engines.
//!
//! Flags responses affected by content policy — refusals, safety hedging,
//! and content-filter truncation. Flagged responses are NOT retried —
//! just transparently marked in the review record. The other engines
//! (especially self-hosted) compensate.
//!
//! Self-hosted engines bypass censorship detection entirely.

/// Patterns indicating a refusal or content-filter response.
const REFUSAL_PATTERNS: &[&str] = &[
    "i can't help with that",
    "i cannot help with that",
    "i'm not able to",
    "i am not able to",
    "i can't assist with",
    "i cannot assist with",
    "i'm unable to",
    "i am unable to",
    "i must decline",
    "i have to decline",
    "as an ai",
    "as a language model",
    "i don't have the ability",
    "i cannot provide",
    "i can't provide",
    "this request violates",
    "against my guidelines",
    "against my programming",
    "my content policy",
    "content policy",
    "i'm sorry, but i can't",
    "i'm sorry, but i cannot",
];

/// Patterns indicating safety hedging (excessive qualifiers).
const HEDGING_PATTERNS: &[&str] = &[
    "it's important to note that",
    "please be aware that",
    "i should mention that",
    "i want to emphasize that this",
    "please consult a professional",
    "this is not professional advice",
    "i strongly recommend seeking",
    "please exercise caution",
    "use at your own risk",
];

/// Minimum hedging pattern matches to flag as safety-hedged.
const HEDGING_THRESHOLD: usize = 3;

pub struct CensorshipDetector;

impl CensorshipDetector {
    /// Check a response for censorship indicators.
    /// Returns true if censorship is detected.
    pub fn check(content: &str) -> bool {
        let lower = content.to_lowercase();

        // Check for outright refusal
        if Self::has_refusal(&lower) {
            return true;
        }

        // Check for excessive safety hedging
        if Self::hedging_score(&lower) >= HEDGING_THRESHOLD {
            return true;
        }

        false
    }

    /// Detailed censorship analysis with reason.
    pub fn analyze(content: &str) -> CensorshipAnalysis {
        let lower = content.to_lowercase();

        if Self::has_refusal(&lower) {
            return CensorshipAnalysis {
                flagged: true,
                reason: CensorshipReason::Refusal,
                detail: Self::find_matching_pattern(&lower, REFUSAL_PATTERNS)
                    .unwrap_or_default()
                    .to_string(),
            };
        }

        let hedging = Self::hedging_score(&lower);
        if hedging >= HEDGING_THRESHOLD {
            return CensorshipAnalysis {
                flagged: true,
                reason: CensorshipReason::SafetyHedging,
                detail: format!("{} hedging patterns detected (threshold: {})", hedging, HEDGING_THRESHOLD),
            };
        }

        CensorshipAnalysis {
            flagged: false,
            reason: CensorshipReason::None,
            detail: String::new(),
        }
    }

    fn has_refusal(lower_content: &str) -> bool {
        REFUSAL_PATTERNS.iter().any(|p| lower_content.contains(p))
    }

    fn hedging_score(lower_content: &str) -> usize {
        HEDGING_PATTERNS
            .iter()
            .filter(|p| lower_content.contains(**p))
            .count()
    }

    fn find_matching_pattern<'a>(lower_content: &str, patterns: &[&'a str]) -> Option<&'a str> {
        patterns.iter().find(|p| lower_content.contains(**p)).copied()
    }
}

/// Detailed censorship analysis result.
#[derive(Debug, Clone)]
pub struct CensorshipAnalysis {
    pub flagged: bool,
    pub reason: CensorshipReason,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CensorshipReason {
    None,
    Refusal,
    SafetyHedging,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_response_not_flagged() {
        let response = "Here is the implementation of the retry logic with exponential backoff. \
                        The function handles transient failures gracefully.";
        assert!(!CensorshipDetector::check(response));
    }

    #[test]
    fn test_refusal_flagged() {
        let response = "I'm sorry, but I can't help with that request.";
        assert!(CensorshipDetector::check(response));
    }

    #[test]
    fn test_content_policy_flagged() {
        let response = "This request violates our content policy. I cannot assist.";
        assert!(CensorshipDetector::check(response));
    }

    #[test]
    fn test_as_ai_flagged() {
        let response = "As an AI language model, I don't have the ability to execute code.";
        assert!(CensorshipDetector::check(response));
    }

    #[test]
    fn test_single_hedging_not_flagged() {
        let response = "Here is the code. It's important to note that error handling is included.";
        assert!(!CensorshipDetector::check(response));
    }

    #[test]
    fn test_excessive_hedging_flagged() {
        let response = "It's important to note that this is complex. \
                        Please be aware that edge cases exist. \
                        I should mention that testing is needed. \
                        Please consult a professional for production use.";
        assert!(CensorshipDetector::check(response));
    }

    #[test]
    fn test_analyze_refusal() {
        let analysis = CensorshipDetector::analyze("I cannot provide that information.");
        assert!(analysis.flagged);
        assert_eq!(analysis.reason, CensorshipReason::Refusal);
    }

    #[test]
    fn test_analyze_clean() {
        let analysis = CensorshipDetector::analyze("Here is the Rust implementation.");
        assert!(!analysis.flagged);
        assert_eq!(analysis.reason, CensorshipReason::None);
    }

    #[test]
    fn test_case_insensitive() {
        assert!(CensorshipDetector::check("I CAN'T HELP WITH THAT"));
        assert!(CensorshipDetector::check("As An AI Language Model"));
    }
}
