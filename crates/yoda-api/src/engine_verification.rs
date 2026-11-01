//! Generation evidence, not socket reachability. One bounded request, no fallback
//! models, no retries, and no promotion from a provider's model-list endpoint.
use axum::{extract::{Path, State}, Extension, Json};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use uuid::Uuid;
use crate::{auth::AuthenticatedUser, cube_relay::{PendingRelays, RelayInferRequest},
    error::AppError, state::AppState};
use crate::engine_verification_rules::{peer_for_port, validate_answer};

const PROMPT: &str = "What is 17 times 19? Reply with only the number.";
const TTL_MINUTES: i64 = 5;

struct Pending { map: PendingRelays, id: Uuid }
impl Drop for Pending {
    fn drop(&mut self) {
        let map = self.map.clone();
        let id = self.id;
        tokio::spawn(async move { map.write().await.remove(&id); });
    }
}

/// Resolve the advertised gateway corresponding to the configured model port.
/// This is a route candidate, not proof of the daemon's LLM_PORT override or model.
pub async fn resolve_peer(state: &AppState, endpoint: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(endpoint).map_err(|_| "Invalid model endpoint URL")?;
    let port = url.port().ok_or("Local model endpoint must include its explicit port")?;
    let response = state.http_client.get("https://plenumnet.replit.app/api/salvi/inter-cube/relay/status")
        .timeout(Duration::from_secs(6)).send().await
        .map_err(|_| "Relay route registry is unavailable")?;
    if !response.status().is_success() { return Err("Relay route registry rejected the request".into()); }
    let body: Value = response.json().await.map_err(|_| "Invalid relay route registry")?;
    peer_for_port(&body, port)
}

pub async fn verify(
    State(state): State<AppState>, user: Extension<AuthenticatedUser>, Path(slot): Path<String>,
) -> Result<(axum::http::StatusCode, Json<Value>), AppError> {
    if !["a","b","c"].contains(&slot.as_str()) {
        return Err(AppError::Validation("Slot must be a, b, or c".into()));
    }
    // Transaction-scoped lock survives client cancellation and bounds simultaneous
    // probes across tabs/processes without inventing an in-progress success.
    let mut transaction = state.db.begin().await.map_err(AppError::Database)?;
    let locked: bool = sqlx::query_scalar("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("engine-verify:{}:{slot}",user.org_id)).fetch_one(&mut *transaction)
        .await.map_err(AppError::Database)?;
    if !locked { return Err(AppError::Validation("Verification already running for this engine".into())); }
    let row = sqlx::query_as::<_,(Uuid,String,String,String,Option<String>,String,bool,Uuid)>(
        "SELECT id,hosting_mode,endpoint_url,auth_type,credentials_encrypted,model_name,is_disabled,verification_version FROM engine_configs WHERE org_id=$1 AND slot=$2")
        .bind(user.org_id).bind(&slot).fetch_optional(&mut *transaction).await.map_err(AppError::Database)?
        .ok_or_else(||AppError::Validation("Engine not configured".into()))?;
    let (id,mode,endpoint,auth,credentials,model,disabled,version) = row;
    if disabled { return Err(AppError::Validation("Engine is disabled; enable it before verification".into())); }
    let started = Instant::now();
    let request_id = Uuid::new_v4();
    let now = chrono::Utc::now();
    let pending = json!({"verified":false,"slot":slot,"status":"verifying","request_id":request_id,
        "checked_at":now,"expires_at":now+chrono::Duration::seconds(150),"latency_ms":0,
        "configured_model":model,"route":if mode=="self_hosted" {"authenticated relay"} else {"provider HTTPS"}});
    let claimed = sqlx::query("UPDATE engine_configs SET verification=$1,health_status='suspect' WHERE id=$2 AND verification_version=$3")
        .bind(&pending).bind(id).bind(version).execute(&state.db).await.map_err(AppError::Database)?;
    if claimed.rows_affected()!=1 { return Err(AppError::Validation("Engine settings changed before verification".into())); }
    // The browser receives an acknowledgement immediately. The bounded request
    // and its evidence survive browser/proxy disconnects.
    tokio::spawn(async move {
    let work: Result<(),AppError> = async {
    let mut peer: Option<String> = None;
    let result = tokio::time::timeout(Duration::from_secs(135), async {
        if mode == "self_hosted" {
            let target = resolve_peer(&state,&endpoint).await?;
            peer = Some(target.clone());
            tracing::info!(%request_id,slot=%slot,peer=%target,model=%model,"Engine generation verification dispatch");
            let tx = state.relay_tx.read().await.clone().ok_or("Authenticated relay is disconnected")?;
            if !state.live_cube_peer.read().await.contains(&target) { return Err("Selected daemon is not connected to the authenticated relay".into()); }
            let (send,receive) = tokio::sync::oneshot::channel();
            state.pending_relays.write().await.insert(request_id,send);
            let _pending = Pending {map:state.pending_relays.clone(),id:request_id};
            tx.send(RelayInferRequest {request_id,task_id:request_id,cube_address:target.clone(),
                messages:json!([{"role":"user","content":PROMPT}]),model:model.clone(),
                max_tokens:32,temperature:0.0}).await.map_err(|_|"Relay dispatch channel closed")?;
            let answer = receive.await.map_err(|_|"Relay disconnected while waiting for generation")??;
            if answer.from.replace(['.',','],"") != target { return Err("Response came from a different daemon".into()); }
            validate_answer(&answer.content,&model,&answer.model,answer.finish_reason.as_deref())?;
            Ok(json!({"answer":answer.content,"reported_model":answer.model,"finish_reason":answer.finish_reason,
                "model_identity":"request echoed by daemon; loaded model identity not independently attested"}))
        } else {
            let mut request = state.http_client.post(format!("{}/v1/chat/completions",endpoint.trim_end_matches('/')))
                .json(&json!({"model":model,"messages":[{"role":"user","content":PROMPT}],
                    "max_tokens":32,"temperature":0,"stream":false}));
            if let Some(key) = credentials {
                request = match auth.as_str() {
                    "bearer"=>request.bearer_auth(key), "api_key"=>request.header("x-api-key",key), _=>request,
                };
            }
            let response = request.send().await.map_err(|_|"Provider generation request failed")?;
            if !response.status().is_success() {
                return Err(format!("Provider rejected generation: HTTP {}. Check engine credentials, model access and quota.",response.status().as_u16()));
            }
            let data: Value = response.json().await.map_err(|_|"Provider returned invalid generation JSON")?;
            let content = data.pointer("/choices/0/message/content").and_then(Value::as_str).unwrap_or("");
            let actual = data["model"].as_str().unwrap_or("");
            let finish = data.pointer("/choices/0/finish_reason").and_then(Value::as_str);
            validate_answer(content,&model,actual,finish)?;
            Ok(json!({"answer":content,"reported_model":actual,"finish_reason":finish,"model_identity":"provider response"}))
        }
    }).await.unwrap_or_else(|_|Err("Generation timed out after 135 seconds; no answer was received. No retries or fallback nodes were used.".into()));
    let now = chrono::Utc::now();
    let verified = result.is_ok();
    let mut evidence = json!({"verified":verified,"slot":slot,"status":if verified {"online"} else {"suspect"},
        "reachable":verified,"request_id":request_id,"checked_at":now,
        "expires_at":now+chrono::Duration::minutes(TTL_MINUTES),
        "latency_ms":started.elapsed().as_millis() as u64,"configured_model":model,
        "peer":peer,"route":if mode=="self_hosted" {"authenticated relay"} else {"provider HTTPS"},
        "prompt":PROMPT,"endpoint":endpoint});
    match result {
        Ok(answer) => {
            evidence.as_object_mut().unwrap().extend(answer.as_object().unwrap().clone());
            evidence["note"] = json!("Nonempty generation verified at the recorded time. This is not a guarantee of future availability or answer correctness.");
        },
        Err(error) => evidence["error"] = json!(error),
    }
    let updated = sqlx::query("UPDATE engine_configs SET verification=$1,health_status=$2,avg_latency_ms=$3 WHERE id=$4 AND verification_version=$5")
        .bind(&evidence).bind(if verified {"online"} else {"suspect"})
        .bind(started.elapsed().as_millis().min(i32::MAX as u128) as i32).bind(id).bind(version)
        .execute(&mut *transaction).await.map_err(AppError::Database)?;
    if updated.rows_affected()!=1 { return Err(AppError::Validation("Engine settings changed during verification; result discarded".into())); }
    transaction.commit().await.map_err(AppError::Database)?;
    tracing::info!(%request_id,verified,"Engine generation verification completed");
    Ok(())
    }.await;
    if let Err(error) = work { tracing::warn!(%request_id,?error,"Engine verification could not persist a result; pending evidence will expire"); }
    });
    Ok((axum::http::StatusCode::ACCEPTED,Json(pending)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn routing_follows_advertised_gateway_not_slot_name() {
        let registry=json!({"nodes":[{"connected":true,"endpoint":"host:11151","address":"311.111.111.111.1"}]});
        assert_eq!(peer_for_port(&registry,11152).unwrap(),"3111111111111");
        assert!(peer_for_port(&registry,11125).is_err());
    }
    #[test]
    fn rejects_empty_wrong_model_and_truncated_results() {
        assert!(validate_answer(" ","Mathstral","Mathstral",None).is_err());
        assert!(validate_answer("323","Mathstral","other",None).is_err());
        assert!(validate_answer("323","Mathstral","Mathstral",Some("length")).is_err());
        assert!(validate_answer("323","Mathstral","Mathstral",Some("stop")).is_ok());
    }
}
