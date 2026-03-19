//! Capability matrix persistence and meta-learning.
//!
//! B7.1: Store per-(engine, agent_role, domain) scores in PostgreSQL.
//! Update scores after each review cycle via exponential moving average.
//! The Inference Router uses these scores to select optimal engines.

use sqlx::PgPool;
use thiserror::Error;
use uuid::Uuid;
use yoda_inference_router::EngineSlot;

#[derive(Debug, Error)]
pub enum CapabilityError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

/// A single capability score entry.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CapabilityScore {
    pub engine_slot: String,
    pub model_name: String,
    pub agent_role: String,
    pub domain: String,
    pub score: f64,
    pub sample_count: i32,
}

/// EMA smoothing factor for score updates.
/// 0.1 = slow adaptation (stable), 0.3 = fast adaptation (reactive).
const EMA_ALPHA: f64 = 0.15;

/// Record a review outcome and update the capability score.
///
/// Called after every review cycle completes. The `outcome` is 1.0 for
/// a successful review (reviewer caught real issues or correctly approved)
/// and 0.0 for a poor review (missed obvious issues or false rejection).
pub async fn record_outcome(
    db: &PgPool,
    org_id: Uuid,
    engine_slot: EngineSlot,
    model_name: &str,
    agent_role: &str,
    domain: &str,
    outcome: f64,
) -> Result<(), CapabilityError> {
    let slot_str = match engine_slot {
        EngineSlot::A => "a",
        EngineSlot::B => "b",
        EngineSlot::C => "c",
    };

    // Upsert with EMA update
    sqlx::query(
        "INSERT INTO capability_scores \
         (id, org_id, engine_slot, model_name, agent_role, domain, score, sample_count) \
         VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, 1) \
         ON CONFLICT (org_id, engine_slot, agent_role, domain) DO UPDATE SET \
         score = capability_scores.score * (1.0 - $7) + $6 * $7, \
         sample_count = capability_scores.sample_count + 1, \
         updated_at = NOW()"
    )
    .bind(org_id)
    .bind(slot_str)
    .bind(model_name)
    .bind(agent_role)
    .bind(domain)
    .bind(outcome)
    .bind(EMA_ALPHA)
    .execute(db)
    .await?;

    tracing::debug!(
        org_id = %org_id,
        engine = slot_str,
        role = agent_role,
        domain = domain,
        outcome = outcome,
        "Updated capability score"
    );

    Ok(())
}

/// Get the best engine for a specific agent role and domain.
///
/// Returns engine slots sorted by score descending.
pub async fn rank_engines(
    db: &PgPool,
    org_id: Uuid,
    agent_role: &str,
    domain: &str,
) -> Result<Vec<CapabilityScore>, CapabilityError> {
    let rows = sqlx::query_as::<_, (String, String, String, String, f64, i32)>(
        "SELECT engine_slot, model_name, agent_role, domain, score, sample_count \
         FROM capability_scores \
         WHERE org_id = $1 AND agent_role = $2 AND domain = $3 \
         ORDER BY score DESC"
    )
    .bind(org_id)
    .bind(agent_role)
    .bind(domain)
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(slot, model, role, dom, score, count)| CapabilityScore {
            engine_slot: slot,
            model_name: model,
            agent_role: role,
            domain: dom,
            score,
            sample_count: count,
        })
        .collect())
}

/// Get all capability scores for an organization (for the dashboard).
pub async fn get_all_scores(
    db: &PgPool,
    org_id: Uuid,
) -> Result<Vec<CapabilityScore>, CapabilityError> {
    let rows = sqlx::query_as::<_, (String, String, String, String, f64, i32)>(
        "SELECT engine_slot, model_name, agent_role, domain, score, sample_count \
         FROM capability_scores \
         WHERE org_id = $1 \
         ORDER BY engine_slot, agent_role, domain"
    )
    .bind(org_id)
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(slot, model, role, dom, score, count)| CapabilityScore {
            engine_slot: slot,
            model_name: model,
            agent_role: role,
            domain: dom,
            score,
            sample_count: count,
        })
        .collect())
}

/// Select the optimal engine for a primary producer role.
///
/// Returns the engine slot with the highest score for the given
/// competencies, or falls back to the first configured engine.
pub async fn select_optimal_engine(
    db: &PgPool,
    org_id: Uuid,
    competencies: &[String],
) -> Result<Option<String>, CapabilityError> {
    if competencies.is_empty() {
        return Ok(None);
    }

    // Average scores across all requested competency domains
    let placeholders: Vec<String> = competencies
        .iter()
        .enumerate()
        .map(|(i, _)| format!("${}", i + 2))
        .collect();
    let placeholder_str = placeholders.join(", ");

    let sql = format!(
        "SELECT engine_slot, AVG(score) as avg_score \
         FROM capability_scores \
         WHERE org_id = $1 AND domain IN ({}) AND sample_count >= 3 \
         GROUP BY engine_slot \
         ORDER BY avg_score DESC \
         LIMIT 1",
        placeholder_str
    );

    // Build query dynamically
    let mut query = sqlx::query_as::<_, (String, f64)>(&sql).bind(org_id);
    for comp in competencies {
        query = query.bind(comp);
    }

    let result = query.fetch_optional(db).await?;
    Ok(result.map(|(slot, _score)| slot))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ema_calculation() {
        // Simulate EMA: start at 0.5, observe 1.0 outcome
        let old_score = 0.5;
        let outcome = 1.0;
        let new_score = old_score * (1.0 - EMA_ALPHA) + outcome * EMA_ALPHA;
        assert!((new_score - 0.575).abs() < 0.001); // 0.5 * 0.85 + 1.0 * 0.15

        // Another update with 1.0
        let newer_score = new_score * (1.0 - EMA_ALPHA) + 1.0 * EMA_ALPHA;
        assert!(newer_score > new_score); // Score increases toward 1.0
    }

    #[test]
    fn test_ema_decay_on_failure() {
        let old_score = 0.8;
        let outcome = 0.0; // failure
        let new_score = old_score * (1.0 - EMA_ALPHA) + outcome * EMA_ALPHA;
        assert!((new_score - 0.68).abs() < 0.001); // 0.8 * 0.85 + 0.0 * 0.15
        assert!(new_score < old_score); // Score decreases
    }
}
