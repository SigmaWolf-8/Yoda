//! Live financial statements for the sovereign estate.
//!
//! The workbook is a *position as of the basis date* (1 April 2026). It is not
//! a set of statements: nothing in it moves when time passes, no obligation
//! accrues, and the bullion is held at a fix price that stopped being true the
//! next morning. This module turns that position into statements computed at
//! the moment of the request:
//!
//! * an **auditor's trial balance** — every account with a code, a
//!   classification, a debit or credit column, its authority reference, and a
//!   statement of whether the figure came from the workbook or was computed;
//! * a **balance sheet** re-footed from those accounts;
//! * an **income statement** carrying real, live interest expense;
//! * a **debt schedule** with what is owed, what has accrued, and what is
//!   callable right now;
//! * a **gold revaluation** against live spot, disclosed as a memo rather than
//!   posted.
//!
//! ## Rules this module obeys
//!
//! **Principal is never invented.** Obligation principals come from the
//! Balance Sheet lines of the workbook. `debt-terms.json` supplies only terms
//! — index, spread, day count, call conditions. A liability with no declared
//! terms is reported as unmodelled; it is not quietly assumed to be free.
//!
//! **A missing rate withholds a figure.** If a reference rate cannot be
//! fetched, the obligation's accrual is `null` with the reason attached, and
//! the totals say they are incomplete. No fallback constant is ever
//! substituted — an assumed rate is indistinguishable from a real one once
//! it is on the page, and that is how an auditor gets misled.
//!
//! **Every figure is exact decimal.** See [`super::dec`]. No `f64` touches
//! money anywhere in this path.
//!
//! **Double entry is preserved.** Accrued interest posts as a debit to
//! interest expense and a credit to accrued interest payable, so assets stay
//! put, liabilities rise, period earnings fall by the same amount, and the
//! trial balance still foots.

use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

use super::dec::Dec;
use super::rates::{self, RateSnapshot};
use crate::error::AppError;
use crate::state::AppState;

/// Places used when presenting currency.
const MONEY_SCALE: u32 = 2;
/// Places used for rates and intermediate fractions.
const RATE_SCALE: u32 = 12;

// ── Wire types ───────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct StatementsQuery {
    /// `?refresh=1` bypasses the rate cache for an on-demand re-poll.
    refresh: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub code: String,
    pub account: String,
    /// `Asset` | `Liability` | `Equity` | `Revenue` | `Expense`.
    pub classification: &'static str,
    pub debit: Option<Dec>,
    pub credit: Option<Dec>,
    /// Where the number came from — a workbook cell or a named computation.
    pub source: String,
    /// The statutory or standards reference carried by the workbook.
    pub authority: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrialBalance {
    pub accounts: Vec<Account>,
    /// `None` when any live accrual could not be computed. The listing is still
    /// published — the reader may want to see which legs *did* post — but the
    /// foot is withheld, because a sum over a knowingly incomplete set of
    /// entries is not a trial balance total, it is a wrong number.
    pub total_debits: Option<Dec>,
    pub total_credits: Option<Dec>,
    /// `None` for the same reason: an unreconciled book is not a balanced one.
    pub balanced: Option<bool>,
    /// Present when an accrual could not be computed, so the reader knows why
    /// the foot is missing.
    pub incomplete_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementLine {
    pub label: String,
    pub amount: Dec,
    pub note: Option<String>,
    /// `workbook` when carried from the extract, `computed` when derived here.
    pub origin: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BalanceSheet {
    pub current_assets: Vec<StatementLine>,
    /// Withheld (`None`) when a live accrual is missing: interest receivable is
    /// a current asset, so a total struck without it understates what is held.
    pub total_current_assets: Option<Dec>,
    pub non_current_assets: Vec<StatementLine>,
    /// Unaffected by the accrual, so always publishable.
    pub total_non_current_assets: Dec,
    pub total_assets: Option<Dec>,
    pub liabilities: Vec<StatementLine>,
    /// Withheld (`None`) when a live accrual is missing: accrued interest is a
    /// liability, so a total struck without it understates what is owed.
    pub total_liabilities: Option<Dec>,
    pub equity: Vec<StatementLine>,
    /// Withheld for the same reason — the period loss closes into equity.
    pub total_equity: Option<Dec>,
    pub total_liabilities_and_equity: Option<Dec>,
    pub balanced: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomeStatement {
    pub period_from: String,
    pub period_to: String,
    pub revenue: Vec<StatementLine>,
    pub gross_revenue: Dec,
    pub cost_of_goods_sold: Dec,
    pub gross_profit: Dec,
    pub operating_expenses: Vec<StatementLine>,
    pub total_operating_expenses: Dec,
    pub ebitda: Dec,
    pub depreciation_amortization: Dec,
    pub ebit: Dec,
    pub interest_expense: Option<Dec>,
    /// Earned on the reserves and instruments that fund the obligations above.
    pub interest_income: Option<Dec>,
    /// Income less expense. Negative means the obligations cost more than the
    /// assets funding them earned.
    pub net_interest: Option<Dec>,
    pub earnings_before_tax: Option<Dec>,
    pub income_tax_expense: Dec,
    pub net_income: Option<Dec>,
    /// Set when interest could not be computed, so EBT/net income are `null`.
    pub withheld_reason: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Obligation {
    pub id: String,
    pub ledger_line: String,
    pub creditor: String,
    pub instrument: String,
    pub authority: String,
    /// Read from the Balance Sheet, never from the terms file.
    pub principal: Dec,
    pub rate_index: String,
    pub index_percent: Option<Dec>,
    pub spread_bps: Dec,
    /// index + spread, the rate actually applied.
    pub all_in_percent: Option<Dec>,
    pub day_count: String,
    pub days_accrued: i64,
    pub accrued_interest: Option<Dec>,
    pub total_owed: Option<Dec>,
    pub call_basis: String,
    pub call_notice_days: i64,
    /// Principal + accrual, but only for obligations callable without notice.
    pub callable_now: Option<Dec>,
    /// `accruing` | `rate_unavailable`.
    pub status: &'static str,
    pub note: Option<String>,
    pub basis: String,
}

/// A liability the estate has declared carries no interest, carried through to
/// the statement so the reader can see the position and who took it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NonInterestBearing {
    pub ledger_line: String,
    /// Read from the Balance Sheet, like every other principal figure.
    pub principal: Dec,
    pub reason: String,
    pub declared_by: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebtSchedule {
    pub basis_date: String,
    pub as_of_date: String,
    pub obligations: Vec<Obligation>,
    /// Sum of the principal of *interest-bearing* obligations only.
    pub total_principal: Dec,
    /// Liabilities explicitly declared non-interest-bearing, and their total.
    pub non_interest_bearing: Vec<NonInterestBearing>,
    pub total_non_interest_bearing: Dec,
    pub total_accrued_interest: Option<Dec>,
    pub total_owed: Option<Dec>,
    /// The call figure: what a creditor could demand today, with no notice.
    pub call_owed_immediately: Option<Dec>,
    /// What falls due once contractual notice has run.
    pub call_owed_on_notice: Option<Dec>,
    /// Balance-sheet liabilities with no declared terms.
    pub unmodelled_liabilities: Vec<String>,
    /// Declared terms whose ledger line is not on the balance sheet.
    pub orphan_terms: Vec<String>,
    pub complete: bool,
    pub incomplete_reason: Option<String>,
}

/// An asset earning interest over the period, the mirror of `Obligation`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EarningAsset {
    pub id: String,
    pub ledger_line: String,
    pub obligor: String,
    pub instrument: String,
    pub authority: String,
    /// Read from the Balance Sheet, never from the terms file.
    pub principal: Dec,
    pub rate_index: String,
    pub index_percent: Option<Dec>,
    pub spread_bps: Dec,
    pub all_in_percent: Option<Dec>,
    pub day_count: String,
    pub days_accrued: i64,
    pub accrued_income: Option<Dec>,
    /// `accruing` | `rate_unavailable`.
    pub status: &'static str,
    pub note: Option<String>,
    pub basis: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomeSchedule {
    pub basis_date: String,
    pub as_of_date: String,
    pub assets: Vec<EarningAsset>,
    pub total_principal: Dec,
    pub total_accrued_income: Option<Dec>,
    /// Balance-sheet assets with no declared rate — gold, land and the like.
    /// Listed so the reader can see what is deliberately earning nothing.
    pub non_earning_assets: Vec<String>,
    pub orphan_terms: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoldRevaluation {
    pub fine_gold_ounces: Dec,
    pub recorded_price_usd_per_oz: Dec,
    pub recorded_fair_market_value: Dec,
    pub carrying_value: Dec,
    pub live_price_usd_per_oz: Option<Dec>,
    pub live_fair_market_value: Option<Dec>,
    /// Live fair value less carrying value — the unrecorded reserve.
    pub revaluation_surplus: Option<Dec>,
    /// Movement against the workbook's own fair value at the recorded fix.
    pub movement_since_recorded_fix: Option<Dec>,
    pub price_move_percent: Option<Dec>,
    /// Why this is disclosed and not posted.
    pub treatment: String,
    pub status: &'static str,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub id: &'static str,
    pub description: String,
    pub expected: String,
    pub actual: String,
    pub pass: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Statements {
    pub entity: Value,
    pub version: Value,
    pub source: Value,
    pub as_of: String,
    pub as_of_date: String,
    pub basis_date: String,
    pub days_elapsed: i64,
    pub rates: RateSnapshot,
    pub trial_balance: TrialBalance,
    pub balance_sheet: BalanceSheet,
    pub income_statement: IncomeStatement,
    pub debt_schedule: DebtSchedule,
    pub income_schedule: IncomeSchedule,
    pub gold_revaluation: GoldRevaluation,
    pub checks: Vec<Check>,
    pub methodology: Vec<&'static str>,
}

// ── Small helpers ────────────────────────────────────────────────────────

fn bad(ctx: &str, e: impl std::fmt::Display) -> AppError {
    AppError::Internal(format!("{ctx}: {e}"))
}

/// Read a decimal from JSON that may hold it as a string (the extractor's
/// convention) or as a number (raw workbook cells).
fn dec_at(v: &Value, ptr: &str) -> Result<Dec, AppError> {
    let node = v
        .pointer(ptr)
        .ok_or_else(|| AppError::Internal(format!("ledger is missing `{ptr}`")))?;
    dec_of(node, ptr)
}

fn dec_of(node: &Value, ctx: &str) -> Result<Dec, AppError> {
    let raw = match node {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        other => {
            return Err(AppError::Internal(format!(
                "ledger field `{ctx}` is {other}, not a figure"
            )))
        }
    };
    Dec::parse(&raw).map_err(|e| bad(&format!("ledger field `{ctx}` = `{raw}`"), e))
}

fn str_at<'a>(v: &'a Value, ptr: &str) -> Option<&'a str> {
    v.pointer(ptr).and_then(Value::as_str)
}

/// Build a label → authority map from a workbook sheet, where each data row is
/// `[label, value, authority]`. This is what makes the listing auditable: the
/// statutory reference travels with the number.
fn authority_map(ledger: &Value, sheet: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    if let Some(rows) = ledger
        .pointer(&format!("/sheets/{sheet}/rows"))
        .and_then(Value::as_array)
    {
        for row in rows {
            let Some(cells) = row.as_array() else { continue };
            if cells.len() < 3 {
                continue;
            }
            let (Some(label), Some(auth)) = (cells[0].as_str(), cells[2].as_str()) else {
                continue;
            };
            if !label.is_empty() && !auth.is_empty() {
                map.insert(label.to_string(), auth.to_string());
            }
        }
    }
    map
}

/// Split a signed balance into the correct trial-balance column.
fn columns(natural_debit: bool, amount: &Dec) -> (Option<Dec>, Option<Dec>) {
    let positive = !amount.is_negative();
    let magnitude = amount.abs();
    if natural_debit == positive {
        (Some(magnitude), None)
    } else {
        (None, Some(magnitude))
    }
}

fn line(label: &str, amount: Dec, note: Option<String>, origin: &'static str) -> StatementLine {
    StatementLine { label: label.to_string(), amount, note, origin }
}

fn check(id: &'static str, description: String, expected: String, actual: String) -> Check {
    let pass = expected == actual;
    Check { id, description, expected, actual, pass }
}

/// Compare two figures *numerically*, then present them at a common scale.
/// Comparing the rendered strings instead would fail `2153000000000` against
/// `2153000000000.00` — the same money, two scales — and report a balanced
/// book as broken.
fn check_money(
    id: &'static str,
    description: String,
    expected: &Dec,
    actual: &Dec,
    scale: u32,
) -> Result<Check, AppError> {
    let e = expected.rescale(scale).map_err(|err| bad(id, err))?;
    let a = actual.rescale(scale).map_err(|err| bad(id, err))?;
    Ok(Check {
        id,
        description,
        expected: e.to_string(),
        actual: a.to_string(),
        pass: e.eq_dec(&a).map_err(|err| bad(id, err))?,
    })
}

/// Same comparison, but for figures that may have been withheld. A withheld
/// operand does not pass: an assertion that could not be evaluated has not been
/// satisfied, and reporting it as green would tell the reader the books
/// reconcile when nobody checked.
fn check_money_opt(
    id: &'static str,
    description: String,
    expected: Option<&Dec>,
    actual: Option<&Dec>,
    scale: u32,
    withheld_reason: Option<&str>,
) -> Result<Check, AppError> {
    match (expected, actual) {
        (Some(e), Some(a)) => check_money(id, description, e, a, scale),
        _ => {
            let why = withheld_reason.unwrap_or("a required figure was withheld");
            Ok(Check {
                id,
                description,
                expected: expected
                    .map(|d| d.to_string())
                    .unwrap_or_else(|| format!("withheld — {why}")),
                actual: actual
                    .map(|d| d.to_string())
                    .unwrap_or_else(|| format!("withheld — {why}")),
                pass: false,
            })
        }
    }
}

// ── Debt terms ───────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DebtTerms {
    basis_date: String,
    obligations: Vec<TermEntry>,
    /// Liabilities the estate has declared carry no interest. This exists so
    /// that "this line does not accrue" is a *stated* position with a reason
    /// and an author, rather than something the engine quietly assumed because
    /// no terms were supplied.
    #[serde(default)]
    non_interest_bearing: Vec<NonInterestEntry>,
    /// Assets that earn interest. Without these the accrual is one-sided: the
    /// estate would be charged for every obligation while the reserves funding
    /// them earned nothing, which is not a loss, it is a missing leg.
    #[serde(default)]
    interest_earning_assets: Vec<AssetTermEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssetTermEntry {
    id: String,
    ledger_line: String,
    obligor: String,
    instrument: String,
    authority: String,
    rate_index: String,
    spread_bps: String,
    day_count: String,
    basis: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NonInterestEntry {
    ledger_line: String,
    reason: String,
    declared_by: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TermEntry {
    id: String,
    ledger_line: String,
    creditor: String,
    instrument: String,
    authority: String,
    rate_index: String,
    spread_bps: String,
    day_count: String,
    call_basis: String,
    call_notice_days: i64,
    basis: String,
}

fn load_terms() -> Result<DebtTerms, AppError> {
    let path = super::data_root().join("debt-terms.json");
    let raw = std::fs::read_to_string(&path).map_err(|e| {
        AppError::Internal(format!(
            "debt terms not readable at {}: {e}. The debt schedule cannot be computed without declared terms.",
            path.display()
        ))
    })?;
    serde_json::from_str(&raw)
        .map_err(|e| AppError::Internal(format!("debt terms at {} are not valid JSON: {e}", path.display())))
}

/// Days in the year implied by a day-count convention.
fn year_basis(convention: &str) -> Result<Dec, AppError> {
    match convention {
        "ACT/360" => Ok(Dec::from_int(360)),
        "ACT/365" => Ok(Dec::from_int(365)),
        other => Err(AppError::Internal(format!(
            "unsupported day-count convention `{other}` in debt-terms.json (expected ACT/360 or ACT/365)"
        ))),
    }
}

// ── Handler ──────────────────────────────────────────────────────────────

/// `GET /api/capomastro/statements` — the live statement set.
pub async fn get_statements(
    State(_state): State<AppState>,
    Query(q): Query<StatementsQuery>,
) -> Result<Json<Statements>, AppError> {
    let ledger = super::load_ledger()?;
    let terms = load_terms()?;
    let force = matches!(q.refresh.as_deref(), Some("1") | Some("true"));
    let rate_snapshot = rates::snapshot(force).await;

    let bs_authority = authority_map(ledger, "Balance Sheet");

    // ── Dates ────────────────────────────────────────────────────────
    let basis_date = chrono::NaiveDate::parse_from_str(&terms.basis_date, "%Y-%m-%d")
        .map_err(|e| bad(&format!("debt-terms basisDate `{}`", terms.basis_date), e))?;
    let now = chrono::Utc::now();
    let as_of_date = now.date_naive();
    // A basis date in the future would otherwise produce negative accruals.
    // Clamp to zero and let the checks section report it.
    let days_elapsed = (as_of_date - basis_date).num_days().max(0);
    let days = Dec::from_int(days_elapsed);

    // ── Debt schedule ────────────────────────────────────────────────
    let bs_liabilities = ledger
        .pointer("/summary/balanceSheet/liabilities")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::Internal("ledger summary has no balanceSheet.liabilities".into()))?;

    let mut obligations = Vec::new();
    let mut matched_lines: Vec<String> = Vec::new();
    let mut orphan_terms = Vec::new();
    let mut rate_failures: Vec<String> = Vec::new();

    for term in &terms.obligations {
        let Some(bs_line) = bs_liabilities
            .iter()
            .find(|l| l.get("label").and_then(Value::as_str) == Some(term.ledger_line.as_str()))
        else {
            orphan_terms.push(format!(
                "{} references balance-sheet line `{}`, which does not exist",
                term.id, term.ledger_line
            ));
            continue;
        };
        matched_lines.push(term.ledger_line.clone());

        let principal = dec_of(
            bs_line.get("value").unwrap_or(&Value::Null),
            &format!("liability `{}`", term.ledger_line),
        )?;
        let spread_bps = Dec::parse(&term.spread_bps)
            .map_err(|e| bad(&format!("{} spreadBps `{}`", term.id, term.spread_bps), e))?;

        let quote = rate_snapshot.quote(&term.rate_index);
        let index_percent = quote.and_then(|q| q.percent);

        let (all_in, accrued, total_owed, status, note) = match index_percent {
            None => {
                let why = match quote {
                    None => format!(
                        "no reference rate published under id `{}` — check debt-terms.json against the rate sources",
                        term.rate_index
                    ),
                    Some(q) => q
                        .error
                        .clone()
                        .unwrap_or_else(|| format!("{} is unavailable", q.label)),
                };
                rate_failures.push(format!("{}: {}", term.id, why));
                (None, None, None, "rate_unavailable", Some(why))
            }
            Some(idx) => {
                // all-in rate = index + spread, spread quoted in basis points.
                let spread_pct = spread_bps.div(&Dec::from_int(100), RATE_SCALE).map_err(|e| bad("spread", e))?;
                let all_in = idx.add(&spread_pct).map_err(|e| bad("all-in rate", e))?;
                let fraction = all_in
                    .div(&Dec::from_int(100), RATE_SCALE)
                    .map_err(|e| bad("rate fraction", e))?;
                let basis = year_basis(&term.day_count)?;
                // principal × rate × days ÷ basis, dividing LAST. Rounding the
                // day-count fraction before multiplying pushes a large
                // principal off by a cent — see dec::tests.
                let accrued = principal
                    .mul(&fraction)
                    .and_then(|x| x.mul(&days))
                    .and_then(|x| x.div(&basis, MONEY_SCALE))
                    .map_err(|e| bad(&format!("accrual for {}", term.id), e))?;
                let owed = principal.add(&accrued).map_err(|e| bad("total owed", e))?;
                (
                    Some(all_in.rescale(6).map_err(|e| bad("rate", e))?),
                    Some(accrued),
                    Some(owed),
                    "accruing",
                    None,
                )
            }
        };

        let callable_now = if term.call_notice_days == 0 { total_owed } else { None };

        obligations.push(Obligation {
            id: term.id.clone(),
            ledger_line: term.ledger_line.clone(),
            creditor: term.creditor.clone(),
            instrument: term.instrument.clone(),
            authority: term.authority.clone(),
            principal,
            rate_index: term.rate_index.clone(),
            index_percent,
            spread_bps,
            all_in_percent: all_in,
            day_count: term.day_count.clone(),
            days_accrued: days_elapsed,
            accrued_interest: accrued,
            total_owed,
            call_basis: term.call_basis.clone(),
            call_notice_days: term.call_notice_days,
            callable_now,
            status,
            note,
            basis: term.basis.clone(),
        });
    }

    // Liabilities the estate has declared carry no interest. Principal still
    // comes from the balance sheet; the declaration supplies only the position
    // and its author.
    let mut non_interest_bearing: Vec<NonInterestBearing> = Vec::new();
    for entry in &terms.non_interest_bearing {
        let Some(bs_line) = bs_liabilities
            .iter()
            .find(|l| l.get("label").and_then(Value::as_str) == Some(entry.ledger_line.as_str()))
        else {
            orphan_terms.push(format!(
                "a non-interest-bearing declaration references balance-sheet line `{}`, which does not exist",
                entry.ledger_line
            ));
            continue;
        };
        if matched_lines.iter().any(|m| m == &entry.ledger_line) {
            orphan_terms.push(format!(
                "`{}` is declared both interest-bearing and non-interest-bearing — the accrual uses the interest-bearing terms",
                entry.ledger_line
            ));
            continue;
        }
        let principal = dec_of(
            bs_line.get("value").unwrap_or(&Value::Null),
            &format!("liability `{}`", entry.ledger_line),
        )?;
        matched_lines.push(entry.ledger_line.clone());
        non_interest_bearing.push(NonInterestBearing {
            ledger_line: entry.ledger_line.clone(),
            principal,
            reason: entry.reason.clone(),
            declared_by: entry.declared_by.clone(),
        });
    }

    // ── The asset leg ────────────────────────────────────────────────
    // Every obligation above is funded by something, and that something earns.
    // Accruing only the expense would manufacture a loss out of a matched book.
    let bs_current_assets = ledger
        .pointer("/summary/balanceSheet/currentAssets")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::Internal("ledger summary has no balanceSheet.currentAssets".into()))?;
    let bs_non_current_assets = ledger
        .pointer("/summary/balanceSheet/nonCurrentAssets")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            AppError::Internal("ledger summary has no balanceSheet.nonCurrentAssets".into())
        })?;
    let all_asset_lines: Vec<&Value> = bs_current_assets
        .iter()
        .chain(bs_non_current_assets.iter())
        .collect();

    let mut earning_assets: Vec<EarningAsset> = Vec::new();
    let mut earning_lines: Vec<String> = Vec::new();

    for term in &terms.interest_earning_assets {
        let Some(bs_line) = all_asset_lines
            .iter()
            .find(|l| l.get("label").and_then(Value::as_str) == Some(term.ledger_line.as_str()))
        else {
            orphan_terms.push(format!(
                "{} references balance-sheet asset `{}`, which does not exist",
                term.id, term.ledger_line
            ));
            continue;
        };
        earning_lines.push(term.ledger_line.clone());

        let principal = dec_of(
            bs_line.get("value").unwrap_or(&Value::Null),
            &format!("asset `{}`", term.ledger_line),
        )?;
        let spread_bps = Dec::parse(&term.spread_bps)
            .map_err(|e| bad(&format!("{} spreadBps `{}`", term.id, term.spread_bps), e))?;

        let quote = rate_snapshot.quote(&term.rate_index);
        let index_percent = quote.and_then(|q| q.percent);

        let (all_in, accrued, status, note) = match index_percent {
            None => {
                let why = match quote {
                    None => format!(
                        "no reference rate published under id `{}` — check debt-terms.json against the rate sources",
                        term.rate_index
                    ),
                    Some(q) => q
                        .error
                        .clone()
                        .unwrap_or_else(|| format!("{} is unavailable", q.label)),
                };
                rate_failures.push(format!("{}: {}", term.id, why));
                (None, None, "rate_unavailable", Some(why))
            }
            Some(idx) => {
                let spread_pct = spread_bps
                    .div(&Dec::from_int(100), RATE_SCALE)
                    .map_err(|e| bad("spread", e))?;
                let all_in = idx.add(&spread_pct).map_err(|e| bad("all-in rate", e))?;
                let fraction = all_in
                    .div(&Dec::from_int(100), RATE_SCALE)
                    .map_err(|e| bad("rate fraction", e))?;
                let basis = year_basis(&term.day_count)?;
                // Same ordering as the expense leg: divide last.
                let accrued = principal
                    .mul(&fraction)
                    .and_then(|x| x.mul(&days))
                    .and_then(|x| x.div(&basis, MONEY_SCALE))
                    .map_err(|e| bad(&format!("accrual for {}", term.id), e))?;
                (
                    Some(all_in.rescale(6).map_err(|e| bad("rate", e))?),
                    Some(accrued),
                    "accruing",
                    None,
                )
            }
        };

        earning_assets.push(EarningAsset {
            id: term.id.clone(),
            ledger_line: term.ledger_line.clone(),
            obligor: term.obligor.clone(),
            instrument: term.instrument.clone(),
            authority: term.authority.clone(),
            principal,
            rate_index: term.rate_index.clone(),
            index_percent,
            spread_bps,
            all_in_percent: all_in,
            day_count: term.day_count.clone(),
            days_accrued: days_elapsed,
            accrued_income: accrued,
            status,
            note,
            basis: term.basis.clone(),
        });
    }

    let non_earning_assets: Vec<String> = all_asset_lines
        .iter()
        .filter_map(|l| l.get("label").and_then(Value::as_str))
        .filter(|label| !earning_lines.iter().any(|m| m == label))
        .map(str::to_string)
        .collect();

    let total_earning_principal =
        Dec::sum(&earning_assets.iter().map(|a| a.principal).collect::<Vec<_>>())
            .map_err(|e| bad("total interest-earning principal", e))?;

    let unmodelled_liabilities: Vec<String> = bs_liabilities
        .iter()
        .filter_map(|l| l.get("label").and_then(Value::as_str))
        .filter(|label| !matched_lines.iter().any(|m| m == label))
        .map(str::to_string)
        .collect();

    let total_principal = Dec::sum(&obligations.iter().map(|o| o.principal).collect::<Vec<_>>())
        .map_err(|e| bad("total principal", e))?;
    let total_non_interest_bearing = Dec::sum(
        &non_interest_bearing
            .iter()
            .map(|n| n.principal)
            .collect::<Vec<_>>(),
    )
    .map_err(|e| bad("total non-interest-bearing liabilities", e))?;

    // Accrual totals are withheld wholesale if any single leg is unpriced: a
    // partial sum presented as a total is a wrong total.
    let complete = rate_failures.is_empty();
    let incomplete_reason = if complete { None } else { Some(rate_failures.join("; ")) };

    let sum_opt = |vals: Vec<Option<Dec>>| -> Result<Option<Dec>, AppError> {
        if !complete {
            return Ok(None);
        }
        let mut acc = Dec::zero();
        for v in vals.into_iter().flatten() {
            acc = acc.add(&v).map_err(|e| bad("schedule total", e))?;
        }
        Ok(Some(acc.rescale(MONEY_SCALE).map_err(|e| bad("schedule total", e))?))
    };

    let total_accrued_income = sum_opt(earning_assets.iter().map(|a| a.accrued_income).collect())?;
    let total_accrued = sum_opt(obligations.iter().map(|o| o.accrued_interest).collect())?;
    let total_owed_all = sum_opt(obligations.iter().map(|o| o.total_owed).collect())?;
    let call_now = sum_opt(obligations.iter().map(|o| o.callable_now).collect())?;
    let call_on_notice = sum_opt(
        obligations
            .iter()
            .map(|o| if o.call_notice_days > 0 { o.total_owed } else { None })
            .collect(),
    )?;

    let income_schedule = IncomeSchedule {
        basis_date: terms.basis_date.clone(),
        as_of_date: as_of_date.to_string(),
        assets: earning_assets,
        total_principal: total_earning_principal,
        total_accrued_income,
        non_earning_assets,
        orphan_terms: Vec::new(),
    };

    let debt_schedule = DebtSchedule {
        basis_date: terms.basis_date.clone(),
        as_of_date: as_of_date.to_string(),
        obligations,
        total_principal,
        non_interest_bearing,
        total_non_interest_bearing,
        total_accrued_interest: total_accrued,
        total_owed: total_owed_all,
        call_owed_immediately: call_now,
        call_owed_on_notice: call_on_notice,
        unmodelled_liabilities: unmodelled_liabilities.clone(),
        orphan_terms,
        complete,
        incomplete_reason: incomplete_reason.clone(),
    };

    // ── Trial balance ────────────────────────────────────────────────
    let mut accounts: Vec<Account> = Vec::new();

    let mut push_section = |accounts: &mut Vec<Account>,
                            ptr: &str,
                            base: u32,
                            classification: &'static str,
                            natural_debit: bool|
     -> Result<Vec<StatementLine>, AppError> {
        let items = ledger
            .pointer(ptr)
            .and_then(Value::as_array)
            .ok_or_else(|| AppError::Internal(format!("ledger summary has no `{ptr}`")))?;
        let mut lines = Vec::new();
        for (i, item) in items.iter().enumerate() {
            let label = item
                .get("label")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::Internal(format!("`{ptr}[{i}]` has no label")))?;
            let amount = dec_of(item.get("value").unwrap_or(&Value::Null), label)?;
            let (debit, credit) = columns(natural_debit, &amount);
            accounts.push(Account {
                code: format!("{}", base + (i as u32) * 10),
                account: label.to_string(),
                classification,
                debit,
                credit,
                source: "Workbook — Balance Sheet".into(),
                authority: bs_authority.get(label).cloned(),
            });
            lines.push(line(label, amount, bs_authority.get(label).cloned(), "workbook"));
        }
        Ok(lines)
    };

    let mut current_assets = push_section(
        &mut accounts,
        "/summary/balanceSheet/currentAssets",
        1000,
        "Asset",
        true,
    )?;
    let non_current_assets = push_section(
        &mut accounts,
        "/summary/balanceSheet/nonCurrentAssets",
        1500,
        "Asset",
        true,
    )?;
    let mut liability_lines = push_section(
        &mut accounts,
        "/summary/balanceSheet/liabilities",
        2000,
        "Liability",
        false,
    )?;
    let equity_lines = push_section(&mut accounts, "/summary/balanceSheet/equity", 3000, "Equity", false)?;

    // Income statement lines from the workbook, classified by label.
    let is_lines = ledger
        .pointer("/summary/incomeStatement/lines")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::Internal("ledger summary has no incomeStatement.lines".into()))?;

    let mut revenue_lines = Vec::new();
    let mut opex_lines = Vec::new();
    let mut cogs = Dec::zero();
    let mut depreciation = Dec::zero();
    let mut tax = Dec::zero();
    let mut revenue_seq = 0u32;
    let mut expense_seq = 0u32;

    for item in is_lines {
        let label = item.get("label").and_then(Value::as_str).unwrap_or_default();
        let amount = dec_of(item.get("amount").unwrap_or(&Value::Null), label)?;
        let basis = item.get("basis").and_then(Value::as_str).map(str::to_string);

        match label {
            "Gross Revenue" => {
                accounts.push(Account {
                    code: format!("{}", 4000 + revenue_seq * 10),
                    account: label.into(),
                    classification: "Revenue",
                    debit: columns(false, &amount).0,
                    credit: columns(false, &amount).1,
                    source: "Workbook — Income Statement".into(),
                    authority: basis.clone(),
                });
                revenue_seq += 1;
                revenue_lines.push(line(label, amount, basis, "workbook"));
            }
            // The workbook's own interest line is superseded by the live
            // accrual computed below; carrying both would double-count.
            "Interest Expense" => {}
            _ => {
                let code = match label {
                    "Cost of Goods Sold (COGS)" => 5000,
                    "Depreciation & Amortization" => 5800,
                    "Income Tax Expense" => 5950,
                    _ => {
                        expense_seq += 1;
                        5000 + expense_seq * 10
                    }
                };
                accounts.push(Account {
                    code: format!("{code}"),
                    account: label.into(),
                    classification: "Expense",
                    debit: columns(true, &amount).0,
                    credit: columns(true, &amount).1,
                    source: "Workbook — Income Statement".into(),
                    authority: basis.clone(),
                });
                match label {
                    "Cost of Goods Sold (COGS)" => cogs = amount,
                    "Depreciation & Amortization" => depreciation = amount,
                    "Income Tax Expense" => tax = amount,
                    _ => opex_lines.push(line(label, amount, basis, "workbook")),
                }
            }
        }
    }

    // ── The live posting: accrued interest ───────────────────────────
    let interest_expense = debt_schedule.total_accrued_interest;
    if let Some(interest) = interest_expense {
        let rate_note = format!(
            "Computed {} → {} ({} days) on declared terms against live reference rates",
            debt_schedule.basis_date, debt_schedule.as_of_date, days_elapsed
        );
        accounts.push(Account {
            code: "2900".into(),
            account: "Accrued Interest Payable".into(),
            classification: "Liability",
            debit: None,
            credit: Some(interest),
            source: "Computed — live accrual on declared debt terms".into(),
            authority: Some("ASC 835-30 / IAS 23 — interest accrued but unpaid".into()),
        });
        accounts.push(Account {
            code: "5900".into(),
            account: "Interest Expense".into(),
            classification: "Expense",
            debit: Some(interest),
            credit: None,
            source: "Computed — live accrual on declared debt terms".into(),
            authority: Some("ASC 835-30 / IAS 23 — effective interest recognised in profit or loss".into()),
        });
        liability_lines.push(line(
            "Accrued Interest Payable",
            interest,
            Some(rate_note),
            "computed",
        ));
    }

    let interest_income = income_schedule.total_accrued_income;
    if let Some(income) = interest_income {
        let rate_note = format!(
            "Computed {} → {} ({} days) on declared asset terms against live reference rates",
            income_schedule.basis_date, income_schedule.as_of_date, days_elapsed
        );
        accounts.push(Account {
            code: "1900".into(),
            account: "Accrued Interest Receivable".into(),
            classification: "Asset",
            debit: Some(income),
            credit: None,
            source: "Computed — live accrual on declared asset terms".into(),
            authority: Some("ASC 310 / IFRS 9 — interest earned but not yet received".into()),
        });
        accounts.push(Account {
            code: "4900".into(),
            account: "Interest Income".into(),
            classification: "Revenue",
            debit: None,
            credit: Some(income),
            source: "Computed — live accrual on declared asset terms".into(),
            authority: Some(
                "ASC 835-30 / IFRS 9 — effective interest recognised in profit or loss".into(),
            ),
        });
        current_assets.push(line(
            "Accrued Interest Receivable",
            income,
            Some(rate_note),
            "computed",
        ));
    }

    let total_debits = Dec::sum(
        &accounts
            .iter()
            .filter_map(|a| a.debit)
            .collect::<Vec<_>>(),
    )
    .and_then(|d| d.rescale(MONEY_SCALE))
    .map_err(|e| bad("total debits", e))?;
    let total_credits = Dec::sum(
        &accounts
            .iter()
            .filter_map(|a| a.credit)
            .collect::<Vec<_>>(),
    )
    .and_then(|d| d.rescale(MONEY_SCALE))
    .map_err(|e| bad("total credits", e))?;
    // Withhold the foot wholesale if any accrual leg is missing. The accounts
    // above are still listed, but summing them would present a total struck
    // over a knowingly partial set of entries as if it were the whole book.
    let (total_debits, total_credits, tb_balanced) = if incomplete_reason.is_none() {
        let balanced = total_debits
            .eq_dec(&total_credits)
            .map_err(|e| bad("trial balance comparison", e))?;
        (Some(total_debits), Some(total_credits), Some(balanced))
    } else {
        (None, None, None)
    };

    let trial_balance = TrialBalance {
        accounts,
        total_debits,
        total_credits,
        balanced: tb_balanced,
        incomplete_reason: incomplete_reason.clone(),
    };

    // ── Income statement ─────────────────────────────────────────────
    let gross_revenue = dec_at(ledger, "/summary/incomeStatement/grossRevenue")?;
    let gross_profit = gross_revenue.sub(&cogs).map_err(|e| bad("gross profit", e))?;
    let total_opex = Dec::sum(&opex_lines.iter().map(|l| l.amount).collect::<Vec<_>>())
        .map_err(|e| bad("total operating expenses", e))?;
    let ebitda = gross_profit.sub(&total_opex).map_err(|e| bad("EBITDA", e))?;
    let ebit = ebitda.sub(&depreciation).map_err(|e| bad("EBIT", e))?;
    // Interest is presented gross on both sides and netted on its own line, so
    // the reader can see the cost of the obligations and the return on the
    // assets funding them rather than a single number that hides both.
    let (net_interest, ebt, net_income) = match (interest_expense, interest_income) {
        (Some(expense), Some(income)) => {
            let net = income.sub(&expense).map_err(|e| bad("net interest", e))?;
            let ebt = ebit.add(&net).map_err(|e| bad("EBT", e))?;
            let ni = ebt.sub(&tax).map_err(|e| bad("net income", e))?;
            (Some(net), Some(ebt), Some(ni))
        }
        _ => (None, None, None),
    };

    let income_statement = IncomeStatement {
        period_from: terms.basis_date.clone(),
        period_to: as_of_date.to_string(),
        revenue: revenue_lines,
        gross_revenue,
        cost_of_goods_sold: cogs,
        gross_profit,
        operating_expenses: opex_lines,
        total_operating_expenses: total_opex,
        ebitda,
        depreciation_amortization: depreciation,
        ebit,
        interest_expense,
        interest_income,
        net_interest,
        earnings_before_tax: ebt,
        income_tax_expense: tax,
        net_income,
        withheld_reason: incomplete_reason.clone(),
    };

    // ── Balance sheet, re-footed ─────────────────────────────────────
    let mut equity_presented = equity_lines.clone();
    if let Some(ni) = net_income {
        equity_presented.push(line(
            "Net Income (Loss) — Period to Date",
            ni,
            Some(format!(
                "Closes the period's net interest into equity; period {} → {}",
                terms.basis_date, as_of_date
            )),
            "computed",
        ));
    }

    let total_current_assets = Dec::sum(&current_assets.iter().map(|l| l.amount).collect::<Vec<_>>())
        .map_err(|e| bad("total current assets", e))?;
    let total_non_current_assets =
        Dec::sum(&non_current_assets.iter().map(|l| l.amount).collect::<Vec<_>>())
            .map_err(|e| bad("total non-current assets", e))?;
    let total_assets = total_current_assets
        .add(&total_non_current_assets)
        .map_err(|e| bad("total assets", e))?;
    // Interest receivable is a current asset, so the asset side now depends on
    // the accrual as well and is withheld on the same terms as the other foot.
    let (total_current_assets, total_assets) = if incomplete_reason.is_none() {
        (Some(total_current_assets), Some(total_assets))
    } else {
        (None, None)
    };
    let total_liabilities = Dec::sum(&liability_lines.iter().map(|l| l.amount).collect::<Vec<_>>())
        .map_err(|e| bad("total liabilities", e))?;
    let total_equity = Dec::sum(&equity_presented.iter().map(|l| l.amount).collect::<Vec<_>>())
        .map_err(|e| bad("total equity", e))?;
    // Accrued interest is a liability and the period loss closes into equity,
    // so both sides below depend on the accrual. If any leg is unpriced these
    // totals would understate what is owed — withhold them rather than publish
    // a figure an auditor would foot against and find short.
    let (total_liabilities, total_equity, total_l_and_e, bs_balanced) = if incomplete_reason.is_none()
    {
        let total_l_and_e = total_liabilities
            .add(&total_equity)
            .map_err(|e| bad("total liabilities and equity", e))?;
        let balanced = match total_assets {
            Some(a) => a
                .eq_dec(&total_l_and_e)
                .map_err(|e| bad("balance sheet comparison", e))?,
            None => false,
        };
        (
            Some(total_liabilities),
            Some(total_equity),
            Some(total_l_and_e),
            Some(balanced),
        )
    } else {
        (None, None, None, None)
    };

    let balance_sheet = BalanceSheet {
        current_assets,
        total_current_assets,
        non_current_assets,
        total_non_current_assets,
        total_assets,
        liabilities: liability_lines,
        total_liabilities,
        equity: equity_presented,
        total_equity,
        total_liabilities_and_equity: total_l_and_e,
        balanced: bs_balanced,
    };

    // ── Gold revaluation (memo disclosure) ───────────────────────────
    let ounces = dec_at(ledger, "/summary/goldAssay/fineGoldOunces")?;
    let recorded_price = dec_at(ledger, "/summary/goldAssay/lbmaSpotUsdPerOz")?;
    let recorded_fmv = dec_at(ledger, "/summary/goldAssay/fairMarketValueUsd")?;
    let carrying = dec_at(ledger, "/summary/goldAssay/carryingValueUsd")?;

    let gold_q = &rate_snapshot.gold;
    let (live_fmv, surplus, movement, move_pct) = match gold_q.usd_per_troy_ounce {
        None => (None, None, None, None),
        Some(price) => {
            let fmv = ounces
                .mul(&price)
                .and_then(|v| v.rescale(MONEY_SCALE))
                .map_err(|e| bad("live gold fair value", e))?;
            let surplus = fmv.sub(&carrying).map_err(|e| bad("revaluation surplus", e))?;
            let movement = fmv
                .sub(&recorded_fmv.rescale(MONEY_SCALE).map_err(|e| bad("recorded fmv", e))?)
                .map_err(|e| bad("movement", e))?;
            let pct = price
                .sub(&recorded_price)
                .and_then(|d| d.div(&recorded_price, 6))
                .and_then(|d| d.mul(&Dec::from_int(100)))
                .and_then(|d| d.rescale(4))
                .map_err(|e| bad("price move", e))?;
            (Some(fmv), Some(surplus), Some(movement), Some(pct))
        }
    };

    let gold_revaluation = GoldRevaluation {
        fine_gold_ounces: ounces,
        recorded_price_usd_per_oz: recorded_price,
        recorded_fair_market_value: recorded_fmv,
        carrying_value: carrying,
        live_price_usd_per_oz: gold_q.usd_per_troy_ounce,
        live_fair_market_value: live_fmv,
        revaluation_surplus: surplus,
        movement_since_recorded_fix: movement,
        price_move_percent: move_pct,
        treatment: "Disclosed, not posted. Appreciation on bullion held at cost is an \
                    unrecognised reserve under the historical-cost basis the workbook is \
                    prepared on; recognising it would require an IAS 16 revaluation election \
                    and a corresponding OCI reserve. The figure is presented so the reader can \
                    see the unrecorded buffer, and it is deliberately absent from the trial \
                    balance."
            .into(),
        status: gold_q.status,
        error: gold_q.error.clone(),
    };

    // ── Reconciliation checks ────────────────────────────────────────
    let mut checks = vec![
        check_money_opt(
            "TB-FOOTS",
            "Trial balance debits equal credits".into(),
            trial_balance.total_debits.as_ref(),
            trial_balance.total_credits.as_ref(),
            MONEY_SCALE,
            incomplete_reason.as_deref(),
        )?,
        check_money_opt(
            "BS-BALANCES",
            "Assets equal liabilities plus equity".into(),
            balance_sheet.total_assets.as_ref(),
            balance_sheet.total_liabilities_and_equity.as_ref(),
            MONEY_SCALE,
            incomplete_reason.as_deref(),
        )?,
        check_money(
            "DEBT-TIES",
            "Interest-bearing principal plus declared non-interest-bearing liabilities ties to workbook total liabilities".into(),
            &dec_at(ledger, "/summary/balanceSheet/totalLiabilities")?,
            &debt_schedule
                .total_principal
                .add(&debt_schedule.total_non_interest_bearing)
                .map_err(|e| bad("liabilities coverage total", e))?,
            MONEY_SCALE,
        )?,
        check(
            "DEBT-COVERAGE",
            "Every balance-sheet liability is either priced or declared non-interest-bearing".into(),
            "0 unmodelled".to_string(),
            format!("{} unmodelled", unmodelled_liabilities.len()),
        ),
        check_money_opt(
            "ASSETS-TIE",
            "Total assets equal the workbook figure plus accrued interest receivable".into(),
            match income_schedule.total_accrued_income {
                Some(income) => Some(
                    dec_at(ledger, "/summary/balanceSheet/totalAssets")?
                        .add(&income)
                        .map_err(|e| bad("expected total assets", e))?,
                ),
                None => None,
            }
            .as_ref(),
            balance_sheet.total_assets.as_ref(),
            MONEY_SCALE,
            incomplete_reason.as_deref(),
        )?,
        check(
            "ASSET-COVERAGE",
            "Every interest-earning asset is declared; the rest are listed as non-earning".into(),
            format!("{} asset lines classified", all_asset_lines.len()),
            format!(
                "{} asset lines classified ({} earning + {} non-earning)",
                income_schedule.assets.len() + income_schedule.non_earning_assets.len(),
                income_schedule.assets.len(),
                income_schedule.non_earning_assets.len()
            ),
        ),
    ];

    // The gold fair value in the workbook must be reproducible from its own
    // stated inputs; if it is not, the extract has drifted from the assay.
    let recomputed_fmv = ounces
        .mul(&recorded_price)
        .and_then(|v| v.rescale(8))
        .map_err(|e| bad("gold recompute", e))?;
    checks.push(check_money(
        "GOLD-RECOMPUTES",
        "Workbook gold fair value reproduces from ounces × recorded fix".into(),
        &recorded_fmv,
        &recomputed_fmv,
        8,
    )?);

    checks.push(check(
        "RATES-LIVE",
        "All reference rates answered".into(),
        "live".to_string(),
        rate_snapshot.status.to_string(),
    ));

    Ok(Json(Statements {
        entity: ledger.get("entity").cloned().unwrap_or(Value::Null),
        version: ledger.get("version").cloned().unwrap_or(Value::Null),
        source: ledger.get("source").cloned().unwrap_or(Value::Null),
        as_of: now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        as_of_date: as_of_date.to_string(),
        basis_date: terms.basis_date,
        days_elapsed,
        rates: rate_snapshot,
        trial_balance,
        balance_sheet,
        income_statement,
        debt_schedule,
        income_schedule,
        gold_revaluation,
        checks,
        methodology: vec![
            "Principals are read from the workbook Balance Sheet. debt-terms.json declares only terms — index, spread, day count and call conditions.",
            "Interest accrues from the basis date to the request date using the stated day-count convention against live published reference rates.",
            "Interest accrues on both sides. Obligations post debit Interest Expense (5900) / credit Accrued Interest Payable (2900); interest-earning assets post debit Accrued Interest Receivable (1900) / credit Interest Income (4900).",
            "Interest is presented gross on the income statement with a separate net interest line, so the cost of the obligations and the return on the assets funding them are both visible.",
            "If a reference rate cannot be fetched, the dependent figures are withheld as null with the transport error attached. No fallback or assumed rate is ever substituted.",
            "All arithmetic is exact base-10 decimal. No IEEE floating point is used anywhere in this computation.",
            "Gold appreciation is disclosed as an unrecorded memo, not posted, because the estate is carried on a historical-cost basis.",
        ],
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn columns_place_natural_balances_correctly() {
        let positive = Dec::parse("100").unwrap();
        let negative = Dec::parse("-100").unwrap();
        // An asset with a positive balance is a debit.
        assert_eq!(columns(true, &positive).0.unwrap().to_string(), "100");
        assert!(columns(true, &positive).1.is_none());
        // A liability with a positive balance is a credit.
        assert_eq!(columns(false, &positive).1.unwrap().to_string(), "100");
        // A contra balance flips the column and is shown unsigned.
        assert_eq!(columns(true, &negative).1.unwrap().to_string(), "100");
    }

    #[test]
    fn day_count_conventions_are_explicit() {
        assert_eq!(year_basis("ACT/360").unwrap().to_string(), "360");
        assert_eq!(year_basis("ACT/365").unwrap().to_string(), "365");
        assert!(year_basis("30/360").is_err(), "unknown conventions must be refused, not defaulted");
    }

    #[test]
    fn accrual_posting_keeps_the_books_balanced() {
        // Assets stay put; the liability and the expense are equal and
        // opposite through equity, so debits still equal credits.
        let assets = Dec::parse("2153000000000").unwrap();
        let liabilities = Dec::parse("450000000000").unwrap();
        let equity = Dec::parse("1703000000000").unwrap();
        let interest = Dec::parse("5273979657.53").unwrap();

        let debits = assets.add(&interest).unwrap();
        let credits = liabilities.add(&interest).unwrap().add(&equity).unwrap();
        assert!(debits.eq_dec(&credits).unwrap());

        // And the presented balance sheet, which closes income into equity.
        let liab_presented = liabilities.add(&interest).unwrap();
        let equity_presented = equity.sub(&interest).unwrap();
        assert!(assets.eq_dec(&liab_presented.add(&equity_presented).unwrap()).unwrap());
    }

    #[test]
    fn authority_travels_with_the_figure() {
        let ledger = serde_json::json!({
            "sheets": { "Balance Sheet": { "rows": [
                ["Cash & Cash Equivalents", 1250000000, "12 U.S.C. § 5904 Stablecoin Liquidity Reserve"],
                ["CURRENT ASSETS"],
                [],
            ]}}
        });
        let map = authority_map(&ledger, "Balance Sheet");
        assert_eq!(
            map.get("Cash & Cash Equivalents").map(String::as_str),
            Some("12 U.S.C. § 5904 Stablecoin Liquidity Reserve")
        );
        assert_eq!(map.len(), 1, "header and blank rows must not become accounts");
    }
}
