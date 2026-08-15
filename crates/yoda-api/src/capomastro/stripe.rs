//! The estate's Stripe account, reached directly over the REST API.
//!
//! Two things are deliberate here.
//!
//! **The secret key is never held.** It is fetched from the Replit connection
//! API on each call and dropped when the call returns. Connector credentials
//! rotate; a key cached at boot is a key that works until it silently doesn't,
//! and the failure would land in the middle of issuing a demand. The fetch is
//! cheap and local.
//!
//! **Stripe's answer is never guessed at.** Every call either returns Stripe's
//! JSON or an error carrying Stripe's own message. Nothing in this module
//! invents a status, retries a write, or reports success it did not see — a
//! payment surface that quietly assumes is worse than one that stops.

use std::time::Duration;

use serde_json::Value;

use crate::error::AppError;

const STRIPE_API: &str = "https://api.stripe.com/v1";
const CONNECTOR_TIMEOUT: Duration = Duration::from_secs(10);
const STRIPE_TIMEOUT: Duration = Duration::from_secs(20);

/// Stripe's ceiling for a single charge in USD minor units — $999,999.99.
///
/// Larger balances are not refused by rounding them down or by splitting them
/// behind the operator's back. A demand above this is reported as what it is:
/// an amount this rail cannot carry.
pub const MAX_CHARGE_CENTS: i64 = 99_999_999;

/// Fetch the estate's Stripe secret key from the Replit connection API.
///
/// Deliberately uncached — see the module note.
async fn secret_key(client: &reqwest::Client) -> Result<String, AppError> {
    let hostname = std::env::var("REPLIT_CONNECTORS_HOSTNAME").map_err(|_| {
        AppError::Unavailable(
            "the connection service address is not set in this environment, so the Stripe \
             credentials cannot be fetched"
                .into(),
        )
    })?;

    let token = std::env::var("REPL_IDENTITY")
        .ok()
        .map(|t| format!("repl {t}"))
        .or_else(|| {
            std::env::var("WEB_REPL_RENEWAL")
                .ok()
                .map(|t| format!("depl {t}"))
        })
        .ok_or_else(|| {
            AppError::Unavailable(
                "this process holds no identity token, so it cannot ask the connection service \
                 for the Stripe credentials"
                    .into(),
            )
        })?;

    let url =
        format!("https://{hostname}/api/v2/connection?include_secrets=true&connector_names=stripe");
    let res = client
        .get(&url)
        .header("Accept", "application/json")
        .header("X_REPLIT_TOKEN", token)
        .timeout(CONNECTOR_TIMEOUT)
        .send()
        .await
        .map_err(|e| AppError::Unavailable(format!("the connection service did not answer: {e}")))?;

    let status = res.status();
    let body: Value = res.json().await.map_err(|e| {
        AppError::Unavailable(format!("the connection service answered unreadably: {e}"))
    })?;
    if !status.is_success() {
        return Err(AppError::Unavailable(format!(
            "the connection service refused the credential request ({status})"
        )));
    }

    // The connection service has carried this field under both names; accept
    // either rather than failing on a rename that is not ours to control.
    body.pointer("/items/0/settings/secret")
        .or_else(|| body.pointer("/items/0/settings/secret_key"))
        .or_else(|| body.pointer("/items/0/settings/api_key"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| {
            AppError::Unavailable(
                "Stripe is not connected to this environment, or the connection carries no secret \
                 key. Connect Stripe from the Integrations pane."
                    .into(),
            )
        })
}

/// Whether the connected account is in test mode, read from the key itself.
/// Shown on the collections page so no one mistakes a test demand for a real
/// one, or the reverse.
pub fn is_test_key(key: &str) -> bool {
    key.starts_with("sk_test_") || key.starts_with("rk_test_")
}

/// Live mode / test mode, without exposing the key.
pub async fn mode(client: &reqwest::Client) -> Result<&'static str, AppError> {
    Ok(if is_test_key(&secret_key(client).await?) {
        "test"
    } else {
        "live"
    })
}

/// A form-encoded POST to Stripe.
///
/// `idempotency_key` is required rather than optional: every call this module
/// makes creates something, and a retried demand that raises a second invoice
/// against the same debtor is a real-world error, not a cosmetic one.
pub async fn post(
    client: &reqwest::Client,
    path: &str,
    form: &[(String, String)],
    idempotency_key: &str,
) -> Result<Value, AppError> {
    let key = secret_key(client).await?;
    let res = client
        .post(format!("{STRIPE_API}/{path}"))
        .bearer_auth(&key)
        .header("Idempotency-Key", idempotency_key)
        .form(form)
        .timeout(STRIPE_TIMEOUT)
        .send()
        .await
        .map_err(|e| AppError::Unavailable(format!("Stripe did not answer: {e}")))?;
    read(res, path).await
}

/// A GET against Stripe. `query` is passed through verbatim.
pub async fn get(
    client: &reqwest::Client,
    path: &str,
    query: &[(String, String)],
) -> Result<Value, AppError> {
    let key = secret_key(client).await?;
    let res = client
        .get(format!("{STRIPE_API}/{path}"))
        .bearer_auth(&key)
        .query(query)
        .timeout(STRIPE_TIMEOUT)
        .send()
        .await
        .map_err(|e| AppError::Unavailable(format!("Stripe did not answer: {e}")))?;
    read(res, path).await
}

/// Turn a Stripe response into JSON, or into Stripe's own error message.
///
/// Stripe explains its refusals precisely — an unverified account, a customer
/// that cannot be invoiced, an amount over the rail's ceiling. Replacing that
/// with "payment failed" would throw away the only thing that tells an operator
/// what to do next.
async fn read(res: reqwest::Response, path: &str) -> Result<Value, AppError> {
    let status = res.status();
    let body: Value = res
        .json()
        .await
        .map_err(|e| AppError::Unavailable(format!("Stripe answered unreadably: {e}")))?;

    if status.is_success() {
        return Ok(body);
    }

    let detail = body
        .pointer("/error/message")
        .and_then(Value::as_str)
        .unwrap_or("no reason given");
    let code = body
        .pointer("/error/code")
        .and_then(Value::as_str)
        .map(|c| format!(" [{c}]"))
        .unwrap_or_default();

    Err(match status.as_u16() {
        400 | 402 | 404 | 409 => AppError::Validation(format!("Stripe refused {path}{code}: {detail}")),
        401 | 403 => AppError::Unavailable(format!(
            "Stripe rejected this account's credentials{code}: {detail}"
        )),
        _ => AppError::Unavailable(format!("Stripe failed on {path} ({status}){code}: {detail}")),
    })
}
