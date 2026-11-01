//! Mixed-engine dispatch. Local slots use their own authenticated cube peer;
//! cloud slots use the existing HTTP provider adapter. Never substitute peers.
use std::{future::Future, pin::Pin, time::{Duration, Instant}};
use uuid::Uuid;
use yoda_inference_router::{
    dispatch::{call_engine, DispatchError, InferenceTransport},
    validation::{ValidationResult, Validator},
    EngineConfig, EngineSlot, HostingMode, InferenceResponse,
};
use crate::{cube_relay::{RelayInferRequest, PendingRelays}, state::AppState};

pub struct MixedTransport { pub state: AppState, pub task_id: Uuid }

struct PendingGuard { pending: PendingRelays, id: Uuid }
struct EvidenceGuard { db: sqlx::PgPool, id: Uuid }
impl Drop for EvidenceGuard {
    fn drop(&mut self) {
        let db=self.db.clone(); let id=self.id;
        tokio::spawn(async move {
            let _=sqlx::query("UPDATE execution_events SET state='failed',error='Execution interrupted or cancelled before a final response was persisted',finished_at=now() WHERE id=$1 AND state='running'")
                .bind(id).execute(&db).await;
        });
    }
}
impl Drop for PendingGuard {
    fn drop(&mut self) {
        let pending = self.pending.clone();
        let id = self.id;
        // Covers timeout, pause, cancellation and the loss of a worker lease.
        tokio::spawn(async move { pending.write().await.remove(&id); });
    }
}

pub fn slot_name(slot: EngineSlot) -> &'static str {
    match slot { EngineSlot::A => "a", EngineSlot::B => "b", EngineSlot::C => "c" }
}

impl InferenceTransport for MixedTransport {
    fn infer<'a>(&'a self, engine: &'a EngineConfig, system: &'a str, user: &'a str)
        -> Pin<Box<dyn Future<Output=Result<InferenceResponse,DispatchError>> + Send + 'a>> {
        Box::pin(async move {
            let event_id=Uuid::new_v4();
            let route=if engine.hosting_mode==HostingMode::SelfHosted {"authenticated relay"} else {"provider HTTPS"};
            sqlx::query("INSERT INTO execution_events(id,task_id,engine_slot,configured_model,route,state) VALUES($1,$2,$3,$4,$5,'running')")
                .bind(event_id).bind(self.task_id).bind(slot_name(engine.slot)).bind(&engine.model_name).bind(route)
                .execute(&self.state.db).await.map_err(|_|DispatchError::HttpError(engine.slot,"Cannot record execution evidence; call not sent".into()))?;
            let _evidence_guard=EvidenceGuard {db:self.state.db.clone(),id:event_id};
            let outcome=async {
            if engine.hosting_mode != HostingMode::SelfHosted {
                return call_engine(&self.state.http_client,engine,system,user,None).await;
            }
            let peer = crate::engine_verification::resolve_peer(&self.state,&engine.endpoint_url).await
                .map_err(|error| DispatchError::HttpError(engine.slot,error))?;
            sqlx::query("UPDATE execution_events SET peer=$2 WHERE id=$1").bind(event_id).bind(&peer)
                .execute(&self.state.db).await.map_err(|_|DispatchError::HttpError(engine.slot,"Cannot record daemon route; call not sent".into()))?;
            let tx = self.state.relay_tx.read().await.clone()
                .ok_or(DispatchError::EngineOffline(engine.slot))?;
            if !self.state.live_cube_peer.read().await.contains(&peer) {
                return Err(DispatchError::EngineOffline(engine.slot));
            }
            let id = event_id;
            let (send,receive) = tokio::sync::oneshot::channel();
            self.state.pending_relays.write().await.insert(id,send);
            let _guard = PendingGuard {pending:self.state.pending_relays.clone(),id};
            let started = Instant::now();
            let request = RelayInferRequest {
                request_id:id,task_id:self.task_id,cube_address:peer.clone(),
                messages:serde_json::json!([
                    {"role":"system","content":system},
                    {"role":"user","content":user}
                ]),
                model:engine.model_name.clone(),max_tokens:4096,temperature:0.7,
            };
            tokio::time::timeout(Duration::from_secs(10),tx.send(request)).await
                .map_err(|_| DispatchError::HttpError(engine.slot,"Relay dispatch timed out".into()))?
                .map_err(|_| DispatchError::EngineOffline(engine.slot))?;
            let result = tokio::time::timeout(Duration::from_secs(120),receive).await
                .map_err(|_| DispatchError::HttpError(engine.slot,"Local model reply timed out".into()))?
                .map_err(|_| DispatchError::HttpError(engine.slot,"Relay response channel closed".into()))?
                .map_err(|_| DispatchError::HttpError(engine.slot,"Daemon returned an inference error".into()))?;
            if result.from.replace(['.',','],"") != peer {
                return Err(DispatchError::ValidationFailed(engine.slot,0,"Reply came from a different cube peer".into()));
            }
            if result.model != engine.model_name {
                return Err(DispatchError::ValidationFailed(engine.slot,0,
                    format!("Daemon reported model {:?}; configured model {:?}. Align the slot with the actual loaded model.",result.model,engine.model_name)));
            }
            if result.content.trim().is_empty() { return Err(DispatchError::EmptyResponse(engine.slot)); }
            match Validator::validate(&result.content,4096,result.finish_reason.as_deref()) {
                ValidationResult::Valid => {},
                _ => return Err(DispatchError::ValidationFailed(engine.slot,0,"Invalid or truncated local model response".into())),
            }
            Ok(InferenceResponse {
                tis27_hash:yoda_plenumnet_bridge::hashing::hash_bytes(result.content.as_bytes()),
                content:result.content,engine_slot:engine.slot,model_name:result.model,
                latency_ms:started.elapsed().as_millis() as u64,censorship_flagged:false,
            })
            }.await;
            let (status,output,error)=match &outcome {
                Ok(response)=>("completed",Some(response.content.clone()),None),
                Err(_)=>("failed",None,Some("Engine execution failed; no successful output was recorded. Check generation evidence and worker failure status.".to_string())),
            };
            sqlx::query("UPDATE execution_events SET state=$2,output=$3,error=$4,finished_at=now() WHERE id=$1")
                .bind(event_id).bind(status).bind(output).bind(error).execute(&self.state.db).await
                .map_err(|_|DispatchError::HttpError(engine.slot,"Could not persist execution evidence; result withheld".into()))?;
            outcome
        })
    }
}
