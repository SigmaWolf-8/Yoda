#[path = "../src/browser_formula_store.rs"]
mod store;
use store as browser_formula_store;
#[allow(dead_code)]
#[path = "../src/auth.rs"]
mod auth;
#[allow(dead_code)]
#[path = "../src/error.rs"]
mod error;
#[allow(dead_code)]
#[path = "../src/gate_handle.rs"]
mod gate_handle;
#[path = "../src/browser_formula_history.rs"]
mod api;
mod state {
    // Only the shared dependencies used by the real auth and history handlers.
    #[derive(Clone)]
    pub struct AppState {
        pub db: sqlx::PgPool,
        pub jwt_secret: String,
        pub jwt_access_expiry_minutes: i64,
        pub jwt_refresh_expiry_days: i64,
    }
}
use axum::{body::{Body, to_bytes}, http::{Request, StatusCode}, middleware, routing::get, Router};
use tower::ServiceExt;
use serde_json::{json, Value};
use sqlx::{postgres::PgPoolOptions, PgPool};
use uuid::Uuid;

fn submission(version: &str, status: &str) -> store::Submission {
    serde_json::from_value(json!({
        "submissionId": Uuid::new_v4(),
        "claim": {"id":"claim","title":"Original title","formula":"F=(x²,0,0)","sources":["Codex"]},
        "record": {
            "id":"check","title":"A check","kind":"numerical-check",
            "inputs":{"samples":2048}, "assumptions":["Unit ball"],
            "expected":{"flux":0}, "tolerance":1e-12, "limitation":"Finite approximation",
            "status":status, "observed":if status=="passed" { json!({"flux":0}) } else { Value::Null },
            "implementationVersion":version,"testVersion":format!("test/{version}"),
            "executionLocation":"Browser / JavaScript; not a daemon",
            "traceId":Uuid::new_v4(),"executedAt":"2026-11-01T00:00:00Z",
            "error":if status=="passed" { Value::Null } else { json!("Executor unavailable or failed") }
        }
    })).unwrap()
}

#[test]
fn validates_terminal_reports_and_rejects_forged_success() {
    for status in ["passed", "failed", "unavailable"] {
        submission("1", status).validate().unwrap();
    }
    for field in ["implementationVersion", "testVersion", "inputs", "expected", "observed",
        "assumptions", "executedAt", "traceId", "tolerance", "error"] {
        let mut input = submission("1", "passed");
        input.record.as_object_mut().unwrap().remove(field);
        assert!(input.validate().is_err(), "accepted missing {field}");
    }
    for kind in ["daemon-execution", "ai-commentary", "displayed-formula"] {
        let mut input = submission("1", "passed");
        input.record["kind"] = json!(kind);
        assert!(input.validate().is_err());
        input.record["status"] = json!("unavailable");
        input.record["observed"] = Value::Null;
        input.record["executedAt"] = Value::Null;
        input.record["error"] = json!("No adapter");
        input.validate().unwrap();
    }
    for status in ["running", "not-run", "certified"] {
        let mut input = submission("1", status);
        input.record["status"] = json!(status);
        assert!(input.validate().is_err());
    }
    let mut oversized = submission("1", "passed");
    oversized.record["inputs"]["large"] = json!("x".repeat(65536));
    assert!(oversized.validate().is_err());
    let mut invalid_date = submission("1", "passed");
    invalid_date.record["executedAt"] = json!("yesterday");
    assert!(invalid_date.validate().is_err());
    let mut forged_owner = serde_json::to_value(submission("1", "passed")).unwrap();
    forged_owner["user_id"] = json!(Uuid::new_v4());
    assert!(serde_json::from_value::<store::Submission>(forged_owner).is_err());
}

async fn exercise(db: &PgPool) {
    let org_a = Uuid::new_v4();
    let org_b = Uuid::new_v4();
    let user_a = Uuid::new_v4();
    let user_b = Uuid::new_v4();
    sqlx::query("INSERT INTO organizations VALUES($1),($2)").bind(org_a).bind(org_b).execute(db).await.unwrap();
    sqlx::query("INSERT INTO users(id) VALUES($1),($2)").bind(user_a).bind(user_b).execute(db).await.unwrap();
    let first = submission("1", "passed");
    let (saved, same) = store::append(db, org_a, user_a, &first).await.unwrap();
    assert!(same);
    assert_eq!(saved["provenance"], "client-submitted-unverified");
    assert_eq!(saved["daemonReceipt"], false);
    assert_ne!(saved["receivedAt"], first.record["executedAt"]);
    let (retried, same) = store::append(db, org_a, user_a, &first).await.unwrap();
    assert!(same);
    assert_eq!(retried, saved, "retry must return the immutable original");
    let mut changed = submission("2", "failed");
    changed.submission_id = first.submission_id;
    let (conflict, same) = store::append(db, org_a, user_a, &changed).await.unwrap();
    assert!(!same);
    assert_eq!(conflict, saved);
    // Both user and organization boundaries apply (including users in the same org).
    for (org, user) in [(org_a, user_b), (org_b, user_a), (org_b, user_b)] {
        assert_eq!(store::history(db, org, user, None).await.unwrap()["runs"], json!([]));
        let (other, same) = store::append(db, org, user, &changed).await.unwrap();
        assert!(same, "idempotency namespace must be owner-scoped");
        assert_ne!(other["id"], saved["id"]);
    }
    let mut second = submission("2", "failed");
    second.record["inputs"]["samples"] = json!(4096);
    second.claim["formula"] = json!("New formula snapshot");
    store::append(db, org_a, user_a, &second).await.unwrap();
    let unavailable = submission("3", "unavailable");
    store::append(db, org_a, user_a, &unavailable).await.unwrap();
    let reopened = store::history(db, org_a, user_a, None).await.unwrap();
    assert_eq!(reopened["runs"].as_array().unwrap().len(), 3);
    assert_eq!(reopened["runs"][0]["submission"]["record"]["status"], "unavailable");
    assert_eq!(reopened["runs"][1]["submission"]["record"]["implementationVersion"], "2");
    assert_eq!(reopened["runs"][1]["submission"]["record"]["testVersion"], "test/2");
    assert_eq!(reopened["runs"][1]["submission"]["record"]["inputs"]["samples"], 4096);
    assert_eq!(reopened["runs"][2]["submission"], serde_json::to_value(&first).unwrap());
    for statement in [
        "UPDATE browser_formula_runs SET payload='{}'",
        "DELETE FROM browser_formula_runs",
        "TRUNCATE browser_formula_runs",
    ] {
        assert!(sqlx::query(statement).execute(db).await.is_err(), "allowed {statement}");
    }
    for _ in 0..50 {
        store::append(db, org_a, user_a, &submission("4", "passed")).await.unwrap();
    }
    let page = store::history(db, org_a, user_a, None).await.unwrap();
    assert_eq!(page["runs"].as_array().unwrap().len(), 50);
    let cursor = page["nextCursor"].as_str().unwrap().parse().unwrap();
    // A new append between pages cannot duplicate or hide older rows.
    store::append(db, org_a, user_a, &submission("5", "passed")).await.unwrap();
    let older = store::history(db, org_a, user_a, Some(cursor)).await.unwrap();
    assert_eq!(older["runs"].as_array().unwrap().len(), 3);
    assert!(older["nextCursor"].is_null());
    assert_eq!(older["runs"][2], saved);
    exercise_http(db, org_a, user_a, user_b).await;
}

async fn exercise_http(db: &PgPool, org: Uuid, user: Uuid, other: Uuid) {
    sqlx::query("INSERT INTO org_members(org_id,user_id) VALUES($1,$2),($1,$3)")
        .bind(org).bind(user).bind(other).execute(db).await.unwrap();
    let state = state::AppState {
        db: db.clone(), jwt_secret: "history-test-only-secret-not-used-by-the-app".into(),
        jwt_access_expiry_minutes: 60, jwt_refresh_expiry_days: 1,
    };
    let token = auth::create_access_token(user, "fixture@example.invalid", org, &state.jwt_secret, 60).unwrap();
    let other_token = auth::create_access_token(other, "fixture@example.invalid", org, &state.jwt_secret, 60).unwrap();
    let app = Router::new().route("/history", get(api::history).post(api::append))
        .layer(axum::extract::DefaultBodyLimit::max(65536))
        .layer(middleware::from_fn_with_state(state.clone(), auth::strict_auth_middleware))
        .layer(middleware::from_fn(api::no_cache)).with_state(state);
    for credential in [None, Some("Basic not-a-bearer"), Some("Bearer invalid")] {
        let mut request = Request::builder().uri("/history");
        if let Some(value) = credential { request = request.header("Authorization", value); }
        let response = app.clone().oneshot(request.body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(response.headers()["cache-control"], "private, no-store");
    }
    let response = app.clone().oneshot(Request::builder().uri("/history")
        .header("x-api-key", "invalid-key").body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let input = submission("http-version", "failed");
    let body = serde_json::to_string(&input).unwrap();
    let post = |body: String| Request::builder().method("POST").uri("/history")
        .header("Authorization", format!("Bearer {token}")).header("Content-Type", "application/json")
        .body(Body::from(body)).unwrap();
    let response = app.clone().oneshot(post(body.clone())).await.unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let saved: Value = serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
    assert_eq!(saved["submission"]["record"]["status"], "failed");
    assert_eq!(saved["provenance"], "client-submitted-unverified");
    let response = app.clone().oneshot(post(body)).await.unwrap();
    let retried: Value = serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
    assert_eq!(saved, retried);
    let mut changed = serde_json::to_value(&input).unwrap();
    changed["record"]["testVersion"] = json!("mutated");
    assert_eq!(app.clone().oneshot(post(changed.to_string())).await.unwrap().status(), StatusCode::CONFLICT);
    assert_eq!(app.clone().oneshot(post("x".repeat(65537))).await.unwrap().status(), StatusCode::PAYLOAD_TOO_LARGE);
    let response = app.clone().oneshot(Request::builder().uri("/history")
        .header("Authorization", format!("Bearer {other_token}")).body(Body::empty()).unwrap()).await.unwrap();
    let history: Value = serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
    assert!(history["runs"].as_array().unwrap().iter().all(|r| r["id"] != saved["id"]));
    sqlx::query("DELETE FROM org_members WHERE user_id=$1").bind(user).execute(db).await.unwrap();
    let response = app.oneshot(Request::builder().uri("/history")
        .header("Authorization", format!("Bearer {token}")).body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN, "stale membership must invalidate otherwise valid credentials");
}

/// Real Postgres, isolated schema; no changes to application records.
#[tokio::test]
async fn durable_history_is_append_only_isolated_and_versioned() {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL required for isolated Postgres tests");
    let admin = PgPoolOptions::new().max_connections(1).connect(&url).await.unwrap();
    let schema = format!("formula_history_test_{}", Uuid::new_v4().simple());
    sqlx::query(&format!("CREATE SCHEMA {schema}")).execute(&admin).await.unwrap();
    let search_path = format!("SET search_path TO {schema}");
    let db = PgPoolOptions::new().max_connections(2).after_connect(move |connection, _| {
        let statement = search_path.clone();
        Box::pin(async move { sqlx::query(&statement).execute(connection).await?; Ok(()) })
    }).connect(&url).await.unwrap();
    sqlx::raw_sql("CREATE TABLE users(id uuid PRIMARY KEY, email text NOT NULL DEFAULT 'fixture@example.invalid');
        CREATE TABLE organizations(id uuid PRIMARY KEY);
        CREATE TABLE org_members(org_id uuid, user_id uuid, created_at timestamptz DEFAULT now());
        CREATE TABLE api_keys(user_id uuid, key_prefix text, key_hash text);")
        .execute(&db).await.unwrap();
    sqlx::raw_sql(include_str!("../../../migrations/20261101000003_formula_evidence.sql")).execute(&db).await.unwrap();
    sqlx::raw_sql(include_str!("../../../migrations/20261101000004_browser_formula_history.sql")).execute(&db).await.unwrap();
    // Join the test task so a panic still leaves the test schema cleaned up.
    let result = tokio::spawn({ let db = db.clone(); async move { exercise(&db).await } }).await;
    db.close().await;
    sqlx::query(&format!("DROP SCHEMA {schema} CASCADE")).execute(&admin).await.unwrap();
    result.unwrap();
}
