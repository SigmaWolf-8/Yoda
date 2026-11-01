//! Route selection keeps each configured slot paired with its own model.
use std::{collections::HashSet, future::Future};

pub async fn select_configured_route<F, Fut>(
    engines: Vec<(String, String, String)>,
    live_peers: &HashSet<String>,
    mut resolve: F,
) -> Option<(String, String, String)>
where
    F: FnMut(String) -> Fut,
    Fut: Future<Output = Option<String>>,
{
    for (slot, model, endpoint) in engines {
        if model.trim().is_empty() {
            continue;
        }
        if let Some(peer) = resolve(endpoint).await {
            if live_peers.contains(&peer) {
                return Some((slot, model, peer));
            }
        }
    }
    None
}
