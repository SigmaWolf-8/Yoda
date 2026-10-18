//! Collections — turning a receivable on the balance sheet into a demand a
//! debtor can actually pay.
//!
//! The estate's interest-earning positions are money other parties hold. Their
//! principal is read from the Balance Sheet and their accrued interest is
//! computed live against a published reference rate, exactly as on the
//! statements page. This module takes one of those positions and issues a
//! formal demand for payment through Stripe: a real invoice, with a hosted
//! payment page, addressed to a named debtor.
//!
//! Four rules govern it.
//!
//! **The amount is never re-derived here.** Outstanding comes from the same
//! live computation that foots the statements. A collections page quoting a
//! figure the statements do not show would be a second set of books.
//!
//! **A demand is capped by what is actually owed.** The operator chooses how
//! much of the position to call now — a demand can be partial, and often must
//! be — but never more than the position stands at.
//!
//! **The rail's limits are disclosed, not worked around.** Stripe cannot carry
//! a charge above $999,999.99. A balance in the billions is not rounded down,
//! silently split, or quietly refused: the page states the ceiling, the demand
//! is raised as a payment on account, and the invoice itself records the full
//! outstanding figure it is drawn against.
//!
//! **Payment state is never stored.** Whether an invoice is open, paid or void
//! is read from Stripe on every request. Copying it into this database would
//! create a record that can disagree with the processor, and the disagreement
//! would always be discovered at the worst moment.

use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

use super::dec::{Dec, DecError};
use super::statements::{self, EarningAsset};
use super::stripe;
use crate::error::AppError;
use crate::state::AppState;

/// Decimal arithmetic that fails here is a bug in the figures, not in the
/// caller's request: it becomes an internal error carrying the exact reason.
fn arith(e: DecError) -> AppError {
    AppError::Internal(format!("collections arithmetic: {e}"))
}

/// AppError carries its message in its variant rather than through `Display`,
/// so an error being *reported inside a payload* (rather than returned) has to
/// be unwrapped explicitly.
fn reason(e: &AppError) -> String {
    match e {
        AppError::Validation(m)
        | AppError::Unauthorized(m)
        | AppError::Forbidden(m)
        | AppError::NotFound(m)
        | AppError::Conflict(m)
        | AppError::Internal(m)
        | AppError::Unavailable(m) => m.clone(),
        AppError::Database(e) => format!("database: {e}"),
    }
}

/// A demand must name a payer, and the payer must be reachable: Stripe sends
/// the invoice by email and hosts the payment page behind that address.
const MAX_EMAIL: usize = 320;
const MAX_MEMO: usize = 500;
const MAX_NAME: usize = 200;

// ── The register ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Register {
    pub as_of: String,
    pub basis_date: String,
    pub days_accrued: i64,
    /// `live` or `test`, read from the connected key. An operator must never
    /// have to guess which account a demand just went out on.
    pub stripe_mode: String,
    /// Present when Stripe could not be reached at all. The positions and their
    /// figures are still served — the ledger does not depend on the processor.
    pub stripe_error: Option<String>,
    pub max_demand_usd: String,
    pub positions: Vec<Position>,
    pub totals: Totals,
    /// Invoices standing on the estate's Stripe account that this register did
    /// not raise — earlier demands, dashboard invoices, other tooling.
    pub external_demands: Vec<ExternalDemand>,
    /// What those invoices come to, per currency. Never folded into `totals`,
    /// which is USD and drawn from the ledger's own positions.
    pub external_totals: Vec<CurrencyTotal>,
    /// Set when the account could not be read. The absence of external demands
    /// is then unknown, not zero, and the page says so.
    pub external_error: Option<String>,
    /// False when the account holds more invoices than this read walked, so the
    /// list above is a prefix rather than the whole account.
    pub external_complete: bool,
    pub notes: Vec<&'static str>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub principal: String,
    /// Withheld when any position's accrual could not be computed — a total
    /// that silently omits an unpriced leg is a wrong total.
    pub outstanding: Option<String>,
    pub demanded: String,
    pub paid: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Position {
    pub id: String,
    pub ledger_line: String,
    pub obligor: String,
    pub instrument: String,
    pub authority: String,
    pub principal: String,
    pub rate_index: String,
    pub all_in_percent: Option<String>,
    pub day_count: String,
    pub days_accrued: i64,
    pub accrued_interest: Option<String>,
    /// principal + accrued interest. `None` when the rate source failed, in
    /// which case only the principal is demandable and the page says so.
    pub outstanding: Option<String>,
    /// `accruing` | `rate_unavailable`.
    pub status: String,
    pub note: Option<String>,
    pub basis: String,
    /// What this rail can carry against this position right now.
    pub demandable_now: String,
    pub demands: Vec<DemandRecord>,
    pub demanded_total: String,
    pub paid_total: String,
}

/// One issued demand, as this database recorded it, married to the invoice's
/// live state in Stripe.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DemandRecord {
    pub id: String,
    pub issued_at: String,
    pub debtor_email: String,
    pub debtor_name: Option<String>,
    pub amount: String,
    pub outstanding_at_issue: String,
    pub memo: Option<String>,
    pub stripe_invoice_id: Option<String>,
    pub hosted_invoice_url: Option<String>,
    pub invoice_pdf: Option<String>,
    pub number: Option<String>,
    /// This row's own state: `pending` | `issued` | `failed`.
    pub state: String,
    pub failure_reason: Option<String>,
    /// Stripe's state for the invoice: `open` | `paid` | `void` | `uncollectible`
    /// | `draft`. `None` when Stripe could not be reached — never assumed.
    pub invoice_status: Option<String>,
    pub amount_paid: Option<String>,
    pub amount_due: Option<String>,
    pub invoice_error: Option<String>,
    /// `sent`, `not_confirmed`, or `None` for a demand that never reached the
    /// point of delivery.
    pub delivery: Option<String>,
    pub delivery_error: Option<String>,
    /// What the estate's own records say about settlement, posted by the
    /// Stripe webhook the moment the event landed: `paid` | `payment_failed`
    /// | `voided` | `uncollectible`, or `None` when no event has arrived.
    /// This is the register's answer when Stripe cannot be asked live.
    pub settlement_state: Option<String>,
    /// When the settling event says it happened — Stripe's clock, not ours.
    pub settled_at: Option<String>,
    pub settled_amount: Option<String>,
}

/// GET /api/capomastro/collections
pub async fn get_register(State(state): State<AppState>) -> Result<Json<Register>, AppError> {
    let statements = statements::build_statements(false).await?;
    let schedule = &statements.income_schedule;

    let (mode, stripe_error) = match stripe::mode(&state.http_client).await {
        Ok(m) => (m.to_string(), None),
        Err(e) => ("unknown".to_string(), Some(reason(&e))),
    };

    let rows = sqlx::query(
        "SELECT id, position_id, ledger_line, obligor, outstanding_usd, demanded_cents, \
                debtor_email, debtor_name, memo, stripe_invoice_id, hosted_invoice_url, \
                state, failure_reason, delivery_state, delivery_error, created_at, \
                settlement_state, settled_at, settled_amount_cents \
           FROM collections_demands \
          ORDER BY created_at DESC",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| AppError::Internal(format!("reading the demand register: {e}")))?;

    // Invoices this register raised are shown against their position; the rest
    // of the account is reported separately, so "demanded to date" counts what
    // the estate has actually served, not merely what this page issued.
    let ours: std::collections::HashSet<String> = rows
        .iter()
        .filter_map(|r| r.get::<Option<String>, _>("stripe_invoice_id"))
        .collect();
    let our_demand_ids: std::collections::HashSet<String> = rows
        .iter()
        .map(|r| r.get::<Uuid, _>("id").to_string())
        .collect();
    let (external, external_totals, external_error, external_complete) =
        match external_demands(&state, &ours, &our_demand_ids).await {
            Ok((d, t, truncated)) => (d, t, None, !truncated),
            Err(e) => (Vec::new(), Vec::new(), Some(reason(&e)), false),
        };

    let mut positions = Vec::new();
    let mut principal_total = Dec::parse("0").map_err(arith)?;
    let mut outstanding_total = Some(Dec::parse("0").map_err(arith)?);
    let mut demanded_total_all = Dec::parse("0").map_err(arith)?;
    let mut paid_total_all = Dec::parse("0").map_err(arith)?;

    for asset in &schedule.assets {
        let outstanding = outstanding_of(asset)?;
        principal_total = principal_total.add(&asset.principal).map_err(arith)?;
        outstanding_total = match (outstanding_total, &outstanding) {
            (Some(running), Some(o)) => Some(running.add(o).map_err(arith)?),
            _ => None,
        };

        let mut demands = Vec::new();
        let mut demanded = Dec::parse("0").map_err(arith)?;
        let mut paid = Dec::parse("0").map_err(arith)?;

        for row in rows.iter().filter(|r| {
            r.get::<String, _>("position_id") == asset.id
        }) {
            let record = hydrate(&state, row).await;
            let amount = Dec::parse(&record.amount).map_err(arith)?;
            // `pending` counts here exactly as it counts when a demand is
            // issued: an unconfirmed invoice holds its amount until Stripe
            // settles the question, so the page can never show more as callable
            // than the issuance path will actually allow.
            if record.state == "issued" || record.state == "pending" {
                demanded = demanded.add(&amount).map_err(arith)?;
            }
            // Stripe's live figure when it answered; the webhook-posted
            // settlement when it did not. The register can state that a
            // payment arrived without asking the processor.
            if let Some(p) = record.amount_paid.as_ref().or(record.settled_amount.as_ref()) {
                paid = paid.add(&Dec::parse(p).map_err(arith)?).map_err(arith)?;
            }
            demands.push(record);
        }

        demanded_total_all = demanded_total_all.add(&demanded).map_err(arith)?;
        paid_total_all = paid_total_all.add(&paid).map_err(arith)?;

        // What is still demandable: the outstanding less what has already gone
        // out, then clipped to the ceiling this rail can carry.
        let claimable = match &outstanding {
            Some(o) => o.sub(&demanded).map_err(arith)?,
            None => asset.principal.sub(&demanded).map_err(arith)?,
        };
        let demandable = clip_to_rail(&claimable)?;

        positions.push(Position {
            id: asset.id.clone(),
            ledger_line: asset.ledger_line.clone(),
            obligor: asset.obligor.clone(),
            instrument: asset.instrument.clone(),
            authority: asset.authority.clone(),
            principal: asset.principal.to_canonical(),
            rate_index: asset.rate_index.clone(),
            all_in_percent: asset.all_in_percent.as_ref().map(Dec::to_canonical),
            day_count: asset.day_count.clone(),
            days_accrued: asset.days_accrued,
            accrued_interest: asset.accrued_income.as_ref().map(Dec::to_canonical),
            outstanding: outstanding.as_ref().map(Dec::to_canonical),
            status: asset.status.to_string(),
            note: asset.note.clone(),
            basis: asset.basis.clone(),
            demandable_now: demandable.to_canonical(),
            demanded_total: demanded.to_canonical(),
            paid_total: paid.to_canonical(),
            demands,
        });
    }

    Ok(Json(Register {
        as_of: statements.as_of.clone(),
        basis_date: statements.basis_date.clone(),
        days_accrued: statements.days_elapsed,
        stripe_mode: mode,
        stripe_error,
        max_demand_usd: cents_to_dec(stripe::MAX_CHARGE_CENTS)?.to_canonical(),
        positions,
        totals: Totals {
            principal: principal_total.to_canonical(),
            outstanding: outstanding_total.as_ref().map(Dec::to_canonical),
            demanded: demanded_total_all.to_canonical(),
            paid: paid_total_all.to_canonical(),
        },
        external_demands: external,
        external_totals,
        external_error,
        external_complete,
        notes: vec![
            "Demands raised outside this register — from the Stripe dashboard or earlier tooling \
             — are read back from the account and listed in their own currency. They are never \
             folded into the USD totals above, which belong to the ledger's own positions.",
            "Principal is read from the Balance Sheet and interest is accrued live against the \
             published reference rate — the same computation the statements foot on.",
            "A demand is an invoice raised in Stripe against a named debtor, payable on receipt. \
             Its status here is read from Stripe on every request, never stored.",
            "Stripe cannot carry a single charge above $999,999.99. Larger balances are demanded \
             as payments on account, and each invoice records the full sum it is drawn against.",
            "Interest does not stop when a demand is issued: the position keeps accruing at the \
             stated index until it is settled.",
        ],
    }))
}

// ── Demands raised outside this register ─────────────────────────────────
//
// This page is not the only way an invoice reaches the estate's Stripe
// account: demands are also raised from the Stripe dashboard, by earlier
// tooling, or by hand. Counting only what this module created would report
// "nothing demanded" while real, payable invoices sit open against a debtor —
// the one lie a collections register must never tell.
//
// So the account itself is read. Every invoice Stripe holds is listed; those
// this register issued are recognised by id and shown against their position,
// and the rest are reported here as what they are: demands standing outside
// the ledger's own accounting.

/// Currencies Stripe carries with no minor unit at all — an amount of 1000 is
/// ¥1000, not ¥10.00. Dividing these by 100 would understate a demand
/// hundredfold.
const ZERO_DECIMAL: [&str; 16] = [
    "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv",
    "xaf", "xof", "xpf",
];

/// Stripe's minor units for a currency, as an exact decimal string.
fn minor_to_dec(amount: i64, currency: &str) -> Result<Dec, AppError> {
    if ZERO_DECIMAL.contains(&currency) {
        return Dec::parse(&amount.to_string()).map_err(arith);
    }
    cents_to_dec(amount)
}

/// An invoice on the account that this register did not raise.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalDemand {
    pub invoice_id: String,
    pub number: Option<String>,
    /// Stripe's own state: `open` | `paid` | `void` | `uncollectible` | `draft`.
    pub status: String,
    /// ISO 4217, upper case. Never mixed with another currency in a total.
    pub currency: String,
    pub amount: String,
    pub amount_paid: String,
    pub amount_due: String,
    pub created: String,
    pub due_date: Option<String>,
    pub debtor: Option<String>,
    pub description: Option<String>,
    pub hosted_invoice_url: Option<String>,
    pub invoice_pdf: Option<String>,
}

/// What has been demanded in one currency. Currencies are never summed
/// together: a CAD demand and a USD position are different claims, and adding
/// them would invent an exchange rate nobody agreed to.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrencyTotal {
    pub currency: String,
    /// Issued and still standing — `open`, `paid` and `uncollectible`. A void
    /// invoice was withdrawn and is not a demand; a draft was never served.
    pub demanded: String,
    pub paid: String,
    pub outstanding: String,
    pub voided: String,
    pub count: usize,
}

/// Read every invoice on the account, skipping the ones this register issued.
///
/// Bounded to five pages: the register is a working surface, not an archive,
/// and an unbounded walk would make the page slower the longer the estate
/// collects.
async fn external_demands(
    state: &AppState,
    ours: &std::collections::HashSet<String>,
    our_demand_ids: &std::collections::HashSet<String>,
) -> Result<(Vec<ExternalDemand>, Vec<CurrencyTotal>, bool), AppError> {
    let mut found: Vec<ExternalDemand> = Vec::new();
    let mut starting_after: Option<String> = None;
    // Set when the page cap is reached while Stripe still has more: the list
    // is then a prefix of the account, and saying otherwise would make an
    // unread invoice look like an absent one.
    let mut truncated = false;

    for page_no in 0..5 {
        let mut query = vec![("limit".to_string(), "100".to_string())];
        if let Some(cursor) = &starting_after {
            query.push(("starting_after".to_string(), cursor.clone()));
        }
        let page = stripe::get(&state.http_client, "invoices", &query).await?;
        let data = page
            .get("data")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if data.is_empty() {
            break;
        }
        let last = data
            .last()
            .and_then(|i| i.get("id"))
            .and_then(Value::as_str)
            .map(str::to_string);

        for inv in data {
            let Some(id) = inv.get("id").and_then(Value::as_str) else {
                continue;
            };
            // Ours already appears against its position, with its own audit
            // row. Recognition is by invoice id, or by a demand id this
            // database actually holds — a bare `demandId` in metadata proves
            // nothing, and trusting it would let any dashboard invoice hide
            // itself from the register by copying the key.
            let is_ours = ours.contains(id)
                || inv
                    .pointer("/metadata/demandId")
                    .and_then(Value::as_str)
                    .is_some_and(|d| our_demand_ids.contains(d));
            if is_ours {
                continue;
            }
            let currency = inv
                .get("currency")
                .and_then(Value::as_str)
                .unwrap_or("usd")
                .to_string();
            let minor = |field: &str| -> Result<String, AppError> {
                Ok(
                    minor_to_dec(inv.get(field).and_then(Value::as_i64).unwrap_or(0), &currency)?
                        .to_canonical(),
                )
            };

            found.push(ExternalDemand {
                invoice_id: id.to_string(),
                number: inv
                    .get("number")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                status: inv
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .to_string(),
                currency: currency.to_uppercase(),
                amount: minor("total")?,
                amount_paid: minor("amount_paid")?,
                amount_due: minor("amount_due")?,
                created: stamp(inv.get("created").and_then(Value::as_i64)),
                due_date: inv
                    .get("due_date")
                    .and_then(Value::as_i64)
                    .map(|t| stamp(Some(t))),
                debtor: inv
                    .get("customer_email")
                    .and_then(Value::as_str)
                    .or_else(|| inv.get("customer_name").and_then(Value::as_str))
                    .map(str::to_string),
                description: inv
                    .pointer("/lines/data/0/description")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                hosted_invoice_url: inv
                    .get("hosted_invoice_url")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                invoice_pdf: inv
                    .get("invoice_pdf")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            });
        }

        if !page.get("has_more").and_then(Value::as_bool).unwrap_or(false) {
            break;
        }
        if page_no == 4 {
            truncated = true;
            break;
        }
        match last {
            Some(cursor) => starting_after = Some(cursor),
            None => break,
        }
    }

    // Per-currency totals, in the order the currencies first appear.
    let mut totals: Vec<CurrencyTotal> = Vec::new();
    for d in &found {
        let slot = match totals.iter_mut().find(|t| t.currency == d.currency) {
            Some(existing) => existing,
            None => {
                totals.push(CurrencyTotal {
                    currency: d.currency.clone(),
                    demanded: "0.00".into(),
                    paid: "0.00".into(),
                    outstanding: "0.00".into(),
                    voided: "0.00".into(),
                    count: 0,
                });
                totals.last_mut().expect("just pushed")
            }
        };
        let add = |running: &str, addend: &str| -> Result<String, AppError> {
            Ok(Dec::parse(running)
                .map_err(arith)?
                .add(&Dec::parse(addend).map_err(arith)?)
                .map_err(arith)?
                .to_canonical())
        };
        match d.status.as_str() {
            "open" | "paid" | "uncollectible" => {
                slot.count += 1;
                slot.demanded = add(&slot.demanded, &d.amount)?;
                slot.paid = add(&slot.paid, &d.amount_paid)?;
                slot.outstanding = add(&slot.outstanding, &d.amount_due)?;
            }
            "void" => {
                slot.voided = add(&slot.voided, &d.amount)?;
            }
            // A draft was never served on anyone. It is listed, not counted.
            _ => {}
        }
    }

    Ok((found, totals, truncated))
}

/// A Stripe unix timestamp as an RFC 3339 string.
fn stamp(secs: Option<i64>) -> String {
    secs.and_then(|s| chrono::DateTime::from_timestamp(s, 0))
        .map(|t| t.to_rfc3339())
        .unwrap_or_default()
}

/// Marry a stored demand row to the invoice's live state in Stripe.
async fn hydrate(state: &AppState, row: &sqlx::postgres::PgRow) -> DemandRecord {
    let id: Uuid = row.get("id");
    let created: chrono::DateTime<chrono::Utc> = row.get("created_at");
    let cents: i64 = row.get("demanded_cents");
    let invoice_id: Option<String> = row.get("stripe_invoice_id");

    let amount = cents_to_dec(cents)
        .map(|d| d.to_canonical())
        .unwrap_or_else(|_| cents.to_string());

    let mut record = DemandRecord {
        id: id.to_string(),
        issued_at: created.to_rfc3339(),
        debtor_email: row.get("debtor_email"),
        debtor_name: row.get("debtor_name"),
        amount,
        outstanding_at_issue: row.get("outstanding_usd"),
        memo: row.get("memo"),
        stripe_invoice_id: invoice_id.clone(),
        hosted_invoice_url: row.get("hosted_invoice_url"),
        invoice_pdf: None,
        number: None,
        state: row.get("state"),
        failure_reason: row.get("failure_reason"),
        invoice_status: None,
        amount_paid: None,
        amount_due: None,
        invoice_error: None,
        delivery: row.get("delivery_state"),
        delivery_error: row.get("delivery_error"),
        settlement_state: row.get("settlement_state"),
        settled_at: row
            .get::<Option<chrono::DateTime<chrono::Utc>>, _>("settled_at")
            .map(|t| t.to_rfc3339()),
        settled_amount: row
            .get::<Option<i64>, _>("settled_amount_cents")
            .and_then(|c| cents_to_dec(c).ok())
            .map(|d| d.to_canonical()),
    };

    // A pending row with no invoice id is the one genuinely ambiguous state: the
    // demand was reserved, Stripe may or may not have created the invoice, and
    // the acknowledgement never arrived. Every invoice this module raises
    // carries its demand id in metadata, so Stripe itself can settle the
    // question — and until it does, the reservation stands.
    let invoice_id = match invoice_id {
        Some(existing) => existing,
        None if record.state == "pending" => match recover_invoice(state, &id).await {
            Ok(Some(found)) => {
                record.stripe_invoice_id = Some(found.clone());
                found
            }
            Ok(None) => return record,
            Err(e) => {
                record.invoice_error = Some(reason(&e));
                return record;
            }
        },
        None => return record,
    };

    match stripe::get(&state.http_client, &format!("invoices/{invoice_id}"), &[]).await {
        Ok(invoice) => {
            record.invoice_status = invoice
                .get("status")
                .and_then(Value::as_str)
                .map(str::to_string);
            record.number = invoice
                .get("number")
                .and_then(Value::as_str)
                .map(str::to_string);
            record.invoice_pdf = invoice
                .get("invoice_pdf")
                .and_then(Value::as_str)
                .map(str::to_string);
            if let Some(url) = invoice.get("hosted_invoice_url").and_then(Value::as_str) {
                record.hosted_invoice_url = Some(url.to_string());
            }
            record.amount_paid = invoice
                .get("amount_paid")
                .and_then(Value::as_i64)
                .and_then(|c| cents_to_dec(c).ok())
                .map(|d| d.to_canonical());
            record.amount_due = invoice
                .get("amount_due")
                .and_then(Value::as_i64)
                .and_then(|c| cents_to_dec(c).ok())
                .map(|d| d.to_canonical());
        }
        // The invoice exists; we simply could not ask about it. Saying so is the
        // whole point — an unreachable processor must not read as "unpaid".
        Err(e) => record.invoice_error = Some(reason(&e)),
    }

    record
}

/// Ask Stripe whether an invoice exists for a demand this database lost track
/// of, and record it if so.
///
/// This is the only path that writes an invoice id it did not itself create,
/// and it writes exactly what Stripe reports — it never invents one to close a
/// gap.
async fn recover_invoice(state: &AppState, id: &Uuid) -> Result<Option<String>, AppError> {
    let found = stripe::get(
        &state.http_client,
        "invoices/search",
        &[
            ("query".to_string(), format!("metadata['demandId']:'{id}'")),
            ("limit".to_string(), "1".to_string()),
        ],
    )
    .await?;

    let Some(invoice_id) = found
        .pointer("/data/0/id")
        .and_then(Value::as_str)
        .map(str::to_string)
    else {
        return Ok(None);
    };

    let status = found.pointer("/data/0/status").and_then(Value::as_str);
    // A recovered invoice that Stripe has finalised *is* an issued demand; a
    // draft one is not, and stays pending until something finishes or voids it.
    let state_now = if matches!(status, Some("open") | Some("paid") | Some("uncollectible")) {
        "issued"
    } else {
        "pending"
    };

    sqlx::query(
        "UPDATE collections_demands SET stripe_invoice_id=$2, state=$3, \
         hosted_invoice_url=COALESCE($4, hosted_invoice_url), updated_at=NOW() WHERE id=$1",
    )
    .bind(id)
    .bind(&invoice_id)
    .bind(state_now)
    .bind(
        found
            .pointer("/data/0/hosted_invoice_url")
            .and_then(Value::as_str),
    )
    .execute(&state.db)
    .await
    .map_err(|e| AppError::Internal(format!("recording the recovered invoice: {e}")))?;

    Ok(Some(invoice_id))
}

// ── Issuing a demand ─────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DemandRequest {
    pub debtor_email: String,
    pub debtor_name: Option<String>,
    /// Exact decimal USD. Omitted means "everything this rail can carry".
    pub amount: Option<String>,
    pub memo: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DemandIssued {
    pub id: String,
    pub position_id: String,
    pub amount: String,
    pub outstanding_at_issue: String,
    pub stripe_invoice_id: String,
    pub number: Option<String>,
    pub hosted_invoice_url: Option<String>,
    pub invoice_pdf: Option<String>,
    pub invoice_status: String,
    /// `sent` when Stripe confirmed it emailed the invoice, `not_confirmed`
    /// when the send call itself failed. The invoice is payable either way —
    /// but nobody is told it reached the debtor unless it did.
    pub delivery: &'static str,
    pub delivery_error: Option<String>,
    pub mode: String,
}

/// POST /api/capomastro/collections/{position_id}/demand
pub async fn issue_demand(
    State(state): State<AppState>,
    Path(position_id): Path<String>,
    Json(req): Json<DemandRequest>,
) -> Result<Json<DemandIssued>, AppError> {
    // ── The position, from the live computation ──────────────────────
    let statements = statements::build_statements(false).await?;
    let asset = statements
        .income_schedule
        .assets
        .iter()
        .find(|a| a.id == position_id)
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "no receivable position `{position_id}` — the estate's terms file declares none"
            ))
        })?;

    let email = req.debtor_email.trim().to_string();
    if email.len() > MAX_EMAIL || !email.contains('@') || email.contains(char::is_whitespace) {
        return Err(AppError::Validation(
            "a demand needs a valid email address: Stripe delivers the invoice and hosts the \
             payment page behind it"
                .into(),
        ));
    }
    if let Some(memo) = &req.memo {
        if memo.chars().count() > MAX_MEMO {
            return Err(AppError::Validation(format!(
                "the memo is longer than {MAX_MEMO} characters"
            )));
        }
    }
    if let Some(name) = &req.debtor_name {
        if name.chars().count() > MAX_NAME {
            return Err(AppError::Validation(format!(
                "the debtor name is longer than {MAX_NAME} characters"
            )));
        }
    }

    // ── Fail closed on an unpriced position ──────────────────────────
    // A demand is a legal claim for a specific sum. If the reference rate could
    // not be reached the interest leg is unknown, and an invoice that quietly
    // demands the principal alone understates the claim on paper the debtor
    // keeps. The position is not written down — it simply cannot be called
    // until the rate source answers.
    let ceiling_basis = outstanding_of(asset)?.ok_or_else(|| {
        AppError::Unavailable(format!(
            "`{}` cannot be demanded right now: its interest could not be priced ({}). The \
             principal is not the amount owed, so no invoice is raised until {} answers.",
            asset.ledger_line,
            asset.note.as_deref().unwrap_or("the reference rate is unavailable"),
            asset.rate_index,
        ))
    })?;

    // ── Reserve the amount, under a lock on this position ────────────
    // Two operators calling the same position at the same moment would each
    // read the same free balance and each raise an invoice for it. The reading
    // and the reservation therefore happen inside one transaction holding an
    // advisory lock keyed to the position, and the reservation is a `pending`
    // row that counts against the balance from the instant it is written.
    //
    // The lock is released at commit, before Stripe is called — it guards the
    // arithmetic, not the network round trip.
    let id = Uuid::new_v4();
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|e| AppError::Internal(format!("opening the demand transaction: {e}")))?;

    sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1))")
        .bind(&position_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| AppError::Internal(format!("locking the position: {e}")))?;

    // Pending counts as spoken for. A demand whose outcome at Stripe is unknown
    // holds its amount until it is reconciled — the alternative is demanding
    // the same money twice because the first invoice could not be recorded.
    let already: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(demanded_cents), 0)::BIGINT FROM collections_demands \
          WHERE position_id = $1 AND state IN ('pending', 'issued')",
    )
    .bind(&position_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| AppError::Internal(format!("reading prior demands: {e}")))?;
    let already_dec = cents_to_dec(already)?;
    let claimable = ceiling_basis.sub(&already_dec).map_err(arith)?;

    if claimable.is_zero() {
        return Err(AppError::Validation(format!(
            "`{}` is already fully spoken for ({} USD demanded or awaiting confirmation). Nothing \
             further is callable until more interest accrues or an invoice is withdrawn.",
            asset.ledger_line,
            already_dec.to_canonical()
        )));
    }
    if claimable.is_negative() {
        return Err(AppError::Validation(format!(
            "demands already standing against `{}` ({} USD) exceed what the position now stands \
             at ({} USD). Withdraw the surplus invoice before issuing another.",
            asset.ledger_line,
            already_dec.to_canonical(),
            ceiling_basis.to_canonical()
        )));
    }

    // ── The amount ───────────────────────────────────────────────────
    let amount = match req.amount.as_deref().map(str::trim) {
        Some(a) if !a.is_empty() => {
            let parsed = Dec::parse(a).map_err(|e| {
                AppError::Validation(format!("`{a}` is not an amount this ledger can carry: {e}"))
            })?;
            // Refused, not rounded. Rounding an operator's figure would demand a
            // sum nobody typed, and half a cent of it would be invented.
            if parsed.scale() > 2 {
                return Err(AppError::Validation(format!(
                    "{a} USD is finer than a cent. A demand is denominated in whole cents — the \
                     invoice cannot carry the rest."
                )));
            }
            parsed
        }
        // No amount named: call everything the rail can take, rounded *down* so
        // the default can never exceed what is actually callable.
        _ => clip_to_rail(&claimable)?,
    };

    if amount.is_zero() || amount.is_negative() {
        return Err(AppError::Validation(
            "a demand must be for a positive amount".into(),
        ));
    }
    if amount.cmp_dec(&claimable).map_err(arith)? == std::cmp::Ordering::Greater {
        return Err(AppError::Validation(format!(
            "cannot demand {} USD against `{}`: the position stands at {} USD and {} USD is \
             already demanded or awaiting confirmation, leaving {} USD callable.",
            amount.to_canonical(),
            asset.ledger_line,
            ceiling_basis.to_canonical(),
            already_dec.to_canonical(),
            claimable.to_canonical()
        )));
    }
    let cents = dec_to_cents(&amount)?;
    if cents > stripe::MAX_CHARGE_CENTS {
        return Err(AppError::Validation(format!(
            "{} USD is above the {} USD ceiling a single Stripe charge can carry. Issue it as a \
             payment on account: several demands may run against the same position, and each \
             invoice records the full sum it is drawn against.",
            amount.to_canonical(),
            cents_to_dec(stripe::MAX_CHARGE_CENTS)?.to_canonical()
        )));
    }

    let outstanding_str = ceiling_basis.to_canonical();
    sqlx::query(
        "INSERT INTO collections_demands \
            (id, position_id, ledger_line, obligor, outstanding_usd, demanded_cents, \
             debtor_email, debtor_name, memo, state) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')",
    )
    .bind(id)
    .bind(&position_id)
    .bind(&asset.ledger_line)
    .bind(&asset.obligor)
    .bind(&outstanding_str)
    .bind(cents)
    .bind(&email)
    .bind(&req.debtor_name)
    .bind(&req.memo)
    .execute(&mut *tx)
    .await
    .map_err(|e| AppError::Internal(format!("recording the demand: {e}")))?;

    tx.commit()
        .await
        .map_err(|e| AppError::Internal(format!("reserving the demand: {e}")))?;

    match raise_invoice(&state, &id, asset, &email, &req, cents, &ceiling_basis, &already_dec).await
    {
        Ok(issued) => Ok(Json(issued)),
        Err(e) => {
            // Two very different failures land here.
            //
            // Stripe *refusing* is definite: it read the request and declined,
            // so nothing payable exists and the row is closed as failed.
            //
            // Stripe *not answering* is not. A timeout can mean the invoice was
            // created and the acknowledgement was lost. Closing that row would
            // release the amount for a second demand while a real, payable
            // invoice sat at Stripe. It stays pending — still reserved, still
            // reconcilable — with the reason recorded against it.
            let definite = matches!(
                e,
                AppError::Validation(_) | AppError::NotFound(_) | AppError::Conflict(_)
            );
            let next_state = if definite { "failed" } else { "pending" };
            let _ = sqlx::query(
                "UPDATE collections_demands SET state=$2, failure_reason=$3, updated_at=NOW() \
                 WHERE id=$1",
            )
            .bind(id)
            .bind(next_state)
            .bind(reason(&e))
            .execute(&state.db)
            .await;
            Err(e)
        }
    }
}

/// Customer → invoice → line item → finalise. Every write carries an
/// idempotency key derived from this demand's own id, so a retried request
/// cannot raise a second invoice against the same debtor.
#[allow(clippy::too_many_arguments)]
async fn raise_invoice(
    state: &AppState,
    id: &Uuid,
    asset: &EarningAsset,
    email: &str,
    req: &DemandRequest,
    cents: i64,
    outstanding: &Dec,
    already: &Dec,
) -> Result<DemandIssued, AppError> {
    let http = &state.http_client;
    let mode = stripe::mode(http).await?;

    // ── The debtor ───────────────────────────────────────────────────
    // Reuse the customer if this address is already on the account: a debtor
    // with five duplicate customer records has five separate payment histories,
    // and none of them is the truth.
    let existing = stripe::get(
        http,
        "customers",
        &[
            ("email".into(), email.to_string()),
            ("limit".into(), "1".into()),
        ],
    )
    .await?;
    let customer_id = match existing
        .pointer("/data/0/id")
        .and_then(Value::as_str)
        .map(str::to_string)
    {
        Some(existing) => existing,
        None => {
            let mut form = vec![
                ("email".to_string(), email.to_string()),
                (
                    "description".to_string(),
                    format!("Debtor of Capomastro Holdings Ltd. — {}", asset.ledger_line),
                ),
                ("metadata[positionId]".to_string(), asset.id.clone()),
            ];
            if let Some(name) = req.debtor_name.as_deref().map(str::trim) {
                if !name.is_empty() {
                    form.push(("name".to_string(), name.to_string()));
                }
            }
            stripe::post(http, "customers", &form, &format!("{id}-customer"))
                .await?
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string)
                .ok_or_else(|| {
                    AppError::Unavailable("Stripe created a customer without an id".into())
                })?
        }
    };

    // ── The invoice ──────────────────────────────────────────────────
    // `send_invoice` with zero days: this is a demand, not an offer of terms.
    // The full outstanding travels in the footer and the metadata, so the paper
    // states what the payment is on account of.
    let rate = asset
        .all_in_percent
        .as_ref()
        .map(|r| format!("{}% ({})", r.to_canonical(), asset.rate_index))
        .unwrap_or_else(|| format!("{} — rate unavailable", asset.rate_index));
    let footer = format!(
        "Drawn against {} — {} USD outstanding as at {} ({} days accrued at {}, {} basis). \
         Previously demanded and unpaid: {} USD. Payable on receipt. Interest continues to accrue \
         until settlement. Authority: {}.",
        asset.ledger_line,
        outstanding.to_canonical(),
        chrono::Utc::now().format("%Y-%m-%d"),
        asset.days_accrued,
        rate,
        asset.day_count,
        already.to_canonical(),
        asset.authority,
    );

    let mut invoice_form = vec![
        ("customer".to_string(), customer_id.clone()),
        ("collection_method".to_string(), "send_invoice".to_string()),
        ("days_until_due".to_string(), "0".to_string()),
        ("currency".to_string(), "usd".to_string()),
        (
            "description".to_string(),
            format!(
                "Formal demand for payment — {} ({})",
                asset.ledger_line, asset.id
            ),
        ),
        ("footer".to_string(), footer),
        ("auto_advance".to_string(), "false".to_string()),
        ("metadata[positionId]".to_string(), asset.id.clone()),
        ("metadata[ledgerLine]".to_string(), asset.ledger_line.clone()),
        (
            "metadata[outstandingUsd]".to_string(),
            outstanding.to_canonical(),
        ),
        ("metadata[demandId]".to_string(), id.to_string()),
        (
            "metadata[estate]".to_string(),
            "Capomastro Holdings Ltd.".to_string(),
        ),
    ];
    if let Some(memo) = req.memo.as_deref().map(str::trim) {
        if !memo.is_empty() {
            invoice_form.push(("metadata[memo]".to_string(), memo.to_string()));
        }
    }

    let invoice = stripe::post(http, "invoices", &invoice_form, &format!("{id}-invoice")).await?;
    let invoice_id = invoice
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Unavailable("Stripe created an invoice without an id".into()))?
        .to_string();

    // Recorded before the line item and the finalisation, not after. From here
    // on the register can find this invoice at Stripe and read its true state
    // even if every later step fails.
    sqlx::query(
        "UPDATE collections_demands SET stripe_invoice_id=$2, stripe_customer_id=$3, \
         updated_at=NOW() WHERE id=$1",
    )
    .bind(id)
    .bind(&invoice_id)
    .bind(&customer_id)
    .execute(&state.db)
    .await
    .map_err(|e| AppError::Internal(format!("recording the draft invoice: {e}")))?;

    // ── The line ─────────────────────────────────────────────────────
    let line_description = match req.memo.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
        Some(memo) => format!("{} — payment on account. {}", asset.ledger_line, memo),
        None => format!(
            "{} — payment on account against {} USD outstanding",
            asset.ledger_line,
            outstanding.to_canonical()
        ),
    };
    stripe::post(
        http,
        "invoiceitems",
        &[
            ("customer".to_string(), customer_id),
            ("invoice".to_string(), invoice_id.clone()),
            ("amount".to_string(), cents.to_string()),
            ("currency".to_string(), "usd".to_string()),
            ("description".to_string(), line_description),
        ],
        &format!("{id}-item"),
    )
    .await?;

    // ── Issue it ─────────────────────────────────────────────────────
    let finalised = stripe::post(
        http,
        &format!("invoices/{invoice_id}/finalize"),
        &[],
        &format!("{id}-finalize"),
    )
    .await?;

    let hosted = finalised
        .get("hosted_invoice_url")
        .and_then(Value::as_str)
        .map(str::to_string);
    let pdf = finalised
        .get("invoice_pdf")
        .and_then(Value::as_str)
        .map(str::to_string);
    let number = finalised
        .get("number")
        .and_then(Value::as_str)
        .map(str::to_string);
    let status = finalised
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();

    sqlx::query(
        "UPDATE collections_demands SET state='issued', hosted_invoice_url=$2, \
         failure_reason=NULL, updated_at=NOW() WHERE id=$1",
    )
    .bind(id)
    .bind(&hosted)
    .execute(&state.db)
    .await
    .map_err(|e| AppError::Internal(format!("recording the issued invoice: {e}")))?;

    // Delivery is its own call and its own outcome. An invoice can be perfectly
    // valid and still never reach the debtor, and "issued" must not be read as
    // "served" unless Stripe said it sent it.
    let (delivery, delivery_error) = match stripe::post(
        http,
        &format!("invoices/{invoice_id}/send"),
        &[],
        &format!("{id}-send"),
    )
    .await
    {
        Ok(_) => ("sent", None),
        Err(e) => ("not_confirmed", Some(reason(&e))),
    };
    let _ = sqlx::query(
        "UPDATE collections_demands SET delivery_state=$2, delivery_error=$3, updated_at=NOW() \
         WHERE id=$1",
    )
    .bind(id)
    .bind(delivery)
    .bind(&delivery_error)
    .execute(&state.db)
    .await;

    Ok(DemandIssued {
        id: id.to_string(),
        position_id: asset.id.clone(),
        amount: cents_to_dec(cents)?.to_canonical(),
        outstanding_at_issue: outstanding.to_canonical(),
        stripe_invoice_id: invoice_id,
        number,
        hosted_invoice_url: hosted,
        invoice_pdf: pdf,
        invoice_status: status,
        delivery,
        delivery_error,
        mode: mode.to_string(),
    })
}

/// POST /api/capomastro/collections/demands/{id}/void
///
/// Withdrawing a demand is Stripe's business: voiding the invoice is what makes
/// it unpayable. This route asks Stripe and reports what Stripe said — it never
/// marks a row void on its own.
pub async fn void_demand(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let invoice_id: Option<String> = sqlx::query_scalar(
        "SELECT stripe_invoice_id FROM collections_demands WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| AppError::Internal(format!("reading the demand: {e}")))?
    .flatten();

    let invoice_id = invoice_id.ok_or_else(|| {
        AppError::NotFound(
            "no issued invoice for that demand — there is nothing at Stripe to withdraw".into(),
        )
    })?;

    let voided = stripe::post(
        &state.http_client,
        &format!("invoices/{invoice_id}/void"),
        &[],
        &format!("{id}-void"),
    )
    .await?;

    sqlx::query("UPDATE collections_demands SET state='voided', updated_at=NOW() WHERE id=$1")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| AppError::Internal(format!("recording the withdrawal: {e}")))?;

    Ok(Json(json!({
        "id": id.to_string(),
        "stripeInvoiceId": invoice_id,
        "status": voided.get("status").and_then(Value::as_str).unwrap_or("unknown"),
    })))
}

// ── Arithmetic ───────────────────────────────────────────────────────────

/// Principal plus accrued interest, or nothing at all.
///
/// When the accrual is missing the total is withheld rather than quietly
/// reported as the principal: "we could not price the interest" and "there is
/// no interest" are different statements, and only one of them is true.
fn outstanding_of(asset: &EarningAsset) -> Result<Option<Dec>, AppError> {
    match &asset.accrued_income {
        Some(interest) => Ok(Some(asset.principal.add(interest).map_err(arith)?)),
        None => Ok(None),
    }
}

/// The most of `amount` this payment rail can carry in one demand.
///
/// Rounded **down** to the cent. Rounding a default up — even by a cent — would
/// demand more than the position holds, and the request would then be refused
/// by the very check that computed it.
fn clip_to_rail(amount: &Dec) -> Result<Dec, AppError> {
    let ceiling = cents_to_dec(stripe::MAX_CHARGE_CENTS)?;
    if amount.is_negative() {
        return Dec::parse("0.00").map_err(arith);
    }
    Ok(match amount.cmp_dec(&ceiling).map_err(arith)? {
        std::cmp::Ordering::Greater => ceiling,
        _ => floor_to_cents(amount)?,
    })
}

/// Truncate a non-negative decimal to whole cents. Truncation, not rounding:
/// the fraction of a cent is dropped, never carried up.
fn floor_to_cents(amount: &Dec) -> Result<Dec, AppError> {
    if amount.is_negative() {
        return Dec::parse("0.00").map_err(arith);
    }
    let canonical = amount.to_canonical();
    let (whole, frac) = canonical
        .split_once('.')
        .unwrap_or((canonical.as_str(), ""));
    let cents: String = frac.chars().chain(std::iter::repeat('0')).take(2).collect();
    Dec::parse(&format!("{whole}.{cents}")).map_err(arith)
}

/// Minor units → decimal USD, exactly.
fn cents_to_dec(cents: i64) -> Result<Dec, AppError> {
    Dec::parse(&format!("{}.{:02}", cents / 100, (cents % 100).abs())).map_err(arith)
}

/// Decimal USD → minor units. The amount must already be in whole cents; this
/// refuses rather than rounding, because rounding here would change the sum
/// being demanded from what the operator authorised.
fn dec_to_cents(amount: &Dec) -> Result<i64, AppError> {
    if amount.scale() > 2 {
        return Err(AppError::Validation(format!(
            "{} USD is finer than a cent and cannot be carried onto an invoice",
            amount.to_canonical()
        )));
    }
    let fixed = amount.to_fixed(2).map_err(arith)?;
    let digits: String = fixed.chars().filter(|c| c.is_ascii_digit()).collect();
    let cents: i64 = digits.parse().map_err(|_| {
        AppError::Validation(format!(
            "{} USD is beyond the range a payment rail can express in minor units",
            amount.to_canonical()
        ))
    })?;
    Ok(if fixed.starts_with('-') { -cents } else { cents })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cents_round_trip_exactly() {
        for cents in [1i64, 99, 100, 12_345, stripe::MAX_CHARGE_CENTS] {
            let dec = cents_to_dec(cents).unwrap();
            assert_eq!(dec_to_cents(&dec).unwrap(), cents, "round trip broke at {cents}");
        }
    }

    #[test]
    fn a_balance_beyond_the_rail_is_clipped_not_rounded_down_silently() {
        let trillions = Dec::parse("1600000000000").unwrap();
        let clipped = clip_to_rail(&trillions).unwrap();
        assert_eq!(clipped.to_canonical(), "999999.99");
    }

    #[test]
    fn a_small_balance_passes_through_untouched() {
        let small = Dec::parse("1250.50").unwrap();
        assert_eq!(clip_to_rail(&small).unwrap().to_canonical(), "1250.50");
    }
}
