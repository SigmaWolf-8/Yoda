use capomastro_ledger::conservation::{evaluate, journal_balanced, GateInput, JournalLine};

fn input(kind: &str, values: &[(&str, &str)]) -> GateInput {
    GateInput {
        kind: kind.into(), scope: "Unit-test fixture; not a real transaction".into(),
        unit: "USD".into(), period_start: "2026-10-29T00:00:00Z".into(),
        period_end: "2026-10-29T01:00:00Z".into(),
        evidence: "Deterministic unit-test fixture".into(), note: String::new(),
        values: values.iter().map(|(k,v)| ((*k).into(),(*v).into())).collect(),
    }
}
fn bridge(price: &str) -> GateInput {
    input("bridge", &[("nmt","200000"),("xrp","1"),("price",price)])
}

#[test]
fn bridge_small_gap_is_exact_and_journal_balances() {
    let result = evaluate(&bridge("23999.50")).unwrap();
    assert_eq!(result.residual, "0.5");
    assert_eq!(result.classification, "valuation_shortfall");
    assert_eq!(result.status, "fail");
    assert_eq!(result.global_balanced, Some(true));
    assert!(journal_balanced(&result.journal).unwrap());
    assert_eq!(result.metrics.iter().find(|m| m.label == "Energy represented").unwrap().value, "720000000000");
}

#[test]
fn fifty_cent_xrp_is_not_a_fifty_cent_gap() {
    let result = evaluate(&bridge("0.50")).unwrap();
    assert_eq!(result.residual, "23999.5");
    assert_eq!(result.metrics.iter().find(|m| m.label == "Valuation gap / cost basis").unwrap().value, "99.99791667");
}

#[test]
fn parity_is_not_physical_losslessness() {
    let result = evaluate(&bridge("24000")).unwrap();
    assert_eq!(result.residual, "0");
    assert_eq!(result.classification, "valuation_parity");
    assert_eq!(result.metrics.iter().find(|m| m.label == "Price deviation from reference").unwrap().value, "0");
    assert!(result.local_claim.contains("not established"));
}

#[test]
fn gain_uses_positive_credit_not_negative_debit() {
    let result = evaluate(&bridge("24000.50")).unwrap();
    assert_eq!(result.residual, "-0.5");
    assert!(result.journal.iter().all(|l| !l.debit.starts_with('-') && !l.credit.starts_with('-')));
    assert!(result.journal.iter().any(|l| l.account.contains("Gain") && l.credit == "0.5"));
    assert!(journal_balanced(&result.journal).unwrap());
}

#[test]
fn boundary_uses_accumulation_and_declared_adjustments() {
    let result = evaluate(&input("boundary", &[("opening","100"),("closing","115"),
        ("inflows","25"),("outflows","5"),("adjustments","-5")])).unwrap();
    assert_eq!(result.residual, "0");
    assert_eq!(result.metrics.iter().find(|m| m.label.starts_with("Outward")).unwrap().value, "-20");
    assert_eq!(result.global_balanced, None);
}

#[test]
fn missing_flow_is_unknown_not_zero() {
    assert!(evaluate(&input("boundary", &[("opening","100"),("closing","100"),
        ("inflows","0"),("adjustments","0")])).is_err());
}

#[test]
fn opposite_residuals_must_not_hide_local_failures() {
    for closing in ["99", "101"] {
        let result = evaluate(&input("boundary", &[("opening","100"),("closing",closing),
            ("inflows","0"),("outflows","0"),("adjustments","0")])).unwrap();
        assert_eq!(result.status, "fail");
        assert_ne!(result.residual, "0");
    }
}

#[test]
fn reserve_surplus_is_not_zero_flux_but_meets_declared_backing() {
    let result = evaluate(&input("reserve", &[("reserves","101"),("liabilities","100")])).unwrap();
    assert_eq!(result.classification, "reserve_surplus");
    assert_eq!(result.residual, "1");
    assert_eq!(result.status, "pass");
}

#[test]
fn reserve_shortfall_fails_at_cell_level() {
    let result = evaluate(&input("reserve", &[("reserves","99.99"),("liabilities","100")])).unwrap();
    assert_eq!(result.residual, "-0.01");
    assert_eq!(result.status, "fail");
}

#[test]
fn writeoff_keeps_named_asset_and_balanced_journal() {
    let result = evaluate(&input("writeOff", &[("amount","25.13"),("asset","Metered equipment")])).unwrap();
    assert_eq!(result.journal[1].account, "Metered equipment");
    assert_eq!(result.journal[1].credit, "25.13");
    assert_eq!(result.global_balanced, Some(true));
}

#[test]
fn rejects_invalid_or_unproven_inputs() {
    for price in ["-1", "NaN", "Infinity", "1e3", "0.000000001", " 1", "+1"] {
        assert!(evaluate(&bridge(price)).is_err(), "{price}");
    }
    let mut no_evidence = bridge("1");
    no_evidence.evidence.clear();
    assert!(evaluate(&no_evidence).is_err());
    let mut wrong_currency = bridge("1");
    wrong_currency.unit = "CAD".into();
    assert!(evaluate(&wrong_currency).is_err());
    let mut extra = bridge("1");
    extra.values.insert("hiddenAmount".into(), "123".into());
    assert!(evaluate(&extra).is_err());
    assert!(evaluate(&input("writeOff", &[("amount","0"),("asset","Asset")])).is_err());
}

#[test]
fn fractional_money_never_round_trips_through_float() {
    let result = evaluate(&input("bridge", &[("nmt","200000.00000001"),
        ("xrp","1.00000001"),("price","24000.00000001")])).unwrap();
    assert_eq!(result.residual, "-0.0002400088000001");
    assert!(journal_balanced(&result.journal).unwrap());
}

#[test]
fn overflow_is_an_error_not_saturation() {
    assert!(evaluate(&input("bridge", &[("nmt","999999999999999999999999"),
        ("xrp","999999999999999999999999"),("price","999999999999999999999999")])).is_err());
}

#[test]
fn journal_integrity_detects_unbalanced_and_negative_lines() {
    assert!(!journal_balanced(&[JournalLine { account:"a".into(),debit:"1".into(),credit:"0".into() }]).unwrap());
    assert!(journal_balanced(&[JournalLine { account:"a".into(),debit:"-1".into(),credit:"0".into() }]).is_err());
}
