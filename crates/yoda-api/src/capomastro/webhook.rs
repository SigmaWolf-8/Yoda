//! The Stripe webhook — a payment posts to the register the moment it lands.
//!
//! The register reads every invoice live from Stripe, which is correct but
//! passive: a debtor can pay at 2am and the estate's own records say nothing
//! until someone opens the page. Stripe pushes invoice lifecycle events here,
//! each one is matched back to a demand by the `demandId` the invoice has
//! carried in its metadata since issue, and the settlement fact is recorded
//! against the demand row.
//!
//! Three rules govern this surface.
//!
//! **Nothing unsigned is believed.** The route is public — it has to be, Stripe
//! is the caller — so the signature is the whole of the authentication. Every
//! request must carry a `Stripe-Signature` header whose HMAC verifies against a
//! signing secret this service holds; anything else is refused before the body
//! is even parsed as JSON.
//!
//! **Redelivery is a fact of the medium, not an error.** Stripe redelivers
//! events until acknowledged. Every accepted event id is written down first,
//! and an id seen before is acknowledged without being applied — a redelivered
//! `invoice.paid` must not post twice.
//!
//! **An event this service cannot use is acknowledged, never crashed on.** An
//! unknown type, an invoice with no demand id, a demand id that matches no row:
//! each is logged and answered 200. Refusing them would only make Stripe
//! redeliver forever, and none of them is Stripe's fault.

use axum::body::Bytes;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::Json;
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;
use uuid::Uuid;

use super::stripe;
use crate::error::AppError;
use crate::state::AppState;

// ── Sealing the signing secret at rest ───────────────────────────────────
//
// The signing secret is the sole credential authorising a public surface:
// anyone who reads it can forge a settlement. It is therefore never stored in
// plaintext. It cannot go through `security::encrypt_credential` either — that
// path's ciphertext serialisation is `todo!()` pending the PlenumNET service
// and panics at runtime — so it is sealed here with XChaCha20-Poly1305 under a
// key derived from `SESSION_SECRET` (IETF variant, random 96-bit nonce — fine
// at this volume: sealing happens on registration, not per event). A database
// read alone recovers nothing;
// forging an accepted signature requires the environment's secret as well.
//
// Stored form: `v1:{hex nonce}:{hex ciphertext}`. If `SESSION_SECRET` is
// absent or rotated, unsealing fails closed: events are refused and the
// endpoint re-registers itself at the next boot rather than ever trusting a
// secret it cannot read.

use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Nonce};

/// Domain label for the sealing key derivation.
const SEAL_CONTEXT: &[u8] = b"capomastro-webhook-secret-sealing-v1";

fn sealing_cipher() -> Result<ChaCha20Poly1305, AppError> {
    let session_secret = std::env::var("SESSION_SECRET")
        .ok()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::Internal(
                "SESSION_SECRET is not set, so the webhook signing secret cannot be sealed at \
                 rest — refusing to store it in plaintext"
                    .into(),
            )
        })?;
    let mut mac = HmacSha256::new_from_slice(session_secret.as_bytes())
        .map_err(|e| AppError::Internal(format!("deriving the sealing key: {e}")))?;
    mac.update(SEAL_CONTEXT);
    let key: [u8; 32] = mac.finalize().into_bytes().into();
    Ok(ChaCha20Poly1305::new((&key).into()))
}

/// Seal a signing secret for storage. Random 12-byte nonce per sealing.
fn seal_secret(plaintext: &str) -> Result<String, AppError> {
    let cipher = sealing_cipher()?;
    let mut nonce_bytes = [0u8; 12];
    rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| AppError::Internal(format!("sealing the webhook secret: {e}")))?;
    Ok(format!("v1:{}:{}", hex::encode(nonce_bytes), hex::encode(ct)))
}

/// Open a sealed signing secret. Fails on any tampering, wrong key, or a
/// value that is not in sealed form.
fn unseal_secret(stored: &str) -> Result<String, AppError> {
    let mut parts = stored.splitn(3, ':');
    let (Some("v1"), Some(nonce_hex), Some(ct_hex)) = (parts.next(), parts.next(), parts.next())
    else {
        return Err(AppError::Internal("stored webhook secret is not sealed".into()));
    };
    let nonce_bytes = hex::decode(nonce_hex)
        .ok()
        .filter(|n| n.len() == 12)
        .ok_or_else(|| AppError::Internal("sealed webhook secret has a malformed nonce".into()))?;
    let ct = hex::decode(ct_hex)
        .map_err(|_| AppError::Internal("sealed webhook secret has malformed ciphertext".into()))?;
    let cipher = sealing_cipher()?;
    let pt = cipher
        .decrypt(Nonce::from_slice(&nonce_bytes), ct.as_ref())
        .map_err(|_| {
            AppError::Internal(
                "the sealed webhook secret failed authentication — wrong key or tampered".into(),
            )
        })?;
    String::from_utf8(pt)
        .map_err(|_| AppError::Internal("unsealed webhook secret is not UTF-8".into()))
}

type HmacSha256 = Hmac<Sha256>;

/// How far a signed timestamp may drift from now before the signature is
/// stale. Stripe's own libraries default to five minutes.
const TOLERANCE_SECS: i64 = 300;

/// The event types this webhook asks Stripe for. Everything else that arrives
/// is acknowledged and logged, but no endpoint is subscribed to more than it
/// handles.
const SUBSCRIBED_EVENTS: [&str; 4] = [
    "invoice.paid",
    "invoice.payment_failed",
    "invoice.voided",
    "invoice.marked_uncollectible",
];

/// Path this router serves the webhook on — the registration task and the
/// route table must never disagree about it.
pub const WEBHOOK_PATH: &str = "/api/capomastro/collections/webhook";

// ── Endpoint registration ────────────────────────────────────────────────

/// Register this environment's webhook endpoint at Stripe, once, in the
/// background. Failure is logged, not fatal: the register still works read-only
/// without a webhook, and the next boot tries again.
pub fn spawn_webhook_registration(state: AppState) {
    tokio::spawn(async move {
        if let Err(e) = encrypt_legacy_secrets(&state).await {
            tracing::warn!(error = ?e, "could not migrate plaintext webhook secrets");
        }
        match ensure_endpoint(&state).await {
            Ok(Some(url)) => tracing::info!(url, "Stripe collections webhook endpoint ready"),
            Ok(None) => tracing::info!(
                "no public domain in this environment — Stripe collections webhook not registered"
            ),
            Err(e) => tracing::warn!(
                error = ?e,
                "could not register the Stripe collections webhook — payments will still be \
                 read live from Stripe, but nothing will push them"
            ),
        }
    });
}

/// Create (or find) the webhook endpoint for this environment's public URL and
/// hold the signing secret Stripe issued for it.
///
/// The Replit Stripe connection carries no webhook signing secret, so the
/// endpoint is registered directly over the REST API — `webhook_endpoints`
/// returns the secret exactly once, at creation, and it is stored then or
/// never. One endpoint per URL: the dev domain and a published domain each
/// get their own row and their own secret.
async fn ensure_endpoint(state: &AppState) -> Result<Option<String>, AppError> {
    let Some(domain) = std::env::var("REPLIT_DOMAINS")
        .ok()
        .and_then(|d| d.split(',').next().map(str::to_string))
        .filter(|d| !d.is_empty())
    else {
        return Ok(None);
    };
    let url = format!("https://{domain}{WEBHOOK_PATH}");

    let known: Option<(String, String)> = sqlx::query_as(
        "SELECT endpoint_id, signing_secret FROM collections_webhook_endpoints WHERE url = $1",
    )
    .bind(&url)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| AppError::Internal(format!("reading registered webhooks: {e}")))?;

    // A row whose secret cannot be opened (rotated SESSION_SECRET, tampering)
    // is dead weight: it can never verify an event. Drop it at Stripe's side
    // too and register afresh.
    let known = match known {
        Some((endpoint_id, sealed)) if unseal_secret(&sealed).is_err() => {
            tracing::warn!(
                endpoint_id,
                "stored webhook signing secret cannot be opened — re-registering the endpoint"
            );
            let _ = stripe::delete(
                &state.http_client,
                &format!("webhook_endpoints/{endpoint_id}"),
            )
            .await;
            sqlx::query("DELETE FROM collections_webhook_endpoints WHERE url = $1")
                .bind(&url)
                .execute(&state.db)
                .await
                .map_err(|e| AppError::Internal(format!("clearing the dead webhook row: {e}")))?;
            None
        }
        Some((endpoint_id, _)) => Some(endpoint_id),
        None => None,
    };

    if let Some(endpoint_id) = known {
        // Confirm it still exists and is enabled at Stripe. If Stripe no longer
        // knows it (deleted from the dashboard, say), the stored secret is dead
        // and the endpoint is re-created.
        match stripe::get(
            &state.http_client,
            &format!("webhook_endpoints/{endpoint_id}"),
            &[],
        )
        .await
        {
            Ok(ep) if ep.get("status").and_then(Value::as_str) == Some("enabled") => {
                return Ok(Some(url));
            }
            Ok(_) | Err(AppError::Validation(_)) | Err(AppError::NotFound(_)) => {
                tracing::warn!(
                    endpoint_id,
                    "stored Stripe webhook endpoint is gone or disabled — re-registering"
                );
                sqlx::query("DELETE FROM collections_webhook_endpoints WHERE url = $1")
                    .bind(&url)
                    .execute(&state.db)
                    .await
                    .map_err(|e| {
                        AppError::Internal(format!("clearing the dead webhook row: {e}"))
                    })?;
            }
            // Stripe unreachable: the stored secret may be perfectly good.
            // Keep it and try again next boot rather than churning endpoints.
            Err(e) => return Err(e),
        }
    }

    let mut form: Vec<(String, String)> = vec![
        ("url".to_string(), url.clone()),
        ("description".to_string(), "Capomastro collections register — settlement events".to_string()),
        ("metadata[managed_by]".to_string(), "capomastro-collections".to_string()),
    ];
    for (i, ev) in SUBSCRIBED_EVENTS.iter().enumerate() {
        form.push((format!("enabled_events[{i}]"), (*ev).to_string()));
    }

    // The idempotency key is derived from the URL so a crash between the POST
    // and the INSERT cannot mint a second endpoint for the same address.
    let created = stripe::post(
        &state.http_client,
        "webhook_endpoints",
        &form,
        &format!("collections-webhook-{}", hex_digest(url.as_bytes())),
    )
    .await?;

    let endpoint_id = created
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Unavailable("Stripe created a webhook endpoint without an id".into()))?;
    let secret = created
        .get("secret")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::Unavailable(
                "Stripe returned a webhook endpoint without its signing secret — the endpoint \
                 cannot be trusted and was not recorded"
                    .into(),
            )
        })?;

    // The signing secret is a credential authorising a public surface: it is
    // sealed at rest and opened only at the moment of verification.
    let sealed = seal_secret(secret)?;

    sqlx::query(
        "INSERT INTO collections_webhook_endpoints (url, endpoint_id, signing_secret) \
         VALUES ($1, $2, $3) \
         ON CONFLICT (url) DO UPDATE SET endpoint_id = $2, signing_secret = $3",
    )
    .bind(&url)
    .bind(endpoint_id)
    .bind(&sealed)
    .execute(&state.db)
    .await
    .map_err(|e| AppError::Internal(format!("recording the webhook endpoint: {e}")))?;

    Ok(Some(url))
}

fn hex_digest(bytes: &[u8]) -> String {
    use sha2::Digest;
    hex::encode(Sha256::digest(bytes))
}

// ── Signature verification ───────────────────────────────────────────────

/// Every signing secret this service may legitimately receive events under:
/// the connection's own, when the connection carries one, plus every endpoint
/// this service registered. More than one can be live at once (dev and
/// published domains), and a signature verifying under any of them is valid.
async fn signing_secrets(state: &AppState) -> Vec<String> {
    let mut secrets: Vec<String> = Vec::new();
    // The connection's webhook secret vouches for the *connector's* Stripe
    // account. When STRIPE_SECRET_KEY is set, that key is the authority and
    // the connector may be a different (possibly sandbox) account — its events
    // must not be believed against this register.
    let direct_key_active = std::env::var("STRIPE_SECRET_KEY")
        .map(|k| !k.trim().is_empty())
        .unwrap_or(false);
    if !direct_key_active {
        match stripe::connection_webhook_secret(&state.http_client).await {
            Ok(Some(s)) => secrets.push(s),
            Ok(None) => {}
            Err(e) => tracing::warn!(error = ?e, "could not read the connection's webhook secret"),
        }
    }
    match sqlx::query_scalar::<_, String>(
        "SELECT signing_secret FROM collections_webhook_endpoints",
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            for sealed in rows {
                match unseal_secret(&sealed) {
                    Ok(secret) => secrets.push(secret),
                    // A secret that cannot be opened cannot verify anything —
                    // it is skipped, loudly. Fail closed: an unreadable secret
                    // never becomes an accepted signature.
                    Err(e) => tracing::warn!(
                        error = ?e,
                        "a stored webhook secret could not be decrypted — events signed under \
                         it will be refused until the endpoint re-registers"
                    ),
                }
            }
        }
        Err(e) => tracing::warn!(error = %e, "could not read stored webhook secrets"),
    }
    secrets
}

/// One-time migration: any secret stored in plaintext by an earlier build is
/// sealed in place. A plaintext Stripe secret is recognisable (`whsec_…`,
/// and no `hash:hex` envelope); anything already sealed is left alone.
async fn encrypt_legacy_secrets(state: &AppState) -> Result<(), AppError> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT url, signing_secret FROM collections_webhook_endpoints",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| AppError::Internal(format!("reading webhook secrets: {e}")))?;

    for (url, stored) in rows {
        if unseal_secret(&stored).is_ok() {
            continue; // already sealed
        }
        if !stored.starts_with("whsec_") {
            tracing::warn!(
                url,
                "a stored webhook secret is neither sealed nor recognisably plaintext — leaving \
                 it; events under it will be refused"
            );
            continue;
        }
        let sealed = seal_secret(&stored)?;
        sqlx::query("UPDATE collections_webhook_endpoints SET signing_secret = $2 WHERE url = $1")
            .bind(&url)
            .bind(&sealed)
            .execute(&state.db)
            .await
            .map_err(|e| AppError::Internal(format!("storing the sealed secret: {e}")))?;
        tracing::info!(url, "sealed a plaintext webhook signing secret at rest");
    }
    Ok(())
}

/// Verify a `Stripe-Signature` header against one secret, exactly as Stripe's
/// own libraries do: HMAC-SHA256 over `{timestamp}.{payload}`, compared in
/// constant time against every `v1` candidate, with the timestamp bounded to
/// the tolerance window against replay.
fn verify_signature(secret: &str, header: &str, payload: &[u8], now: i64) -> bool {
    let mut timestamp: Option<i64> = None;
    let mut candidates: Vec<&str> = Vec::new();
    for part in header.split(',') {
        match part.trim().split_once('=') {
            Some(("t", t)) => timestamp = t.parse().ok(),
            Some(("v1", sig)) => candidates.push(sig),
            _ => {}
        }
    }
    let Some(t) = timestamp else { return false };
    if (now - t).abs() > TOLERANCE_SECS {
        return false;
    }
    for candidate in candidates {
        let Ok(sig_bytes) = hex::decode(candidate) else {
            continue;
        };
        let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
            .expect("HMAC accepts keys of any length");
        mac.update(t.to_string().as_bytes());
        mac.update(b".");
        mac.update(payload);
        if mac.verify_slice(&sig_bytes).is_ok() {
            return true;
        }
    }
    false
}

// ── The handler ──────────────────────────────────────────────────────────

/// POST /api/capomastro/collections/webhook
///
/// Public by necessity, authenticated by signature. The body is taken raw —
/// the signature covers the exact bytes Stripe sent, and a re-serialized JSON
/// body would never verify.
pub async fn stripe_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    // ── The signature, before anything else ──────────────────────────
    let header = headers
        .get("stripe-signature")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            AppError::Unauthorized("this endpoint accepts only signed Stripe events".into())
        })?;

    let secrets = signing_secrets(&state).await;
    if secrets.is_empty() {
        // No secret held means no event can be verified — fail closed, and say
        // why, rather than accepting on faith.
        return Err(AppError::Unavailable(
            "no webhook signing secret is held yet, so this event cannot be verified. The \
             endpoint registers itself at startup once Stripe is reachable."
                .into(),
        ));
    }

    let now = chrono::Utc::now().timestamp();
    if !secrets.iter().any(|s| verify_signature(s, header, &body, now)) {
        return Err(AppError::Unauthorized(
            "the event's signature did not verify against any signing secret this service \
             holds — the event is not believed"
                .into(),
        ));
    }

    // ── The event ────────────────────────────────────────────────────
    let event: Value = serde_json::from_slice(&body).map_err(|e| {
        AppError::Validation(format!("a signed event arrived with an unreadable body: {e}"))
    })?;
    let event_id = event.get("id").and_then(Value::as_str).unwrap_or("");
    let event_type = event.get("type").and_then(Value::as_str).unwrap_or("");
    let object = event.pointer("/data/object").cloned().unwrap_or(Value::Null);

    if event_id.is_empty() {
        tracing::warn!("signed Stripe event carried no id — acknowledged, not applied");
        return Ok(Json(json!({ "received": true, "applied": false, "reason": "no event id" })));
    }

    if !SUBSCRIBED_EVENTS.contains(&event_type) {
        tracing::info!(event_id, event_type, "unhandled Stripe event type — acknowledged");
        return Ok(Json(json!({ "received": true, "applied": false, "reason": "unhandled type" })));
    }

    // ── The demand it belongs to ─────────────────────────────────────
    let demand_id = object
        .pointer("/metadata/demandId")
        .and_then(Value::as_str)
        .and_then(|s| Uuid::parse_str(s).ok());
    let Some(demand_id) = demand_id else {
        tracing::info!(
            event_id,
            event_type,
            "Stripe event carries no demandId metadata — not one of this register's invoices; \
             acknowledged"
        );
        return Ok(Json(json!({ "received": true, "applied": false, "reason": "no demandId" })));
    };

    // The demand id alone is not proof of identity: a signed event for some
    // *other* invoice that happens to carry a known demand UUID in its
    // metadata must not settle the demand. The event's invoice must be the
    // demand's own invoice. The one exception is a demand still `pending` with
    // no invoice recorded — the Stripe-timed-out-mid-issue case, where this
    // event is precisely the missing confirmation — and it is adopted then,
    // and only then.
    let Some(invoice_id) = object.get("id").and_then(Value::as_str).map(str::to_string) else {
        tracing::warn!(event_id, event_type, "Stripe event carried no invoice id — acknowledged");
        return Ok(Json(json!({ "received": true, "applied": false, "reason": "no invoice id" })));
    };
    let amount_paid = object.get("amount_paid").and_then(Value::as_i64);
    let event_created = event
        .get("created")
        .and_then(Value::as_i64)
        .and_then(|t| chrono::DateTime::from_timestamp(t, 0))
        .unwrap_or_else(chrono::Utc::now);

    // ── Apply, exactly once ──────────────────────────────────────────
    // The event ledger insert and the demand update commit together: either
    // the event is recorded as applied and its posting stands, or neither
    // happened and Stripe's redelivery gets a clean second attempt.
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|e| AppError::Internal(format!("opening the settlement transaction: {e}")))?;

    let fresh = sqlx::query(
        "INSERT INTO collections_webhook_events (id, event_type, demand_id) \
         VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
    )
    .bind(event_id)
    .bind(event_type)
    .bind(demand_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| AppError::Internal(format!("recording the event: {e}")))?
    .rows_affected()
        > 0;

    if !fresh {
        tracing::info!(event_id, event_type, %demand_id, "redelivered Stripe event — already applied");
        return Ok(Json(json!({ "received": true, "applied": false, "reason": "duplicate" })));
    }

    let applied = match event_type {
        // A payment posts once. The guard on settlement_state means that even
        // if Stripe were to emit two *distinct* paid events for one invoice,
        // the second changes nothing.
        "invoice.paid" => sqlx::query(
            "UPDATE collections_demands SET \
                settlement_state = 'paid', \
                settled_at = $2, \
                settled_amount_cents = $3, \
                settlement_event_id = $4, \
                stripe_invoice_id = COALESCE(stripe_invoice_id, $5), \
                state = 'issued', \
                updated_at = NOW() \
             WHERE id = $1 AND settlement_state IS DISTINCT FROM 'paid' \
               AND (stripe_invoice_id = $5 \
                    OR (stripe_invoice_id IS NULL AND state = 'pending'))",
        )
        .bind(demand_id)
        .bind(event_created)
        .bind(amount_paid)
        .bind(event_id)
        .bind(&invoice_id),

        // A failed attempt never displaces a recorded payment: a debtor whose
        // card bounced *after* the invoice was paid by other means stays paid.
        "invoice.payment_failed" => sqlx::query(
            "UPDATE collections_demands SET \
                settlement_state = 'payment_failed', \
                settlement_event_id = $2, \
                stripe_invoice_id = COALESCE(stripe_invoice_id, $3), \
                updated_at = NOW() \
             WHERE id = $1 AND settlement_state IS DISTINCT FROM 'paid' \
               AND (stripe_invoice_id = $3 \
                    OR (stripe_invoice_id IS NULL AND state = 'pending'))",
        )
        .bind(demand_id)
        .bind(event_id)
        .bind(&invoice_id),

        "invoice.voided" => sqlx::query(
            "UPDATE collections_demands SET \
                settlement_state = 'voided', \
                settled_at = $2, \
                settlement_event_id = $3, \
                stripe_invoice_id = COALESCE(stripe_invoice_id, $4), \
                state = 'voided', \
                updated_at = NOW() \
             WHERE id = $1 AND settlement_state IS DISTINCT FROM 'paid' \
               AND (stripe_invoice_id = $4 \
                    OR (stripe_invoice_id IS NULL AND state = 'pending'))",
        )
        .bind(demand_id)
        .bind(event_created)
        .bind(event_id)
        .bind(&invoice_id),

        "invoice.marked_uncollectible" => sqlx::query(
            "UPDATE collections_demands SET \
                settlement_state = 'uncollectible', \
                settled_at = $2, \
                settlement_event_id = $3, \
                stripe_invoice_id = COALESCE(stripe_invoice_id, $4), \
                updated_at = NOW() \
             WHERE id = $1 AND settlement_state IS DISTINCT FROM 'paid' \
               AND (stripe_invoice_id = $4 \
                    OR (stripe_invoice_id IS NULL AND state = 'pending'))",
        )
        .bind(demand_id)
        .bind(event_created)
        .bind(event_id)
        .bind(&invoice_id),

        // Unreachable: filtered above. Kept explicit so a future addition to
        // SUBSCRIBED_EVENTS without a handler is a loud mistake, not a silent one.
        other => {
            tracing::warn!(event_id, event_type = other, "subscribed event type with no handler");
            return Ok(Json(json!({ "received": true, "applied": false, "reason": "no handler" })));
        }
    }
    .execute(&mut *tx)
    .await
    .map_err(|e| AppError::Internal(format!("posting the settlement: {e}")))?
    .rows_affected();

    tx.commit()
        .await
        .map_err(|e| AppError::Internal(format!("committing the settlement: {e}")))?;

    if applied == 0 {
        // The event named a demand this register does not hold (or one already
        // settled). Logged and acknowledged — Stripe did nothing wrong.
        tracing::warn!(
            event_id,
            event_type,
            %demand_id,
            "Stripe event matched no open demand row — acknowledged without posting"
        );
    } else {
        tracing::info!(event_id, event_type, %demand_id, "settlement posted from Stripe event");
    }

    Ok(Json(json!({ "received": true, "applied": applied > 0 })))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sign(secret: &str, t: i64, payload: &[u8]) -> String {
        let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(t.to_string().as_bytes());
        mac.update(b".");
        mac.update(payload);
        format!("t={t},v1={}", hex::encode(mac.finalize().into_bytes()))
    }

    #[test]
    fn a_secret_seals_and_unseals_round_trip() {
        std::env::set_var("SESSION_SECRET", "test-session-secret");
        let sealed = seal_secret("whsec_roundtrip").unwrap();
        assert!(sealed.starts_with("v1:"));
        assert!(!sealed.contains("whsec_"));
        assert_eq!(unseal_secret(&sealed).unwrap(), "whsec_roundtrip");
    }

    #[test]
    fn a_tampered_seal_fails_closed() {
        std::env::set_var("SESSION_SECRET", "test-session-secret");
        let sealed = seal_secret("whsec_roundtrip").unwrap();
        let mut tampered = sealed.clone().into_bytes();
        let last = tampered.len() - 1;
        tampered[last] = if tampered[last] == b'0' { b'1' } else { b'0' };
        assert!(unseal_secret(std::str::from_utf8(&tampered).unwrap()).is_err());
    }

    #[test]
    fn a_plaintext_value_does_not_unseal() {
        std::env::set_var("SESSION_SECRET", "test-session-secret");
        assert!(unseal_secret("whsec_plaintext").is_err());
    }

    #[test]
    fn a_correct_signature_verifies() {
        let header = sign("whsec_test", 1_000_000, b"{\"id\":\"evt_1\"}");
        assert!(verify_signature("whsec_test", &header, b"{\"id\":\"evt_1\"}", 1_000_000));
    }

    #[test]
    fn a_wrong_secret_does_not_verify() {
        let header = sign("whsec_other", 1_000_000, b"{}");
        assert!(!verify_signature("whsec_test", &header, b"{}", 1_000_000));
    }

    #[test]
    fn a_tampered_payload_does_not_verify() {
        let header = sign("whsec_test", 1_000_000, b"{\"amount\":1}");
        assert!(!verify_signature("whsec_test", &header, b"{\"amount\":2}", 1_000_000));
    }

    #[test]
    fn a_stale_timestamp_is_refused_even_when_the_hmac_is_right() {
        let header = sign("whsec_test", 1_000_000, b"{}");
        assert!(!verify_signature("whsec_test", &header, b"{}", 1_000_000 + TOLERANCE_SECS + 1));
    }

    #[test]
    fn a_header_with_no_timestamp_is_refused() {
        assert!(!verify_signature("whsec_test", "v1=deadbeef", b"{}", 0));
    }

    #[test]
    fn extra_unknown_pairs_and_multiple_v1s_are_tolerated() {
        let good = sign("whsec_test", 1_000_000, b"{}");
        let header = format!("{good},v0=ffff,v1=0000");
        assert!(verify_signature("whsec_test", &header, b"{}", 1_000_000));
    }
}
