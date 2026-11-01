//! Durable approved-task queue worker. Loaded agent definitions are not running
//! agents. This worker executes the real four-step protocol, never fabricates an
//! answer, never relaxes review settings, and never creates new user goals.
use axum::{extract::State, Extension, Json};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;
use std::time::Duration;
use uuid::Uuid;
use yoda_inference_router::{dispatch::select_reviewer_count, ReviewIntensity};
use yoda_orchestrator::{protocol, Mode, Task, TaskStatus};

use crate::{auth::AuthenticatedUser, error::AppError, state::AppState};

pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        let owner = Uuid::new_v4();
        let mut ticker = tokio::time::interval(Duration::from_secs(5));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            ticker.tick().await;
            if let Err(e) = tick(&state, owner).await {
                // Do not log provider credentials or raw response bodies.
                tracing::error!(error = ?e, "Autonomous queue worker tick failed");
            }
        }
    });
}

async fn message(state: &AppState, org: Uuid, owner: Uuid, text: &str) -> Result<(), AppError> {
    sqlx::query("UPDATE agent_workers SET message=$3, heartbeat_at=NOW() WHERE org_id=$1 AND lease_owner=$2")
        .bind(org).bind(owner).bind(text).execute(&state.db).await?;
    Ok(())
}

async fn tick(state: &AppState, owner: Uuid) -> Result<(), AppError> {
    let orgs: Vec<Uuid> = sqlx::query_scalar("SELECT org_id FROM agent_workers WHERE enabled OR active_task IS NOT NULL ORDER BY org_id")
        .fetch_all(&state.db).await?;
    for org in orgs {
        // One leased worker per organization, across processes and restarts.
        let got = sqlx::query(
            "UPDATE agent_workers SET lease_owner=$2, lease_until=NOW()+INTERVAL '60 seconds', heartbeat_at=NOW() \
             WHERE org_id=$1 AND (lease_owner=$2 OR lease_until IS NULL OR lease_until<NOW())")
            .bind(org).bind(owner).execute(&state.db).await?;
        if got.rows_affected() == 0 { continue; }
        let run = run_one(state, org, owner).await;
        if run.is_err() {
            message(state, org, owner, "Worker operation failed; queue retained. Inspect server logs.").await?;
        }
        // Keep the lease only during a cycle. Another serving instance can
        // take over idle work immediately instead of waiting for expiry.
        sqlx::query("UPDATE agent_workers SET lease_until=NOW() WHERE org_id=$1 AND lease_owner=$2")
            .bind(org).bind(owner).execute(&state.db).await?;
        run?;
    }
    Ok(())
}

async fn run_one(state: &AppState, org: Uuid, owner: Uuid) -> Result<(), AppError> {
    let control = sqlx::query("SELECT enabled,active_task FROM agent_workers WHERE org_id=$1")
        .bind(org).fetch_one(&state.db).await?;
    // Recover only work this durable worker owned. Never reset terminal or
    // unrelated browser/relay tasks.
    if let Some(id) = control.get::<Option<Uuid>, _>("active_task") {
        sqlx::query(
            "UPDATE tasks SET status=CASE WHEN COALESCE((SELECT attempts FROM agent_worker_attempts WHERE task_id=$1),0)>=3 \
             THEN 'ESCALATED' ELSE 'QUEUED' END, error_message='Autonomous worker interrupted; recovered from durable state',updated_at=NOW() \
             WHERE id=$1 AND status='ASSIGNED'")
            .bind(id).execute(&state.db).await?;
        sqlx::query("UPDATE agent_workers SET active_task=NULL WHERE org_id=$1 AND lease_owner=$2")
            .bind(org).bind(owner).execute(&state.db).await?;
    }
    if !control.get::<bool,_>("enabled") {
        return message(state, org, owner, "Paused by operator; no new inference is dispatched.").await;
    }

    let engines = sqlx::query_as::<_, (String,String,String,Option<String>,String,String)>(
        "SELECT slot,hosting_mode,endpoint_url,credentials_encrypted,model_name,auth_type FROM engine_configs \
         WHERE org_id=$1 AND NOT is_disabled \
         AND health_status='online' AND verification->>'verified'='true' \
         AND (verification->>'expires_at')::timestamptz > now() ORDER BY slot")
        .bind(org).fetch_all(&state.db).await?;
    let relay_armed = state.relay_tx.read().await.is_some();
    let live_peers = state.live_cube_peer.read().await.clone();
    let verified_routes: Vec<(String,Option<String>)> = sqlx::query_as(
        "SELECT slot,verification->>'peer' FROM engine_configs WHERE org_id=$1")
        .bind(org).fetch_all(&state.db).await?;
    let engines: Vec<_> = engines.into_iter().filter(|e| e.1 != "self_hosted" ||
        (relay_armed && verified_routes.iter().any(|(slot,peer)|slot==&e.0 &&
            peer.as_ref().is_some_and(|p|live_peers.contains(p))))).collect();
    if engines.is_empty() {
        return message(state, org, owner,
            "Waiting for verified generation: verify engines in Settings or Monitoring. A connected relay or accepted provider key alone does not certify execution. No model calls are being made.").await;
    }
    let mut configs: Vec<_> = engines.iter().map(crate::query::build_engine_config).collect();
    let families: Vec<(String,String)> = sqlx::query_as(
        "SELECT slot,COALESCE(NULLIF(family_override,''),NULLIF(model_family,''),'') FROM engine_configs WHERE org_id=$1")
        .bind(org).fetch_all(&state.db).await?;
    for (i,config) in configs.iter_mut().enumerate() {
        config.model_family = families.iter().find(|(slot,_)| slot==&engines[i].0).map(|(_,f)|f.clone()).unwrap_or_default();
    }
    let lineages = yoda_inference_router::diversity::ModelLineageDb::load(std::path::Path::new(&state.lineages_path))
        .map_err(|_| AppError::Internal("Model lineage configuration is unreadable".into()))?;
    let rows = sqlx::query(
        "SELECT t.*,p.settings FROM tasks t JOIN projects p ON p.id=t.project_id \
         LEFT JOIN agent_worker_attempts a ON a.task_id=t.id \
         WHERE p.org_id=$1 AND t.status='QUEUED' AND NOT t.archived \
         AND COALESCE(a.attempts,0)<3 AND (a.next_attempt_at IS NULL OR a.next_attempt_at<=NOW()) \
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(t.dependencies) dep \
           WHERE NOT EXISTS (SELECT 1 FROM tasks d WHERE d.project_id=t.project_id AND d.task_number=dep AND d.status='FINAL')) \
         ORDER BY t.workflow_position NULLS LAST,t.created_at LIMIT 50")
        .bind(org).fetch_all(&state.db).await?;
    if rows.is_empty() {
        return message(state, org, owner, "Waiting for eligible queued work; dependencies, retry delays and terminal states are respected.").await;
    }
    let mut candidate = None;
    for row in rows {
        let settings: Value = row.get("settings");
        let intensity = match settings.get("review_intensity").and_then(Value::as_str).unwrap_or("full") {
            "light" => ReviewIntensity::Light,
            "medium" => ReviewIntensity::Medium,
            _ => ReviewIntensity::Full,
        };
        let required = select_reviewer_count(intensity);
        let refs: Vec<_> = configs.iter().take(required).collect();
        if configs.len() >= required && yoda_inference_router::diversity::validate_diversity(&refs,&lineages).is_ok() {
            candidate = Some((row,intensity));
            break;
        }
    }
    let Some((row,intensity)) = candidate else {
        return message(state, org, owner,
            "Queued tasks require enough online review engines from distinct declared model families. Project review intensity is not silently downgraded.").await;
    };
    let id: Uuid = row.get("id");
    let competencies: Vec<String> = serde_json::from_value(row.get("competencies"))
        .map_err(|_| AppError::Internal("Task competencies are malformed".into()))?;
    let agent = row.get::<Option<String>,_>("primary_agent_role")
        .and_then(|a| state.agents.get(&a))
        .or_else(|| state.agents.find_best_match(&competencies).ok());
    let Some(agent) = agent else {
        return message(state, org, owner, "No matching compiled agent; queued task retained.").await;
    };
    let mut reviewer_ids = agent.compatible_reviewers.clone();
    let mut other_ids = state.agents.list_ids();
    other_ids.sort();
    reviewer_ids.extend(other_ids);
    let mut reviewers = Vec::new();
    for name in reviewer_ids {
        if name == agent.agent_id || reviewers.iter().any(|a: &yoda_orchestrator::AgentConfig| a.agent_id == name) { continue; }
        if let Some(a) = state.agents.get(&name) { reviewers.push(a); }
        if reviewers.len() == select_reviewer_count(intensity) { break; }
    }
    if reviewers.len() < select_reviewer_count(intensity) {
        return message(state, org, owner, "Waiting for enough distinct compiled reviewer roles.").await;
    }
    let task = Task {
        id, project_id: row.get("project_id"), task_number: row.get("task_number"), title: row.get("title"),
        competencies, dependencies: serde_json::from_value(row.get("dependencies"))
            .map_err(|_| AppError::Internal("Task dependencies are malformed".into()))?,
        status: TaskStatus::Assigned, parent_task_id: row.get("parent_task_id"),
        workflow_position: row.get("workflow_position"),
        mode: if row.get::<String,_>("mode")=="ronin" {Mode::Ronin} else {Mode::Yoda},
        created_at: row.get("created_at"), updated_at: Utc::now(),
    };
    let mut tx = state.db.begin().await?;
    let still_owned: Option<bool> = sqlx::query_scalar(
        "SELECT enabled FROM agent_workers WHERE org_id=$1 AND lease_owner=$2 AND lease_until>NOW() FOR UPDATE")
        .bind(org).bind(owner).fetch_optional(&mut *tx).await?;
    if still_owned != Some(true) { return Ok(()); }
    let claimed = sqlx::query("UPDATE tasks SET status='ASSIGNED',primary_agent_role=$2,primary_engine_slot=$3,updated_at=NOW() WHERE id=$1 AND status='QUEUED'")
        .bind(id).bind(&agent.agent_id).bind(&engines[0].0).execute(&mut *tx).await?;
    if claimed.rows_affected()==0 { return Ok(()); }
    sqlx::query("INSERT INTO agent_worker_attempts (task_id,attempts) VALUES ($1,1) ON CONFLICT(task_id) DO UPDATE SET attempts=agent_worker_attempts.attempts+1")
        .bind(id).execute(&mut *tx).await?;
    sqlx::query("UPDATE agent_workers SET active_task=$3,message='Running four-step production/review protocol',lease_until=NOW()+INTERVAL '60 seconds' WHERE org_id=$1 AND lease_owner=$2")
        .bind(org).bind(owner).bind(id).execute(&mut *tx).await?;
    tx.commit().await?;

    let reviewer_refs: Vec<_> = reviewers.iter().collect();
    let engine_refs: Vec<_> = configs.iter().collect();
    let transport = crate::agent_transport::MixedTransport {state:state.clone(),task_id:id};
    let work = protocol::execute_four_step_via(&transport,&task,&agent,&reviewer_refs,&configs[0],&engine_refs,intensity);
    tokio::pin!(work);
    let timeout = tokio::time::sleep(Duration::from_secs(600));
    tokio::pin!(timeout);
    let mut failure = "Inference timed out or was paused; no successful output is claimed".to_string();
    let outcome = loop {
        tokio::select! {
            result = &mut work => {
                match result {
                    Ok(result) => break Some(result),
                    Err(error) => {
                        use yoda_inference_router::dispatch::DispatchError;
                        failure = match error {
                            protocol::ProtocolError::Dispatch(DispatchError::EngineOffline(slot)) => format!("Engine {slot:?} lost its authenticated relay peer"),
                            protocol::ProtocolError::Dispatch(DispatchError::ValidationFailed(slot,_,message)) => format!("Engine {slot:?} response failed validation: {message}"),
                            protocol::ProtocolError::Dispatch(DispatchError::HttpError(slot,message)) if message.contains("LLM server unreachable") =>
                                format!("Engine {slot:?}: the daemon cannot reach its local model server. Start the configured llama-server process on the daemon host."),
                            protocol::ProtocolError::Dispatch(_) => "Engine request failed; check provider authentication, model process and relay connectivity".into(),
                            _ => "Four-step protocol could not complete; no consensus or final answer is claimed".into(),
                        };
                        tracing::warn!(task_id=%id,reason=%failure,"Autonomous inference attempt failed");
                        break None;
                    }
                }
            },
            _ = &mut timeout => break None,
            _ = tokio::time::sleep(Duration::from_secs(10)) => {
                let alive: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM agent_workers w JOIN tasks t ON t.id=w.active_task WHERE w.org_id=$1 AND w.lease_owner=$2 AND w.enabled AND t.status='ASSIGNED')")
                    .bind(org).bind(owner).fetch_one(&state.db).await?;
                if !alive { break None; }
                let renewed = sqlx::query("UPDATE agent_workers SET heartbeat_at=NOW(),lease_until=NOW()+INTERVAL '60 seconds' WHERE org_id=$1 AND lease_owner=$2 AND lease_until>NOW()")
                    .bind(org).bind(owner).execute(&state.db).await?;
                if renewed.rows_affected()==0 { return Ok(()); }
            }
        }
    };
    // Lock status before persisting. A cancellation/escalation wins over a late
    // response. Save output and terminal state in one transaction.
    let mut tx = state.db.begin().await?;
    let enabled: Option<bool> = sqlx::query_scalar("SELECT enabled FROM agent_workers WHERE org_id=$1 AND lease_owner=$2 AND lease_until>NOW() FOR UPDATE")
        .bind(org).bind(owner).fetch_optional(&mut *tx).await?;
    let Some(enabled) = enabled else { return Ok(()); };
    let outcome = if enabled { outcome } else { None };
    let status: Option<String> = sqlx::query_scalar("SELECT status FROM tasks WHERE id=$1 FOR UPDATE")
        .bind(id).fetch_optional(&mut *tx).await?;
    if status.as_deref()==Some("ASSIGNED") {
        if let Some(result) = outcome {
            for step in &result.results {
                let slot = format!("{:?}",step.response.engine_slot).to_lowercase();
                let rid: Uuid = sqlx::query_scalar(
                    "INSERT INTO task_results (task_id,step_number,result_content,engine_slot,engine_model,agent_role,tis27_hash) \
                     VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(task_id,step_number) DO UPDATE SET result_content=EXCLUDED.result_content,\
                     engine_slot=EXCLUDED.engine_slot,engine_model=EXCLUDED.engine_model,agent_role=EXCLUDED.agent_role,tis27_hash=EXCLUDED.tis27_hash RETURNING id")
                    .bind(id).bind(i16::from(step.step)).bind(&step.response.content).bind(slot)
                    .bind(&step.response.model_name).bind(&agent.agent_id).bind(&step.response.tis27_hash)
                    .fetch_one(&mut *tx).await?;
                sqlx::query("DELETE FROM task_reviews WHERE task_result_id=$1").bind(rid).execute(&mut *tx).await?;
                if let Some(reviews) = result.reviews.iter().find(|r| r.step==step.step) {
                    for review in &reviews.reviews {
                        sqlx::query("INSERT INTO task_reviews (task_result_id,engine_slot,engine_model,agent_role,verdict,tis27_hash,censorship_flagged) VALUES($1,$2,$3,$4,$5,$6,$7)")
                            .bind(rid).bind(format!("{:?}",review.engine_slot).to_lowercase())
                            .bind(&review.response.model_name).bind(&review.agent_role)
                            .bind(json!({"approved":review.approved,"confidence":review.confidence,"content":review.response.content}))
                            .bind(&review.response.tis27_hash).bind(review.response.censorship_flagged)
                            .execute(&mut *tx).await?;
                    }
                }
            }
            let content = if result.escalated {
                "Autonomous review did not reach consensus. Production drafts and reviewer findings are retained in the task results; no final answer is claimed."
            } else { &result.final_output };
            sqlx::query("INSERT INTO task_messages (task_id,role,content) VALUES($1,'assistant',$2)")
                .bind(id).bind(content).execute(&mut *tx).await?;
            sqlx::query("UPDATE tasks SET status=$2,error_message=$3,updated_at=NOW() WHERE id=$1")
                .bind(id).bind(if result.escalated {"ESCALATED"} else {"FINAL"})
                .bind(if result.escalated {Some("Reviewers did not reach consensus")} else {None})
                .execute(&mut *tx).await?;
            sqlx::query("UPDATE agent_worker_attempts SET protocol=$2,last_error=NULL WHERE task_id=$1")
                .bind(id).bind(serde_json::to_value(result).map_err(|_| AppError::Internal("Protocol serialization failed".into()))?)
                .execute(&mut *tx).await?;
        } else {
            sqlx::query("UPDATE agent_worker_attempts SET next_attempt_at=NOW()+attempts*INTERVAL '60 seconds',last_error=$2 WHERE task_id=$1")
                .bind(id).bind(&failure).execute(&mut *tx).await?;
            sqlx::query("UPDATE tasks SET status=CASE WHEN (SELECT attempts FROM agent_worker_attempts WHERE task_id=$1)>=3 THEN 'ESCALATED' ELSE 'QUEUED' END,error_message=$2,updated_at=NOW() WHERE id=$1")
                .bind(id).bind(&failure).execute(&mut *tx).await?;
        }
    }
    sqlx::query("UPDATE agent_workers SET active_task=NULL,message='Cycle finished; checking queue',heartbeat_at=NOW() WHERE org_id=$1 AND lease_owner=$2")
        .bind(org).bind(owner).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn status(State(state): State<AppState>, user: Extension<AuthenticatedUser>) -> Result<Json<Value>, AppError> {
    let row = sqlx::query("SELECT enabled,heartbeat_at,active_task,message,COALESCE(heartbeat_at>NOW()-INTERVAL '30 seconds',false) AS alive FROM agent_workers WHERE org_id=$1")
        .bind(user.org_id).fetch_optional(&state.db).await?;
    let queued: i64 = sqlx::query_scalar("SELECT count(*) FROM tasks t JOIN projects p ON p.id=t.project_id WHERE p.org_id=$1 AND t.status='QUEUED' AND NOT t.archived")
        .bind(user.org_id).fetch_one(&state.db).await?;
    Ok(Json(match row {
        Some(r) => json!({"enabled":r.get::<bool,_>("enabled"),"alive":r.get::<bool,_>("alive"),
            "heartbeatAt":r.get::<Option<chrono::DateTime<Utc>>,_>("heartbeat_at"),
            "activeTask":r.get::<Option<Uuid>,_>("active_task"),"message":r.get::<String,_>("message"),
            "queued":queued,"maxAttempts":3,"maxTaskSeconds":600}),
        None => json!({"enabled":false,"alive":false,"heartbeatAt":null,"activeTask":null,"message":"Worker has not started","queued":queued,"maxAttempts":3,"maxTaskSeconds":600}),
    }))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Control { enabled: bool }

pub async fn control(State(state): State<AppState>, user: Extension<AuthenticatedUser>, Json(input): Json<Control>) -> Result<Json<Value>,AppError> {
    sqlx::query("INSERT INTO agent_workers(org_id,enabled,message) VALUES($1,$2,CASE WHEN $2 THEN 'Enabled; waiting for next worker cycle' ELSE 'Paused by operator; active requests stop within 10 seconds' END) ON CONFLICT(org_id) DO UPDATE SET enabled=EXCLUDED.enabled,message=EXCLUDED.message")
        .bind(user.org_id).bind(input.enabled).execute(&state.db).await?;
    status(State(state),user).await
}
