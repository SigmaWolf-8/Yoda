#[path = "../src/query_relay_selection.rs"]
mod query_relay_selection;

use query_relay_selection::select_configured_route;
use std::collections::HashSet;

fn engines() -> Vec<(String, String, String)> {
    vec![
        ("a".into(), "model-a".into(), "endpoint-a".into()),
        ("b".into(), "model-b".into(), "endpoint-b".into()),
    ]
}

#[tokio::test]
async fn unavailable_a_uses_live_b_with_bs_own_model() {
    let live = HashSet::from(["peer-b".into()]);
    let selected = select_configured_route(engines(), &live, |endpoint| async move {
        match endpoint.as_str() {
            "endpoint-a" => None,
            "endpoint-b" => Some("peer-b".into()),
            _ => panic!("unconfigured route"),
        }
    }).await;
    assert_eq!(selected, Some(("b".into(), "model-b".into(), "peer-b".into())));
}

#[tokio::test]
async fn advertised_but_disconnected_a_does_not_block_b() {
    let live = HashSet::from(["peer-b".into()]);
    let selected = select_configured_route(engines(), &live, |endpoint| async move {
        Some(endpoint.replace("endpoint", "peer"))
    }).await;
    assert_eq!(selected, Some(("b".into(), "model-b".into(), "peer-b".into())));
}

#[tokio::test]
async fn unrelated_live_peer_is_never_substituted() {
    let live = HashSet::from(["unconfigured-peer".into()]);
    assert_eq!(select_configured_route(engines(), &live, |endpoint| async move {
        Some(endpoint.replace("endpoint", "peer"))
    }).await, None);
}

#[tokio::test]
async fn first_live_configured_model_retains_priority() {
    let live = HashSet::from(["peer-a".into(), "peer-b".into()]);
    let selected = select_configured_route(engines(), &live, |endpoint| async move {
        Some(endpoint.replace("endpoint", "peer"))
    }).await;
    assert_eq!(selected, Some(("a".into(), "model-a".into(), "peer-a".into())));
}
