//! Health monitoring for configured inference engines.
//!
//! Self-hosted: ping /health every 30 seconds.
//! Commercial/free-tier: lightweight test completion every 60 seconds.
//! Tracks latency, error rates, and queue depth per engine.

use crate::{EngineConfig, EngineSlot, HealthStatus, HostingMode};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tracing;

/// Health check intervals.
const SELF_HOSTED_INTERVAL: Duration = Duration::from_secs(30);
const API_INTERVAL: Duration = Duration::from_secs(60);
/// If a health check takes longer than this, flag as suspect.
const SUSPECT_THRESHOLD: Duration = Duration::from_secs(10);
/// After this many consecutive failures, mark as offline.
const OFFLINE_THRESHOLD: u32 = 3;

/// Per-engine health metrics.
#[derive(Debug, Clone)]
pub struct EngineHealth {
    pub slot: EngineSlot,
    pub status: HealthStatus,
    pub avg_latency_ms: Option<u64>,
    pub error_rate: f64,
    pub consecutive_failures: u32,
    pub last_check: Option<Instant>,
    pub queue_depth: u32,
}

impl EngineHealth {
    pub fn new(slot: EngineSlot) -> Self {
        Self {
            slot,
            status: HealthStatus::Offline,
            avg_latency_ms: None,
            error_rate: 0.0,
            consecutive_failures: 0,
            last_check: None,
            queue_depth: 0,
        }
    }

    /// Record a successful health check.
    pub fn record_success(&mut self, latency_ms: u64) {
        self.status = HealthStatus::Online;
        self.consecutive_failures = 0;
        self.last_check = Some(Instant::now());

        // Exponential moving average for latency
        self.avg_latency_ms = Some(match self.avg_latency_ms {
            Some(prev) => (prev * 7 + latency_ms * 3) / 10, // α = 0.3
            None => latency_ms,
        });

        // Decay error rate on success
        self.error_rate *= 0.9;
    }

    /// Record a failed health check.
    pub fn record_failure(&mut self) {
        self.consecutive_failures += 1;
        self.last_check = Some(Instant::now());

        // Increase error rate
        self.error_rate = (self.error_rate * 0.9) + 0.1;

        if self.consecutive_failures >= OFFLINE_THRESHOLD {
            self.status = HealthStatus::Offline;
        } else {
            self.status = HealthStatus::Suspect;
        }
    }
}

/// Shared health state across the application.
pub type SharedHealthState = Arc<RwLock<HashMap<EngineSlot, EngineHealth>>>;

/// Create a new shared health state.
pub fn new_health_state() -> SharedHealthState {
    Arc::new(RwLock::new(HashMap::new()))
}

/// Start the background health monitor for a single engine.
///
/// Spawns a tokio task that periodically checks the engine's health.
/// Updates the shared state which is read by the dispatch layer.
pub fn spawn_health_monitor(
    client: reqwest::Client,
    config: EngineConfig,
    state: SharedHealthState,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let interval = match config.hosting_mode {
            HostingMode::SelfHosted => SELF_HOSTED_INTERVAL,
            HostingMode::Commercial | HostingMode::FreeTier => API_INTERVAL,
        };

        // Initialize health entry
        {
            let mut s = state.write().await;
            s.insert(config.slot, EngineHealth::new(config.slot));
        }

        loop {
            let start = Instant::now();
            let result = check_engine_health(&client, &config).await;
            let latency_ms = start.elapsed().as_millis() as u64;

            {
                let mut s = state.write().await;
                let health = s.entry(config.slot).or_insert_with(|| EngineHealth::new(config.slot));

                match result {
                    Ok(()) => {
                        health.record_success(latency_ms);
                        if start.elapsed() > SUSPECT_THRESHOLD {
                            health.status = HealthStatus::Suspect;
                            tracing::warn!(slot = ?config.slot, latency_ms, "Slow health check — suspect");
                        }
                    }
                    Err(e) => {
                        health.record_failure();
                        tracing::warn!(
                            slot = ?config.slot,
                            failures = health.consecutive_failures,
                            status = ?health.status,
                            error = %e,
                            "Health check failed"
                        );
                    }
                }
            }

            tokio::time::sleep(interval).await;
        }
    })
}

/// Perform a single health check on an engine.
async fn check_engine_health(
    client: &reqwest::Client,
    config: &EngineConfig,
) -> Result<(), String> {
    match config.hosting_mode {
        HostingMode::SelfHosted => {
            // Ping the /health endpoint
            let url = format!("{}/health", config.endpoint_url.trim_end_matches('/'));
            let resp = client
                .get(&url)
                .timeout(Duration::from_secs(5))
                .send()
                .await
                .map_err(|e| format!("health ping failed: {}", e))?;
            if resp.status().is_success() {
                Ok(())
            } else {
                Err(format!("health returned {}", resp.status()))
            }
        }
        HostingMode::Commercial | HostingMode::FreeTier => {
            // Lightweight test completion
            let url = format!(
                "{}/v1/chat/completions",
                config.endpoint_url.trim_end_matches('/')
            );
            let body = serde_json::json!({
                "model": &config.model_name,
                "messages": [{"role": "user", "content": "ping"}],
                "max_tokens": 1,
            });

            let mut req = client.post(&url).timeout(Duration::from_secs(15));

            if let Some(ref creds) = config.credentials {
                req = match config.auth_type {
                    crate::AuthType::Bearer => req.header("Authorization", format!("Bearer {}", creds)),
                    crate::AuthType::ApiKey => req.header("x-api-key", creds),
                    crate::AuthType::None => req,
                };
            }

            let resp = req
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("test completion failed: {}", e))?;

            if resp.status().is_success() {
                Ok(())
            } else {
                let status = resp.status();
                let body_text = resp.text().await.unwrap_or_default();
                Err(format!("test completion returned {}: {}", status, body_text))
            }
        }
    }
}

/// Get the current health status of an engine from shared state.
pub async fn get_health(state: &SharedHealthState, slot: EngineSlot) -> Option<EngineHealth> {
    state.read().await.get(&slot).cloned()
}

/// Get all engine health statuses.
pub async fn get_all_health(state: &SharedHealthState) -> Vec<EngineHealth> {
    state.read().await.values().cloned().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_health_success_tracking() {
        let mut h = EngineHealth::new(EngineSlot::A);
        assert_eq!(h.status, HealthStatus::Offline);

        h.record_success(100);
        assert_eq!(h.status, HealthStatus::Online);
        assert_eq!(h.avg_latency_ms, Some(100));
        assert_eq!(h.consecutive_failures, 0);

        h.record_success(200);
        // EMA: (100*7 + 200*3) / 10 = 130
        assert_eq!(h.avg_latency_ms, Some(130));
    }

    #[test]
    fn test_health_failure_escalation() {
        let mut h = EngineHealth::new(EngineSlot::B);
        h.record_success(50);
        assert_eq!(h.status, HealthStatus::Online);

        h.record_failure();
        assert_eq!(h.status, HealthStatus::Suspect);
        assert_eq!(h.consecutive_failures, 1);

        h.record_failure();
        assert_eq!(h.status, HealthStatus::Suspect);
        assert_eq!(h.consecutive_failures, 2);

        h.record_failure();
        assert_eq!(h.status, HealthStatus::Offline);
        assert_eq!(h.consecutive_failures, 3);
    }

    #[test]
    fn test_health_recovery() {
        let mut h = EngineHealth::new(EngineSlot::C);
        h.record_failure();
        h.record_failure();
        h.record_failure();
        assert_eq!(h.status, HealthStatus::Offline);

        h.record_success(100);
        assert_eq!(h.status, HealthStatus::Online);
        assert_eq!(h.consecutive_failures, 0);
    }
}
