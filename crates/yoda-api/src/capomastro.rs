//! Capomastro sovereign-ledger surfaces.
//!
//! Three read paths and one parse path, all backed by real artefacts on disk —
//! nothing here synthesises figures:
//!
//! * `GET  /api/capomastro/ledger`        — the Unified GAAP Ledger workbook,
//!   extracted losslessly to JSON by `scripts/extract-gaap-ledger.py`.
//! * `GET  /api/capomastro/measurements`  — sealed `.fcx` token-measurement
//!   records, parsed from their pipe-delimited line format.
//! * `GET  /api/capomastro/revenue`       — the revenue-analytics shaping of
//!   the ledger (KPIs + segment mix) derived from the workbook's own numbers.
//! * `POST /api/capomastro/pacs008/parse` — ISO 20022 `pacs.008.001.10` XML in,
//!   typed JSON out, via the `capomastro-pacs008` crate.
//!
//! The ledger JSON is read once and cached; the `.fcx` directory is re-read per
//! request so newly sealed measurements appear without a restart.

use axum::{extract::State, Json};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::OnceLock;

use crate::error::AppError;
use crate::state::AppState;

/// Root of the on-disk Capomastro data set. Overridable so a packaged desktop
/// build can point at its own bundle directory.
fn data_root() -> PathBuf {
    std::env::var("CAPOMASTRO_DATA_PATH")
        .unwrap_or_else(|_| "./data/capomastro".to_string())
        .into()
}

// ── GAAP ledger ──────────────────────────────────────────────────────────

static LEDGER: OnceLock<Value> = OnceLock::new();

fn load_ledger() -> Result<&'static Value, AppError> {
    if let Some(cached) = LEDGER.get() {
        return Ok(cached);
    }
    let path = data_root().join("gaap-ledger.json");
    let raw = std::fs::read_to_string(&path).map_err(|e| {
        AppError::Internal(format!(
            "GAAP ledger not readable at {}: {e}. Run scripts/extract-gaap-ledger.py.",
            path.display()
        ))
    })?;
    let parsed: Value = serde_json::from_str(&raw)
        .map_err(|e| AppError::Internal(format!("GAAP ledger at {} is not valid JSON: {e}", path.display())))?;
    Ok(LEDGER.get_or_init(|| parsed))
}

/// `GET /api/capomastro/ledger` — the full workbook, every sheet, plus the
/// recomputed summary block.
pub async fn get_ledger(State(_state): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(load_ledger()?.clone()))
}

// ── Revenue analytics ────────────────────────────────────────────────────

/// `GET /api/capomastro/revenue` — the analytics shaping the dashboard renders.
///
/// The workbook states a deliberate zero-revenue accrual ground state
/// (`R = 0 // EBT = 0 // EBITA = 0`), so the "mix" reported here is the
/// reserve-asset composition that backs the estate, not invented sales. Every
/// figure traces to a workbook cell.
///
/// This handler performs **no arithmetic**. Money and ratios are computed once,
/// in exact decimal, by `scripts/extract-gaap-ledger.py`, and are carried
/// through as decimal strings. Re-deriving them here in `f64` would silently
/// perturb published figures, so values are only ever selected and forwarded.
pub async fn get_revenue(State(_state): State<AppState>) -> Result<Json<Value>, AppError> {
    let ledger = load_ledger()?;
    let summary = ledger
        .get("summary")
        .ok_or_else(|| AppError::Internal("ledger JSON has no summary block".into()))?;
    let bs = summary
        .get("balanceSheet")
        .ok_or_else(|| AppError::Internal("ledger summary has no balanceSheet".into()))?;

    let segments = summary
        .get("segmentMix")
        .cloned()
        .unwrap_or_else(|| Value::Array(Vec::new()));

    Ok(Json(json!({
        "entity": ledger.get("entity").cloned().unwrap_or(Value::Null),
        "version": ledger.get("version").cloned().unwrap_or(Value::Null),
        "accrualGroundState": {
            "grossRevenue": summary.pointer("/incomeStatement/grossRevenue").cloned().unwrap_or(json!(0)),
            "costOfGoodsSold": summary.pointer("/incomeStatement/costOfGoodsSold").cloned().unwrap_or(json!(0)),
            "note": "ASC 606 / IFRS 15 / CAS 14: No Performance Obligations Satisfied",
        },
        "kpis": {
            "totalAssets": bs.get("totalAssets").cloned().unwrap_or(json!(0)),
            "totalLiabilities": bs.get("totalLiabilities").cloned().unwrap_or(json!(0)),
            "totalEquity": bs.get("totalEquity").cloned().unwrap_or(json!(0)),
            "balanced": bs.get("balanced").cloned().unwrap_or(json!(false)),
            "goldFairMarketValue": summary.pointer("/goldAssay/fairMarketValueUsd").cloned().unwrap_or(json!(0)),
            "goldCarryingValue": summary.pointer("/goldAssay/carryingValueUsd").cloned().unwrap_or(json!(0)),
            "unrecordedReserveBuffer": summary.pointer("/goldAssay/unrecordedReserveBufferUsd").cloned().unwrap_or(json!(0)),
            "xCross": summary.pointer("/crossBalance/xCross").cloned().unwrap_or(json!(0)),
        },
        "segmentMix": segments,
        "crossBalance": summary.get("crossBalance").cloned().unwrap_or(Value::Null),
        "goldAssay": summary.get("goldAssay").cloned().unwrap_or(Value::Null),
        "descendantRegister": summary.get("descendantRegister").cloned().unwrap_or(Value::Null),
    })))
}

// ── Sealed .fcx measurements ─────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeasurementField {
    pub key: String,
    pub value: String,
    pub unit: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SealedMeasurement {
    pub file: String,
    pub record: String,
    pub version: String,
    pub schema: String,
    pub fields: Vec<MeasurementField>,
    /// PIF-127 integrity digest carried in the record's closing line.
    pub pif127: Option<String>,
}

/// Parse one sealed `.fcx` record.
///
/// Format: the body is wrapped in `⟦ … ⟧`, the first line is
/// `RECORD ┃ VERSION ┃ SCHEMA`, every later line is `key ┃ value ┃ unit`, and
/// the digest line is `┃ PIF-127 ┃ <hex>`.
fn parse_fcx(file: &str, body: &str) -> Option<SealedMeasurement> {
    let body = body.trim().trim_start_matches('⟦').trim_end_matches('⟧');
    let mut lines = body.lines().map(str::trim).filter(|l| !l.is_empty());

    let header: Vec<String> = lines
        .next()?
        .split('┃')
        .map(|p| p.trim().to_string())
        .collect();

    let mut fields = Vec::new();
    let mut pif127 = None;

    for line in lines {
        let parts: Vec<&str> = line.split('┃').map(str::trim).collect();
        if parts.len() >= 3 && parts[0].is_empty() && parts[1] == "PIF-127" {
            pif127 = Some(parts[2].to_string());
            continue;
        }
        if parts.len() < 2 || parts[0].is_empty() {
            continue;
        }
        fields.push(MeasurementField {
            key: parts[0].to_string(),
            value: parts[1].to_string(),
            unit: parts.get(2).copied().unwrap_or("").to_string(),
        });
    }

    Some(SealedMeasurement {
        file: file.to_string(),
        record: header.first().cloned().unwrap_or_default(),
        version: header.get(1).cloned().unwrap_or_default(),
        schema: header.get(2).cloned().unwrap_or_default(),
        fields,
        pif127,
    })
}

/// Largest sealed record we will read. A `.fcx` is a short pipe-delimited
/// text record; anything past this is not one, and reading it would let a
/// stray file in the data directory balloon a public response.
const MAX_FCX_BYTES: u64 = 256 * 1024;

/// Most files we will read in one response.
const MAX_FCX_FILES: usize = 256;

/// Most records we will return in one response. A single file may hold many
/// concatenated `⟦…⟧` records, so capping bytes and files is not enough on its
/// own to bound the size of this public response.
const MAX_FCX_RECORDS: usize = 512;

/// `GET /api/capomastro/measurements` — every sealed `.fcx` record on disk.
///
/// The scan is synchronous file I/O, so it runs on the blocking pool rather
/// than on a Tokio worker: this route is public, and blocking a worker per
/// request is how a directory scan turns into a denial of service.
pub async fn get_measurements(State(_state): State<AppState>) -> Result<Json<Value>, AppError> {
    let measurements = tokio::task::spawn_blocking(read_measurements)
        .await
        .map_err(|e| AppError::Internal(format!("measurement scan failed to run: {e}")))??;

    Ok(Json(json!({
        "count": measurements.len(),
        "measurements": measurements,
    })))
}

fn read_measurements() -> Result<Vec<SealedMeasurement>, AppError> {
    let dir = data_root().join("measurements");
    let entries = std::fs::read_dir(&dir).map_err(|e| {
        AppError::Internal(format!("sealed measurements unreadable at {}: {e}", dir.display()))
    })?;

    let mut paths: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().and_then(|x| x.to_str()) == Some("fcx"))
        .collect();
    paths.sort();
    paths.truncate(MAX_FCX_FILES);

    let mut measurements = Vec::new();
    for path in paths {
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unnamed")
            .to_string();

        match std::fs::metadata(&path) {
            Ok(meta) if meta.len() > MAX_FCX_BYTES => {
                tracing::warn!(
                    file = %name,
                    bytes = meta.len(),
                    limit = MAX_FCX_BYTES,
                    "skipping oversized .fcx record"
                );
                continue;
            }
            Ok(_) => {}
            Err(e) => {
                tracing::warn!(file = %name, error = %e, "skipping unstattable .fcx record");
                continue;
            }
        }

        let raw = match std::fs::read_to_string(&path) {
            Ok(raw) => raw,
            Err(e) => {
                tracing::warn!(file = %name, error = %e, "skipping unreadable .fcx record");
                continue;
            }
        };
        // A single file may hold several concatenated ⟦…⟧ records.
        for chunk in raw.split('⟧') {
            if measurements.len() >= MAX_FCX_RECORDS {
                tracing::warn!(
                    limit = MAX_FCX_RECORDS,
                    "sealed measurement response truncated at the record cap"
                );
                return Ok(measurements);
            }
            if !chunk.contains('⟦') {
                continue;
            }
            if let Some(parsed) = parse_fcx(&name, chunk) {
                measurements.push(parsed);
            }
        }
    }

    Ok(measurements)
}

// ── ISO 20022 pacs.008 ───────────────────────────────────────────────────

/// Largest `pacs.008` document the public parse endpoint will accept.
///
/// Real messages are a few kilobytes; the endpoint buffers the whole body and
/// then parses it, so this cap is what keeps an anonymous caller from turning
/// one request into unbounded memory and CPU. Enforced as a `DefaultBodyLimit`
/// on the route in `routes.rs`, which rejects anything larger with 413.
pub const MAX_PACS008_BYTES: usize = 512 * 1024;

/// `POST /api/capomastro/pacs008/parse` — body is raw `pacs.008.001.10` XML.
///
/// Returns the streamed `EndToEndId` alongside the fully deserialised document
/// so a caller can compare the fast path against the strict parse.
pub async fn parse_pacs008(
    State(_state): State<AppState>,
    body: String,
) -> Result<Json<Value>, AppError> {
    if body.trim().is_empty() {
        return Err(AppError::Validation(
            "request body must contain a pacs.008.001.10 XML document".into(),
        ));
    }

    let streamed = capomastro_pacs008::extract_end_to_end_id(body.as_bytes());
    let document = capomastro_pacs008::parse_pacs008(&body)
        .map_err(|e| AppError::Validation(format!("not a valid pacs.008.001.10 document: {e}")))?;

    Ok(Json(json!({
        "streamedEndToEndId": streamed,
        "document": document,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_sealed_record() {
        let raw = "⟦ SEC-TOKEN-MEASUREMENT-0001 ┃ V1.2.2.10.1 ┃ FLYWHEEL-GAAP\n\
                   walked_W ┃ 26138322 ┃ [1]\n\
                   gaap_balanced ┃ true ┃ [1]\n\
                   ┃ PIF-127 ┃ 3a19915fea1c4167bb679d6ede631802\n⟧";
        let parsed = parse_fcx("sample.fcx", raw).expect("record must parse");

        assert_eq!(parsed.record, "SEC-TOKEN-MEASUREMENT-0001");
        assert_eq!(parsed.version, "V1.2.2.10.1");
        assert_eq!(parsed.schema, "FLYWHEEL-GAAP");
        assert_eq!(parsed.fields.len(), 2);
        assert_eq!(parsed.fields[0].key, "walked_W");
        assert_eq!(parsed.fields[0].value, "26138322");
        assert_eq!(parsed.fields[0].unit, "[1]");
        assert_eq!(parsed.pif127.as_deref(), Some("3a19915fea1c4167bb679d6ede631802"));
    }

    #[test]
    fn digest_line_is_not_mistaken_for_a_field() {
        let raw = "⟦ R ┃ V ┃ S\n┃ PIF-127 ┃ deadbeef\n⟧";
        let parsed = parse_fcx("x.fcx", raw).unwrap();
        assert!(parsed.fields.is_empty());
        assert_eq!(parsed.pif127.as_deref(), Some("deadbeef"));
    }
}
