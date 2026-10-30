//! Server-to-server Array3 telemetry. A local CRS cache is not the upstream
//! relay registry. Credentials never go to the monitor iframe.
use std::{collections::BTreeMap, sync::OnceLock, time::{Duration,Instant}};
use axum::{extract::State,Json};
use serde_json::Value;
use tokio::sync::Mutex;
use crate::{state::AppState,error::AppError};

type Cache = BTreeMap<&'static str,(Instant,Value)>;
static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();

async fn fetch(state: &AppState, feed: &'static str) -> Result<Json<Value>,AppError> {
    let path = match feed {
        "slots" => "/api/salvi/inter-cube/slots",
        "status" => "/api/salvi/inter-cube/relay/status",
        "inventory" => "/api/salvi/inter-cube/relay/slot-inventory",
        _ => return Err(AppError::Validation("Unknown telemetry feed".into())),
    };
    // Single-flight + short cache: duplicate monitor tabs must not overwhelm
    // the upstream's shared per-IP request allowance.
    let mut cache = CACHE.get_or_init(||Mutex::new(BTreeMap::new())).lock().await;
    if let Some((at,body)) = cache.get(feed) {
        if at.elapsed()<Duration::from_secs(5) { return Ok(Json(body.clone())); }
    }
    let mut request = state.http_client.get(format!("https://plenumnet.replit.app{path}"))
        .timeout(Duration::from_secs(6));
    if feed=="slots" {
        let token = std::env::var("RELAY_API_TOKEN")
            .map_err(|_| AppError::Unavailable("Array3 telemetry needs the server's RELAY_API_TOKEN; no empty cluster is substituted.".into()))?;
        if token.is_empty() { return Err(AppError::Unavailable("Relay API token is empty".into())); }
        request = request.bearer_auth(token);
    }
    let response = request.send().await
        .map_err(|_| AppError::Unavailable("Upstream Array3 telemetry could not be reached; node state is unknown, not zero.".into()))?;
    let status = response.status();
    if !status.is_success() {
        return Err(AppError::Unavailable(match status.as_u16() {
            401|403 => "Upstream rejected the server relay credential. Node state is unknown.".into(),
            429 => "Upstream telemetry rate limit reached. Wait for the next poll.".into(),
            _ => format!("Upstream Array3 telemetry returned HTTP {status}; no empty inventory was substituted."),
        }));
    }
    let mut body: Value = response.json().await
        .map_err(|_| AppError::Unavailable("Upstream Array3 telemetry was not JSON".into()))?;
    let valid = match feed {
        "slots" => body.pointer("/cluster/nodes").is_some_and(Value::is_array),
        "status" => body.get("nodes").is_some_and(Value::is_array),
        _ => body.get("nodes").is_some_and(Value::is_array) || body.pointer("/cluster/nodes").is_some_and(Value::is_array),
    };
    if !valid { return Err(AppError::Unavailable("Upstream Array3 telemetry has an unrecognized shape".into())); }
    body["_source"] = serde_json::json!({"service":"PlenumNET relay","observedAt":chrono::Utc::now(),"cacheSeconds":5});
    cache.insert(feed,(Instant::now(),body.clone()));
    Ok(Json(body))
}

pub async fn slots(State(state):State<AppState>)->Result<Json<Value>,AppError>{
    // The deployed daemons publish slot reports, but do not all implement the
    // upstream HTTP-proxy request. Use fresh published reports, explicitly
    // distinguishing transport presence from observed service inventory.
    let inventory = fetch(&state,"inventory").await?.0;
    let status = fetch(&state,"status").await?.0;
    let reports = inventory["nodes"].as_array()
        .ok_or_else(||AppError::Unavailable("Missing upstream inventory reports".into()))?;
    let peers = status["nodes"].as_array()
        .ok_or_else(||AppError::Unavailable("Missing upstream relay peer list".into()))?;
    let mut nodes = Vec::new();
    let mut responding = 0;
    for number in 1..=3u64 {
        let slot = match number {1=>"a",2=>"b",_=>"c"};
        let address = crate::cube_relay::slot_to_cube_address(slot);
        let connected = peers.iter().any(|p| p["connected"].as_bool()==Some(true) &&
            p["address"].as_str().map(|a|a.replace(['.',','],""))==Some(address.to_string()));
        let report = reports.iter().find(|r| {
            let id = r["nodeId"].as_u64().or_else(||r["nodeId"].as_str().and_then(|s|s.parse().ok()));
            id==Some(number) && r["source"]=="slot-report" &&
                r["stale"].as_bool()==Some(false) && r["ageMs"].as_u64().is_some_and(|a|a<90_000) &&
                (r["slots"].is_array() || r["slots"]["slots"].is_array())
        });
        if let Some(r) = report {
            responding+=1;
            nodes.push(serde_json::json!({"node_id_num":number,"address":address,"connected":connected,
                "status":"reported","slots":r["slots"],"health":r["health"],
                "source":"slot-report","receivedAt":r["receivedAt"],"ageMs":r["ageMs"]}));
        } else {
            nodes.push(serde_json::json!({"node_id_num":number,"address":address,"connected":connected,
                "status":"telemetry_unavailable","slots":null,"health":null}));
        }
    }
    Ok(Json(serde_json::json!({"cluster":{"total_nodes":3,"responding_nodes":responding,"nodes":nodes},
        "_source":{"service":"PlenumNET daemon slot reports","observedAt":chrono::Utc::now(),
            "maximumReportAgeMs":90_000,"note":"A relay connection alone does not prove service occupancy."}})))
}
pub async fn status(State(state):State<AppState>)->Result<Json<Value>,AppError>{fetch(&state,"status").await}
pub async fn inventory(State(state):State<AppState>)->Result<Json<Value>,AppError>{fetch(&state,"inventory").await}
