//! Live market rates for the sovereign ledger.
//!
//! Interest owed is not a stored figure — it is a function of a published
//! reference rate and the days elapsed since the basis date. This module goes
//! and gets those reference rates from the institutions that publish them:
//!
//! * **SOFR** — Federal Reserve Bank of New York, the secured overnight
//!   financing rate that demand obligations are priced against.
//! * **Treasury average interest rates** — U.S. Treasury Fiscal Data, the
//!   average coupon on marketable bills/notes/bonds, used for term provisions.
//! * **XAU/USD spot** — gold spot, used to revalue the bullion reserve against
//!   the LBMA fix recorded in the workbook.
//!
//! All three are public, unauthenticated endpoints.
//!
//! **A missing rate is reported, never invented.** If a source is unreachable
//! its quote comes back with `status: "unavailable"` and the transport error
//! attached, and every figure that depended on it is withheld rather than
//! computed from a stale or assumed number. An auditor can tell the difference
//! between "3.65%" and "we could not reach the Fed"; a fallback constant would
//! erase that distinction.

use serde::Serialize;
use serde_json::Value;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use super::dec::Dec;

/// How long a fetched snapshot is served before the sources are polled again.
/// SOFR and the Treasury series publish once a business day, so a short cache
/// costs nothing in freshness and keeps a dashboard refresh from hammering
/// public infrastructure.
const CACHE_TTL: Duration = Duration::from_secs(300);

/// Per-source budget. These endpoints answer in ~200 ms; anything beyond this
/// is a hang, and a statement that takes a minute to load is a broken page.
const FETCH_TIMEOUT: Duration = Duration::from_secs(8);

const SOFR_URL: &str = "https://markets.newyorkfed.org/api/rates/secured/sofr/last/1.json";
const TREASURY_URL: &str = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?sort=-record_date&page%5Bsize%5D=12";
const GOLD_URL: &str = "https://api.gold-api.com/price/XAU";

/// One reference rate, or the reason there isn't one.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RateQuote {
    /// Stable identifier that debt terms reference (`SOFR`, `UST_NOTES`, …).
    pub id: String,
    pub label: String,
    /// Annualised percentage, e.g. `3.65` meaning 3.65 %/yr. `None` when the
    /// source could not be reached.
    pub percent: Option<Dec>,
    /// The publication date the rate is effective for — not the time we asked.
    pub effective_date: Option<String>,
    pub publisher: String,
    pub url: String,
    /// `live` or `unavailable`.
    pub status: &'static str,
    pub error: Option<String>,
}

impl RateQuote {
    fn live(id: &str, label: &str, publisher: &str, url: &str, percent: Dec, effective: Option<String>) -> Self {
        RateQuote {
            id: id.into(),
            label: label.into(),
            percent: Some(percent),
            effective_date: effective,
            publisher: publisher.into(),
            url: url.into(),
            status: "live",
            error: None,
        }
    }

    fn down(id: &str, label: &str, publisher: &str, url: &str, err: String) -> Self {
        RateQuote {
            id: id.into(),
            label: label.into(),
            percent: None,
            effective_date: None,
            publisher: publisher.into(),
            url: url.into(),
            status: "unavailable",
            error: Some(err),
        }
    }
}

/// Gold spot, kept separate from interest indices because it revalues an asset
/// rather than accruing a liability.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoldQuote {
    /// USD per troy ounce.
    pub usd_per_troy_ounce: Option<Dec>,
    pub observed_at: Option<String>,
    pub publisher: String,
    pub url: String,
    pub status: &'static str,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RateSnapshot {
    /// When these quotes were pulled (RFC 3339, UTC).
    pub fetched_at: String,
    /// True when this response came from cache rather than a fresh poll.
    pub from_cache: bool,
    /// Seconds the snapshot is served before re-polling.
    pub cache_ttl_seconds: u64,
    pub quotes: Vec<RateQuote>,
    pub gold: GoldQuote,
    /// `live` (everything answered), `degraded` (some did), `unavailable`
    /// (nothing did).
    pub status: &'static str,
}

impl RateSnapshot {
    /// Look up an index by the id a debt term references.
    pub fn quote(&self, id: &str) -> Option<&RateQuote> {
        self.quotes.iter().find(|q| q.id == id)
    }
}

struct Cached {
    at: Instant,
    snap: RateSnapshot,
}

static CACHE: RwLock<Option<Cached>> = RwLock::const_new(None);

/// Fetch the current rate snapshot, using the cache unless `force` is set.
pub async fn snapshot(force: bool) -> RateSnapshot {
    if !force {
        if let Some(c) = CACHE.read().await.as_ref() {
            if c.at.elapsed() < CACHE_TTL {
                let mut snap = c.snap.clone();
                snap.from_cache = true;
                return snap;
            }
        }
    }

    let fresh = fetch_all().await;
    *CACHE.write().await = Some(Cached { at: Instant::now(), snap: fresh.clone() });
    fresh
}

async fn fetch_all() -> RateSnapshot {
    let client = match reqwest::Client::builder().timeout(FETCH_TIMEOUT).build() {
        Ok(c) => c,
        Err(e) => {
            // Without a client nothing can be fetched; say so once per source
            // rather than pretending some subset worked.
            let msg = format!("HTTP client could not be constructed: {e}");
            return RateSnapshot {
                fetched_at: now_rfc3339(),
                from_cache: false,
                cache_ttl_seconds: CACHE_TTL.as_secs(),
                quotes: vec![
                    RateQuote::down("SOFR", "Secured Overnight Financing Rate", "Federal Reserve Bank of New York", SOFR_URL, msg.clone()),
                ],
                gold: GoldQuote {
                    usd_per_troy_ounce: None,
                    observed_at: None,
                    publisher: "gold-api.com".into(),
                    url: GOLD_URL.into(),
                    status: "unavailable",
                    error: Some(msg),
                },
                status: "unavailable",
            };
        }
    };

    let (sofr, treasury, gold) = tokio::join!(
        fetch_sofr(&client),
        fetch_treasury(&client),
        fetch_gold(&client),
    );

    let mut quotes = vec![sofr];
    quotes.extend(treasury);

    let live = quotes.iter().filter(|q| q.status == "live").count();
    let total = quotes.len() + 1; // + gold
    let live_all = live + usize::from(gold.status == "live");
    let status = if live_all == total {
        "live"
    } else if live_all == 0 {
        "unavailable"
    } else {
        "degraded"
    };

    RateSnapshot {
        fetched_at: now_rfc3339(),
        from_cache: false,
        cache_ttl_seconds: CACHE_TTL.as_secs(),
        quotes,
        gold,
        status,
    }
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// A fetched JSON document, kept alongside the exact bytes it arrived as.
///
/// `serde_json` decodes a fractional JSON number into an `f64`. That is fine
/// for navigation — finding the row whose `security_desc` matches, reading a
/// publication date — but it must never be the path a *rate* travels, because
/// the double is a re-encoding of the publisher's decimal, not the decimal
/// itself. So the parsed tree is used only to locate things, and every numeric
/// value is lifted out of `raw` as the publisher's own characters.
struct Body {
    value: Value,
    raw: String,
}

impl Body {
    fn parse(raw: String, url: &str) -> Result<Body, String> {
        let value = serde_json::from_str(&raw).map_err(|e| {
            let head: String = raw.chars().take(180).collect();
            format!("{url} did not return JSON ({e}): {head}")
        })?;
        Ok(Body { value, raw })
    }
}

/// Walk a JSON-pointer path over the *unparsed* text and return the source
/// characters of the value it addresses. Objects and arrays are re-split with
/// `RawValue`, which borrows rather than decodes, so no number along the way is
/// ever turned into a float.
fn raw_lexeme<'a>(raw: &'a str, ptr: &str) -> Result<&'a str, String> {
    use serde_json::value::RawValue;
    use std::collections::BTreeMap;

    let mut cur: &'a RawValue =
        serde_json::from_str(raw).map_err(|e| format!("body is not JSON ({e})"))?;

    for seg in ptr.split('/').skip(1) {
        // RFC 6901 escapes: `~1` is `/`, `~0` is `~`. Order matters.
        let key = seg.replace("~1", "/").replace("~0", "~");
        let text = cur.get().trim_start();
        if text.starts_with('{') {
            let map: BTreeMap<String, &'a RawValue> = serde_json::from_str(cur.get())
                .map_err(|e| format!("object at `{ptr}` could not be split ({e})"))?;
            cur = map
                .get(&key)
                .copied()
                .ok_or_else(|| format!("response has no field at `{ptr}`"))?;
        } else if text.starts_with('[') {
            let arr: Vec<&'a RawValue> = serde_json::from_str(cur.get())
                .map_err(|e| format!("array at `{ptr}` could not be split ({e})"))?;
            let i: usize = key
                .parse()
                .map_err(|_| format!("`{key}` in `{ptr}` is not an array index"))?;
            cur = arr
                .get(i)
                .copied()
                .ok_or_else(|| format!("response has no element at `{ptr}`"))?;
        } else {
            return Err(format!("`{ptr}` descends into a scalar"));
        }
    }
    Ok(cur.get().trim())
}

/// Pull a JSON body, reporting transport and status failures with the address
/// that failed so an operator can reproduce it with `curl`.
async fn get_json(client: &reqwest::Client, url: &str) -> Result<Body, String> {
    let resp = client
        .get(url)
        .header("accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("request to {url} failed: {e}"))?;
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("response body from {url} could not be read: {e}"))?;
    if !status.is_success() {
        let head: String = body.chars().take(180).collect();
        return Err(format!("{url} returned HTTP {status}: {head}"));
    }
    Body::parse(body, url)
}

/// Read a published figure as the publisher wrote it.
///
/// The value is taken from the raw response text, so a quote with more
/// precision than a double can hold arrives intact instead of being silently
/// rewritten by a round trip through `f64`. A quoted string is unwrapped and a
/// bare number is taken verbatim; anything else — `null`, a boolean, an object
/// — is an error, never a coerced guess.
fn number_field(b: &Body, ptr: &str) -> Result<Dec, String> {
    let lex = raw_lexeme(&b.raw, ptr)?;
    let text = if lex.len() >= 2 && lex.starts_with('"') && lex.ends_with('"') {
        // A JSON string. Escapes cannot appear inside a decimal literal, so if
        // one is present the field is not a number and `Dec::parse` will say so.
        &lex[1..lex.len() - 1]
    } else {
        lex
    };
    Dec::parse(text).map_err(|e| format!("field `{ptr}` = `{lex}` is not a decimal: {e}"))
}

async fn fetch_sofr(client: &reqwest::Client) -> RateQuote {
    const ID: &str = "SOFR";
    const LABEL: &str = "Secured Overnight Financing Rate";
    const PUB: &str = "Federal Reserve Bank of New York";
    match get_json(client, SOFR_URL).await {
        Err(e) => RateQuote::down(ID, LABEL, PUB, SOFR_URL, e),
        Ok(b) => match number_field(&b, "/refRates/0/percentRate") {
            Err(e) => RateQuote::down(ID, LABEL, PUB, SOFR_URL, e),
            Ok(rate) => {
                let eff = b
                    .value
                    .pointer("/refRates/0/effectiveDate")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                RateQuote::live(ID, LABEL, PUB, SOFR_URL, rate, eff)
            }
        },
    }
}

/// The Treasury series returns one row per security type per month. Only the
/// most recent `record_date` is taken, so a partially-published month cannot
/// mix rates from two different periods into one statement.
async fn fetch_treasury(client: &reqwest::Client) -> Vec<RateQuote> {
    const PUB: &str = "U.S. Department of the Treasury — Fiscal Data";
    let wanted = [
        ("Treasury Bills", "UST_BILLS", "Treasury Bills — average interest rate"),
        ("Treasury Notes", "UST_NOTES", "Treasury Notes — average interest rate"),
        ("Treasury Bonds", "UST_BONDS", "Treasury Bonds — average interest rate"),
    ];

    let body = match get_json(client, TREASURY_URL).await {
        Ok(v) => v,
        Err(e) => {
            return wanted
                .iter()
                .map(|(_, id, label)| RateQuote::down(id, label, PUB, TREASURY_URL, e.clone()))
                .collect()
        }
    };

    let empty: Vec<Value> = Vec::new();
    let rows = body.value.get("data").and_then(Value::as_array).unwrap_or(&empty);
    let latest = rows
        .iter()
        .filter_map(|r| r.get("record_date").and_then(Value::as_str))
        .max()
        .map(str::to_string);

    wanted
        .iter()
        .map(|(desc, id, label)| {
            // The parsed tree locates the row; the figure itself is then lifted
            // out of the raw text by index, so it never passes through a float.
            let row = rows.iter().position(|r| {
                r.get("security_desc").and_then(Value::as_str) == Some(desc)
                    && r.get("record_date").and_then(Value::as_str) == latest.as_deref()
            });
            match row {
                None => RateQuote::down(
                    id,
                    label,
                    PUB,
                    TREASURY_URL,
                    format!(
                        "no `{desc}` row for record_date {}",
                        latest.as_deref().unwrap_or("(none returned)")
                    ),
                ),
                Some(i) => match number_field(&body, &format!("/data/{i}/avg_interest_rate_amt")) {
                    Err(e) => RateQuote::down(id, label, PUB, TREASURY_URL, e),
                    Ok(rate) => RateQuote::live(id, label, PUB, TREASURY_URL, rate, latest.clone()),
                },
            }
        })
        .collect()
}

async fn fetch_gold(client: &reqwest::Client) -> GoldQuote {
    const PUB: &str = "gold-api.com (XAU/USD spot)";
    match get_json(client, GOLD_URL).await {
        Err(e) => GoldQuote {
            usd_per_troy_ounce: None,
            observed_at: None,
            publisher: PUB.into(),
            url: GOLD_URL.into(),
            status: "unavailable",
            error: Some(e),
        },
        Ok(b) => match number_field(&b, "/price") {
            Err(e) => GoldQuote {
                usd_per_troy_ounce: None,
                observed_at: None,
                publisher: PUB.into(),
                url: GOLD_URL.into(),
                status: "unavailable",
                error: Some(e),
            },
            Ok(price) => GoldQuote {
                usd_per_troy_ounce: Some(price),
                observed_at: b
                    .value
                    .pointer("/updatedAt")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                publisher: PUB.into(),
                url: GOLD_URL.into(),
                status: "live",
                error: None,
            },
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(raw: &str) -> Body {
        Body::parse(raw.to_string(), "test://body").unwrap()
    }

    #[test]
    fn reads_a_json_number_without_losing_the_literal() {
        let b = body(r#"{ "refRates": [ { "percentRate": 3.65 } ] }"#);
        assert_eq!(
            number_field(&b, "/refRates/0/percentRate").unwrap().to_string(),
            "3.65"
        );
    }

    #[test]
    fn reads_a_json_string_rate() {
        let b = body(r#"{ "avg_interest_rate_amt": "3.758" }"#);
        assert_eq!(
            number_field(&b, "/avg_interest_rate_amt").unwrap().to_string(),
            "3.758"
        );
    }

    #[test]
    fn missing_or_wrong_typed_fields_are_errors_not_zeros() {
        let b = body(r#"{ "a": true }"#);
        assert!(number_field(&b, "/missing").is_err());
        assert!(number_field(&b, "/a").is_err());
        assert!(number_field(&body(r#"{ "a": null }"#), "/a").is_err());
    }

    /// The reason the raw text is kept at all: this literal has more
    /// significant digits than an `f64` can represent, so a parse-then-restring
    /// round trip silently rewrites it. Reading the source characters does not.
    #[test]
    fn a_rate_beyond_double_precision_survives_intact() {
        let raw = r#"{ "price": 4343.2998046875123456789 }"#;
        assert_eq!(
            number_field(&body(raw), "/price").unwrap().to_string(),
            "4343.2998046875123456789"
        );

        let via_double = serde_json::from_str::<Value>(raw).unwrap()["price"].to_string();
        assert_ne!(
            via_double, "4343.2998046875123456789",
            "if serde_json ever preserves this, the raw-text path is still the contract"
        );
    }

    #[test]
    fn pointer_walking_reports_where_it_failed() {
        let b = body(r#"{ "data": [ { "v": 1 } ] }"#);
        assert!(raw_lexeme(&b.raw, "/data/9/v").is_err());
        assert!(raw_lexeme(&b.raw, "/data/0/v/deeper").is_err());
        assert_eq!(raw_lexeme(&b.raw, "/data/0/v").unwrap(), "1");
    }
}
