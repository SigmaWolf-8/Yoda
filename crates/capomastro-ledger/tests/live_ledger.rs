//! The live computation is checked against two independent things: the sealed
//! extraction published by `scripts/extract-gaap-ledger.py`, and the workbook's
//! own arithmetic identities. A test that only compared the live figures to
//! themselves would pass on any consistent set of wrong numbers.

use capomastro_ledger::dec::Dec;
use capomastro_ledger::live::{compute, LedgerError};
use serde_json::{json, Value};

fn data_root() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("data/capomastro")
}

fn load(name: &str) -> Value {
    let path = data_root().join(name);
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("{} not readable: {e}", path.display()));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("{} is not JSON: {e}", path.display()))
}

fn computed() -> capomastro_ledger::live::Computed {
    compute(&load("gaap-ledger.json"), &load("void-instruments.json"))
        .expect("live computation refused the committed ledger")
}

fn dec(summary: &Value, pointer: &str) -> Dec {
    let raw = summary
        .pointer(pointer)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("{pointer} missing from the live summary"));
    Dec::parse(raw).unwrap_or_else(|e| panic!("{pointer} is not a decimal: {e}"))
}

#[test]
fn live_figures_agree_with_the_sealed_extraction() {
    let out = computed();
    assert!(
        out.parity.sealed_summary_present,
        "the committed ledger carries no sealed summary to check against"
    );
    assert!(
        out.parity.fields_compared > 50,
        "only {} fields were compared; the parity check is not reaching the figures",
        out.parity.fields_compared
    );
    assert!(
        out.parity.agrees,
        "live computation diverges from the sealed extraction: {:#?}",
        out.parity.divergences
    );
}

#[test]
fn the_sheet_actually_foots() {
    let s = computed().summary;
    let assets = dec(&s, "/balanceSheet/totalAssets");
    let l_and_e = dec(&s, "/balanceSheet/totalLiabilitiesAndEquity");
    assert!(
        assets.eq_dec(&l_and_e).unwrap(),
        "assets {assets} != liabilities + equity {l_and_e}"
    );
    assert_eq!(
        s.pointer("/balanceSheet/balanced"),
        Some(&Value::Bool(true)),
        "the ledger reports itself unbalanced"
    );
}

#[test]
fn gold_valuation_is_the_product_of_its_stated_inputs() {
    let s = computed().summary;
    let bars = dec(&s, "/goldAssay/barsCounted");
    let per_bar = dec(&s, "/goldAssay/nominalMassPerBarKg");
    let purity = dec(&s, "/goldAssay/finePurity");
    let troy = dec(&s, "/goldAssay/troyOunceFactor");
    let spot = dec(&s, "/goldAssay/lbmaSpotUsdPerOz");

    let ounces = bars
        .mul_exact(&per_bar)
        .unwrap()
        .mul_exact(&purity)
        .unwrap()
        .mul_exact(&troy)
        .unwrap();
    assert!(
        ounces.eq_dec(&dec(&s, "/goldAssay/fineGoldOunces")).unwrap(),
        "fine ounces do not reproduce from bars × mass × purity × troy factor"
    );
    assert!(
        ounces
            .mul_exact(&spot)
            .unwrap()
            .eq_dec(&dec(&s, "/goldAssay/fairMarketValueUsd"))
            .unwrap(),
        "fair value is not ounces × spot"
    );
    // The buffer is a disclosure, not a posting: it must be the gap between
    // fair value and the historical carrying amount, nothing else.
    let gap = dec(&s, "/goldAssay/fairMarketValueUsd")
        .sub(&dec(&s, "/goldAssay/carryingValueUsd"))
        .unwrap();
    assert!(gap
        .eq_dec(&dec(&s, "/goldAssay/unrecordedReserveBufferUsd"))
        .unwrap());
}

#[test]
fn segment_shares_sum_to_one_and_are_ordered() {
    let s = computed().summary;
    let mix = s
        .get("segmentMix")
        .and_then(Value::as_array)
        .expect("no segment mix");
    assert!(mix.len() >= 2, "a one-line mix is not a composition");

    let mut total = Dec::zero();
    let mut previous: Option<Dec> = None;
    for entry in mix {
        let value = Dec::parse(entry["value"].as_str().unwrap()).unwrap();
        total = total
            .add(&Dec::parse(entry["share"].as_str().unwrap()).unwrap())
            .unwrap();
        if let Some(prev) = previous {
            assert!(
                prev.cmp_dec(&value).unwrap() != std::cmp::Ordering::Less,
                "segment mix is not ordered largest-first"
            );
        }
        previous = Some(value);
    }
    // Shares are stated at twelve places, so they sum to one within the last
    // published digit — asserting exact equality would be asserting that a
    // rounded set of ratios is unrounded.
    let drift = total.sub(&Dec::from_int(1)).unwrap().abs();
    assert!(
        drift.cmp_dec(&Dec::parse("0.000000000001").unwrap()).unwrap()
            != std::cmp::Ordering::Greater,
        "shares sum to {total}, which is off by more than the published scale"
    );
}

#[test]
fn descendant_invariants_come_from_the_kernel() {
    let s = computed().summary;
    let total = s["descendantRegister"]["totalRegisteredDescendants"]
        .as_u64()
        .expect("descendant total is not a whole number");
    let root = s["descendantRegister"]["digitalRoot"].as_u64().unwrap();
    let harmonic = s["descendantRegister"]["harmonic"].as_bool().unwrap();
    assert_eq!(root, ((total - 1) % 9) + 1);
    assert_eq!(harmonic, total % 9 == 0);
}

#[test]
fn a_resurrected_strike_stops_the_computation() {
    let mut ledger = load("gaap-ledger.json");
    let voids = load("void-instruments.json");
    let label = voids["strikes"][0]["label"]
        .as_str()
        .expect("no strike to test with")
        .to_string();

    // Put the struck line back into the workbook cells, exactly as a careless
    // re-extraction would.
    ledger["sheets"]["Balance Sheet"]["rows"]
        .as_array_mut()
        .unwrap()
        .push(json!([label.clone(), "999", "Restored by accident"]));

    let err = compute(&ledger, &voids).expect_err("a resurrected strike was served as fact");
    let LedgerError(message) = err;
    assert!(
        message.contains(&label) && message.to_lowercase().contains("resurrect"),
        "unhelpful refusal: {message}"
    );
}

#[test]
fn a_silent_workbook_is_refused_rather_than_zeroed() {
    let mut ledger = load("gaap-ledger.json");
    let voids = load("void-instruments.json");

    // Blank the gold spot price the way a stripped formula cell would.
    let rows = ledger["sheets"]["Gold Assay & Valuation"]["rows"]
        .as_array_mut()
        .unwrap();
    for row in rows.iter_mut() {
        let is_spot = row
            .as_array()
            .and_then(|cells| cells.first())
            .and_then(Value::as_str)
            .map(|label| label.to_lowercase().contains("lbma pm gold fix price"))
            .unwrap_or(false);
        if is_spot {
            *row = json!(["LBMA PM Gold Fix Price", "", "USD / oz"]);
        }
    }

    let err = compute(&ledger, &voids)
        .expect_err("a missing gold price produced a valuation anyway");
    let LedgerError(message) = err;
    assert!(
        message.to_lowercase().contains("refusing to substitute zero"),
        "wrong refusal: {message}"
    );
}

#[test]
fn a_numeric_looking_note_is_not_mistaken_for_the_value() {
    let mut ledger = load("gaap-ledger.json");
    let voids = load("void-instruments.json");

    // The value column goes blank and the column beside it happens to read
    // like a number — a unit written as a bare figure, an authority reference
    // that is all digits. Scanning onward for "the first numeric cell" would
    // publish that as the gold price.
    let rows = ledger["sheets"]["Gold Assay & Valuation"]["rows"]
        .as_array_mut()
        .unwrap();
    for row in rows.iter_mut() {
        let is_spot = row
            .as_array()
            .and_then(|cells| cells.first())
            .and_then(Value::as_str)
            .map(|label| label.to_lowercase().contains("lbma pm gold fix price"))
            .unwrap_or(false);
        if is_spot {
            *row = json!(["LBMA PM Gold Fix Price", "", "820", "WP-2026-AU-820-GOLD"]);
        }
    }

    let err = compute(&ledger, &voids)
        .expect_err("an audit reference number was published as the gold price");
    let LedgerError(message) = err;
    assert!(
        message.contains("LBMA PM Gold Fix Price"),
        "wrong refusal: {message}"
    );
}

#[test]
fn a_quadrant_with_no_reserve_is_refused_not_zeroed() {
    let mut ledger = load("gaap-ledger.json");
    let voids = load("void-instruments.json");

    let rows = ledger["sheets"]["Cross-Balance Matrix"]["rows"]
        .as_array_mut()
        .unwrap();
    for row in rows.iter_mut() {
        let is_leg = row
            .as_array()
            .and_then(|cells| cells.first())
            .and_then(Value::as_str)
            .map(|label| label.to_lowercase().starts_with("leg 2"))
            .unwrap_or(false);
        if is_leg {
            row.as_array_mut().unwrap()[3] = json!(0);
        }
    }

    let err = compute(&ledger, &voids).expect_err("an unbacked quadrant was published as balanced");
    let LedgerError(message) = err;
    assert!(message.contains("no reserve"), "wrong refusal: {message}");
}

#[test]
fn a_year_typed_as_text_is_not_spent_as_money() {
    let mut ledger = load("gaap-ledger.json");
    let voids = load("void-instruments.json");

    // The workbook's own typing is the only thing separating a figure from a
    // note that reads like one. Put text in the gold price cell — parseable,
    // plausible, and not a number as far as the spreadsheet is concerned — and
    // withdraw it from the typing index, exactly as the extractor would.
    let sheet = &mut ledger["sheets"]["Gold Assay & Valuation"];
    let mut spot_row = None;
    for (index, row) in sheet["rows"].as_array().unwrap().iter().enumerate() {
        let is_spot = row
            .as_array()
            .and_then(|cells| cells.first())
            .and_then(Value::as_str)
            .map(|label| label.to_lowercase().contains("lbma pm gold fix price"))
            .unwrap_or(false);
        if is_spot {
            spot_row = Some(index);
        }
    }
    let spot_row = spot_row.expect("the workbook states no gold price");
    sheet["rows"][spot_row][1] = json!("2026");
    let index: Vec<Value> = sheet["numericCells"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|pair| pair[0].as_u64() != Some(spot_row as u64) || pair[1].as_u64() != Some(1))
        .cloned()
        .collect();
    sheet["numericCells"] = Value::Array(index);

    let err = compute(&ledger, &voids).expect_err("a text cell was valued as a gold price");
    let LedgerError(message) = err;
    assert!(
        message.contains("as text") && message.contains("LBMA PM Gold Fix Price"),
        "wrong refusal: {message}"
    );
}

#[test]
fn an_untyped_workbook_cannot_be_computed_from() {
    let mut ledger = load("gaap-ledger.json");
    let voids = load("void-instruments.json");
    ledger["sheets"]["Balance Sheet"]
        .as_object_mut()
        .unwrap()
        .remove("numericCells");

    let err = compute(&ledger, &voids)
        .expect_err("figures were read from cells of unknown type");
    let LedgerError(message) = err;
    assert!(
        message.contains("cell-typing index"),
        "wrong refusal: {message}"
    );
}

#[test]
fn a_weight_beyond_the_working_precision_is_refused() {
    let mut ledger = load("gaap-ledger.json");
    let voids = load("void-instruments.json");

    let rows = ledger["sheets"]["Cross-Balance Matrix"]["rows"]
        .as_array_mut()
        .unwrap();
    for row in rows.iter_mut() {
        let is_leg = row
            .as_array()
            .and_then(|cells| cells.first())
            .and_then(Value::as_str)
            .map(|label| label.to_lowercase().starts_with("leg 1"))
            .unwrap_or(false);
        if is_leg {
            row.as_array_mut().unwrap()[4] = json!(50000);
        }
    }

    let err = compute(&ledger, &voids)
        .expect_err("a weight was published at a precision the arithmetic cannot support");
    let LedgerError(message) = err;
    assert!(
        message.contains("no longer supports"),
        "wrong refusal: {message}"
    );
}

#[test]
fn losing_a_known_strike_stops_the_ledger() {
    let ledger = load("gaap-ledger.json");
    let mut voids = load("void-instruments.json");
    voids["strikes"] = json!([]);

    let err = compute(&ledger, &voids)
        .expect_err("emptying the declaration file quietly reinstated the instrument");
    let LedgerError(message) = err;
    assert!(
        message.contains("OBL-DAMAGE-OFFSET"),
        "wrong refusal: {message}"
    );
}

#[test]
fn an_incomplete_strike_is_not_a_declaration() {
    let ledger = load("gaap-ledger.json");
    let mut voids = load("void-instruments.json");
    voids["strikes"][0]["basis"] = json!("");
    voids["strikes"][0]["declaredBy"] = json!("");

    let err = compute(&ledger, &voids).expect_err("an unexplained deletion was accepted");
    let LedgerError(message) = err;
    assert!(
        message.contains("basis") && message.contains("declaredBy"),
        "wrong refusal: {message}"
    );
}

#[test]
fn an_unchecked_ledger_is_not_published() {
    let mut ledger = load("gaap-ledger.json");
    let voids = load("void-instruments.json");
    ledger.as_object_mut().unwrap().remove("summary");

    let err = compute(&ledger, &voids)
        .expect_err("live figures were served with nothing to check them against");
    let LedgerError(message) = err;
    assert!(
        message.contains("cross-check"),
        "wrong refusal: {message}"
    );
}
