//! Shared entry point and inspectable records for Forge, Kyokushin and native queries.
use axum::{extract::{Path,State},Extension,Json,http::StatusCode};
use serde::Deserialize;
use serde_json::{json,Value};
use uuid::Uuid;
use crate::{auth::AuthenticatedUser,error::AppError,state::AppState};

#[derive(Deserialize)]
pub struct Submit { pub text:String, pub mode:Option<String>, pub project_id:Option<Uuid> }

pub async fn submit_project(State(state):State<AppState>, user:Extension<AuthenticatedUser>,
    Path(project):Path<Uuid>,Json(input):Json<Submit>) -> Result<(StatusCode,Json<Value>),AppError> {
    enqueue(&state,user.org_id,project,input).await
}
pub async fn submit(State(state):State<AppState>,user:Extension<AuthenticatedUser>,
    Json(input):Json<Submit>) -> Result<(StatusCode,Json<Value>),AppError> {
    let project=input.project_id.ok_or_else(||AppError::Validation("Choose a project; its engine-review policy applies to this run.".into()))?;
    enqueue(&state,user.org_id,project,input).await
}
async fn enqueue(state:&AppState,org:Uuid,project:Uuid,input:Submit)->Result<(StatusCode,Json<Value>),AppError>{
    let text=input.text.trim();
    if text.is_empty() || text.len()>100_000 {return Err(AppError::Validation("Provide between 1 and 100,000 bytes of input".into()));}
    let mut tx=state.db.begin().await?;
    // Serialize numbering within this project and verify tenant ownership.
    let mode: String=sqlx::query_scalar("SELECT mode FROM projects WHERE id=$1 AND org_id=$2 FOR UPDATE")
        .bind(project).bind(org).fetch_optional(&mut *tx).await?
        .ok_or_else(||AppError::NotFound("Project not found".into()))?;
    let mode=input.mode.as_deref().unwrap_or(&mode);
    if !["yoda","ronin"].contains(&mode) {return Err(AppError::Validation("Unknown execution mode".into()));}
    let competencies=yoda_orchestrator::decomposer::infer_competencies(text);
    let agent=state.agents.find_best_match(&competencies)
        .map_err(|_|AppError::Unavailable("No matching compiled agent; nothing was executed".into()))?;
    let number:i64=sqlx::query_scalar("SELECT COALESCE(MAX(CASE WHEN task_number ~ '^[0-9]+([.]|$)' THEN split_part(task_number,'.',1)::bigint END),0)+1 FROM tasks WHERE project_id=$1")
        .bind(project).fetch_one(&mut *tx).await?;
    let id=Uuid::new_v4();
    sqlx::query("INSERT INTO tasks(id,project_id,task_number,title,competencies,dependencies,status,workflow_position,mode,primary_agent_role) VALUES($1,$2,$3,$4,$5,'[]','QUEUED',$6,$7,$8)")
        .bind(id).bind(project).bind(number.to_string()).bind(text).bind(json!(competencies)).bind(number as i32)
        .bind(mode).bind(&agent.agent_id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO task_messages(task_id,role,content) VALUES($1,'user',$2)")
        .bind(id).bind(text).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED,Json(json!({"task_id":id,"decomposition":null,"needs_approval":false,
        "relay_endpoint":null,"status":"QUEUED","agent":agent.agent_id,
        "note":"Shared agent worker executes this task using Settings engines and the project review policy. Queued is not completed."}))))
}

pub async fn health(State(state):State<AppState>,user:Extension<AuthenticatedUser>)->Result<Json<Value>,AppError>{
    let rows:Vec<(String,String,String,bool,bool)>=sqlx::query_as(
        "SELECT slot,model_name,health_status,is_disabled,COALESCE(health_status='online' AND verification->>'verified'='true' AND (verification->>'expires_at')::timestamptz>now(),false) FROM engine_configs WHERE org_id=$1 ORDER BY slot")
        .bind(user.org_id).fetch_all(&state.db).await?;
    let ready=|slot:&str|rows.iter().any(|(s,_,_,disabled,verified)|s==slot && !disabled && *verified);
    Ok(Json(json!({"alpha_ready":ready("a"),"beta_ready":ready("b"),"gamma_ready":ready("c"),
        "alpha":ready("a"),"beta":ready("b"),"gamma":ready("c"),
        "any_available":rows.iter().any(|(_,_,_,d,v)|!d && *v),
        "all_available":ready("a")&&ready("b")&&ready("c"),
        "source":"Settings AI Engines; recent generation evidence",
        "note":"Readiness concerns generation only, not mathematical correctness or completed reviews."})))
}

pub async fn run(State(state):State<AppState>,user:Extension<AuthenticatedUser>,Path(id):Path<Uuid>)->Result<Json<Value>,AppError>{
    let task:Value=sqlx::query_scalar("SELECT to_jsonb(t) FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=$1 AND p.org_id=$2")
        .bind(id).bind(user.org_id).fetch_optional(&state.db).await?
        .ok_or_else(||AppError::NotFound("Run not found".into()))?;
    sqlx::query("UPDATE execution_events SET state='failed',error='Execution record expired without a final response; the process may have restarted',finished_at=now() WHERE task_id=$1 AND state='running' AND started_at<now()-interval '15 minutes'")
        .bind(id).execute(&state.db).await?;
    let results:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(r) FROM task_results r WHERE task_id=$1 ORDER BY step_number")
        .bind(id).fetch_all(&state.db).await?;
    let reviews:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(v) FROM task_reviews v JOIN task_results r ON r.id=v.task_result_id WHERE r.task_id=$1 ORDER BY v.created_at")
        .bind(id).fetch_all(&state.db).await?;
    let events:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(e) FROM execution_events e WHERE task_id=$1 ORDER BY started_at")
        .bind(id).fetch_all(&state.db).await?;
    let worker:Option<Value>=sqlx::query_scalar("SELECT jsonb_build_object('enabled',enabled,'message',message,'active_task',active_task,'heartbeat_at',heartbeat_at) FROM agent_workers WHERE org_id=$1")
        .bind(user.org_id).fetch_optional(&state.db).await?;
    Ok(Json(json!({"task":task,"results":results,"reviews":reviews,"events":events,"worker":worker})))
}
