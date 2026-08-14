//! One-click auditor copies of the ledger and the live statements.
//!
//! Four surfaces, all rendered from the *same* computation the Statements page
//! displays — `statements::build_statements`. There is one statement builder in
//! this codebase and one set of numbers; an export that recomputed its own
//! figures would be a second set of books, and the first thing an auditor does
//! with two sets of books is stop trusting both.
//!
//! * `GET /api/capomastro/export/statements.html` — the full statement package,
//!   laid out for letter paper. `?print=1` opens the browser print dialogue on
//!   load, which is how a PDF is produced without shipping a PDF engine.
//! * `GET /api/capomastro/export/statements.csv` — the same package as a
//!   sectioned working paper an auditor can tie out in Excel.
//! * `GET /api/capomastro/export/trial-balance.csv` — the trial balance alone.
//! * `GET /api/capomastro/export/ledger.csv` — the source workbook, every sheet,
//!   exactly as extracted.
//!
//! Two rules govern the presentation, and both exist because a financial
//! statement is read by people who will act on it:
//!
//! 1. **A withheld figure is never rendered as blank or zero.** It prints as
//!    `[WITHHELD]` with the reason carried alongside. A blank cell in a money
//!    column reads as nil to every accountant alive.
//! 2. **Nothing here claims assurance that does not exist.** The package is
//!    marked UNAUDITED on every page and carries a notice stating that no audit
//!    or review has been performed. It is the working paper a CPA/CGA attaches
//!    their own report to — it is not, and must never look like, that report.

use axum::extract::{Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::dec::Dec;
use super::statements::{build_statements, Statements};
use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct ExportQuery {
    /// `?refresh=1` re-polls the rate sources before rendering.
    refresh: Option<String>,
    /// `?print=1` fires the browser print dialogue on load (HTML only).
    print: Option<String>,
}

fn flag(v: &Option<String>) -> bool {
    matches!(v.as_deref(), Some("1") | Some("true"))
}

// ── Presentation helpers ─────────────────────────────────────────────────

/// Group a decimal string into accounting thousands at two places.
///
/// Negatives print in parentheses, which is the convention every statement
/// reader parses without thinking. A leading minus sign is easy to miss in a
/// column of figures; a bracket is not.
fn money(d: &Dec) -> String {
    let fixed = match d.to_fixed(2) {
        Ok(s) => s,
        // to_fixed only fails on scale overflow, which money never reaches.
        // Falling back to the exact form is honest: it is still the number.
        Err(_) => d.to_string(),
    };
    let negative = fixed.starts_with('-');
    let body = fixed.trim_start_matches('-');
    let (int_part, frac) = body.split_once('.').unwrap_or((body, "00"));

    let mut grouped = String::new();
    for (i, c) in int_part.chars().enumerate() {
        if i > 0 && (int_part.len() - i) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(c);
    }

    if negative {
        format!("({grouped}.{frac})")
    } else {
        format!("{grouped}.{frac}")
    }
}

/// A figure the computation withheld. Never an empty cell, never a zero.
const WITHHELD: &str = "[WITHHELD]";

fn money_opt(d: Option<&Dec>) -> String {
    d.map(money).unwrap_or_else(|| WITHHELD.to_string())
}

/// Exact decimal for machine-readable columns — no grouping, no parentheses,
/// so a spreadsheet reads it as a number and an auditor can re-add the column.
fn exact_opt(d: Option<&Dec>) -> String {
    d.map(|v| v.to_fixed(2).unwrap_or_else(|_| v.to_string()))
        .unwrap_or_else(|| WITHHELD.to_string())
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn plain(v: &Value) -> String {
    v.as_str().map(str::to_owned).unwrap_or_default()
}

/// SHA-256 over the payload the document was rendered from.
///
/// The figures are recomputed live on every request, so two copies printed
/// minutes apart legitimately differ. The digest lets a recipient prove which
/// computation they are holding, and lets the sender prove what they sent.
fn payload_digest(s: &Statements) -> String {
    let json = serde_json::to_string(s).unwrap_or_default();
    let mut h = Sha256::new();
    h.update(json.as_bytes());
    hex::encode(h.finalize())
}

// ── CSV ──────────────────────────────────────────────────────────────────

/// True when the cell is a plain number a spreadsheet should read as a number.
///
/// This is the exception that keeps the export usable: an auditor has to be
/// able to re-add a column, and a money figure defused as text cannot be summed.
/// Only the strict money shape qualifies — optional sign, digits, optional
/// fractional part — so nothing that could carry a formula slips through.
fn is_plain_number(s: &str) -> bool {
    let body = s.strip_prefix('-').unwrap_or(s);
    if body.is_empty() {
        return false;
    }
    let (int_part, frac) = body.split_once('.').unwrap_or((body, "0"));
    !int_part.is_empty()
        && !frac.is_empty()
        && int_part.bytes().all(|b| b.is_ascii_digit())
        && frac.bytes().all(|b| b.is_ascii_digit())
}

fn csv_cell(s: &str) -> String {
    // Excel, Sheets and Numbers evaluate any cell opening with =, +, - or @ as a
    // formula, and these labels, notes and authorities come from JSON on disk.
    // A tampered label would otherwise execute when an auditor opens the file.
    // A leading apostrophe forces the cell to text; genuine numbers are exempt
    // so the money columns stay addable.
    //
    // The sigil is looked for past any leading whitespace or control characters:
    // importers vary in what they trim before parsing, and " =cmd" reaching a
    // spreadsheet that trims is the same attack as "=cmd" reaching one that does
    // not. Trimming here only decides *whether to defuse* — the cell itself is
    // still written exactly as it was given.
    let lead_stripped = s.trim_start_matches(|c: char| c.is_whitespace() || c.is_control());
    let needs_defusing =
        !is_plain_number(lead_stripped) && lead_stripped.starts_with(['=', '+', '-', '@']);
    let defused = if needs_defusing {
        format!("'{s}")
    } else {
        s.to_string()
    };

    if defused.contains(',')
        || defused.contains('"')
        || defused.contains('\n')
        || defused.contains('\r')
    {
        format!("\"{}\"", defused.replace('"', "\"\""))
    } else {
        defused
    }
}

fn csv_row(cells: &[&str]) -> String {
    let joined: Vec<String> = cells.iter().map(|c| csv_cell(c)).collect();
    format!("{}\n", joined.join(","))
}

fn attachment(body: String, content_type: &'static str, filename: String) -> Response {
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type.to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{filename}\""),
            ),
            // A statement is a point-in-time document. Serving it from a cache
            // would hand someone yesterday's figures under today's date.
            (header::CACHE_CONTROL, "no-store".to_string()),
        ],
        body,
    )
        .into_response()
}

// ── Trial balance CSV ────────────────────────────────────────────────────

fn trial_balance_csv(s: &Statements) -> String {
    let mut out = String::new();
    out.push_str(&csv_row(&[&plain(&s.entity)]));
    out.push_str(&csv_row(&["Trial Balance — Auditor's Listing"]));
    out.push_str(&csv_row(&[&format!("As at {}", s.as_of_date)]));
    out.push_str(&csv_row(&["Expressed in United States dollars (USD)"]));
    out.push_str(&csv_row(&["UNAUDITED — no assurance is expressed"]));
    out.push('\n');
    out.push_str(&csv_row(&[
        "Code",
        "Account",
        "Classification",
        "Source",
        "Authority / basis",
        "Debit",
        "Credit",
    ]));
    for a in &s.trial_balance.accounts {
        out.push_str(&csv_row(&[
            &a.code,
            &a.account,
            a.classification,
            &a.source,
            a.authority.as_deref().unwrap_or(""),
            &a.debit.as_ref().map(|d| exact_opt(Some(d))).unwrap_or_default(),
            &a.credit.as_ref().map(|d| exact_opt(Some(d))).unwrap_or_default(),
        ]));
    }
    out.push_str(&csv_row(&[
        "",
        "TOTALS",
        "",
        "",
        "",
        &exact_opt(s.trial_balance.total_debits.as_ref()),
        &exact_opt(s.trial_balance.total_credits.as_ref()),
    ]));
    if let Some(reason) = &s.trial_balance.incomplete_reason {
        out.push('\n');
        out.push_str(&csv_row(&["Foot withheld", reason]));
    }
    out
}

// ── Full statement package CSV ───────────────────────────────────────────

fn statements_csv(s: &Statements) -> String {
    let mut out = String::new();
    let section = |title: &str, out: &mut String| {
        out.push('\n');
        out.push_str(&csv_row(&[title]));
    };

    out.push_str(&csv_row(&[&plain(&s.entity)]));
    out.push_str(&csv_row(&["Financial Statement Package — Auditor Working Paper"]));
    out.push_str(&csv_row(&[&format!("As at {} ({})", s.as_of_date, s.as_of)]));
    out.push_str(&csv_row(&[&format!(
        "Period from {} to {} ({} days)",
        s.basis_date, s.as_of_date, s.days_elapsed
    )]));
    out.push_str(&csv_row(&["Expressed in United States dollars (USD)"]));
    out.push_str(&csv_row(&[
        "UNAUDITED — compiled from records provided by management. No audit or review performed; no assurance expressed.",
    ]));
    out.push_str(&csv_row(&[&format!("Source workbook: {}", plain(&s.source))]));
    out.push_str(&csv_row(&[&format!("Payload SHA-256: {}", payload_digest(s))]));

    section("STATEMENT OF FINANCIAL POSITION", &mut out);
    out.push_str(&csv_row(&["Section", "Line", "Amount", "Origin", "Note"]));
    let bs = &s.balance_sheet;
    for l in &bs.current_assets {
        out.push_str(&csv_row(&[
            "Current assets",
            &l.label,
            &exact_opt(Some(&l.amount)),
            l.origin,
            l.note.as_deref().unwrap_or(""),
        ]));
    }
    out.push_str(&csv_row(&[
        "Current assets",
        "Total current assets",
        &exact_opt(bs.total_current_assets.as_ref()),
        "computed",
        "",
    ]));
    for l in &bs.non_current_assets {
        out.push_str(&csv_row(&[
            "Non-current assets",
            &l.label,
            &exact_opt(Some(&l.amount)),
            l.origin,
            l.note.as_deref().unwrap_or(""),
        ]));
    }
    out.push_str(&csv_row(&[
        "Non-current assets",
        "Total non-current assets",
        &exact_opt(Some(&bs.total_non_current_assets)),
        "computed",
        "",
    ]));
    out.push_str(&csv_row(&[
        "Assets",
        "TOTAL ASSETS",
        &exact_opt(bs.total_assets.as_ref()),
        "computed",
        "",
    ]));
    for l in &bs.liabilities {
        out.push_str(&csv_row(&[
            "Liabilities",
            &l.label,
            &exact_opt(Some(&l.amount)),
            l.origin,
            l.note.as_deref().unwrap_or(""),
        ]));
    }
    out.push_str(&csv_row(&[
        "Liabilities",
        "Total liabilities",
        &exact_opt(bs.total_liabilities.as_ref()),
        "computed",
        "",
    ]));
    for l in &bs.equity {
        out.push_str(&csv_row(&[
            "Equity",
            &l.label,
            &exact_opt(Some(&l.amount)),
            l.origin,
            l.note.as_deref().unwrap_or(""),
        ]));
    }
    out.push_str(&csv_row(&[
        "Equity",
        "Total equity",
        &exact_opt(bs.total_equity.as_ref()),
        "computed",
        "",
    ]));
    out.push_str(&csv_row(&[
        "",
        "TOTAL LIABILITIES AND EQUITY",
        &exact_opt(bs.total_liabilities_and_equity.as_ref()),
        "computed",
        "",
    ]));

    section("STATEMENT OF OPERATIONS", &mut out);
    out.push_str(&csv_row(&["Line", "Amount", "Basis"]));
    let is = &s.income_statement;
    for l in &is.revenue {
        out.push_str(&csv_row(&[
            &l.label,
            &exact_opt(Some(&l.amount)),
            l.note.as_deref().unwrap_or(""),
        ]));
    }
    out.push_str(&csv_row(&["Gross profit", &exact_opt(Some(&is.gross_profit)), ""]));
    for l in &is.operating_expenses {
        out.push_str(&csv_row(&[
            &l.label,
            &exact_opt(Some(&l.amount)),
            l.note.as_deref().unwrap_or(""),
        ]));
    }
    out.push_str(&csv_row(&[
        "Total operating expenses",
        &exact_opt(Some(&is.total_operating_expenses)),
        "",
    ]));
    out.push_str(&csv_row(&["EBITDA", &exact_opt(Some(&is.ebitda)), ""]));
    out.push_str(&csv_row(&[
        "Depreciation and amortisation",
        &exact_opt(Some(&is.depreciation_amortization)),
        "",
    ]));
    out.push_str(&csv_row(&["EBIT", &exact_opt(Some(&is.ebit)), ""]));
    out.push_str(&csv_row(&[
        "Interest income",
        &exact_opt(is.interest_income.as_ref()),
        "Accrued on interest-earning assets over the period",
    ]));
    out.push_str(&csv_row(&[
        "Interest expense",
        &exact_opt(is.interest_expense.as_ref()),
        "Accrued on interest-bearing obligations over the period",
    ]));
    out.push_str(&csv_row(&[
        "Net interest",
        &exact_opt(is.net_interest.as_ref()),
        "",
    ]));
    out.push_str(&csv_row(&[
        "Earnings before tax",
        &exact_opt(is.earnings_before_tax.as_ref()),
        "",
    ]));
    out.push_str(&csv_row(&[
        "Income tax expense",
        &exact_opt(Some(&is.income_tax_expense)),
        "",
    ]));
    out.push_str(&csv_row(&[
        "NET INCOME (LOSS)",
        &exact_opt(is.net_income.as_ref()),
        is.withheld_reason.as_deref().unwrap_or(""),
    ]));

    section("SCHEDULE OF INTEREST-BEARING OBLIGATIONS", &mut out);
    out.push_str(&csv_row(&[
        "ID",
        "Ledger line",
        "Creditor",
        "Authority",
        "Principal",
        "Index",
        "Index %",
        "Spread (bps)",
        "All-in %",
        "Day count",
        "Days",
        "Accrued interest",
        "Total owed",
        "Call basis",
        "Notice days",
        "Status",
    ]));
    for o in &s.debt_schedule.obligations {
        out.push_str(&csv_row(&[
            &o.id,
            &o.ledger_line,
            &o.creditor,
            &o.authority,
            &exact_opt(Some(&o.principal)),
            o.rate_index.as_deref().unwrap_or(WITHHELD),
            &o.index_percent.as_ref().map(Dec::to_string).unwrap_or_else(|| WITHHELD.into()),
            &o.spread_bps.as_ref().map(Dec::to_string).unwrap_or_else(|| WITHHELD.into()),
            &o.all_in_percent.as_ref().map(Dec::to_string).unwrap_or_else(|| WITHHELD.into()),
            o.day_count.as_deref().unwrap_or(WITHHELD),
            &o.days_accrued.to_string(),
            &exact_opt(o.accrued_interest.as_ref()),
            &exact_opt(o.total_owed.as_ref()),
            &o.call_basis,
            &o.call_notice_days.to_string(),
            o.status,
        ]));
    }
    for n in &s.debt_schedule.non_interest_bearing {
        out.push_str(&csv_row(&[
            "",
            &n.ledger_line,
            "",
            "",
            &exact_opt(Some(&n.principal)),
            "non-interest-bearing",
            "",
            "",
            "",
            "",
            "0",
            "0.00",
            &exact_opt(Some(&n.principal)),
            "",
            "",
            &format!("declared by {}", n.declared_by),
        ]));
    }

    section("SCHEDULE OF INTEREST-EARNING ASSETS", &mut out);
    out.push_str(&csv_row(&[
        "ID",
        "Ledger line",
        "Obligor",
        "Authority",
        "Principal",
        "Index",
        "Index %",
        "Spread (bps)",
        "All-in %",
        "Day count",
        "Days",
        "Accrued income",
        "Status",
    ]));
    for a in &s.income_schedule.assets {
        out.push_str(&csv_row(&[
            &a.id,
            &a.ledger_line,
            &a.obligor,
            &a.authority,
            &exact_opt(Some(&a.principal)),
            &a.rate_index,
            &a.index_percent.as_ref().map(Dec::to_string).unwrap_or_else(|| WITHHELD.into()),
            &a.spread_bps.to_string(),
            &a.all_in_percent.as_ref().map(Dec::to_string).unwrap_or_else(|| WITHHELD.into()),
            &a.day_count,
            &a.days_accrued.to_string(),
            &exact_opt(a.accrued_income.as_ref()),
            a.status,
        ]));
    }
    for label in &s.income_schedule.non_earning_assets {
        out.push_str(&csv_row(&[
            "", label, "", "", "", "non-earning", "", "", "", "", "0", "0.00", "declared",
        ]));
    }

    if !s.void_instruments.is_empty() {
        section("INSTRUMENTS STRUCK — VOID AB INITIO (disclosure only, not posted)", &mut out);
        out.push_str(&csv_row(&[
            "ID",
            "Line",
            "Former section",
            "Amount struck",
            "Declaration",
            "Declared by",
            "Declared on",
            "Offsetting credit",
            "Basis",
        ]));
        for v in &s.void_instruments {
            out.push_str(&csv_row(&[
                &v.id,
                &v.label,
                &v.former_section,
                &exact_opt(Some(&v.struck_amount)),
                &v.declaration,
                &v.declared_by,
                &v.declared_on,
                &v.offsetting_credit,
                &v.basis,
            ]));
        }
    }

    section("TRIAL BALANCE", &mut out);
    out.push_str(&csv_row(&[
        "Code",
        "Account",
        "Classification",
        "Source",
        "Authority / basis",
        "Debit",
        "Credit",
    ]));
    for a in &s.trial_balance.accounts {
        out.push_str(&csv_row(&[
            &a.code,
            &a.account,
            a.classification,
            &a.source,
            a.authority.as_deref().unwrap_or(""),
            &a.debit.as_ref().map(|d| exact_opt(Some(d))).unwrap_or_default(),
            &a.credit.as_ref().map(|d| exact_opt(Some(d))).unwrap_or_default(),
        ]));
    }
    out.push_str(&csv_row(&[
        "",
        "TOTALS",
        "",
        "",
        "",
        &exact_opt(s.trial_balance.total_debits.as_ref()),
        &exact_opt(s.trial_balance.total_credits.as_ref()),
    ]));

    section("RECONCILIATIONS", &mut out);
    out.push_str(&csv_row(&["Check", "Assertion", "Expected", "Actual", "Result"]));
    for c in &s.checks {
        out.push_str(&csv_row(&[
            c.id,
            &c.description,
            &c.expected,
            &c.actual,
            if c.pass { "PASS" } else { "FAIL" },
        ]));
    }

    section("REFERENCE RATES APPLIED", &mut out);
    out.push_str(&csv_row(&[
        "ID",
        "Rate",
        "Percent",
        "Effective date",
        "Publisher",
        "Source",
        "Status",
    ]));
    for q in &s.rates.quotes {
        out.push_str(&csv_row(&[
            &q.id,
            &q.label,
            &q.percent.as_ref().map(Dec::to_string).unwrap_or_else(|| WITHHELD.into()),
            q.effective_date.as_deref().unwrap_or(""),
            &q.publisher,
            &q.url,
            q.status,
        ]));
    }

    section("BASIS OF PREPARATION", &mut out);
    for m in &s.methodology {
        out.push_str(&csv_row(&[m]));
    }

    out
}

// ── Source workbook CSV ──────────────────────────────────────────────────

fn ledger_csv(ledger: &Value) -> String {
    let mut out = String::new();
    out.push_str(&csv_row(&[&plain(
        ledger.get("entity").unwrap_or(&Value::Null),
    )]));
    out.push_str(&csv_row(&[&plain(
        ledger.get("division").unwrap_or(&Value::Null),
    )]));
    out.push_str(&csv_row(&[&plain(
        ledger.get("version").unwrap_or(&Value::Null),
    )]));
    out.push_str(&csv_row(&[&format!(
        "Source workbook: {}",
        plain(ledger.get("source").unwrap_or(&Value::Null))
    )]));
    out.push_str(&csv_row(&[
        "Lossless extract of the source workbook. Sheets and rows appear in workbook order; no cell is reformatted.",
    ]));

    let order: Vec<String> = ledger
        .get("sheetOrder")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(str::to_owned).collect())
        .unwrap_or_default();

    let sheets = ledger.get("sheets").and_then(Value::as_object);
    for name in &order {
        let Some(sheet) = sheets.and_then(|s| s.get(name)) else {
            continue;
        };
        out.push('\n');
        out.push_str(&csv_row(&[&format!("SHEET: {name}")]));
        let rows = sheet.get("rows").and_then(Value::as_array);
        for row in rows.into_iter().flatten() {
            let cells: Vec<String> = row
                .as_array()
                .map(|r| {
                    r.iter()
                        .map(|c| match c {
                            Value::String(s) => s.clone(),
                            Value::Null => String::new(),
                            other => other.to_string(),
                        })
                        .collect()
                })
                .unwrap_or_default();
            let refs: Vec<&str> = cells.iter().map(String::as_str).collect();
            out.push_str(&csv_row(&refs));
        }
    }
    out
}

// ── The printable statement package ──────────────────────────────────────

/// A money row: label, figure, and an optional emphasis class.
fn row(label: &str, value: String, class: &str, indent: bool) -> String {
    format!(
        "<tr class=\"{class}\"><td class=\"lbl{}\">{}</td><td class=\"num\">{}</td></tr>",
        if indent { " ind" } else { "" },
        esc(label),
        esc(&value)
    )
}

fn statements_html(s: &Statements, auto_print: bool) -> String {
    let entity = plain(&s.entity);
    let digest = payload_digest(s);
    let bs = &s.balance_sheet;
    let is = &s.income_statement;

    let mut h = String::new();

    // ── Cover / letterhead ──
    h.push_str(&format!(
        r#"<header class="cover">
  <div class="rule"></div>
  <h1>{entity}</h1>
  <div class="sub">{division}</div>
  <h2>Financial Statement Package</h2>
  <div class="asof">As at {as_of_date}</div>
  <div class="period">For the period from {basis} to {as_of_date} ({days} days)</div>
  <div class="units">Expressed in United States dollars (USD)</div>
  <div class="stamp">UNAUDITED</div>
  <div class="rule"></div>
</header>"#,
        entity = esc(&entity),
        division = esc(&plain(&s.version)),
        as_of_date = esc(&s.as_of_date),
        basis = esc(&s.basis_date),
        days = s.days_elapsed,
    ));

    // ── Notice to reader ──
    h.push_str(&format!(
        r#"<section class="notice">
  <h3>Notice to Reader</h3>
  <p>These statements have been compiled from the records and representations of the estate. They are
  <strong>unaudited</strong>. No audit and no review engagement has been performed on them, and accordingly
  <strong>no assurance is expressed</strong> on the figures presented.</p>
  <p>Where a compilation, review or audit report from a professional accountant is required, this package is the
  underlying working paper to which that practitioner attaches their own report. It is not itself such a report and
  must not be presented as one.</p>
  <p>Every figure is computed at the moment of rendering from the source workbook and from live published reference
  rates. A figure that could not be computed is printed as <span class="wh">{WITHHELD}</span> with its reason — it is
  never shown as nil. Reference rates and bullion spot move continuously; two copies of this package rendered at
  different times will legitimately differ, which is why each carries a digest of the computation it was rendered
  from.</p>
  <table class="meta">
    <tr><td>Rendered</td><td>{rendered}</td></tr>
    <tr><td>Source workbook</td><td>{source}</td></tr>
    <tr><td>Workbook version</td><td>{version}</td></tr>
    <tr><td>Reference rate status</td><td>{rates}</td></tr>
    <tr><td>Computation digest (SHA-256)</td><td class="mono">{digest}</td></tr>
  </table>
</section>"#,
        WITHHELD = WITHHELD,
        rendered = esc(&s.as_of),
        source = esc(&plain(&s.source)),
        version = esc(&plain(&s.version)),
        rates = esc(s.rates.status),
        digest = esc(&digest),
    ));

    // ── Statement of financial position ──
    h.push_str("<section class=\"page\"><h3>Statement of Financial Position</h3>");
    h.push_str(&format!(
        "<div class=\"cap\">As at {}</div><table class=\"fin\">",
        esc(&s.as_of_date)
    ));
    h.push_str("<tr class=\"sec\"><td colspan=\"2\">ASSETS</td></tr>");
    h.push_str("<tr class=\"grp\"><td colspan=\"2\">Current assets</td></tr>");
    for l in &bs.current_assets {
        h.push_str(&row(&l.label, money(&l.amount), "", true));
    }
    h.push_str(&row(
        "Total current assets",
        money_opt(bs.total_current_assets.as_ref()),
        "sub",
        false,
    ));
    h.push_str("<tr class=\"grp\"><td colspan=\"2\">Non-current assets</td></tr>");
    for l in &bs.non_current_assets {
        h.push_str(&row(&l.label, money(&l.amount), "", true));
    }
    h.push_str(&row(
        "Total non-current assets",
        money(&bs.total_non_current_assets),
        "sub",
        false,
    ));
    h.push_str(&row(
        "TOTAL ASSETS",
        money_opt(bs.total_assets.as_ref()),
        "tot",
        false,
    ));

    h.push_str("<tr class=\"sec\"><td colspan=\"2\">LIABILITIES AND EQUITY</td></tr>");
    h.push_str("<tr class=\"grp\"><td colspan=\"2\">Liabilities</td></tr>");
    for l in &bs.liabilities {
        h.push_str(&row(&l.label, money(&l.amount), "", true));
    }
    h.push_str(&row(
        "Total liabilities",
        money_opt(bs.total_liabilities.as_ref()),
        "sub",
        false,
    ));
    h.push_str("<tr class=\"grp\"><td colspan=\"2\">Equity</td></tr>");
    for l in &bs.equity {
        h.push_str(&row(&l.label, money(&l.amount), "", true));
    }
    h.push_str(&row(
        "Total equity",
        money_opt(bs.total_equity.as_ref()),
        "sub",
        false,
    ));
    h.push_str(&row(
        "TOTAL LIABILITIES AND EQUITY",
        money_opt(bs.total_liabilities_and_equity.as_ref()),
        "tot",
        false,
    ));
    h.push_str("</table>");
    h.push_str(
        "<p class=\"foot-note\">The accompanying notes are an integral part of these financial statements. \
         No comparative period is presented: this is the first period reported on this basis.</p>",
    );
    h.push_str("</section>");

    // ── Statement of operations ──
    h.push_str("<section class=\"page\"><h3>Statement of Operations</h3>");
    h.push_str(&format!(
        "<div class=\"cap\">For the period from {} to {}</div><table class=\"fin\">",
        esc(&is.period_from),
        esc(&is.period_to)
    ));
    for l in &is.revenue {
        h.push_str(&row(&l.label, money(&l.amount), "", true));
    }
    h.push_str(&row("Gross profit", money(&is.gross_profit), "sub", false));
    h.push_str("<tr class=\"grp\"><td colspan=\"2\">Operating expenses</td></tr>");
    for l in &is.operating_expenses {
        h.push_str(&row(&l.label, money(&l.amount), "", true));
    }
    h.push_str(&row(
        "Total operating expenses",
        money(&is.total_operating_expenses),
        "sub",
        false,
    ));
    h.push_str(&row("EBITDA", money(&is.ebitda), "sub", false));
    h.push_str(&row(
        "Depreciation and amortisation",
        money(&is.depreciation_amortization),
        "",
        true,
    ));
    h.push_str(&row("EBIT", money(&is.ebit), "sub", false));
    h.push_str("<tr class=\"grp\"><td colspan=\"2\">Interest</td></tr>");
    h.push_str(&row(
        "Interest income",
        money_opt(is.interest_income.as_ref()),
        "",
        true,
    ));
    h.push_str(&row(
        "Interest expense",
        money_opt(is.interest_expense.as_ref()),
        "",
        true,
    ));
    h.push_str(&row(
        "Net interest",
        money_opt(is.net_interest.as_ref()),
        "sub",
        false,
    ));
    h.push_str(&row(
        "Earnings before tax",
        money_opt(is.earnings_before_tax.as_ref()),
        "sub",
        false,
    ));
    h.push_str(&row(
        "Income tax expense",
        money(&is.income_tax_expense),
        "",
        true,
    ));
    h.push_str(&row(
        "NET INCOME (LOSS)",
        money_opt(is.net_income.as_ref()),
        "tot",
        false,
    ));
    h.push_str("</table>");
    if let Some(reason) = &is.withheld_reason {
        h.push_str(&format!(
            "<p class=\"withheld-note\">Withheld: {}</p>",
            esc(reason)
        ));
    }
    h.push_str("</section>");

    // ── Debt schedule ──
    h.push_str("<section class=\"page\"><h3>Schedule of Interest-Bearing Obligations</h3>");
    h.push_str(&format!(
        "<div class=\"cap\">Accrued from {} to {}</div>",
        esc(&s.debt_schedule.basis_date),
        esc(&s.debt_schedule.as_of_date)
    ));
    h.push_str(
        "<table class=\"grid\"><thead><tr>\
         <th>Obligation</th><th>Creditor</th><th class=\"num\">Principal</th>\
         <th>Rate basis</th><th class=\"num\">All-in</th><th class=\"num\">Days</th>\
         <th class=\"num\">Accrued</th><th class=\"num\">Total owed</th></tr></thead><tbody>",
    );
    for o in &s.debt_schedule.obligations {
        let basis = match (&o.rate_index, &o.day_count) {
            (Some(i), Some(d)) => format!("{i} {}", d),
            _ => WITHHELD.to_string(),
        };
        h.push_str(&format!(
            "<tr><td>{}<div class=\"tiny\">{}</div></td><td>{}</td><td class=\"num\">{}</td>\
             <td>{}</td><td class=\"num\">{}</td><td class=\"num\">{}</td>\
             <td class=\"num\">{}</td><td class=\"num\">{}</td></tr>",
            esc(&o.ledger_line),
            esc(&o.authority),
            esc(&o.creditor),
            esc(&money(&o.principal)),
            esc(&basis),
            esc(
                &o.all_in_percent
                    .as_ref()
                    .map(|d| format!("{}%", d))
                    .unwrap_or_else(|| WITHHELD.into())
            ),
            o.days_accrued,
            esc(&money_opt(o.accrued_interest.as_ref())),
            esc(&money_opt(o.total_owed.as_ref())),
        ));
    }
    for n in &s.debt_schedule.non_interest_bearing {
        h.push_str(&format!(
            "<tr><td>{}<div class=\"tiny\">Declared non-interest-bearing by {}</div></td>\
             <td>—</td><td class=\"num\">{}</td><td>n/a</td><td class=\"num\">—</td>\
             <td class=\"num\">0</td><td class=\"num\">0.00</td><td class=\"num\">{}</td></tr>",
            esc(&n.ledger_line),
            esc(&n.declared_by),
            esc(&money(&n.principal)),
            esc(&money(&n.principal)),
        ));
    }
    h.push_str(&format!(
        "</tbody><tfoot><tr><td colspan=\"2\">Totals</td><td class=\"num\">{}</td>\
         <td colspan=\"3\"></td><td class=\"num\">{}</td><td class=\"num\">{}</td></tr></tfoot></table>",
        esc(&money(&s.debt_schedule.total_principal)),
        esc(&money_opt(s.debt_schedule.total_accrued_interest.as_ref())),
        esc(&money_opt(s.debt_schedule.total_owed.as_ref())),
    ));
    h.push_str("</section>");

    // ── Income schedule ──
    h.push_str("<section class=\"page\"><h3>Schedule of Interest-Earning Assets</h3>");
    h.push_str(
        "<table class=\"grid\"><thead><tr>\
         <th>Asset</th><th>Obligor</th><th class=\"num\">Principal</th>\
         <th>Rate basis</th><th class=\"num\">All-in</th><th class=\"num\">Days</th>\
         <th class=\"num\">Accrued income</th></tr></thead><tbody>",
    );
    for a in &s.income_schedule.assets {
        h.push_str(&format!(
            "<tr><td>{}<div class=\"tiny\">{}</div></td><td>{}</td><td class=\"num\">{}</td>\
             <td>{} {}</td><td class=\"num\">{}</td><td class=\"num\">{}</td><td class=\"num\">{}</td></tr>",
            esc(&a.ledger_line),
            esc(&a.authority),
            esc(&a.obligor),
            esc(&money(&a.principal)),
            esc(&a.rate_index),
            esc(&a.day_count),
            esc(
                &a.all_in_percent
                    .as_ref()
                    .map(|d| format!("{}%", d))
                    .unwrap_or_else(|| WITHHELD.into())
            ),
            a.days_accrued,
            esc(&money_opt(a.accrued_income.as_ref())),
        ));
    }
    h.push_str(&format!(
        "</tbody><tfoot><tr><td colspan=\"2\">Totals</td><td class=\"num\">{}</td>\
         <td colspan=\"3\"></td><td class=\"num\">{}</td></tr></tfoot></table>",
        esc(&money(&s.income_schedule.total_principal)),
        esc(&money_opt(s.income_schedule.total_accrued_income.as_ref())),
    ));
    if !s.income_schedule.non_earning_assets.is_empty() {
        h.push_str(&format!(
            "<p class=\"foot-note\">Declared non-earning and deliberately excluded from the accrual: {}.</p>",
            esc(&s.income_schedule.non_earning_assets.join("; "))
        ));
    }
    h.push_str("</section>");

    // ── Notes ──
    h.push_str("<section class=\"page\"><h3>Notes to the Financial Statements</h3>");
    h.push_str("<h4>1. Basis of preparation</h4><ol class=\"notes\">");
    for m in &s.methodology {
        h.push_str(&format!("<li>{}</li>", esc(m)));
    }
    h.push_str("</ol>");

    h.push_str("<h4>2. Reference rates applied</h4>");
    h.push_str(
        "<table class=\"grid\"><thead><tr><th>Rate</th><th class=\"num\">Percent</th>\
         <th>Effective</th><th>Publisher</th><th>Status</th></tr></thead><tbody>",
    );
    for q in &s.rates.quotes {
        h.push_str(&format!(
            "<tr><td>{}<div class=\"tiny\">{}</div></td><td class=\"num\">{}</td><td>{}</td><td>{}</td><td>{}</td></tr>",
            esc(&q.label),
            esc(&q.url),
            esc(
                &q.percent
                    .as_ref()
                    .map(|d| format!("{}%", d))
                    .unwrap_or_else(|| WITHHELD.into())
            ),
            esc(q.effective_date.as_deref().unwrap_or("—")),
            esc(&q.publisher),
            esc(q.status),
        ));
    }
    h.push_str("</tbody></table>");

    let g = &s.gold_revaluation;
    h.push_str("<h4>3. Bullion — unrecorded revaluation (memo)</h4>");
    h.push_str(&format!(
        "<table class=\"fin\">{}{}{}{}{}</table><p class=\"foot-note\">{}</p>",
        row("Fine gold (troy ounces)", g.fine_gold_ounces.to_string(), "", true),
        row("Carrying value", money(&g.carrying_value), "", true),
        row(
            "Live fair market value",
            money_opt(g.live_fair_market_value.as_ref()),
            "",
            true
        ),
        row(
            "Unrecorded revaluation surplus",
            money_opt(g.revaluation_surplus.as_ref()),
            "sub",
            false
        ),
        g.error
            .as_ref()
            .map(|e| row("Source error", e.clone(), "", true))
            .unwrap_or_default(),
        esc(&g.treatment),
    ));

    let mut note_no = 4;
    if !s.void_instruments.is_empty() {
        h.push_str(&format!(
            "<h4>{note_no}. Instruments struck — void ab initio</h4>\
             <p class=\"foot-note\">Declared never to have existed. Removed from the workbook, the terms file and \
             every listing and total in this package — not carried at nil, and not carried unpriced. Nothing below is \
             posted; it is disclosed so the removal is on the record.</p>"
        ));
        for v in &s.void_instruments {
            h.push_str(&format!(
                "<div class=\"void\"><div class=\"void-head\"><span>{}</span><span class=\"struck\">{}</span></div>\
                 <p>{}</p><p><em>Offsetting credit → {}.</em> {}</p>{}\
                 <div class=\"tiny\">{} · declared by {} · {} · former section: {}</div></div>",
                esc(&v.label),
                esc(&money(&v.struck_amount)),
                esc(&v.basis),
                esc(&v.offsetting_credit),
                esc(&v.offsetting_credit_basis),
                v.collateral_edits
                    .iter()
                    .map(|e| format!("<p class=\"tiny\">{}</p>", esc(e)))
                    .collect::<String>(),
                esc(&v.declaration),
                esc(&v.declared_by),
                esc(&v.declared_on),
                esc(&v.former_section),
            ));
        }
        note_no += 1;
    }

    h.push_str(&format!("<h4>{note_no}. Reconciliations</h4>"));
    h.push_str(
        "<table class=\"grid\"><thead><tr><th>Check</th><th>Assertion</th>\
         <th class=\"num\">Expected</th><th class=\"num\">Actual</th><th>Result</th></tr></thead><tbody>",
    );
    for c in &s.checks {
        h.push_str(&format!(
            "<tr><td class=\"mono\">{}</td><td>{}</td><td class=\"num mono\">{}</td>\
             <td class=\"num mono\">{}</td><td class=\"{}\">{}</td></tr>",
            esc(c.id),
            esc(&c.description),
            esc(&c.expected),
            esc(&c.actual),
            if c.pass { "pass" } else { "fail" },
            if c.pass { "PASS" } else { "FAIL" },
        ));
    }
    h.push_str("</tbody></table>");
    h.push_str("</section>");

    // ── Trial balance ──
    h.push_str("<section class=\"page\"><h3>Trial Balance — Auditor's Listing</h3>");
    h.push_str(&format!(
        "<div class=\"cap\">As at {} · a working paper, not a GAAP statement</div>",
        esc(&s.as_of_date)
    ));
    h.push_str(
        "<table class=\"grid\"><thead><tr><th>Code</th><th>Account</th><th>Class</th>\
         <th>Source</th><th>Authority / basis</th><th class=\"num\">Debit</th>\
         <th class=\"num\">Credit</th></tr></thead><tbody>",
    );
    for a in &s.trial_balance.accounts {
        h.push_str(&format!(
            "<tr><td class=\"mono\">{}</td><td>{}</td><td>{}</td><td class=\"tiny\">{}</td>\
             <td class=\"tiny\">{}</td><td class=\"num\">{}</td><td class=\"num\">{}</td></tr>",
            esc(&a.code),
            esc(&a.account),
            esc(a.classification),
            esc(&a.source),
            esc(a.authority.as_deref().unwrap_or("—")),
            esc(&a.debit.as_ref().map(money).unwrap_or_default()),
            esc(&a.credit.as_ref().map(money).unwrap_or_default()),
        ));
    }
    h.push_str(&format!(
        "</tbody><tfoot><tr><td colspan=\"5\">TOTALS</td><td class=\"num\">{}</td>\
         <td class=\"num\">{}</td></tr></tfoot></table>",
        esc(&money_opt(s.trial_balance.total_debits.as_ref())),
        esc(&money_opt(s.trial_balance.total_credits.as_ref())),
    ));
    if let Some(reason) = &s.trial_balance.incomplete_reason {
        h.push_str(&format!(
            "<p class=\"withheld-note\">Foot withheld: {}</p>",
            esc(reason)
        ));
    }
    h.push_str("</section>");

    // ── Signature block ──
    h.push_str(&format!(
        r#"<section class="page sig">
  <h3>Certification and Release</h3>
  <p>The undersigned confirm that this package was compiled from the records of the estate and released for the
  purpose stated below. This page carries no assurance opinion; see the Notice to Reader.</p>
  <table class="siglines">
    <tr><td>Prepared by</td><td class="line"></td><td>Date</td><td class="line short"></td></tr>
    <tr><td>Reviewed by</td><td class="line"></td><td>Date</td><td class="line short"></td></tr>
    <tr><td>Released to</td><td class="line"></td><td>Purpose</td><td class="line short"></td></tr>
  </table>
  <table class="meta">
    <tr><td>Entity</td><td>{entity}</td></tr>
    <tr><td>Statement date</td><td>{as_of_date}</td></tr>
    <tr><td>Rendered at</td><td>{rendered}</td></tr>
    <tr><td>Computation digest (SHA-256)</td><td class="mono">{digest}</td></tr>
  </table>
  <p class="foot-note">A recipient can verify they hold the same computation by comparing this digest against the one
  printed on the cover of their copy.</p>
</section>"#,
        entity = esc(&entity),
        as_of_date = esc(&s.as_of_date),
        rendered = esc(&s.as_of),
        digest = esc(&digest),
    ));

    let print_script = if auto_print {
        "<script>window.addEventListener('load',function(){window.print();});</script>"
    } else {
        ""
    };

    format!(
        r#"<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>{title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  @page {{ size: letter portrait; margin: 18mm 14mm 16mm 14mm; }}
  :root {{ --ink:#111; --muted:#555; --line:#c9c4b8; --accent:#8a6d20; }}
  * {{ box-sizing: border-box; }}
  body {{
    font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif;
    color: var(--ink); background:#fff; margin:0 auto; padding:24px; max-width: 210mm;
    font-size: 11pt; line-height: 1.45;
  }}
  h1 {{ font-size: 20pt; letter-spacing: .06em; margin:.2em 0 0; text-transform: uppercase; }}
  h2 {{ font-size: 14pt; font-weight: normal; letter-spacing:.14em; text-transform: uppercase; margin:.9em 0 .2em; }}
  h3 {{ font-size: 12.5pt; letter-spacing:.10em; text-transform: uppercase; margin:0 0 .1em;
        border-bottom: 1.5px solid var(--ink); padding-bottom: 4px; }}
  h4 {{ font-size: 11pt; margin: 1.4em 0 .4em; letter-spacing:.04em; }}
  .cover {{ text-align:center; margin-bottom: 26px; }}
  .cover .sub {{ color: var(--muted); font-size: 10pt; letter-spacing:.05em; }}
  .cover .asof {{ font-size: 12pt; margin-top:.3em; }}
  .cover .period, .cover .units {{ color: var(--muted); font-size: 10pt; }}
  .cover .stamp {{ display:inline-block; margin-top:10px; padding:3px 14px; border:1.5px solid #b00;
                   color:#b00; letter-spacing:.28em; font-size:10pt; }}
  .rule {{ border-top: 2px solid var(--ink); margin: 10px 0; }}
  .notice {{ border:1px solid var(--line); padding:14px 16px; margin-bottom: 22px; background:#fbfaf7; }}
  .notice h3 {{ border:0; padding:0; margin-bottom:.4em; }}
  .notice p {{ margin:.5em 0; font-size:10pt; }}
  .cap {{ color: var(--muted); font-size: 9.5pt; margin: 4px 0 10px; font-style: italic; }}
  table {{ width:100%; border-collapse: collapse; }}
  table.fin td {{ padding: 3px 0; }}
  table.fin td.num {{ text-align: right; font-variant-numeric: tabular-nums;
                      font-family: "SFMono-Regular", Menlo, Consolas, monospace; font-size: 10pt; white-space: nowrap; }}
  table.fin td.lbl.ind {{ padding-left: 18px; }}
  table.fin tr.sec td {{ padding-top: 14px; font-weight:700; letter-spacing:.12em; font-size:10pt;
                         border-bottom:1px solid var(--ink); }}
  table.fin tr.grp td {{ padding-top: 10px; font-style: italic; color: var(--muted); font-size:10pt; }}
  table.fin tr.sub td {{ border-top:1px solid var(--line); font-weight:600; }}
  table.fin tr.tot td {{ border-top:1.5px solid var(--ink); border-bottom:3px double var(--ink);
                         font-weight:700; padding: 5px 0; }}
  table.grid {{ font-size: 9pt; margin-top:6px; }}
  table.grid th {{ text-align:left; border-bottom:1.5px solid var(--ink); padding:4px 6px;
                   letter-spacing:.06em; text-transform:uppercase; font-size:8pt; }}
  table.grid td {{ border-bottom:1px solid #e6e2d8; padding:4px 6px; vertical-align: top; }}
  table.grid th.num, table.grid td.num {{ text-align:right; font-variant-numeric: tabular-nums; white-space:nowrap; }}
  table.grid tfoot td {{ border-top:1.5px solid var(--ink); border-bottom:3px double var(--ink); font-weight:700; }}
  table.meta td {{ padding:2px 8px 2px 0; font-size:9pt; vertical-align:top; }}
  table.meta td:first-child {{ color: var(--muted); width: 38%; }}
  .mono {{ font-family: "SFMono-Regular", Menlo, Consolas, monospace; font-size: 8.5pt; word-break: break-all; }}
  .tiny {{ font-size: 8pt; color: var(--muted); }}
  .foot-note {{ font-size: 9pt; color: var(--muted); margin-top: 10px; font-style: italic; }}
  .withheld-note {{ font-size: 9.5pt; color:#8a5a00; margin-top:10px; }}
  .wh {{ color:#8a5a00; font-weight:600; }}
  .pass {{ color:#1a6b32; font-weight:700; }}
  .fail {{ color:#b00; font-weight:700; }}
  .void {{ border:1px solid var(--line); padding:10px 12px; margin:10px 0; }}
  .void-head {{ display:flex; justify-content:space-between; font-weight:700; }}
  .void-head .struck {{ text-decoration: line-through; color:#b00; }}
  .void p {{ margin:.4em 0; font-size:9.5pt; }}
  ol.notes li {{ margin:.4em 0; font-size:10pt; }}
  .siglines td {{ padding: 16px 8px 4px 0; font-size:10pt; }}
  .siglines td.line {{ border-bottom:1px solid var(--ink); width:34%; }}
  .siglines td.line.short {{ width:18%; }}
  section.page {{ margin-top: 26px; }}
  @media print {{
    body {{ padding:0; max-width:none; }}
    section.page {{ break-before: page; page-break-before: always; margin-top:0; }}
    .notice {{ break-inside: avoid; }}
    table.grid tr, .void {{ break-inside: avoid; }}
    a {{ color: inherit; text-decoration: none; }}
  }}
</style></head>
<body>{body}
<footer class="foot-note">{entity} · Financial Statement Package · as at {as_of} · UNAUDITED · digest {short}</footer>
{print_script}
</body></html>"#,
        title = esc(&format!(
            "{entity} — Financial Statement Package — {}",
            s.as_of_date
        )),
        body = h,
        entity = esc(&entity),
        as_of = esc(&s.as_of_date),
        short = esc(&digest[..16]),
        print_script = print_script,
    )
}

// ── Handlers ─────────────────────────────────────────────────────────────

pub async fn export_statements_html(
    State(_state): State<AppState>,
    Query(q): Query<ExportQuery>,
) -> Result<Response, AppError> {
    let s = build_statements(flag(&q.refresh)).await?;
    let body = statements_html(&s, flag(&q.print));
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8".to_string()),
            (header::CACHE_CONTROL, "no-store".to_string()),
        ],
        body,
    )
        .into_response())
}

pub async fn export_statements_csv(
    State(_state): State<AppState>,
    Query(q): Query<ExportQuery>,
) -> Result<Response, AppError> {
    let s = build_statements(flag(&q.refresh)).await?;
    let filename = format!("capomastro-statements-{}.csv", s.as_of_date);
    Ok(attachment(
        statements_csv(&s),
        "text/csv; charset=utf-8",
        filename,
    ))
}

pub async fn export_trial_balance_csv(
    State(_state): State<AppState>,
    Query(q): Query<ExportQuery>,
) -> Result<Response, AppError> {
    let s = build_statements(flag(&q.refresh)).await?;
    let filename = format!("capomastro-trial-balance-{}.csv", s.as_of_date);
    Ok(attachment(
        trial_balance_csv(&s),
        "text/csv; charset=utf-8",
        filename,
    ))
}

pub async fn export_ledger_csv(State(_state): State<AppState>) -> Result<Response, AppError> {
    let ledger = super::ledger_live()?;
    Ok(attachment(
        ledger_csv(&ledger),
        "text/csv; charset=utf-8",
        "capomastro-gaap-ledger.csv".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn money_groups_and_brackets() {
        assert_eq!(money(&Dec::parse("1250000000").unwrap()), "1,250,000,000.00");
        assert_eq!(money(&Dec::parse("0").unwrap()), "0.00");
        assert_eq!(money(&Dec::parse("999").unwrap()), "999.00");
        assert_eq!(money(&Dec::parse("1000").unwrap()), "1,000.00");
        // Negatives bracket rather than sign: a minus is missed in a column.
        assert_eq!(money(&Dec::parse("-8096375").unwrap()), "(8,096,375.00)");
    }

    #[test]
    fn a_withheld_figure_is_never_blank_or_zero() {
        assert_eq!(money_opt(None), "[WITHHELD]");
        assert_eq!(exact_opt(None), "[WITHHELD]");
        assert_ne!(money_opt(None), "0.00");
        assert!(money_opt(None) != String::new());
    }

    #[test]
    fn csv_cells_survive_commas_and_quotes() {
        assert_eq!(csv_cell("plain"), "plain");
        assert_eq!(csv_cell("a,b"), "\"a,b\"");
        assert_eq!(csv_cell("say \"hi\""), "\"say \"\"hi\"\"\"");
        // A note containing a newline must not split the row.
        assert_eq!(csv_cell("one\ntwo"), "\"one\ntwo\"");
    }

    #[test]
    fn formula_leading_text_is_defused_but_money_stays_a_number() {
        // A tampered label must not execute in the auditor's spreadsheet.
        assert_eq!(csv_cell("=cmd|'/c calc'!A1"), "\"'=cmd|'/c calc'!A1\"");
        assert_eq!(csv_cell("+1+1"), "'+1+1");
        assert_eq!(csv_cell("@SUM(A1)"), "'@SUM(A1)");
        assert_eq!(csv_cell("-cmd"), "'-cmd");
        // Whitespace before the sigil is the same attack against any importer
        // that trims before parsing.
        assert_eq!(csv_cell(" =cmd"), "' =cmd");
        assert_eq!(csv_cell("\t@SUM(A1)"), "\"'\t@SUM(A1)\"");
        assert_eq!(csv_cell("\u{0b}=cmd"), "'\u{0b}=cmd");
        // …but a negative figure is a number, not an attack: defusing it would
        // make the column unaddable, which is the whole point of a CSV export.
        assert_eq!(csv_cell("-8096375.00"), "-8096375.00");
        assert_eq!(csv_cell("1250000000.00"), "1250000000.00");
        assert_eq!(csv_cell(" -8096375.00"), " -8096375.00");
        assert!(is_plain_number("-0.01"));
        assert!(!is_plain_number("-"));
        assert!(!is_plain_number("-1-1"));
        assert!(!is_plain_number("1.2.3"));
        assert!(!is_plain_number("=1"));
    }

    #[test]
    fn html_escaping_closes_the_injection_path() {
        // Labels and notes come from JSON on disk, so they are escaped rather
        // than trusted: a document of record must not execute anything.
        assert_eq!(esc("<script>x</script>"), "&lt;script&gt;x&lt;/script&gt;");
        assert_eq!(esc("Tom & \"Jerry\""), "Tom &amp; &quot;Jerry&quot;");
    }
}
