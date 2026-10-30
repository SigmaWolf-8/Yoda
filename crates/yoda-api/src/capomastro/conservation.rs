//! Shared, persisted conservation audit. No payments, mints, or edits to the
//! historical workbook occur here. Failures remain visible as failed evidence.
use axum::{extract::State, Json};
use capomastro_ledger::conservation::{self, GateInput, GateResult};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{postgres::PgRow, Row};
use uuid::Uuid;

use super::dec::Dec;
use crate::{error::AppError, state::AppState};

const GENESIS: &str = "0000000000000000000000000000000000000000000000000000000000000000";
const SELECT: &str = "SELECT id, created_at, previous_hash, hash, input, result FROM conservation_audit ORDER BY sequence";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateRecord {
    pub id: Uuid,
    pub created_at: String,
    pub previous_hash: String,
    pub hash: String,
    pub input: GateInput,
    pub result: GateResult,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainReport {
    pub valid: bool,
    pub count: usize,
    pub errors: Vec<String>,
    pub head: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordRequest {
    pub request_id: Uuid,
    pub input: GateInput,
}

fn internal(e: impl std::fmt::Display) -> AppError {
    AppError::Internal(format!("conservation audit: {e}"))
}

fn validate(input: &GateInput) -> Result<GateResult, AppError> {
    let start = DateTime::parse_from_rfc3339(&input.period_start)
        .map_err(|_| AppError::Validation("periodStart must be RFC3339 with a timezone".into()))?;
    let end = DateTime::parse_from_rfc3339(&input.period_end)
        .map_err(|_| AppError::Validation("periodEnd must be RFC3339 with a timezone".into()))?;
    if end < start {
        return Err(AppError::Validation("periodEnd cannot precede periodStart".into()));
    }
    conservation::evaluate(input).map_err(|e| AppError::Validation(e.to_string()))
}

// JSONB can reorder object keys. Sort recursively before hashing and use the
// same canonical form for both fresh and reloaded records.
fn canonical(v: &Value) -> String {
    match v {
        Value::Object(map) => {
            let mut keys: Vec<_> = map.keys().collect();
            keys.sort();
            format!("{{{}}}", keys.iter().map(|k| {
                format!("{}:{}", json!(k), canonical(&map[*k]))
            }).collect::<Vec<_>>().join(","))
        }
        Value::Array(items) => format!("[{}]", items.iter().map(canonical).collect::<Vec<_>>().join(",")),
        _ => v.to_string(),
    }
}

fn record_hash(record: &GateRecord) -> String {
    let body = json!({
        "schema": "capomastro.conservation/1",
        "id": record.id, "createdAt": record.created_at,
        "previousHash": record.previous_hash, "input": record.input, "result": record.result
    });
    hex::encode(Sha256::digest(canonical(&body).as_bytes()))
}

fn decode(rows: Vec<PgRow>) -> Result<Vec<GateRecord>, AppError> {
    rows.into_iter().map(|row| {
        Ok(GateRecord {
            id: row.try_get("id")?,
            created_at: row.try_get("created_at")?,
            previous_hash: row.try_get("previous_hash")?,
            hash: row.try_get("hash")?,
            input: serde_json::from_value(row.try_get::<Value, _>("input")?).map_err(internal)?,
            result: serde_json::from_value(row.try_get::<Value, _>("result")?).map_err(internal)?,
        })
    }).collect()
}

fn verify_records(records: &[GateRecord]) -> ChainReport {
    let mut previous = GENESIS;
    let mut errors = Vec::new();
    for r in records {
        if r.previous_hash != previous {
            errors.push(format!("{}: previous hash mismatch", r.id));
        }
        if record_hash(r) != r.hash {
            errors.push(format!("{}: record hash mismatch", r.id));
        }
        match validate(&r.input) {
            Ok(result) if result == r.result => {}
            _ => errors.push(format!("{}: stored computation does not match validated inputs", r.id)),
        }
        previous = &r.hash;
    }
    ChainReport {
        valid: errors.is_empty(), count: records.len(), errors,
        head: records.last().map(|r| r.hash.clone()),
    }
}

pub async fn evaluate(Json(input): Json<GateInput>) -> Result<Json<GateResult>, AppError> {
    Ok(Json(validate(&input)?))
}

pub async fn append(
    State(state): State<AppState>,
    Json(request): Json<RecordRequest>,
) -> Result<Json<GateRecord>, AppError> {
    if request.request_id.is_nil() {
        return Err(AppError::Validation("A nonzero requestId is required".into()));
    }
    let result = validate(&request.input)?;
    let mut tx = state.db.begin().await?;
    // One chain, one append lock. Verify and insert occur in the same
    // transaction; concurrent writers cannot fork or reuse a predecessor.
    sqlx::query("SELECT pg_advisory_xact_lock(671203901284)")
        .execute(&mut *tx).await?;
    let records = decode(sqlx::query(SELECT).fetch_all(&mut *tx).await?)?;
    let chain = verify_records(&records);
    if !chain.valid {
        return Err(AppError::Conflict(
            "The existing audit chain failed verification; no record was appended".into(),
        ));
    }
    if let Some(old) = records.iter().find(|r| r.id == request.request_id) {
        if old.input != request.input {
            return Err(AppError::Conflict("requestId already belongs to different inputs".into()));
        }
        let out = old.clone();
        tx.commit().await?;
        return Ok(Json(out));
    }
    let mut record = GateRecord {
        id: request.request_id,
        created_at: Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true),
        previous_hash: chain.head.unwrap_or_else(|| GENESIS.into()),
        hash: String::new(), input: request.input, result,
    };
    record.hash = record_hash(&record);
    sqlx::query(
        "INSERT INTO conservation_audit (id, created_at, previous_hash, hash, input, result) VALUES ($1,$2,$3,$4,$5,$6)",
    )
    .bind(record.id).bind(&record.created_at).bind(&record.previous_hash).bind(&record.hash)
    .bind(serde_json::to_value(&record.input).map_err(internal)?)
    .bind(serde_json::to_value(&record.result).map_err(internal)?)
    .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(record))
}

pub async fn verify(State(state): State<AppState>) -> Result<Json<ChainReport>, AppError> {
    let records = decode(sqlx::query(SELECT).fetch_all(&state.db).await?)?;
    Ok(Json(verify_records(&records)))
}

fn decimal(v: &Value, path: &str) -> Result<Dec, AppError> {
    let s = v.pointer(path).and_then(Value::as_str)
        .ok_or_else(|| internal(format!("missing exact-decimal value at {path}")))?;
    Dec::parse(s).map_err(internal)
}

fn check(status: &str, residual: Option<String>, source: &str, message: &str) -> Value {
    json!({"status":status, "residual":residual, "source":source, "message":message})
}

fn ledger_checks() -> Result<(Value, Value), AppError> {
    let computed = super::live_summary()?;
    let summary = &computed.summary;
    let residual = decimal(summary, "/balanceSheet/totalAssets")?
        .sub(&decimal(summary, "/balanceSheet/totalLiabilities")?).map_err(internal)?
        .sub(&decimal(summary, "/balanceSheet/totalEquity")?).map_err(internal)?;
    let global_ok = residual.is_zero() && computed.parity.agrees;
    let source = "Recomputed sealed workbook snapshot; not a live bank or meter feed";
    let ledger = check(if global_ok { "pass" } else { "fail" }, Some(residual.to_canonical()), source,
        "Assets − liabilities − equity, with sealed-extraction parity checked. This is a snapshot identity, not a boundary-flow reconciliation or evidence of solvency.");
    let find = |path: &str, label: &str| -> Result<Dec, AppError> {
        let lines = summary.pointer(path).and_then(Value::as_array)
            .ok_or_else(|| internal(format!("missing {path}")))?;
        let matches: Vec<_> = lines.iter().filter(|line| line["label"] == label).collect();
        if matches.len() != 1 {
            return Err(internal(format!("expected exactly one declared reserve line: {label}")));
        }
        decimal(matches[0], "/value")
    };
    let reserves = find("/balanceSheet/currentAssets", "Stablecoin Reserve Liquidity")?;
    let liability = find("/balanceSheet/liabilities", "Stablecoin Backing Obligations")?;
    let difference = reserves.sub(&liability).map_err(internal)?;
    let reserve = check(if difference.is_negative() { "fail" } else { "pass" },
        Some(difference.to_canonical()), source,
        "Declared stablecoin reserve liquidity minus declared backing obligations (USD). Aggregate snapshot only; no per-token ownership, eligibility or continuous backing is verified.");
    Ok((ledger, reserve))
}

pub async fn get(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let records = decode(sqlx::query(SELECT).fetch_all(&state.db).await?)?;
    let chain = verify_records(&records);
    let (ledger, reserve) = match ledger_checks() {
        Ok(result) => result,
        Err(_) => {
            let unknown = check("unknown", None, "Workbook computation unavailable",
                "The source could not be read or recomputed. No zero balance or passed check is inferred.");
            (unknown.clone(), unknown)
        }
    };
    Ok(Json(json!({
        "asOf": Utc::now().to_rfc3339(),
        "ledger": ledger, "reserve": reserve, "chain": chain, "records": records,
        "boundary": {
            "status": "unknown",
            "message": "The sealed workbook contains no complete external-flow history or GL-9-0001 through GL-9-0008 event stream. Record opening/closing evidence and all flows to evaluate a specified period; a snapshot cannot supply missing movements."
        },
        "local": {
            "status": "unverified",
            "message": "Recorded cells and batches are finite observations, not continuous monitoring of every account, token or instant. A global pass never proves pointwise conservation."
        },
        "notes": [
            "Supplemental audit only: no payment, mint, price change, or modification of the sealed ledger is performed.",
            "Boundary sign convention: inward = inflows − outflows; outward is its negative. Residual = closing − opening − inward flow − declared adjustments.",
            "Energy-bridge assumptions: 1 NMT = 1 kWh, electricity 0.10 and hardware 0.02 USD/NMT. These are declared valuation assumptions, not a verified physical conversion to XRP.",
            "For 200000 NMT and 1 XRP: price 23999.50 yields a 0.50 USD gap; price 0.50 yields a 23999.50 USD gap. No market price is invented.",
            "Ratio outputs use 8 decimal places, round-half-even; monetary products and differences remain exact.",
            "A balanced journal, mod-9 residue, or zero valuation gap does not establish physical losslessness, zero entropy, GAAP compliance or statutory compliance.",
            "Evidence references are operator-supplied. Hash chaining detects alteration against a retained head; it is not an external signature, proof of truth, or protection against a privileged full-chain rewrite.",
            "Write-offs retain their evidence and balanced supplemental journal; no trail is erased and no historical asset is silently removed."
        ]
    })))
}
