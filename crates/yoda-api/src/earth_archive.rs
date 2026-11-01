//! Write-only Windows reporter credentials. Reports are not server attestations.
use axum::{extract::{State,Path},Extension,Json,http::{HeaderMap,StatusCode},response::{IntoResponse,Response}};
use axum_extra::extract::Host;
use serde::Deserialize;
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use uuid::Uuid;
use crate::{auth::AuthenticatedUser,error::AppError,state::AppState};

const INSTALL:&str=include_str!("../../../scripts/earth_archive/install.ps1");
const GUIDE:&str=include_str!("../../../scripts/earth_archive/GUIDE.txt");
const FILES:[(&str,&str);5]=[
    ("client.py",include_str!("../../../scripts/earth_archive/client.py")),
    ("acquire.py",include_str!("../../../scripts/earth_archive/acquire.py")),
    ("viewer.py",include_str!("../../../scripts/earth_archive/viewer.py")),
    ("retention.py",include_str!("../../../scripts/earth_archive/retention.py")),
    ("retention_ui.py",include_str!("../../../scripts/earth_archive/retention_ui.py")),
];
fn hash(s:&str)->String{format!("{:x}",Sha256::digest(s.as_bytes()))}

pub async fn guide()->impl IntoResponse {([("Content-Type","text/plain; charset=utf-8")],GUIDE)}
pub async fn file(Path(name):Path<String>)->Result<impl IntoResponse,AppError>{
    let body=FILES.iter().find(|(key,_)|*key==name).map(|(_,body)|*body)
        .ok_or_else(||AppError::NotFound("Archive runner file not found".into()))?;
    Ok(([("Content-Type","text/plain; charset=utf-8"),("X-Content-Type-Options","nosniff")],body))
}
pub async fn status(State(state):State<AppState>,user:Extension<AuthenticatedUser>)->Result<Json<Value>,AppError>{
    let installation:Option<Value>=sqlx::query_scalar(
        "SELECT jsonb_build_object('id',id,'created_at',created_at,'expires_at',expires_at,'last_report_at',last_report_at,'report',report) FROM earth_archive_installations WHERE org_id=$1 AND NOT revoked ORDER BY created_at DESC LIMIT 1")
        .bind(user.org_id).fetch_optional(&state.db).await?;
    Ok(Json(json!({"installation":installation,"coverage":"GLOBAL native-resolution","renderer_tier":"T1","server_verified":false})))
}
pub async fn installer(State(state):State<AppState>,user:Extension<AuthenticatedUser>,Host(host):Host)->Result<Response,AppError>{
    if host.is_empty() || host.len()>253 || !host.bytes().all(|b|b.is_ascii_alphanumeric() || matches!(b,b'.'|b'-'|b':')){
        return Err(AppError::Validation("Invalid application host".into()));
    }
    let id=Uuid::new_v4();
    let token=format!("{}{}",Uuid::new_v4().simple(),Uuid::new_v4().simple());
    let hashes:serde_json::Map<String,Value>=FILES.iter().map(|(name,body)|(name.to_string(),json!(hash(body)))).collect();
    let body=INSTALL.replace("@@BASE@@",&format!("https://{host}"))
        .replace("@@TOKEN@@",&token).replace("@@ID@@",&id.to_string())
        .replace("@@HASHES@@",&serde_json::to_string(&hashes).unwrap());
    let mut tx=state.db.begin().await?;
    // Serialize reissues for this organization to avoid two concurrently active credentials.
    sqlx::query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE").bind(user.org_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE earth_archive_installations SET revoked=true WHERE org_id=$1 AND NOT revoked").bind(user.org_id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO earth_archive_installations(id,org_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '90 days')")
        .bind(id).bind(user.org_id).bind(hash(&token)).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok((StatusCode::OK,[("Content-Type","application/octet-stream"),
        ("Content-Disposition","attachment; filename=\"install-yoda-earth.ps1\""),
        ("Cache-Control","no-store"),("X-Content-Type-Options","nosniff")],body).into_response())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Report {
    phase:String,message:String,catalog_complete:bool,catalog_objects:u64,catalog_bytes:u64,
    verified_objects:u64,verified_bytes:u64,failures:u64,archive_complete:bool,engine_ready:bool,
    reported_at:chrono::DateTime<chrono::Utc>,sources:std::collections::BTreeMap<String,Source>,
    survey_grade:bool,native_data_renderer_integrated:bool,integrity_scope:String,
}
#[derive(Deserialize,serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct Source {complete:bool,objects:u64,at:chrono::DateTime<chrono::Utc>,error_type:Option<String>}

pub async fn report(State(state):State<AppState>,headers:HeaderMap,Json(input):Json<Report>)->Result<Json<Value>,AppError>{
    let token=headers.get("authorization").and_then(|h|h.to_str().ok()).and_then(|h|h.strip_prefix("Bearer "))
        .filter(|s|s.len()==64 && s.bytes().all(|b|b.is_ascii_hexdigit()))
        .ok_or_else(||AppError::Unauthorized("Reporting credential required".into()))?;
    let id:Option<Uuid>=sqlx::query_scalar("SELECT id FROM earth_archive_installations WHERE token_hash=$1 AND NOT revoked AND expires_at>now()")
        .bind(hash(token)).fetch_optional(&state.db).await?;
    let id=id.ok_or_else(||AppError::Unauthorized("Reporting credential expired or revoked".into()))?;
    let complete=input.catalog_complete && input.catalog_objects>0 && input.catalog_objects==input.verified_objects;
    if !["starting","inventory","downloading","partial","complete","error","interrupted","not_started"].contains(&input.phase.as_str())
        || input.message.len()>512 || input.integrity_scope.len()>512 || input.sources.len()>3
        || input.sources.iter().any(|(k,v)|!["copernicus","gebco","egm2008"].contains(&k.as_str()) || v.error_type.as_ref().is_some_and(|s|s.len()>100))
        || input.verified_objects>input.catalog_objects || input.verified_bytes>input.catalog_bytes
        || input.failures>input.catalog_objects
        || input.catalog_complete!=(input.sources.len()==3 && input.sources.values().all(|s|s.complete))
        || (input.phase=="complete" && !complete)
        || input.catalog_bytes>10_000_000_000_000_000 || input.archive_complete!=complete
        || input.survey_grade || input.native_data_renderer_integrated {
        return Err(AppError::Validation("Inconsistent or oversized acquisition report".into()));
    }
    let data=json!({"phase":input.phase,"message":input.message,"catalog_complete":input.catalog_complete,
        "catalog_objects":input.catalog_objects,"catalog_bytes":input.catalog_bytes,"verified_objects":input.verified_objects,
        "verified_bytes":input.verified_bytes,"failures":input.failures,"archive_complete":input.archive_complete,
        "engine_ready":input.engine_ready,"reported_at":input.reported_at,"sources":input.sources,
        "survey_grade":false,"native_data_renderer_integrated":false,"integrity_scope":input.integrity_scope});
    sqlx::query("UPDATE earth_archive_installations SET report=$2,last_report_at=now() WHERE id=$1 AND NOT revoked AND expires_at>now() AND (last_report_at IS NULL OR last_report_at<now()-interval '10 seconds' OR (report->>'phase') IS DISTINCT FROM ($2->>'phase'))")
        .bind(id).bind(data).execute(&state.db).await?;
    Ok(Json(json!({"accepted":true,"server_verified":false})))
}
