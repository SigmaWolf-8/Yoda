//! Deterministic, explicitly scoped checks. No model calls or fabricated proofs.
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub type Inputs = BTreeMap<String, String>;

pub fn catalog() -> Value {
    json!({"formulas":[
        {"id":"divergence","title":"Divergence–Flux: cancellation and interior balls",
         "method":"Closed-form reference and 4096-panel midpoint surface quadrature for F=(x²,0,0)",
         "inputs":{"center_x":"0","radius":"1","orientation":"outward","tolerance":"0.000001"},
         "limitations":["Finite quadrature is not proof of the universal local condition.","Ball centre is (center_x,0,0); its closure must lie within the unit ball, or equal it for the global case.","Geometry uses IEEE-754; the analytic reference is specific to this polynomial."]},
        {"id":"arc182","title":"Arc182 canonical axiom identities",
         "method":"Checked exact integer derivation; framework pi_geom is not the circle constant π",
         "inputs":{"c":"3","pi_geom":"14","alpha":"1"},
         "limitations":["Tests these declared identities only; not every formula in the Codex.","A changed axiom instance can legitimately fail an identity; failed results are saved."]},
        {"id":"isopsephy","title":"Milesian sum of explicit Greek glyphs",
         "method":"Exact integer glyph-weight sum and digital root",
         "inputs":{"text":"ΑΒΓ"},
         "limitations":["This check does not transliterate arbitrary languages. The full supplied instrument provides its own transliteration ledger.","Unsupported glyphs are rejected, not silently dropped.","A word-number correspondence does not establish an empirical or legal claim."]},
        {"id":"bridge","title":"Declared NMT/XRP valuation parity",
         "method":"Exact integer cents: NMT × 12 cents minus XRP × recorded price",
         "inputs":{"nmt":"200000","xrp":"1","price":"24000.00"},
         "limitations":["Whole NMT and XRP quantities; USD prices have at most two decimals.","A pass means parity under the stated 0.12 USD/NMT assumption, not physical losslessness or an executed settlement.","A nonzero gap is retained as a failed parity gate."]}
    ]})
}

fn text<'a>(input: &'a Inputs, key: &str) -> Result<&'a str,String> {
    input.get(key).map(|v|v.trim()).filter(|v|!v.is_empty())
        .ok_or_else(||format!("{key} is required"))
}
fn integer(input:&Inputs,key:&str,max:i128)->Result<i128,String>{
    let s=text(input,key)?;
    if !s.bytes().all(|b|b.is_ascii_digit()) {return Err(format!("{key} must be an unsigned whole number"));}
    let n=s.parse::<i128>().map_err(|_|format!("{key} exceeds the integer range"))?;
    if n>max {return Err(format!("{key} must not exceed {max}"));}
    Ok(n)
}
fn number(input:&Inputs,key:&str)->Result<f64,String>{
    let n=text(input,key)?.parse::<f64>().map_err(|_|format!("{key} must be numeric"))?;
    if !n.is_finite(){return Err(format!("{key} must be finite"));}
    Ok(n)
}
fn check(name:&str,passed:bool,actual:Value,expected:Value)->Value {
    json!({"name":name,"passed":passed,"actual":actual,"expected":expected})
}
fn result(id:&str,outputs:Value,checks:Vec<Value>)->Value {
    let cat=catalog();
    let entry=cat["formulas"].as_array().unwrap().iter().find(|e|e["id"]==id).unwrap();
    json!({"status":if checks.iter().all(|c|c["passed"]==true) {"pass"} else {"fail"},
        "method":entry["method"],"scope":"Only this formula, these declared inputs, and the checks shown. Computed by the application server, not by an AI daemon.",
        "outputs":outputs,"checks":checks,"limitations":entry["limitations"]})
}

pub fn evaluate(id:&str,input:&Inputs)->Result<Value,String>{
    match id {
        "divergence"=>divergence(input),
        "arc182"=>arc182(input),
        "isopsephy"=>isopsephy(input),
        "bridge"=>bridge(input),
        _=>Err("Unknown formula; unregistered formulas are not certified".into()),
    }
}

fn divergence(input:&Inputs)->Result<Value,String>{
    let x=number(input,"center_x")?;
    let r=number(input,"radius")?;
    let tolerance=number(input,"tolerance")?;
    let global=x==0.0 && r==1.0;
    if r<1e-6 || r>1.0 || (!global && x.abs()+r>=1.0) {
        return Err("Use the global unit ball or an interior ball with radius ≥ 1e-6 and |center_x|+radius<1".into());
    }
    if !(1e-12..=1e-3).contains(&tolerance){return Err("Tolerance must be between 1e-12 and 0.001".into());}
    let orientation=text(input,"orientation")?;
    let sign=match orientation {"outward"=>1.0,"inward"=>-1.0,_=>return Err("Orientation must be outward or inward".into())};
    let volume=4.0*std::f64::consts::PI*r.powi(3)/3.0;
    let integral=2.0*x*volume;
    // x-axis polar coordinate mu: dS=r² dmu dphi, F·n=(x+r*mu)²*mu.
    // Integrate phi exactly (no phi dependence), mu by independent quadrature.
    let panels=4096;
    let step=2.0/f64::from(panels);
    let sum:f64=(0..panels).map(|i|{
        let mu=-1.0+(f64::from(i)+0.5)*step;
        (x+r*mu).powi(2)*mu
    }).sum();
    let flux=sign*2.0*std::f64::consts::PI*r*r*step*sum;
    let reference=sign*integral;
    let error=(flux-reference).abs();
    let mut quadrature=check("Oriented numerical flux agrees with polynomial reference",
        error<=tolerance,json!(flux),json!(reference));
    quadrature["tolerance"]=json!(tolerance);
    let witness_x=0.5_f64;
    let witness_divergence=2.0*witness_x;
    Ok(result("divergence",json!({
        "field":"F(x,y,z)=(x²,0,0)","divergence":"2x",
        "surface_method":"4096 midpoint panels in mu; exact azimuth integration",
        "ball_center":[x,0.0,0.0],"radius":r,"orientation":orientation,
        "ball_volume":volume,"volume_divergence_integral":integral,
        "oriented_reference_flux":reference,"numerical_flux":flux,"absolute_error":error,
        "reference_average_divergence":integral/volume,
        "global_unit_ball_reference_flux":0,
        "counterexample_witness":{"point":[witness_x,0.0,0.0],"divergence":witness_divergence},
        "universal_local_condition_proved_by_this_run":false
    }),vec![quadrature,check("The unit-ball cancellation counterexample has nonzero pointwise divergence",
        witness_divergence!=0.0,json!(witness_divergence),json!("nonzero"))]))
}

fn arc182(input:&Inputs)->Result<Value,String>{
    let c=integer(input,"c",4)?;
    let pi=integer(input,"pi_geom",1000)?;
    let alpha=integer(input,"alpha",3)?;
    if c<2 || alpha==0 || alpha>=c || pi<=c {return Err("Require 2≤c≤4, 0<alpha<c and pi_geom>c".into());}
    let beta=c-alpha;
    if pi%beta!=0 {return Err("pi_geom must be divisible by beta=c-alpha; no rounded quotient is used".into());}
    let p=pi/beta; let q=pi-c; let r=pi-alpha;
    let sigma=beta*c;
    let delta=beta.pow(beta as u32);
    let lambda=p*r;
    let circumference=delta*lambda;
    let arc=beta*lambda;
    let repunit=(c.pow(sigma as u32)-1)/(c-1);
    let theta=c*c;
    let seventeen=pi+c;
    let fish=theta*seventeen;
    let triangular=format!("{}/{}",seventeen*(seventeen+alpha),beta);
    let digit_cube_sum:i128=fish.to_string().bytes().map(|b|i128::from(b-b'0').pow(c as u32)).sum();
    Ok(result("arc182",json!({"c":c.to_string(),"pi_geom":pi.to_string(),"alpha":alpha.to_string(),
        "beta":beta.to_string(),"p":p.to_string(),"q":q.to_string(),"r":r.to_string(),
        "sigma":sigma.to_string(),"delta":delta.to_string(),"lambda":lambda.to_string(),
        "circumference":circumference.to_string(),"arc":arc.to_string(),"repunit":repunit.to_string(),"fish":fish.to_string()}),
        vec![
            check("Derived circumference equals the repunit",circumference==repunit,json!(circumference.to_string()),json!(repunit.to_string())),
            check("Two arcs equal the circumference",2*arc==circumference,json!((2*arc).to_string()),json!(circumference.to_string())),
            check("Fish equals the declared triangular expression",fish*beta==seventeen*(seventeen+alpha),json!(fish.to_string()),json!(triangular)),
            check("Fish equals sum of digit powers",fish==digit_cube_sum,json!(fish.to_string()),json!(digit_cube_sum.to_string()))
        ]))
}

fn glyph_weight(c:char)->Option<i128>{
    Some(match c{
        'Α'|'Ά'=>1,'Β'=>2,'Γ'=>3,'Δ'=>4,'Ε'|'Έ'=>5,'Ϛ'|'Ϝ'=>6,'Ζ'=>7,'Η'|'Ή'=>8,'Θ'=>9,
        'Ι'|'Ί'|'Ϊ'=>10,'Κ'=>20,'Λ'=>30,'Μ'=>40,'Ν'=>50,'Ξ'=>60,'Ο'|'Ό'=>70,'Π'=>80,'Ϟ'|'Ϙ'=>90,
        'Ρ'=>100,'Σ'=>200,'Τ'=>300,'Υ'|'Ύ'|'Ϋ'=>400,'Φ'=>500,'Χ'=>600,'Ψ'=>700,'Ω'|'Ώ'=>800,'Ϡ'=>900,
        _=>return None,
    })
}
fn isopsephy(input:&Inputs)->Result<Value,String>{
    let value=text(input,"text")?;
    if value.len()>4096 {return Err("Text must be at most 4096 UTF-8 bytes".into());}
    let mut letters=Vec::new(); let mut sum=0_i128;
    for c in value.chars().flat_map(char::to_uppercase){
        if c.is_whitespace(){continue;}
        let weight=glyph_weight(c).ok_or_else(||format!("Unsupported glyph {c:?}; supply explicit supported Greek letters, without punctuation or transliteration"))?;
        sum+=weight;
        letters.push(json!({"glyph":c.to_string(),"value":weight.to_string()}));
    }
    if letters.is_empty(){return Err("At least one Greek glyph is required".into());}
    let mut repeated=sum;
    while repeated>=10 {repeated=repeated.to_string().bytes().map(|b|i128::from(b-b'0')).sum();}
    let root=if sum==0 {0}else{1+(sum-1)%9};
    Ok(result("isopsephy",json!({"text":value,"glyphs":letters,"sum":sum.to_string(),"digital_root":root.to_string()}),
        vec![check("Modulo-nine root agrees with repeated digit summation",root==repeated,json!(root.to_string()),json!(repeated.to_string()))]))
}

fn money(cents:i128)->String{
    format!("{}{}.{:02}",if cents<0{"-"}else{""},cents.abs()/100,cents.abs()%100)
}
fn bridge(input:&Inputs)->Result<Value,String>{
    let nmt=integer(input,"nmt",1_000_000_000_000)?;
    let xrp=integer(input,"xrp",1_000_000_000_000)?;
    let s=text(input,"price")?;
    let mut split=s.split('.');
    let whole=split.next().unwrap();
    let fraction=split.next().unwrap_or("");
    if split.next().is_some() || whole.is_empty() || fraction.len()>2 ||
       !whole.bytes().chain(fraction.bytes()).all(|b|b.is_ascii_digit()) {
        return Err("Price must be a nonnegative USD decimal with at most two fractional digits".into());
    }
    let dollars=whole.parse::<i128>().map_err(|_|"Price exceeds supported range".to_string())?;
    if dollars>1_000_000_000_000 {return Err("Price exceeds supported range".into());}
    let cents=dollars*100+format!("{fraction:0<2}").parse::<i128>().map_err(|_|"Invalid price".to_string())?;
    let cost=nmt*12; let settlement=xrp*cents; let gap=cost-settlement;
    Ok(result("bridge",json!({"nmt":nmt.to_string(),"xrp":xrp.to_string(),"price_usd_per_xrp":money(cents),
        "cost_usd":money(cost),"recorded_value_usd":money(settlement),"valuation_gap_usd":money(gap),
        "assumption_usd_per_nmt":"0.12","reference_usd_per_xrp_for_200000_nmt":"24000.00",
        "posting":if gap>0 {"positive loss/debit observation"}else if gap<0 {"positive gain/credit observation"}else{"parity"},
        "transaction_executed":false}),
        vec![check("Declared valuation parity",gap==0,json!(money(gap)),json!("0.00"))]))
}
