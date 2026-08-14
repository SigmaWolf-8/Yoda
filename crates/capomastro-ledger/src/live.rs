//! Recomputation of the ledger summary from the workbook's own cells.
//!
//! Every figure below is derived here, at call time, from the positions the
//! workbook states. Nothing is read back from a stored total. The arithmetic is
//! exact base-10 fixed point ([`crate::dec::Dec`]); the integer invariants —
//! digital root, divisibility by nine — are discharged by the `salvi-engine`
//! no_std kernel rather than restated with an ad-hoc modulo, so the ledger and
//! the formally verified core cannot drift apart.
//!
//! Three rules govern this module:
//!
//! 1. **A missing cell is not a zero.** Where the workbook is silent the
//!    dependent figure is refused, not defaulted. (The one deliberate
//!    exception is a cell the workbook itself leaves blank because it is a
//!    stripped formula cell — those are exactly the cells recomputed here.)
//! 2. **Struck instruments stay struck.** A void declaration is re-checked on
//!    every computation; if a struck line has reappeared in the cells, the
//!    whole computation is refused rather than served with the instrument
//!    quietly restored.
//! 3. **Two implementations must agree.** The extraction script publishes its
//!    own summary; [`compute`] compares the live figures against it field by
//!    field and reports any divergence instead of preferring one silently.

use std::collections::BTreeSet;
use std::fmt;

use salvi_engine::BijectiveBase9;
use serde_json::{json, Map, Value};

use crate::dec::{Dec, DecError};

/// Published scale for ratios. They are irrational in general, so they are
/// stated at a declared scale rather than pretending to be exact.
const RATIO_DP: u32 = 12;
/// Working scale for the single division in the pipeline: eight places wider
/// than the published one, so rounding cannot reach a published digit, and
/// narrow enough that a trillion-dollar dividend still has room inside 128-bit
/// fixed point. (At thirty places the estate's own gold line overflows the
/// division before it can be rounded — the arithmetic refuses rather than
/// wrapping, but a refusal is still a ledger that will not print.)
const DIVISION_DP: u32 = 20;
/// Tolerance for "is this ratio one", well inside the published scale.
const RATIO_EPSILON: &str = "0.0000000001";
/// The largest cross-balance weight this arithmetic can carry without the
/// working precision of the leg ratio reaching a published digit. Eight orders
/// of magnitude of headroom sit between the working scale and the published
/// one, so this bound is four orders of magnitude more generous than the
/// weights a quadrilateral can actually hold (they sum to one).
const MAX_WEIGHT_MAGNITUDE: &str = "10000";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LedgerError(pub String);

impl fmt::Display for LedgerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for LedgerError {}

impl From<DecError> for LedgerError {
    fn from(e: DecError) -> Self {
        LedgerError(format!("exact arithmetic failed: {e}"))
    }
}

/// One field where the live computation and the sealed extraction disagree.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Divergence {
    /// JSON pointer into the summary, e.g. `/goldAssay/fairMarketValueUsd`.
    pub path: String,
    pub live: String,
    pub sealed: String,
}

/// The outcome of checking the live figures against the sealed extraction.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Parity {
    /// Whether a sealed summary was present to check against at all.
    pub sealed_summary_present: bool,
    /// Leaf values compared.
    pub fields_compared: usize,
    pub divergences: Vec<Divergence>,
    pub agrees: bool,
}

/// A recomputed summary and the parity verdict that accompanies it.
#[derive(Debug, Clone)]
pub struct Computed {
    pub summary: Value,
    pub parity: Parity,
}

// ── cell access ──────────────────────────────────────────────────────────
//
// The sheet cells are the workbook, carried losslessly: text as strings,
// whole numbers as JSON numbers, fractional values as exact decimal strings.
// A cell is numeric when it is a JSON number or a string that parses as a
// plain decimal — the same test the extraction script applies to the
// spreadsheet's own typed cells.

// ── cell access ──────────────────────────────────────────────────────────

/// Parse a cell as an exact decimal. Says nothing about whether the workbook
/// *meant* it as a figure — [`Sheet::holds_a_number`] answers that.
fn cell_as_dec(cell: &Value) -> Option<Dec> {
    match cell {
        Value::Number(n) => Dec::parse(&n.to_string()).ok(),
        Value::String(s) => Dec::parse(s).ok(),
        _ => None,
    }
}

fn cell_str(row: &[Value], idx: usize) -> String {
    row.get(idx).and_then(Value::as_str).unwrap_or("").trim().to_string()
}

/// One workbook sheet: its cells, and which of them the workbook holds as
/// numbers rather than as text.
///
/// The typing index matters more than it looks. JSON has one number type and
/// no way to mark a string as a text cell that happens to read like a figure,
/// so without it an audit reference of `820`, a year, or a footnote numbered
/// `2026` is indistinguishable from money. The extraction script publishes the
/// distinction the spreadsheet itself makes (`numericCells`), and every figure
/// read here must be numeric *in the workbook* — not merely parseable.
struct Sheet<'a> {
    name: String,
    rows: &'a [Value],
    numeric: BTreeSet<(usize, usize)>,
}

impl<'a> Sheet<'a> {
    fn load(ledger: &'a Value, name: &str) -> Result<Sheet<'a>, LedgerError> {
        let key = name.replace('~', "~0").replace('/', "~1");
        let sheet = ledger
            .pointer(&format!("/sheets/{key}"))
            .ok_or_else(|| LedgerError(format!("workbook has no `{name}` sheet")))?;
        let rows = sheet
            .get("rows")
            .and_then(Value::as_array)
            .ok_or_else(|| LedgerError(format!("`{name}` sheet carries no rows")))?;
        let index = sheet.get("numericCells").and_then(Value::as_array).ok_or_else(|| {
            LedgerError(format!(
                "`{name}` sheet carries no cell-typing index. Without it a text cell that reads \
                 like a figure cannot be told from a figure. Re-run \
                 scripts/extract-gaap-ledger.py."
            ))
        })?;
        let mut numeric = BTreeSet::new();
        for pair in index {
            let coords = pair.as_array().filter(|p| p.len() == 2).ok_or_else(|| {
                LedgerError(format!("`{name}`: cell-typing index holds a malformed entry"))
            })?;
            let row = coords[0].as_u64().ok_or_else(|| {
                LedgerError(format!("`{name}`: cell-typing index holds a non-numeric row"))
            })?;
            let col = coords[1].as_u64().ok_or_else(|| {
                LedgerError(format!("`{name}`: cell-typing index holds a non-numeric column"))
            })?;
            numeric.insert((row as usize, col as usize));
        }
        Ok(Sheet { name: name.to_string(), rows, numeric })
    }

    /// The row whose label contains `needle`, with its position.
    fn find(&self, needle: &str) -> Option<(usize, &'a Vec<Value>)> {
        let needle = needle.to_lowercase();
        self.rows.iter().enumerate().find_map(|(i, row)| {
            let cells = row.as_array()?;
            let first = cells.first()?.as_str()?;
            first
                .trim()
                .to_lowercase()
                .contains(&needle)
                .then_some((i, cells))
        })
    }

    fn holds_a_number(&self, row: usize, column: usize) -> bool {
        self.numeric.contains(&(row, column))
    }

    /// A figure at a known position. A blank cell, a text cell, or a text cell
    /// that reads like a number are all refused — never read as zero.
    fn dec_at(&self, row: usize, column: usize, what: &str) -> Result<Dec, LedgerError> {
        let cell = self
            .rows
            .get(row)
            .and_then(Value::as_array)
            .and_then(|cells| cells.get(column));
        let Some(cell) = cell else {
            return Err(LedgerError(format!(
                "{}: {what} — the row ends before column {column}; the figure it should hold is \
                 simply absent",
                self.name
            )));
        };
        if !self.holds_a_number(row, column) {
            return Err(LedgerError(format!(
                "{}: {what} — column {column} holds `{}` as text, not as a figure. Refusing to \
                 spend a note as money.",
                self.name,
                render(cell)
            )));
        }
        cell_as_dec(cell).ok_or_else(|| {
            LedgerError(format!(
                "{}: {what} — column {column} states `{}`, which is not an exact decimal",
                self.name,
                render(cell)
            ))
        })
    }

    /// A figure the computation cannot proceed without, read from a **named
    /// column** of a labelled row.
    ///
    /// The column is stated by the caller rather than discovered by scanning
    /// for "the first numeric cell", because scanning cannot tell a value from
    /// a note beside it. The workbook leaves a value cell empty wherever the
    /// figure was a formula, and the cells alongside hold units and audit
    /// references. So the layout is declared, and a workbook that no longer
    /// matches it stops the ledger instead of quietly answering from the wrong
    /// column.
    fn required(&self, needle: &str, column: usize) -> Result<Dec, LedgerError> {
        let (row, _) = self
            .find(needle)
            .ok_or_else(|| LedgerError(format!("{}: no row matching `{needle}`", self.name)))?;
        self.dec_at(row, column, &format!("row `{needle}`"))
            .map_err(|e| LedgerError(format!("{e}. Refusing to substitute zero.")))
    }

    /// Rows whose label begins with `prefix`, with their positions.
    fn rows_starting(&self, prefix: &str) -> Vec<(usize, String, &'a Vec<Value>)> {
        let prefix = prefix.to_lowercase();
        self.rows
            .iter()
            .enumerate()
            .filter_map(|(i, row)| {
                let cells = row.as_array()?;
                let label = cells.first()?.as_str()?.trim().to_string();
                label
                    .to_lowercase()
                    .starts_with(&prefix)
                    .then_some((i, label, cells))
            })
            .collect()
    }
}

/// The workbook states every parameter and every balance in the column beside
/// its label; the descendant register states its total one column further
/// over, past a cell the workbook leaves empty.
const VALUE_COLUMN: usize = 1;
const REGISTER_TOTAL_COLUMN: usize = 2;

// ── void declarations ────────────────────────────────────────────────────

/// Fields without which a strike is not a declaration but an unexplained
/// deletion. Mirrors `REQUIRED_STRIKE_FIELDS` in the extraction script: both
/// implementations must refuse the same file, or the stricter one is merely
/// decorative.
const REQUIRED_STRIKE_FIELDS: [&str; 10] = [
    "id",
    "label",
    "formerSection",
    "struckAmount",
    "declaration",
    "declaredBy",
    "declaredOn",
    "basis",
    "offsettingCredit",
    "offsettingCreditBasis",
];

/// Strikes known to have been made against this workbook, by id and label.
///
/// Held here, in code, and not taken from the declaration file, because the
/// failure this guards against is the declaration file losing an entry. A list
/// that read itself from the thing it is checking would approve of anything.
const KNOWN_STRIKES: [(&str, &str); 1] = [(
    "OBL-DAMAGE-OFFSET",
    "Active Damage Offset & Restorative Provision",
)];

/// Every strike must be complete, and every strike known to have been made
/// must still be declared. Emptying the declaration file does not reinstate an
/// instrument; it just stops anyone being told it was removed.
fn validate_strikes(strikes: &[Value]) -> Result<(), LedgerError> {
    for strike in strikes {
        let id = strike.get("id").and_then(Value::as_str).unwrap_or("<unnamed>");
        let missing: Vec<&str> = REQUIRED_STRIKE_FIELDS
            .iter()
            .copied()
            .filter(|field| {
                strike
                    .get(*field)
                    .map(|v| render(v).trim().is_empty())
                    .unwrap_or(true)
            })
            .collect();
        if !missing.is_empty() {
            return Err(LedgerError(format!(
                "void declaration {id} is missing {}. A strike without a declarant, date or \
                 basis is an unexplained deletion, which is worse than the figure it removes.",
                missing.join(", ")
            )));
        }
        let amount = strike.get("struckAmount").map(render).unwrap_or_default();
        Dec::parse(&amount).map_err(|_| {
            LedgerError(format!(
                "void declaration {id}: struck amount `{amount}` is not an exact decimal"
            ))
        })?;
    }

    for (known_id, known_label) in KNOWN_STRIKES {
        let declared = strikes
            .iter()
            .find(|s| s.get("id").and_then(Value::as_str) == Some(known_id));
        match declared {
            None => {
                return Err(LedgerError(format!(
                    "strike {known_id} ({known_label}) is known to have been struck from this \
                     workbook but is not declared. Refusing to serve a ledger that has quietly \
                     forgotten it."
                )))
            }
            Some(s) if s.get("label").and_then(Value::as_str) != Some(known_label) => {
                return Err(LedgerError(format!(
                    "strike {known_id} is declared against label `{}`, but the strike recorded \
                     against this workbook was `{known_label}`.",
                    s.get("label").map(render).unwrap_or_default()
                )))
            }
            Some(_) => {}
        }
    }
    Ok(())
}

/// A struck instrument must not be back in the cells. The workbook itself is
/// never edited, so this is not a theoretical check: the extraction applies the
/// strike, and a re-extraction from a mangled declaration file would restore a
/// perfectly plausible line that foots correctly and shows nothing on its face.
fn assert_not_resurrected(ledger: &Value, strikes: &[Value]) -> Result<(), LedgerError> {
    let Some(sheets) = ledger.get("sheets") else {
        return Ok(());
    };
    let haystack = sheets.to_string().to_lowercase();
    for strike in strikes {
        let label = strike.get("label").and_then(Value::as_str).unwrap_or("");
        let id = strike.get("id").and_then(Value::as_str).unwrap_or("(unnamed strike)");
        if label.is_empty() {
            return Err(LedgerError(format!(
                "void declaration {id} carries no label; refusing to compute against an unnamed strike"
            )));
        }
        if haystack.contains(&label.to_lowercase()) {
            return Err(LedgerError(format!(
                "strike {id}: `{label}` is present in the workbook cells again. \
                 Refusing to publish a ledger that has quietly resurrected a struck instrument."
            )));
        }
    }
    Ok(())
}

// ── the computation ──────────────────────────────────────────────────────

fn money_lines(
    sheet: &Sheet<'_>,
    specs: &[(&str, &str)],
) -> Result<Vec<(String, Dec)>, LedgerError> {
    specs
        .iter()
        .map(|(label, needle)| Ok(((*label).to_string(), sheet.required(needle, VALUE_COLUMN)?)))
        .collect()
}

fn lines_json(lines: &[(String, Dec)]) -> Value {
    Value::Array(
        lines
            .iter()
            .map(|(label, value)| json!({ "label": label, "value": value.to_canonical() }))
            .collect(),
    )
}

/// Recompute the whole summary from `ledger`'s sheets and the void
/// declarations in `voids`, then check the result against the sealed summary
/// the extraction script published (when one is present).
pub fn compute(ledger: &Value, voids: &Value) -> Result<Computed, LedgerError> {
    let empty = Vec::new();
    let strikes = voids
        .get("strikes")
        .and_then(Value::as_array)
        .unwrap_or(&empty);
    validate_strikes(strikes)?;
    assert_not_resurrected(ledger, strikes)?;

    let bs = Sheet::load(ledger, "Balance Sheet")?;
    let inc = Sheet::load(ledger, "Income Statement")?;
    let gold = Sheet::load(ledger, "Gold Assay & Valuation")?;
    let reg = Sheet::load(ledger, "Descendant Register 81")?;
    let xb = Sheet::load(ledger, "Cross-Balance Matrix")?;

    // ── balance sheet ────────────────────────────────────────────────
    let current = money_lines(
        &bs,
        &[
            ("Cash & Cash Equivalents", "Cash & Cash Equivalents"),
            ("Stablecoin Reserve Liquidity", "Stablecoin Reserve Liquidity"),
            ("Short-Term Commercial Instruments", "Short-Term Commercial Instruments"),
        ],
    )?;
    let noncurrent = money_lines(
        &bs,
        &[
            ("Monetary Gold Reserves", "Monetary Gold Reserves"),
            ("Real Property & Land Estate Holdings", "Real Property & Land Estate"),
            ("Photonic & Agni Lattice Assets", "Photonic & Agni Lattice"),
        ],
    )?;
    let liabilities = money_lines(
        &bs,
        &[
            ("Stablecoin Backing Obligations", "Stablecoin Backing Obligations"),
            ("Fiat Matching Deposit Reserves", "Fiat Matching Deposit Reserves"),
        ],
    )?;
    let equity = money_lines(
        &bs,
        &[
            ("Sovereign Capital Reserve", "Sovereign Capital Reserve"),
            ("Retained Equilibrium Earnings", "Retained Equilibrium Earnings"),
        ],
    )?;

    // A strike's offsetting credit was applied to the workbook row itself, so
    // it is read here like any other figure. What is checked is that it has
    // somewhere to land: a credit aimed at a line that does not exist means the
    // reversal went nowhere and the sheet is short by the struck amount.
    for strike in strikes {
        let destination = strike
            .get("offsettingCredit")
            .and_then(Value::as_str)
            .unwrap_or("");
        if !equity.iter().any(|(label, _)| label == destination) {
            let id = strike.get("id").and_then(Value::as_str).unwrap_or("(unnamed strike)");
            return Err(LedgerError(format!(
                "strike {id}: offsetting credit line `{destination}` is not an equity line. \
                 The reversal has nowhere to land; refusing to guess."
            )));
        }
    }

    let total_current = Dec::sum(&current.iter().map(|(_, v)| *v).collect::<Vec<_>>())?;
    let total_noncurrent = Dec::sum(&noncurrent.iter().map(|(_, v)| *v).collect::<Vec<_>>())?;
    let total_assets = total_current.add(&total_noncurrent)?;
    let total_liabilities = Dec::sum(&liabilities.iter().map(|(_, v)| *v).collect::<Vec<_>>())?;
    let total_equity = Dec::sum(&equity.iter().map(|(_, v)| *v).collect::<Vec<_>>())?;
    let total_l_and_e = total_liabilities.add(&total_equity)?;
    let balanced = total_assets.eq_dec(&total_l_and_e)?;

    // ── reserve composition ──────────────────────────────────────────
    let mut segment_mix: Vec<(String, Dec, Dec)> = Vec::new();
    for (label, value) in current.iter().chain(noncurrent.iter()) {
        if value.is_zero() || value.is_negative() {
            continue;
        }
        let share = if total_assets.is_zero() {
            Dec::zero()
        } else {
            // Half to even, matching the extraction script's rounding, so a
            // tie in the thirteenth place is not reported as a divergence.
            value.div_half_even(&total_assets, RATIO_DP)?
        };
        segment_mix.push((label.clone(), *value, share));
    }
    // Largest holding first. Sorting is by exact value, never by the rendered
    // string, which would order "9" above "10".
    let mut sort_error: Option<DecError> = None;
    segment_mix.sort_by(|a, b| match b.1.cmp_dec(&a.1) {
        Ok(ordering) => ordering,
        Err(e) => {
            sort_error.get_or_insert(e);
            std::cmp::Ordering::Equal
        }
    });
    if let Some(e) = sort_error {
        return Err(e.into());
    }

    // ── gold assay ───────────────────────────────────────────────────
    let bars = gold.required("Total Gold Bars Counted", VALUE_COLUMN)?;
    let mass_per_bar = gold.required("Nominal Mass per Bar", VALUE_COLUMN)?;
    let purity = gold.required("Fine Gold Purity", VALUE_COLUMN)?;
    let troy_factor = gold.required("Troy Ounce Conversion Factor", VALUE_COLUMN)?;
    let spot = gold.required("LBMA PM Gold Fix Price", VALUE_COLUMN)?;
    let carrying = gold.required("Conservative Stated Carrying Value", VALUE_COLUMN)?;
    // Multiplication only — no division anywhere in this chain, so every one of
    // these is exact rather than stated at a scale.
    let net_mass = bars.mul_exact(&mass_per_bar)?;
    let fine_mass = net_mass.mul_exact(&purity)?;
    let fine_ounces = fine_mass.mul_exact(&troy_factor)?;
    let fair_value = fine_ounces.mul_exact(&spot)?;
    let buffer = fair_value.sub(&carrying)?;

    // ── descendant register ──────────────────────────────────────────
    let mut generations = Vec::new();
    let mut total_nodes: u64 = 0;
    const OFFSPRING_COLUMN: usize = 2;
    for (index, label, cells) in reg.rows_starting("generation ") {
        let offspring_dec = reg.dec_at(index, OFFSPRING_COLUMN, &format!("row `{label}`"))?;
        let offspring = offspring_dec.to_canonical().parse::<u64>().map_err(|_| {
            LedgerError(format!(
                "descendant register: `{label}` states an offspring count of \
                 `{}`, which is not a whole number of people",
                offspring_dec.to_canonical()
            ))
        })?;
        total_nodes = total_nodes.checked_add(offspring).ok_or_else(|| {
            LedgerError("descendant register: offspring counts overflow".into())
        })?;
        generations.push(json!({
            "generation": label,
            "epoch": cell_str(cells, 1),
            "offspring": offspring,
            "nodeId": cell_str(cells, 3),
        }));
    }

    let descendants_dec = reg.required("Total Registered Descendants", REGISTER_TOTAL_COLUMN)?;
    let descendants: u64 = descendants_dec.to_canonical().parse().map_err(|_| {
        LedgerError(format!(
            "descendant register: total registered descendants is `{}`, not a whole number",
            descendants_dec.to_canonical()
        ))
    })?;

    // The digital root and the divisibility test are integer invariants, so
    // they are discharged by the formally verified kernel rather than restated
    // here. `gcd(n, 9) == 9` is the same statement as `n mod 9 == 0`, and the
    // kernel proves the pair agree.
    let encoded = BijectiveBase9::from_u64(descendants).map_err(|e| {
        LedgerError(format!("kernel refused the descendant count {descendants}: {e:?}"))
    })?;
    let digital_root = encoded.digital_root_invariant();
    let harmonic = encoded.gcd_9_invariant() == 9;
    if harmonic != (descendants % 9 == 0) {
        return Err(LedgerError(
            "kernel gcd invariant disagrees with divisibility by nine; refusing to publish".into(),
        ));
    }

    // ── cross-balance matrix ─────────────────────────────────────────
    let mut legs = Vec::new();
    let mut weighted = Vec::new();
    const ASSET_COLUMN: usize = 2;
    const RESERVE_COLUMN: usize = 3;
    const WEIGHT_COLUMN: usize = 4;
    for (index, label, cells) in xb.rows_starting("leg ") {
        let where_ = format!("row `{label}`");
        let asset = xb.dec_at(index, ASSET_COLUMN, &where_)?;
        let reserve = xb.dec_at(index, RESERVE_COLUMN, &where_)?;
        let weight = xb.dec_at(index, WEIGHT_COLUMN, &where_)?;
        // The leg ratio is carried at DIVISION_DP and the weighted product is
        // published at RATIO_DP, so the intermediate rounding is invisible only
        // while the weight cannot magnify it into a published digit. Weights on
        // a quadrilateral sum to one; anything approaching this bound means the
        // matrix is not what this arithmetic was scaled for, and the honest
        // response is to stop rather than to publish digits that are no longer
        // defensible.
        if weight.abs().cmp_dec(&Dec::parse(MAX_WEIGHT_MAGNITUDE)?)? != std::cmp::Ordering::Less {
            return Err(LedgerError(format!(
                "{where_} carries a weight of {}. The leg ratio is computed to {DIVISION_DP} \
                 decimal places, and a weight of that size would let the {DIVISION_DP}th place \
                 reach the {RATIO_DP} places actually published. Refusing to publish digits the \
                 working precision no longer supports.",
                weight.to_canonical()
            )));
        }
        if reserve.is_zero() {
            return Err(LedgerError(format!(
                "{where_} allocates no reserve against an asset of {}. The leg's ratio is \
                 undefined; publishing it as zero would state that the quadrant is unbacked \
                 when what is true is that the workbook does not say.",
                asset.to_canonical()
            )));
        }
        // The only division in the pipeline. Carried far wider than the
        // published scale, then the weighted product is stated at that scale —
        // half to even at both steps, as the extraction script states it.
        let ratio = asset.div_half_even(&reserve, DIVISION_DP)?;
        let weighted_ratio = weight.mul_exact(&ratio)?.rescale_half_even(RATIO_DP)?;
        weighted.push(weighted_ratio);
        legs.push(json!({
            "leg": label,
            "description": cell_str(cells, 1),
            "asset": asset.to_canonical(),
            "reserve": reserve.to_canonical(),
            "weight": weight.to_canonical(),
            "weightedRatio": weighted_ratio.to_canonical(),
        }));
    }
    let x_cross = Dec::sum(&weighted)?;
    let epsilon = Dec::parse(RATIO_EPSILON)?;
    let equilateral = x_cross.sub(&Dec::from_int(1))?.abs().cmp_dec(&epsilon)? == std::cmp::Ordering::Less;

    // ── income statement ─────────────────────────────────────────────
    let income_lines: Vec<Value> = inc
        .rows
        .iter()
        .enumerate()
        .filter_map(|(index, row)| {
            let cells = row.as_array()?;
            let label = cells.first()?.as_str()?.trim().to_string();
            // A line item is a row the workbook holds a *figure* on. A heading
            // whose second cell reads like a number is a heading.
            if !inc.holds_a_number(index, VALUE_COLUMN) {
                return None;
            }
            let amount = cells.get(VALUE_COLUMN).and_then(cell_as_dec)?;
            Some(json!({
                "label": label,
                "amount": amount.to_canonical(),
                "basis": cell_str(cells, 2),
            }))
        })
        .collect();

    // A zero here is the estate's accrual ground state, and it is stated as a
    // zero in the workbook. A *missing* zero is a different claim entirely, so
    // both figures are required rather than defaulted.
    let gross_revenue = inc.required("Gross Revenue", VALUE_COLUMN)?;
    let cogs = inc.required("Cost of Goods Sold", VALUE_COLUMN)?;

    let summary = json!({
        "balanceSheet": {
            "currentAssets": lines_json(&current),
            "nonCurrentAssets": lines_json(&noncurrent),
            "liabilities": lines_json(&liabilities),
            "equity": lines_json(&equity),
            "totalCurrentAssets": total_current.to_canonical(),
            "totalNonCurrentAssets": total_noncurrent.to_canonical(),
            "totalAssets": total_assets.to_canonical(),
            "totalLiabilities": total_liabilities.to_canonical(),
            "totalEquity": total_equity.to_canonical(),
            "totalLiabilitiesAndEquity": total_l_and_e.to_canonical(),
            "balanced": balanced,
        },
        "segmentMix": segment_mix
            .iter()
            .map(|(label, value, share)| json!({
                "label": label,
                "value": value.to_canonical(),
                "share": share.to_canonical(),
            }))
            .collect::<Vec<_>>(),
        "incomeStatement": {
            "grossRevenue": gross_revenue.to_canonical(),
            "costOfGoodsSold": cogs.to_canonical(),
            "lines": income_lines,
        },
        "goldAssay": {
            "barsCounted": bars.to_canonical(),
            "nominalMassPerBarKg": mass_per_bar.to_canonical(),
            "netGoldMassKg": net_mass.to_canonical(),
            "finePurity": purity.to_canonical(),
            "fineGoldMassKg": fine_mass.to_canonical(),
            "troyOunceFactor": troy_factor.to_canonical(),
            "fineGoldOunces": fine_ounces.to_canonical(),
            "lbmaSpotUsdPerOz": spot.to_canonical(),
            "fairMarketValueUsd": fair_value.to_canonical(),
            "carryingValueUsd": carrying.to_canonical(),
            "unrecordedReserveBufferUsd": buffer.to_canonical(),
        },
        "descendantRegister": {
            "generations": generations,
            "totalActiveNodes": total_nodes,
            "totalRegisteredDescendants": descendants,
            "digitalRoot": digital_root,
            "harmonic": harmonic,
        },
        "crossBalance": {
            "legs": legs,
            "xCross": x_cross.to_canonical(),
            "equilateral": equilateral,
        },
        // Disclosure only. Nothing here is posted, summed or tied to; it is
        // carried so a reader can see a figure of this size was removed, by
        // whom, on what basis, and where its credit went.
        "voidInstruments": Value::Array(strikes.clone()),
    });

    // The sealed extraction is not optional. Serving live figures with nothing
    // to check them against silently drops half the guarantee — and the most
    // likely reason for its absence is a truncated or half-written data file,
    // which is not a condition to publish a balance sheet under.
    let sealed = ledger.get("summary").filter(|v| v.is_object()).ok_or_else(|| {
        LedgerError(
            "the ledger data carries no sealed summary to cross-check the live figures against; \
             refusing to publish an unchecked ledger"
                .into(),
        )
    })?;
    let parity = check_parity(&summary, Some(sealed));
    Ok(Computed { summary, parity })
}

// ── parity against the sealed extraction ─────────────────────────────────

/// Compare live figures against the sealed summary, numerically where both
/// sides are decimals.
///
/// String comparison is the wrong test: `2153000000000` and
/// `2153000000000.00` are the same money at two scales, and reporting that as a
/// divergence would turn a correct ledger into a false alarm.
fn check_parity(live: &Value, sealed: Option<&Value>) -> Parity {
    let Some(sealed) = sealed else {
        return Parity {
            sealed_summary_present: false,
            fields_compared: 0,
            divergences: Vec::new(),
            agrees: false,
        };
    };
    let mut compared = 0usize;
    let mut divergences = Vec::new();
    // The void-instrument block is carried through verbatim from the
    // declaration file on both sides, so it is disclosure, not a computed
    // figure, and contributes nothing to the parity verdict.
    compare(live, sealed, "", &mut compared, &mut divergences, &["/voidInstruments"]);
    Parity {
        sealed_summary_present: true,
        fields_compared: compared,
        agrees: divergences.is_empty(),
        divergences,
    }
}

fn compare(
    live: &Value,
    sealed: &Value,
    path: &str,
    compared: &mut usize,
    out: &mut Vec<Divergence>,
    skip: &[&str],
) {
    if skip.contains(&path) {
        return;
    }
    match (live, sealed) {
        (Value::Object(a), Value::Object(b)) => {
            let keys: Vec<&String> = a.keys().chain(b.keys()).collect();
            let mut seen: Vec<&str> = Vec::new();
            for key in keys {
                if seen.contains(&key.as_str()) {
                    continue;
                }
                seen.push(key);
                let child = format!("{path}/{key}");
                match (a.get(key), b.get(key)) {
                    (Some(x), Some(y)) => compare(x, y, &child, compared, out, skip),
                    (Some(x), None) => push_diff(out, &child, x, &Value::Null, compared),
                    (None, Some(y)) => push_diff(out, &child, &Value::Null, y, compared),
                    (None, None) => {}
                }
            }
        }
        (Value::Array(a), Value::Array(b)) => {
            if a.len() != b.len() {
                *compared += 1;
                out.push(Divergence {
                    path: format!("{path} (length)"),
                    live: a.len().to_string(),
                    sealed: b.len().to_string(),
                });
                return;
            }
            for (i, (x, y)) in a.iter().zip(b.iter()).enumerate() {
                compare(x, y, &format!("{path}/{i}"), compared, out, skip);
            }
        }
        (x, y) => push_diff_if_unequal(out, path, x, y, compared),
    }
}

fn scalars_equal(x: &Value, y: &Value) -> bool {
    if x == y {
        return true;
    }
    match (cell_as_dec(x), cell_as_dec(y)) {
        (Some(a), Some(b)) => a.eq_dec(&b).unwrap_or(false),
        _ => false,
    }
}

fn push_diff_if_unequal(
    out: &mut Vec<Divergence>,
    path: &str,
    live: &Value,
    sealed: &Value,
    compared: &mut usize,
) {
    *compared += 1;
    if !scalars_equal(live, sealed) {
        out.push(Divergence {
            path: path.to_string(),
            live: render(live),
            sealed: render(sealed),
        });
    }
}

fn push_diff(
    out: &mut Vec<Divergence>,
    path: &str,
    live: &Value,
    sealed: &Value,
    compared: &mut usize,
) {
    *compared += 1;
    out.push(Divergence {
        path: path.to_string(),
        live: render(live),
        sealed: render(sealed),
    });
}

fn render(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => "(absent)".to_string(),
        other => other.to_string(),
    }
}

/// Shape the analytics the dashboard renders, from the live summary.
///
/// Selection only: every figure here was computed above, in exact decimal, and
/// is forwarded untouched.
pub fn revenue_view(ledger: &Value, summary: &Value, parity: &Parity) -> Value {
    let mut kpis = Map::new();
    for (key, pointer) in [
        ("totalAssets", "/balanceSheet/totalAssets"),
        ("totalLiabilities", "/balanceSheet/totalLiabilities"),
        ("totalEquity", "/balanceSheet/totalEquity"),
        ("balanced", "/balanceSheet/balanced"),
        ("goldFairMarketValue", "/goldAssay/fairMarketValueUsd"),
        ("goldCarryingValue", "/goldAssay/carryingValueUsd"),
        ("unrecordedReserveBuffer", "/goldAssay/unrecordedReserveBufferUsd"),
        ("xCross", "/crossBalance/xCross"),
    ] {
        kpis.insert(
            key.to_string(),
            summary.pointer(pointer).cloned().unwrap_or(Value::Null),
        );
    }

    json!({
        "entity": ledger.get("entity").cloned().unwrap_or(Value::Null),
        "version": ledger.get("version").cloned().unwrap_or(Value::Null),
        "accrualGroundState": {
            "grossRevenue": summary.pointer("/incomeStatement/grossRevenue").cloned().unwrap_or(Value::Null),
            "costOfGoodsSold": summary.pointer("/incomeStatement/costOfGoodsSold").cloned().unwrap_or(Value::Null),
            "note": "ASC 606 / IFRS 15 / CAS 14: No Performance Obligations Satisfied",
        },
        "kpis": Value::Object(kpis),
        "segmentMix": summary.get("segmentMix").cloned().unwrap_or(Value::Array(Vec::new())),
        "crossBalance": summary.get("crossBalance").cloned().unwrap_or(Value::Null),
        "goldAssay": summary.get("goldAssay").cloned().unwrap_or(Value::Null),
        "descendantRegister": summary.get("descendantRegister").cloned().unwrap_or(Value::Null),
        "computation": computation_block(parity),
    })
}

/// How these figures came to exist, stated on the response itself so a reader
/// never has to take it on trust that they were recomputed.
pub fn computation_block(parity: &Parity) -> Value {
    json!({
        "mode": "live",
        "source": "workbook cells (Unified GAAP Ledger), recomputed on every request",
        "arithmetic": "exact base-10 fixed point; no value in this response passed through a float",
        "integerInvariants": "salvi-engine no_std kernel (bijective base-9 digital root, gcd-9 harmonic test)",
        "ratioScaleDecimalPlaces": RATIO_DP,
        "parity": parity,
    })
}
