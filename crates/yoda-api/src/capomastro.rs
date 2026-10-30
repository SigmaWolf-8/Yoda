//! Capomastro sovereign-ledger surfaces.
//!
//! Three read paths and one parse path, all backed by real artefacts on disk —
//! nothing here synthesises figures:
//!
//! * `GET  /api/capomastro/ledger`        — the Unified GAAP Ledger workbook
//!   cells, extracted losslessly to JSON by `scripts/extract-gaap-ledger.py`,
//!   with every derived figure recomputed live from those cells.
//! * `GET  /api/capomastro/measurements`  — sealed `.fcx` token-measurement
//!   records, parsed from their pipe-delimited line format.
//! * `GET  /api/capomastro/revenue`       — the revenue-analytics shaping of
//!   the ledger (KPIs + segment mix) derived from the workbook's own numbers.
//! * `POST /api/capomastro/pacs008/parse` — ISO 20022 `pacs.008.001.10` XML in,
//!   typed JSON out, via the `capomastro-pacs008` crate.
//!
//! The workbook cells are read once and cached — they are a fixed historical
//! artefact — but nothing derived from them is cached: totals, reserve
//! composition, the gold valuation, the descendant invariants and the
//! cross-balance are recomputed on every request by `capomastro-ledger`, in
//! exact decimal, and checked against the extraction script's sealed summary
//! before they are served. The `.fcx` directory is likewise re-read per request
//! so newly sealed measurements appear without a restart.

use axum::{extract::State, Json};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::OnceLock;

use capomastro_ledger::live;

use crate::error::AppError;
use crate::state::AppState;

/// Exact base-10 decimal arithmetic. Money never touches a float. Lives in
/// `capomastro-ledger` so the arithmetic and its tests can be exercised
/// without standing up the API.
pub use capomastro_ledger::dec;
/// Auditor-formatted exports of the ledger and the live statements.
pub mod collections;
pub mod conservation;
/// Stripe webhook: settlement events pushed into the collections register.
pub mod webhook;
pub mod export;
/// Live reference rates (SOFR, Treasury averages, gold spot).
pub mod rates;
/// Statements computed at request time from the workbook plus live rates.
pub mod statements;
pub mod stripe;

/// Root of the on-disk Capomastro data set. Overridable so a packaged desktop
/// build can point at its own bundle directory.
fn data_root() -> PathBuf {
    std::env::var("CAPOMASTRO_DATA_PATH")
        .unwrap_or_else(|_| "./data/capomastro".to_string())
        .into()
}

// ── GAAP ledger ──────────────────────────────────────────────────────────

static LEDGER: OnceLock<Value> = OnceLock::new();
static VOIDS: OnceLock<Value> = OnceLock::new();

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

/// The void declarations. Absent or malformed is fatal, not empty: a strike
/// that goes missing silently reinstates the instrument it struck.
fn load_voids() -> Result<&'static Value, AppError> {
    if let Some(cached) = VOIDS.get() {
        return Ok(cached);
    }
    let path = data_root().join("void-instruments.json");
    let raw = std::fs::read_to_string(&path).map_err(|e| {
        AppError::Internal(format!(
            "void declarations not readable at {}: {e}. Serving the ledger without them \
             would resurrect every struck instrument.",
            path.display()
        ))
    })?;
    let parsed: Value = serde_json::from_str(&raw).map_err(|e| {
        AppError::Internal(format!("void declarations at {} are not valid JSON: {e}", path.display()))
    })?;
    if !parsed.get("strikes").map(Value::is_array).unwrap_or(false) {
        return Err(AppError::Internal(format!(
            "{} has no `strikes` array; refusing to compute the ledger on a guess",
            path.display()
        )));
    }
    Ok(VOIDS.get_or_init(|| parsed))
}

/// Recompute the summary from the workbook cells. Every request; no cache.
fn live_summary() -> Result<live::Computed, AppError> {
    live::compute(load_ledger()?, load_voids()?)
        .map_err(|e| AppError::Internal(format!("live ledger computation refused: {e}")))
}

/// The workbook with its derived figures replaced by the live computation, for
/// the surfaces that read the summary by JSON pointer (the statements builder
/// and the exports). They must see the same numbers the ledger page does; a
/// statement footed on a stored total while the page shows a recomputed one is
/// two sets of books.
pub(crate) fn ledger_live() -> Result<Value, AppError> {
    let computed = live_summary()?;
    let mut out = load_ledger()?.clone();
    if let Some(obj) = out.as_object_mut() {
        obj.insert("summary".into(), computed.summary);
        obj.insert("computation".into(), live::computation_block(&computed.parity));
    }
    Ok(out)
}

/// `GET /api/capomastro/ledger` — the full workbook, every sheet, with the
/// summary recomputed live from those sheets.
///
/// The extraction script's own summary travels alongside as `sealedSummary`,
/// together with a field-by-field parity verdict. It is a second opinion, not
/// the source: if the two ever disagree, the response says so in the open
/// rather than quietly preferring one.
pub async fn get_ledger(State(_state): State<AppState>) -> Result<Json<Value>, AppError> {
    let computed = live_summary()?;
    let mut out = load_ledger()?.clone();
    let sealed = out.get("summary").cloned().unwrap_or(Value::Null);
    if let Some(obj) = out.as_object_mut() {
        obj.insert("summary".into(), computed.summary);
        obj.insert("sealedSummary".into(), sealed);
        obj.insert("computation".into(), live::computation_block(&computed.parity));
    }
    Ok(Json(out))
}

// ── Revenue analytics ────────────────────────────────────────────────────

/// `GET /api/capomastro/revenue` — the analytics shaping the dashboard renders.
///
/// The workbook states a deliberate zero-revenue accrual ground state
/// (`R = 0 // EBT = 0 // EBITA = 0`), so the "mix" reported here is the
/// reserve-asset composition that backs the estate, not invented sales. Every
/// figure traces to a workbook cell.
///
/// This handler performs **no arithmetic of its own**. Every money figure and
/// every ratio is computed by `capomastro-ledger` in exact decimal from the
/// workbook cells and forwarded as a decimal string. Re-deriving any of them
/// here in `f64` would silently perturb a published figure.
pub async fn get_revenue(State(_state): State<AppState>) -> Result<Json<Value>, AppError> {
    let computed = live_summary()?;
    Ok(Json(live::revenue_view(
        load_ledger()?,
        &computed.summary,
        &computed.parity,
    )))
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
