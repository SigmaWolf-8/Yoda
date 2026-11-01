//! Untrusted browser reports, physically separate from server calculation records.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Submission {
    pub submission_id: Uuid,
    pub claim: Value,
    pub record: Value,
}

impl Submission {
    pub fn validate(&self) -> Result<(), &'static str> {
        let r = &self.record;
        let c = &self.claim;
        let text = |value: &Value| value.as_str().is_some_and(|s| !s.trim().is_empty() && s.len() <= 8192);
        if !c.is_object() || !text(&c["id"]) || !text(&c["title"]) || !text(&c["formula"])
            || !c["sources"].as_array().is_some_and(|a| !a.is_empty() && a.len() <= 50 && a.iter().all(text))
            || !r.is_object()
            || ["id", "title", "implementationVersion", "testVersion", "executionLocation", "limitation"]
                .iter().any(|k| !text(&r[k]))
            || !r["inputs"].is_object() || !r["expected"].is_object()
            || !r["assumptions"].as_array().is_some_and(|a| a.len() <= 100 && a.iter().all(text))
        {
            return Err("A complete claim, inputs, expectations and versioned record are required");
        }
        if !matches!(r["kind"].as_str(), Some("displayed-formula" | "ai-commentary" |
            "deterministic-computation" | "symbolic-reasoning" | "numerical-check" | "daemon-execution"))
            || !matches!(r["status"].as_str(), Some("passed" | "failed" | "unavailable"))
        {
            return Err("Only completed browser observations may be appended");
        }
        if !r.get("observed").is_some_and(|v| v.is_null() || v.is_object())
            || !r.get("tolerance").is_some_and(|v| v.is_null() || v.as_f64().is_some_and(|n| n.is_finite() && n >= 0.0))
            || !r.get("traceId").is_some_and(|v| v.is_null() || text(v))
            || !r.get("error").is_some_and(|v| v.is_null() || text(v))
            || !r.get("executedAt").is_some_and(|v| v.is_null() ||
                v.as_str().is_some_and(|s| chrono::DateTime::parse_from_rfc3339(s).is_ok()))
        {
            return Err("Invalid observation, tolerance, error or execution provenance");
        }
        if r["status"] == "passed" && (!r["observed"].is_object() || r["executedAt"].is_null()
            || r["traceId"].is_null() || !r["error"].is_null()
            || matches!(r["kind"].as_str(), Some("daemon-execution" | "displayed-formula" | "ai-commentary")))
        {
            return Err("A browser submission cannot claim a successful daemon receipt or unexecuted result");
        }
        if r["status"] != "passed" && !text(&r["error"]) {
            return Err("Failed and unavailable checks must retain their error");
        }
        if serde_json::to_vec(self).map_err(|_| "Invalid JSON")?.len() > 65536 {
            return Err("Evidence exceeds 64 KiB");
        }
        Ok(())
    }
}

const SELECT: &str = "SELECT jsonb_build_object(
    'id',id,'cursor',sequence::text,'receivedAt',received_at,
    'provenance','client-submitted-unverified','daemonReceipt',false,
    'schemaVersion',1,'submission',payload) FROM browser_formula_runs";

/// Idempotent retry of the exact same submission; never overwrite a previous run.
pub async fn append(db: &PgPool, org: Uuid, user: Uuid, submission: &Submission)
    -> Result<(Value, bool), sqlx::Error>
{
    let payload = serde_json::to_value(submission).expect("serializable submission");
    let inserted = sqlx::query("INSERT INTO browser_formula_runs(id,org_id,user_id,submission_id,payload)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(org_id,user_id,submission_id) DO NOTHING")
        .bind(Uuid::new_v4()).bind(org).bind(user).bind(submission.submission_id).bind(&payload)
        .execute(db).await?.rows_affected() == 1;
    let saved: Value = sqlx::query_scalar(&format!("{SELECT} WHERE org_id=$1 AND user_id=$2 AND submission_id=$3"))
        .bind(org).bind(user).bind(submission.submission_id).fetch_one(db).await?;
    // Callers map a differing payload to 409; the existing record is immutable.
    Ok((saved.clone(), inserted || saved["submission"] == payload))
}

pub async fn history(db: &PgPool, org: Uuid, user: Uuid, before: Option<i64>)
    -> Result<Value, sqlx::Error>
{
    let mut runs: Vec<Value> = sqlx::query_scalar(&format!("{SELECT}
        WHERE org_id=$1 AND user_id=$2 AND ($3::bigint IS NULL OR sequence < $3)
        ORDER BY sequence DESC LIMIT 51"))
        .bind(org).bind(user).bind(before).fetch_all(db).await?;
    let more = runs.len() > 50;
    runs.truncate(50);
    let cursor = if more { runs.last().map(|r| r["cursor"].clone()) } else { None };
    Ok(json!({"runs":runs,"nextCursor":cursor}))
}
