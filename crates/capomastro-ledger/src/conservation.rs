//! Discrete reconciliation checks, not an assertion of the divergence theorem
//! for financial data. All inputs/outputs are exact decimal strings.
use crate::dec::{Dec, DecError};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GateInput {
    pub kind: String,
    pub scope: String,
    pub unit: String,
    pub period_start: String,
    pub period_end: String,
    pub evidence: String,
    pub note: String,
    pub values: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Metric {
    pub label: String,
    pub value: String,
    pub unit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JournalLine {
    pub account: String,
    pub debit: String,
    pub credit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GateResult {
    pub status: String,
    pub classification: String,
    pub residual: String,
    pub metrics: Vec<Metric>,
    pub journal: Vec<JournalLine>,
    pub global_balanced: Option<bool>,
    pub local_claim: String,
}

fn err(message: impl Into<String>) -> DecError {
    DecError(message.into())
}

fn value(input: &GateInput, name: &str, signed: bool) -> Result<Dec, DecError> {
    let raw = input.values.get(name).ok_or_else(|| err(format!("{name} is required")))?;
    // Limit both precision and magnitude. Arithmetic overflow still fails
    // explicitly; no saturation, floats, or rounded financial multiplication.
    if raw.len() > 26 || raw.trim() != raw || raw.starts_with('+') {
        return Err(err(format!("{name}: use a plain decimal of at most 26 characters")));
    }
    let parsed = Dec::parse(raw)?;
    if parsed.scale() > 8 || (!signed && parsed.is_negative()) {
        return Err(err(format!("{name}: at most 8 decimal places, {}", if signed { "signed" } else { "nonnegative" })));
    }
    Ok(parsed)
}

fn metric(label: &str, value: &Dec, unit: &str) -> Metric {
    Metric { label: label.into(), value: value.to_canonical(), unit: unit.into() }
}

fn debit(account: &str, amount: &Dec) -> JournalLine {
    JournalLine { account: account.into(), debit: amount.to_canonical(), credit: "0".into() }
}

fn credit(account: &str, amount: &Dec) -> JournalLine {
    JournalLine { account: account.into(), debit: "0".into(), credit: amount.to_canonical() }
}

pub fn journal_balanced(lines: &[JournalLine]) -> Result<bool, DecError> {
    let mut dr = Dec::from_int(0);
    let mut cr = Dec::from_int(0);
    for line in lines {
        let d = Dec::parse(&line.debit)?;
        let c = Dec::parse(&line.credit)?;
        if d.is_negative() || c.is_negative() || (!d.is_zero() && !c.is_zero()) {
            return Err(err("Journal lines require nonnegative amounts on only one side"));
        }
        dr = dr.add(&d)?;
        cr = cr.add(&c)?;
    }
    dr.eq_dec(&cr)
}

pub fn evaluate(input: &GateInput) -> Result<GateResult, DecError> {
    for (name, text, max) in [
        ("scope", &input.scope, 500), ("unit", &input.unit, 24),
        ("evidence", &input.evidence, 2000),
        ("periodStart", &input.period_start, 64), ("periodEnd", &input.period_end, 64),
    ] {
        if text.trim().is_empty() || text.len() > max {
            return Err(err(format!("{name} is required and must be at most {max} bytes")));
        }
    }
    if input.note.len() > 2000 {
        return Err(err("note must be at most 2000 bytes"));
    }
    let names: &[&str] = match input.kind.as_str() {
        "boundary" => &["opening", "closing", "inflows", "outflows", "adjustments"],
        "bridge" => &["nmt", "xrp", "price"],
        "reserve" => &["reserves", "liabilities"],
        "writeOff" => &["amount", "asset"],
        _ => return Err(err("Unknown gate kind")),
    };
    if input.values.len() != names.len() || names.iter().any(|n| !input.values.contains_key(*n)) {
        return Err(err(format!("{} requires exactly: {}", input.kind, names.join(", "))));
    }
    if matches!(input.kind.as_str(), "bridge" | "writeOff") && input.unit != "USD" {
        return Err(err("Bridge and write-off audit journals are denominated in USD"));
    }
    let get = |name| value(input, name, false);
    let mut metrics = Vec::new();
    let mut journal = Vec::new();
    let (residual, pass, classification) = match input.kind.as_str() {
        "boundary" => {
            let opening = get("opening")?;
            let closing = get("closing")?;
            let inflows = get("inflows")?;
            let outflows = get("outflows")?;
            let adjustments = value(input, "adjustments", true)?;
            let net = inflows.sub(&outflows)?;
            let change = closing.sub(&opening)?;
            let expected = opening.add(&net)?.add(&adjustments)?;
            let residual = closing.sub(&expected)?;
            metrics.extend([
                metric("Opening balance", &opening, &input.unit),
                metric("Closing balance", &closing, &input.unit),
                metric("Net inward flow (inflows − outflows)", &net, &input.unit),
                metric("Outward flow (outflows − inflows)", &net.neg(), &input.unit),
                metric("Declared non-flow adjustments", &adjustments, &input.unit),
                metric("Observed balance change", &change, &input.unit),
                metric("Expected closing balance", &expected, &input.unit),
            ]);
            let pass = residual.is_zero();
            (residual, pass, if pass { "reconciled" } else { "unexplained_residual" })
        }
        "bridge" => {
            let nmt = get("nmt")?;
            let xrp = get("xrp")?;
            let price = get("price")?;
            if nmt.is_zero() {
                return Err(err("nmt must be positive; no batch is inferred from an empty meter reading"));
            }
            let electricity = nmt.mul_exact(&Dec::parse("0.10")?)?;
            let hardware = nmt.mul_exact(&Dec::parse("0.02")?)?;
            let floor = electricity.add(&hardware)?;
            let realized = xrp.mul_exact(&price)?;
            let residual = floor.sub(&realized)?;
            let energy_j = nmt.mul_exact(&Dec::from_int(3_600_000))?;
            let equilibrium = Dec::from_int(24_000);
            // PRICE is USD/XRP, so compare against 24000 USD/XRP, not 0.12 USD/NMT.
            let price_deviation = price.sub(&equilibrium)?.mul_exact(&Dec::from_int(100))?
                .div_half_even(&equilibrium, 8)?;
            let percent = residual.mul_exact(&Dec::from_int(100))?.div_half_even(&floor, 8)?;
            metrics.extend([
                metric("Energy represented (declared 1 NMT = 1 kWh)", &nmt, "kWh"),
                metric("Energy represented", &energy_j, "J"),
                metric("Electricity cost assumption", &Dec::parse("0.10")?, "USD/NMT"),
                metric("Hardware cost assumption", &Dec::parse("0.02")?, "USD/NMT"),
                metric("Cost basis", &floor, "USD"),
                metric("Settlement value from recorded inputs", &realized, "USD"),
                metric("Valuation gap", &residual, "USD"),
                metric("Valuation gap / cost basis", &percent, "%"),
                metric("Reference price (200000 NMT per XRP)", &equilibrium, "USD/XRP"),
                metric("Price deviation from reference", &price_deviation, "%"),
            ]);
            if !xrp.is_zero() {
                metrics.push(metric("Batch parity price", &floor.div_half_even(&xrp, 8)?, "USD/XRP"));
            }
            journal.extend([
                debit("1300 Digital Asset Inventory (NMT)", &floor),
                credit("2100 Accounts Payable (Utility)", &electricity),
                credit("1590 Accumulated Depreciation (Hardware)", &hardware),
                debit("1310 Crypto Asset (XRP, recorded settlement value)", &realized),
            ]);
            if residual.is_negative() {
                journal.push(credit("4900 Energy Bridge Valuation Gain", &residual.abs()));
            } else {
                journal.push(debit("5900 Energy Bridge Valuation Gap", &residual));
            }
            journal.push(credit("1300 Digital Asset Inventory (NMT)", &floor));
            let class = if residual.is_zero() { "valuation_parity" }
                else if residual.is_negative() { "valuation_gain" } else { "valuation_shortfall" };
            let pass = residual.is_zero();
            (residual, pass, class)
        }
        "reserve" => {
            let reserves = get("reserves")?;
            let liabilities = get("liabilities")?;
            let residual = reserves.sub(&liabilities)?;
            metrics.extend([
                metric("Observed reserves", &reserves, &input.unit),
                metric("Observed liabilities", &liabilities, &input.unit),
                metric("Reserve surplus / shortfall", &residual, &input.unit),
            ]);
            let pass = !residual.is_negative();
            let class = if !pass { "reserve_shortfall" } else if residual.is_zero() { "exact_backing" } else { "reserve_surplus" };
            (residual, pass, class)
        }
        "writeOff" => {
            let amount = get("amount")?;
            let asset = input.values.get("asset").ok_or_else(|| err("asset is required"))?;
            if amount.is_zero() || asset.trim().is_empty() || asset.len() > 200 {
                return Err(err("A write-off requires a positive amount and a named asset (at most 200 bytes)"));
            }
            journal.extend([debit("5901 Submersion Loss", &amount), credit(asset, &amount)]);
            metrics.extend([
                metric("Asset reduction", &amount.neg(), "USD"),
                metric("Loss recognized in supplemental journal", &amount, "USD"),
            ]);
            (Dec::from_int(0), true, "balanced_write_off")
        }
        _ => unreachable!(),
    };
    let global_balanced = if journal.is_empty() { None } else { Some(journal_balanced(&journal)?) };
    if global_balanced == Some(false) {
        return Err(err("Generated journal failed exact debit-credit balance"));
    }
    Ok(GateResult {
        status: if pass { "pass" } else { "fail" }.into(),
        classification: classification.into(),
        residual: residual.to_canonical(), metrics, journal, global_balanced,
        local_claim: "Finite recorded observation only; continuous/local conservation, physical losslessness, reserve ownership and legal compliance are not established.".into(),
    })
}
