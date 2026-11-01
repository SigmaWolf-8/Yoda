use serde_json::Value;

pub fn peer_for_port(registry: &Value, port: u16) -> Result<String, String> {
    let peers = registry["nodes"].as_array().ok_or("Relay registry has no nodes")?;
    let candidates: Vec<String> = peers.iter().filter_map(|p| {
        let endpoint = p["endpoint"].as_str()?;
        let gateway: u16 = endpoint.rsplit(':').next()?.parse().ok()?;
        if p["connected"] != true || gateway.checked_add(1) != Some(port) { return None; }
        Some(p["address"].as_str()?.replace(['.', ','], ""))
    }).collect();
    match candidates.as_slice() {
        [peer] => Ok(peer.clone()),
        [] => Err(format!("No connected daemon advertises gateway port {} for model port {port}. No other node was substituted.", port.saturating_sub(1))),
        _ => Err("Multiple daemons advertise this model route; cannot safely choose one".into()),
    }
}

pub fn validate_answer(content: &str, expected: &str, model: &str, finish: Option<&str>) -> Result<(), String> {
    if content.trim().is_empty() { return Err("Model returned an empty answer; generation is not verified".into()); }
    if expected != model { return Err(format!("Model mismatch: requested {expected}, received {model}")); }
    if let Some(reason) = finish {
        if !matches!(reason, "stop" | "eos") {
            return Err(format!("Model answer did not complete normally ({reason})"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn routing_uses_advertised_gateway_not_slot_name() {
        let registry=json!({"nodes":[{"connected":true,"endpoint":"host:11151","address":"311.111.111.111.1"}]});
        assert_eq!(peer_for_port(&registry,11152).unwrap(),"3111111111111");
        assert!(peer_for_port(&registry,11125).is_err());
    }
    #[test]
    fn no_disconnected_or_ambiguous_route() {
        let peer=json!({"connected":true,"endpoint":"host:11151","address":"3111111111111"});
        assert!(peer_for_port(&json!({"nodes":[peer.clone(),peer]}),11152).is_err());
        assert!(peer_for_port(&json!({"nodes":[{"connected":false,"endpoint":"host:11151","address":"3111111111111"}]}),11152).is_err());
    }
    #[test]
    fn empty_wrong_model_and_unfinished_are_failures() {
        for content in [""," ","\n\t"] { assert!(validate_answer(content,"M","M",None).is_err()); }
        assert!(validate_answer("323","M","other",None).is_err());
        for reason in ["length","content_filter","tool_calls","error"] {
            assert!(validate_answer("323","M","M",Some(reason)).is_err());
        }
    }
    #[test]
    fn nonempty_answer_is_required_but_correctness_is_not_claimed() {
        assert!(validate_answer("323","M","M",Some("stop")).is_ok());
        assert!(validate_answer("other answer","M","M",None).is_ok());
    }
}
