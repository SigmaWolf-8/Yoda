#[path="../src/formula_math.rs"]
mod formula_math;
use formula_math::{evaluate,Inputs};
use serde_json::json;
fn inputs(values:&[(&str,&str)])->Inputs {
    values.iter().map(|(k,v)|(k.to_string(),v.to_string())).collect()
}
#[test]
fn all_catalog_examples_execute(){
    for entry in formula_math::catalog()["formulas"].as_array().unwrap(){
        let data:Inputs=serde_json::from_value(entry["inputs"].clone()).unwrap();
        let output=evaluate(entry["id"].as_str().unwrap(),&data).unwrap();
        assert_eq!(output["status"],"pass");
    }
}
#[test]
fn global_cancellation_is_not_pointwise_zero(){
    let r=evaluate("divergence",&inputs(&[("center_x","0"),("radius","1"),("orientation","outward"),("tolerance","0.000001")])).unwrap();
    assert_eq!(r["outputs"]["global_unit_ball_reference_flux"],0);
    assert_eq!(r["outputs"]["counterexample_witness"]["divergence"],1.0);
    assert_eq!(r["outputs"]["universal_local_condition_proved_by_this_run"],false);
    assert!(r["outputs"]["absolute_error"].as_f64().unwrap()<1e-6);
}
#[test]
fn local_ball_and_orientation(){
    let mut data=inputs(&[("center_x","0.5"),("radius","0.25"),("orientation","outward"),("tolerance","0.000001")]);
    let outward=evaluate("divergence",&data).unwrap();
    assert_eq!(outward["outputs"]["reference_average_divergence"],1.0);
    assert!(outward["outputs"]["numerical_flux"].as_f64().unwrap()>0.0);
    data.insert("orientation".into(),"inward".into());
    let inward=evaluate("divergence",&data).unwrap();
    assert_eq!(inward["outputs"]["numerical_flux"].as_f64().unwrap(),-outward["outputs"]["numerical_flux"].as_f64().unwrap());
    assert_eq!(inward["outputs"]["volume_divergence_integral"],outward["outputs"]["volume_divergence_integral"]);
    data.insert("radius".into(),"0.5".into());
    assert!(evaluate("divergence",&data).is_err(),"A touching ball is not interior");
}
#[test]
fn finite_tolerance_failures_are_not_hidden(){
    let data=inputs(&[("center_x","0.5"),("radius","0.25"),("orientation","outward"),("tolerance","0.000000000001")]);
    assert_eq!(evaluate("divergence",&data).unwrap()["status"],"fail");
}
#[test]
fn nonfinite_and_underflow_rejected(){
    for radius in ["NaN","inf","0","1e-300","-1"] {
        let data=inputs(&[("center_x","0"),("radius",radius),("orientation","outward"),("tolerance","0.000001")]);
        assert!(evaluate("divergence",&data).is_err());
    }
}
#[test]
fn canonical_values_are_derived_exactly(){
    let r=evaluate("arc182",&inputs(&[("c","3"),("pi_geom","14"),("alpha","1")])).unwrap();
    assert_eq!(r["outputs"]["arc"],"182");
    assert_eq!(r["outputs"]["circumference"],"364");
    assert_eq!(r["outputs"]["fish"],"153");
    assert_eq!(r["status"],"pass");
    let changed=evaluate("arc182",&inputs(&[("c","2"),("pi_geom","12"),("alpha","1")])).unwrap();
    assert_eq!(changed["status"],"fail");
}
#[test]
fn greek_sum_rejects_unmapped_input(){
    assert_eq!(evaluate("isopsephy",&inputs(&[("text","α β γ")])).unwrap()["outputs"]["sum"],"6");
    assert_eq!(evaluate("isopsephy",&inputs(&[("text","ϛϟϡ")])).unwrap()["outputs"]["sum"],"996");
    assert!(evaluate("isopsephy",&inputs(&[("text","ALPHA")])).is_err());
    assert!(evaluate("isopsephy",&inputs(&[("text","Α!")])).is_err());
}
#[test]
fn bridge_distinguishes_the_two_half_dollar_scenarios(){
    let first=evaluate("bridge",&inputs(&[("nmt","200000"),("xrp","1"),("price","23999.50")])).unwrap();
    let second=evaluate("bridge",&inputs(&[("nmt","200000"),("xrp","1"),("price","0.50")])).unwrap();
    assert_eq!(first["outputs"]["valuation_gap_usd"],"0.50");
    assert_eq!(second["outputs"]["valuation_gap_usd"],"23999.50");
    assert_eq!(first["status"],"fail");
    assert_eq!(first["outputs"]["transaction_executed"],false);
    let gain=evaluate("bridge",&inputs(&[("nmt","200000"),("xrp","1"),("price","24000.50")])).unwrap();
    assert_eq!(gain["outputs"]["valuation_gap_usd"],"-0.50");
    assert_eq!(gain["outputs"]["posting"],"positive gain/credit observation");
    assert!(evaluate("bridge",&inputs(&[("nmt","1"),("xrp","1"),("price","0.001")])).is_err());
}
#[test]
fn unsupported_formula_is_not_certified(){
    assert!(evaluate("all-codex",&Inputs::new()).is_err());
    assert_eq!(json!(evaluate("isopsephy",&Inputs::new()).is_err()),true);
}
