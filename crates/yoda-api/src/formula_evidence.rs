//! Tenant-scoped append-only records of deterministic calculations.
use axum::{extract::{State,Path}, Extension, Json, http::StatusCode};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest,Sha256};
use uuid::Uuid;
use crate::{auth::AuthenticatedUser,error::AppError,state::AppState,formula_math};

const SOURCE:&str=include_str!("formula_math.rs");
fn hash(bytes:&[u8])->String {format!("{:x}",Sha256::digest(bytes))}

pub async fn catalog()->Json<Value>{
    let mut catalog=formula_math::catalog();
    catalog["formulas"].as_array_mut().unwrap().insert(0,json!({
        "id":"isopsephy-document","title":"Full canonical Isopsephy document engine",
        "method":"Execute the supplied Python pipeline and save its complete self-contained HTML instrument",
        "inputs":{"text":"Capomastro Salvalaggio"},
        "limitations":["At most 8192 UTF-8 bytes, 1000 recognized words and 256 distinct tokens.",
            "Canonical tokenizer/mappings are used unchanged; unsupported scripts are not analyzed.",
            "No English gloss is supplied: fallback tokens are not translations.",
            "Server execution and browser runtime assertions are separate evidence."]
    }));
    Json(catalog)
}
pub async fn source()->Json<Value>{
    Json(json!({"language":"Rust","source":SOURCE,"source_sha256":hash(SOURCE.as_bytes()),
        "scope":"Independent deterministic calculation module; no AI, database or network required to evaluate its functions."}))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunInput {formula_id:String,inputs:formula_math::Inputs}

pub async fn run(State(state):State<AppState>,user:Extension<AuthenticatedUser>,Json(input):Json<RunInput>)
    ->Result<(StatusCode,Json<Value>),AppError>{
    if input.inputs.len()>10 || input.inputs.iter().any(|(k,v)|k.len()>64 || v.len()>8192) {
        return Err(AppError::Validation("Formula input exceeds the supported size".into()));
    }
    let id=Uuid::new_v4();
    let (mut output,report,source_hash)=if input.formula_id=="isopsephy-document" {
        let text=input.inputs.get("text").ok_or_else(||AppError::Validation("text is required".into()))?;
        let mut generated=canonical_document(text).await?;
        let result=generated.get_mut("result").map(Value::take)
            .ok_or_else(||AppError::Internal("Canonical result missing".into()))?;
        let report=generated["report_html"].as_str().filter(|v|v.len()<1_000_000)
            .ok_or_else(||AppError::Internal("Canonical report missing or oversized".into()))?.to_string();
        let source_hash=generated["source_sha256"].as_str().ok_or_else(||AppError::Internal("Canonical source hash missing".into()))?.to_string();
        (result,Some(report),source_hash)
    }else{
        (formula_math::evaluate(&input.formula_id,&input.inputs).map_err(AppError::Validation)?,None,hash(SOURCE.as_bytes()))
    };
    if report.is_some() {output["outputs"]["report_url"]=json!(format!("/api/formula-evidence/runs/{id}/report"));}
    let now=chrono::Utc::now();
    let mut record=json!({"id":id,"formula_id":input.formula_id,"inputs":input.inputs,
        "result":output,"executed_at":now,"source_sha256":source_hash,
        "execution_location":"application server; not an AI daemon","schema_version":1});
    let bytes=serde_json::to_vec(&record).map_err(|_|AppError::Internal("Could not encode evidence".into()))?;
    record["evidence_sha256"]=json!(hash(&bytes));
    // A persistence failure is an explicit request failure, never a saved badge.
    sqlx::query("INSERT INTO formula_evidence_runs(id,org_id,formula_id,executed_at,record,report_html) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(id).bind(user.org_id).bind(&input.formula_id).bind(now).bind(&record)
        .bind(report)
        .execute(&state.db).await?;
    Ok((StatusCode::CREATED,Json(record)))
}

static DOCUMENT_LIMIT:tokio::sync::Semaphore=tokio::sync::Semaphore::const_new(2);
async fn canonical_document(text:&str)->Result<Value,AppError>{
    use tokio::io::AsyncWriteExt;
    use std::process::Stdio;
    let _permit=DOCUMENT_LIMIT.try_acquire()
        .map_err(|_|AppError::Unavailable("Two document calculations are already running; retry shortly".into()))?;
    let mut child=tokio::process::Command::new("python3")
        .arg("scripts/run-isopsephy-document.py")
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true)
        .spawn().map_err(|_|AppError::Unavailable("Canonical Python engine could not start".into()))?;
    let mut stdin=child.stdin.take().ok_or_else(||AppError::Internal("Engine input unavailable".into()))?;
    stdin.write_all(text.as_bytes()).await.map_err(|_|AppError::Internal("Engine input failed".into()))?;
    drop(stdin);
    let output=tokio::time::timeout(std::time::Duration::from_secs(20),child.wait_with_output())
        .await.map_err(|_|AppError::Unavailable("Canonical engine exceeded its 20-second bound".into()))?
        .map_err(|_|AppError::Internal("Canonical engine process failed".into()))?;
    let result:Value=serde_json::from_slice(&output.stdout)
        .map_err(|_|AppError::Internal("Canonical engine returned invalid evidence".into()))?;
    if !output.status.success() {
        return Err(AppError::Validation(result["error"].as_str().unwrap_or("Canonical engine failed").to_string()));
    }
    Ok(result)
}

pub async fn report(State(state):State<AppState>,user:Extension<AuthenticatedUser>,Path(id):Path<Uuid>)
    ->Result<axum::response::Html<String>,AppError>{
    let html:Option<Option<String>>=sqlx::query_scalar("SELECT report_html FROM formula_evidence_runs WHERE id=$1 AND org_id=$2")
        .bind(id).bind(user.org_id).fetch_optional(&state.db).await?;
    Ok(axum::response::Html(html.flatten().ok_or_else(||AppError::NotFound("Generated report not found".into()))?))
}

pub async fn history(State(state):State<AppState>,user:Extension<AuthenticatedUser>)->Result<Json<Value>,AppError>{
    let runs:Vec<Value>=sqlx::query_scalar("SELECT record FROM formula_evidence_runs WHERE org_id=$1 ORDER BY executed_at DESC,id DESC LIMIT 50")
        .bind(user.org_id).fetch_all(&state.db).await?;
    Ok(Json(json!({"runs":runs,"limit":50})))
}

/// Constrain the uploaded offline instruments without modifying their bytes.
pub async fn offline_headers(request:axum::extract::Request,next:axum::middleware::Next)->axum::response::Response {
    let path=request.uri().path();
    let offline=path.starts_with("/capomastro/engines/arc182/") ||
        (path.starts_with("/api/formula-evidence/runs/") && path.ends_with("/report"));
    let mut response=next.run(request).await;
    if offline {
        response.headers_mut().insert("Content-Security-Policy",
            axum::http::HeaderValue::from_static("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"));
        response.headers_mut().insert("X-Content-Type-Options",axum::http::HeaderValue::from_static("nosniff"));
    }
    response
}
