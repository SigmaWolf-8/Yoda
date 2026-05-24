//! Agent roster management and upstream sync.
//!
//! Endpoints:
//!   GET  /api/agents              — list all loaded agents
//!   GET  /api/agents/:id          — get single agent detail
//!   GET  /api/agents/sync-status  — compare local vs upstream HEAD
//!   POST /api/agents/sync         — pull from upstream + recompile
//!   POST /api/agents/review       — approve/reject new agents

use axum::{extract::{Multipart, State}, Json};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::auth::AuthenticatedUser;
use crate::error::AppError;
use crate::state::AppState;

/// Require the authenticated user to be an owner/admin of their current org.
/// Roster-mutating endpoints (upload, sync, review) affect global agent state
/// shared by all tenants, so they must not be open to ordinary members.
async fn require_org_admin(
    state: &AppState,
    user: &AuthenticatedUser,
) -> Result<(), AppError> {
    let role: Option<String> = sqlx::query_scalar(
        "SELECT role FROM org_members WHERE user_id = $1 AND org_id = $2",
    )
    .bind(user.user_id)
    .bind(user.org_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| AppError::Internal(format!("role lookup failed: {}", e)))?;

    match role.as_deref() {
        Some("owner") | Some("admin") => Ok(()),
        _ => Err(AppError::Forbidden(
            "Only org owners/admins may modify the agent roster".into(),
        )),
    }
}

// ─── Agent Roster ────────────────────────────────────────────────────

/// Summary of a single agent in the compiled roster.
#[derive(Debug, Clone, Serialize)]
pub struct AgentSummary {
    pub agent_id: String,
    pub display_name: String,
    pub division: String,
    pub description: String,
    pub competencies: Vec<String>,
    pub review_criteria: Vec<String>,
    pub compatible_reviewers: Vec<String>,
    pub source: String,
    pub license: String,
}

/// Full roster response.
#[derive(Debug, Serialize)]
pub struct AgentRosterResponse {
    pub agents: Vec<AgentSummary>,
    pub total: usize,
    pub by_division: HashMap<String, usize>,
    pub upstream_count: usize,
    pub capomastro_count: usize,
}

/// GET /api/agents — list all loaded agents
pub async fn list_agents(
    State(state): State<AppState>,
    _user: axum::Extension<AuthenticatedUser>,
) -> Result<Json<AgentRosterResponse>, AppError> {
    let mut agents: Vec<AgentSummary> = Vec::new();
    let mut by_division: HashMap<String, usize> = HashMap::new();
    let mut upstream_count = 0;
    let mut capomastro_count = 0;

    for agent_id in state.agents.list_ids() {
        if let Some(config) = state.agents.get(&agent_id) {
            *by_division.entry(config.division.clone()).or_insert(0) += 1;

            if config.license == "MIT" {
                upstream_count += 1;
            } else {
                capomastro_count += 1;
            }

            agents.push(AgentSummary {
                agent_id: config.agent_id.clone(),
                display_name: config.display_name.clone(),
                division: config.division.clone(),
                description: config.description.clone(),
                competencies: config.competencies.clone(),
                review_criteria: config.review_criteria.clone(),
                compatible_reviewers: config.compatible_reviewers.clone(),
                source: config.source.clone(),
                license: config.license.clone(),
            });
        }
    }

    agents.sort_by(|a, b| a.division.cmp(&b.division).then(a.display_name.cmp(&b.display_name)));
    let total = agents.len();

    Ok(Json(AgentRosterResponse {
        agents,
        total,
        by_division,
        upstream_count,
        capomastro_count,
    }))
}

/// GET /api/agents/:id — get single agent detail
pub async fn get_agent(
    State(state): State<AppState>,
    _user: axum::Extension<AuthenticatedUser>,
    axum::extract::Path(agent_id): axum::extract::Path<String>,
) -> Result<Json<AgentSummary>, AppError> {
    let config = state
        .agents
        .get(&agent_id)
        .ok_or(AppError::NotFound(format!("Agent not found: {}", agent_id)))?;

    Ok(Json(AgentSummary {
        agent_id: config.agent_id.clone(),
        display_name: config.display_name.clone(),
        division: config.division.clone(),
        description: config.description.clone(),
        competencies: config.competencies.clone(),
        review_criteria: config.review_criteria.clone(),
        compatible_reviewers: config.compatible_reviewers.clone(),
        source: config.source.clone(),
        license: config.license.clone(),
    }))
}

// ─── Upstream Sync Status ────────────────────────────────────────────

/// Sync status comparing local agents to upstream repo.
#[derive(Debug, Serialize)]
pub struct SyncStatusResponse {
    /// Whether the upstream remote is configured.
    pub upstream_configured: bool,
    /// Local HEAD commit hash for agents/upstream/.
    pub local_head: Option<String>,
    /// Upstream HEAD commit hash (fetched from remote).
    pub upstream_head: Option<String>,
    /// Whether there are new/changed agents available.
    pub updates_available: bool,
    /// New agent files not yet in the local roster.
    pub new_agents: Vec<NewAgentInfo>,
    /// Modified agent files (upstream changed since last sync).
    pub modified_agents: Vec<String>,
    /// Total count of pending changes.
    pub pending_count: usize,
    /// Last sync timestamp (from git log).
    pub last_synced: Option<String>,
}

/// Info about a new upstream agent not yet in the local roster.
#[derive(Debug, Clone, Serialize)]
pub struct NewAgentInfo {
    pub filename: String,
    pub division: String,
    pub title: Option<String>,
}

/// GET /api/agents/sync-status
///
/// Compares the local agents/upstream/ directory against the remote
/// msitarzewski/agency-agents repo. Returns a list of new and modified
/// agents available for import.
pub async fn sync_status(
    State(_state): State<AppState>,
    _user: axum::Extension<AuthenticatedUser>,
) -> Result<Json<SyncStatusResponse>, AppError> {
    let upstream_dir = Path::new("agents/upstream");

    // Check if upstream git remote is configured
    let upstream_configured = check_upstream_remote();

    if !upstream_configured || !upstream_dir.exists() {
        return Ok(Json(SyncStatusResponse {
            upstream_configured,
            local_head: None,
            upstream_head: None,
            updates_available: false,
            new_agents: Vec::new(),
            modified_agents: Vec::new(),
            pending_count: 0,
            last_synced: None,
        }));
    }

    // Get local HEAD for agents content
    let local_head = get_local_agents_head();
    let last_synced = get_last_sync_date();

    // Fetch upstream (non-blocking check)
    let (upstream_head, new_agents, modified_agents) = match fetch_upstream_changes() {
        Ok(result) => result,
        Err(e) => {
            tracing::warn!(error = %e, "Failed to fetch upstream changes");
            (None, Vec::new(), Vec::new())
        }
    };

    let updates_available = !new_agents.is_empty() || !modified_agents.is_empty();
    let pending_count = new_agents.len() + modified_agents.len();

    Ok(Json(SyncStatusResponse {
        upstream_configured,
        local_head,
        upstream_head,
        updates_available,
        new_agents,
        modified_agents,
        pending_count,
        last_synced,
    }))
}

// ─── Sync Trigger ────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct SyncResponse {
    pub success: bool,
    pub new_agents_pulled: usize,
    pub modified_agents_pulled: usize,
    pub agents_compiled: usize,
    pub message: String,
}

/// POST /api/agents/sync
///
/// Pulls latest from upstream, recompiles all agents, and reloads
/// the agent registry. Only pulls — does NOT auto-approve new agents.
/// New agents appear in sync-status as pending until reviewed.
pub async fn trigger_sync(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthenticatedUser>,
) -> Result<Json<SyncResponse>, AppError> {
    require_org_admin(&state, &user).await?;
    // Step 1: Git fetch upstream
    let fetch_result = Command::new("git")
        .args(["fetch", "upstream"])
        .output()
        .map_err(|e| AppError::Internal(format!("git fetch failed: {}", e)))?;

    if !fetch_result.status.success() {
        let stderr = String::from_utf8_lossy(&fetch_result.stderr);
        // If upstream remote doesn't exist, try to add it
        if stderr.contains("does not appear to be a git repository")
            || stderr.contains("No such remote")
        {
            tracing::info!("Adding upstream remote...");
            let add_result = Command::new("git")
                .args([
                    "remote",
                    "add",
                    "upstream",
                    "https://github.com/msitarzewski/agency-agents.git",
                ])
                .output()
                .map_err(|e| AppError::Internal(format!("git remote add failed: {}", e)))?;

            if !add_result.status.success() {
                return Err(AppError::Internal(
                    "Failed to add upstream remote".into(),
                ));
            }

            // Retry fetch
            let retry = Command::new("git")
                .args(["fetch", "upstream"])
                .output()
                .map_err(|e| AppError::Internal(format!("git fetch retry failed: {}", e)))?;

            if !retry.status.success() {
                return Err(AppError::Internal(format!(
                    "Upstream fetch failed: {}",
                    String::from_utf8_lossy(&retry.stderr)
                )));
            }
        } else {
            return Err(AppError::Internal(format!(
                "Upstream fetch failed: {}",
                stderr
            )));
        }
    }

    // Step 2: Check for new/modified files
    let diff_output = Command::new("git")
        .args(["diff", "--name-status", "HEAD..upstream/main", "--", "agents/upstream/"])
        .output()
        .map_err(|e| AppError::Internal(format!("git diff failed: {}", e)))?;

    let diff_text = String::from_utf8_lossy(&diff_output.stdout);
    let mut new_count = 0;
    let mut modified_count = 0;

    for line in diff_text.lines() {
        if line.starts_with('A') {
            new_count += 1;
        } else if line.starts_with('M') {
            modified_count += 1;
        }
    }

    // Step 3: Merge upstream changes into agents/upstream/
    let merge_result = Command::new("git")
        .args([
            "checkout",
            "upstream/main",
            "--",
            "agents/upstream/",
        ])
        .output()
        .map_err(|e| AppError::Internal(format!("git checkout upstream failed: {}", e)))?;

    if !merge_result.status.success() {
        return Err(AppError::Internal(format!(
            "Failed to pull upstream agents: {}",
            String::from_utf8_lossy(&merge_result.stderr)
        )));
    }

    // Step 4: Recompile all agents
    let compile_result = Command::new("bash")
        .args(["scripts/compile-agents.sh"])
        .output()
        .map_err(|e| AppError::Internal(format!("Agent compilation failed: {}", e)))?;

    let compile_output = String::from_utf8_lossy(&compile_result.stdout);
    let agents_compiled = compile_output
        .lines()
        .find(|l| l.contains("Compiled"))
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|n| n.parse::<usize>().ok())
        .unwrap_or(0);

    // Refresh in-memory registry so freshly compiled agents are visible immediately.
    state.agents.reload_from_disk().map_err(|e| {
        AppError::Internal(format!(
            "Agents compiled but in-memory registry reload failed: {}",
            e
        ))
    })?;

    // Log the sync event
    crate::security::log_audit_event(
        &state.db,
        None,
        None,
        "agents_synced",
        &serde_json::json!({
            "new_agents": new_count,
            "modified_agents": modified_count,
            "total_compiled": agents_compiled,
        }),
    )
    .await
    .ok(); // Non-fatal if audit log fails

    tracing::info!(
        new = new_count,
        modified = modified_count,
        compiled = agents_compiled,
        "Agent sync complete"
    );

    Ok(Json(SyncResponse {
        success: true,
        new_agents_pulled: new_count,
        modified_agents_pulled: modified_count,
        agents_compiled,
        message: format!(
            "Synced {} new, {} modified agents. {} total compiled.",
            new_count, modified_count, agents_compiled
        ),
    }))
}

// ─── Agent Review / Approve ──────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ReviewRequest {
    /// Agent IDs to approve (add to active roster).
    pub approve: Vec<String>,
    /// Agent IDs to skip (exclude from roster, keep in upstream/).
    pub skip: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct ReviewResponse {
    pub approved: Vec<String>,
    pub skipped: Vec<String>,
    pub roster_size: usize,
}

/// POST /api/agents/review
///
/// Approve or skip new agents after a sync. Approved agents are
/// included in the compiled roster. Skipped agents remain in
/// agents/upstream/ but are excluded from compilation via a
/// .agent-skip file.
pub async fn review_agents(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthenticatedUser>,
    Json(req): Json<ReviewRequest>,
) -> Result<Json<ReviewResponse>, AppError> {
    require_org_admin(&state, &user).await?;
    let skip_file = Path::new("agents/.agent-skip");

    // Load existing skip list
    let mut skip_set: std::collections::HashSet<String> = if skip_file.exists() {
        std::fs::read_to_string(skip_file)
            .unwrap_or_default()
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
            .collect()
    } else {
        std::collections::HashSet::new()
    };

    // Remove approved agents from skip list (if they were previously skipped)
    for agent_id in &req.approve {
        skip_set.remove(agent_id);
    }

    // Add newly skipped agents
    for agent_id in &req.skip {
        skip_set.insert(agent_id.clone());
    }

    // Write updated skip file
    let skip_content = format!(
        "# Agents skipped during review — excluded from compilation\n\
         # Remove a line to re-include an agent on next compile\n\
         {}\n",
        skip_set
            .iter()
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
    std::fs::write(skip_file, skip_content)
        .map_err(|e| AppError::Internal(format!("Failed to write skip file: {}", e)))?;

    // Recompile (skip list is now updated)
    let compile_result = Command::new("bash")
        .args(["scripts/compile-agents.sh"])
        .output()
        .map_err(|e| AppError::Internal(format!("Recompilation failed: {}", e)))?;

    let roster_size = if compile_result.status.success() {
        // Refresh in-memory registry on successful compile.
        state.agents.reload_from_disk().map_err(|e| {
            AppError::Internal(format!(
                "Agents compiled but in-memory registry reload failed: {}",
                e
            ))
        })?;
        // Count compiled agents
        std::fs::read_dir("agents/compiled")
            .map(|dir| dir.filter(|e| e.as_ref().map_or(false, |e| {
                e.path().extension().map_or(false, |ext| ext == "json")
            })).count())
            .unwrap_or(0)
    } else {
        state.agents.count()
    };

    tracing::info!(
        approved = req.approve.len(),
        skipped = req.skip.len(),
        roster_size,
        "Agent review complete"
    );

    Ok(Json(ReviewResponse {
        approved: req.approve,
        skipped: req.skip,
        roster_size,
    }))
}

// ─── Drag-and-drop Upload ────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct UploadedAgent {
    pub filename: String,
    pub saved_path: String,
    pub agent_id: String,
    pub division: String,
}

#[derive(Debug, Serialize)]
pub struct UploadResponse {
    pub success: bool,
    pub uploaded: Vec<UploadedAgent>,
    pub skipped: Vec<UploadSkip>,
    pub agents_compiled: usize,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct UploadSkip {
    pub filename: String,
    pub reason: String,
}

/// POST /api/agents/upload
///
/// Multipart upload: accepts one or more `.md` files with YAML frontmatter,
/// derives division+slug from the body's `**YODA Role ID:** \`<div>/<slug>\``
/// line (falling back to the filename), saves each file under
/// `agents/capomastro/<division>/<slug>.md`, then recompiles the roster
/// and reloads the in-memory registry.
pub async fn upload_agents(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthenticatedUser>,
    mut multipart: Multipart,
) -> Result<Json<UploadResponse>, AppError> {
    require_org_admin(&state, &user).await?;
    let base_dir = Path::new("agents/capomastro");
    std::fs::create_dir_all(base_dir)
        .map_err(|e| AppError::Internal(format!("Cannot create {}: {}", base_dir.display(), e)))?;

    let mut uploaded: Vec<UploadedAgent> = Vec::new();
    let mut skipped: Vec<UploadSkip> = Vec::new();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::Validation(format!("Multipart read failed: {}", e)))?
    {
        let original = field
            .file_name()
            .map(|s| s.to_string())
            .unwrap_or_else(|| "upload.md".to_string());

        if !original.to_lowercase().ends_with(".md") {
            skipped.push(UploadSkip {
                filename: original,
                reason: "Not a .md file".into(),
            });
            continue;
        }

        let bytes = field
            .bytes()
            .await
            .map_err(|e| AppError::Validation(format!("Read body failed: {}", e)))?;

        let content = match std::str::from_utf8(&bytes) {
            Ok(s) => s.to_string(),
            Err(_) => {
                skipped.push(UploadSkip {
                    filename: original,
                    reason: "File is not valid UTF-8".into(),
                });
                continue;
            }
        };

        if !content.trim_start().starts_with("---") {
            skipped.push(UploadSkip {
                filename: original,
                reason: "Missing YAML frontmatter (file must start with `---`)".into(),
            });
            continue;
        }

        let (division, slug) = derive_division_slug(&content, &original);
        let dest_dir = base_dir.join(&division);
        std::fs::create_dir_all(&dest_dir)
            .map_err(|e| AppError::Internal(format!("mkdir {}: {}", dest_dir.display(), e)))?;
        let dest = dest_dir.join(format!("{}.md", slug));

        if let Err(e) = std::fs::write(&dest, &content) {
            skipped.push(UploadSkip {
                filename: original,
                reason: format!("Write failed: {}", e),
            });
            continue;
        }

        let agent_id = format!("{}-{}", division, slug);
        uploaded.push(UploadedAgent {
            filename: original,
            saved_path: dest.to_string_lossy().to_string(),
            agent_id,
            division,
        });
    }

    if uploaded.is_empty() {
        return Ok(Json(UploadResponse {
            success: false,
            uploaded,
            skipped,
            agents_compiled: 0,
            message: "No valid agent files uploaded.".into(),
        }));
    }

    // Recompile so the new agents land in agents/compiled/ as JSON.
    let compile = Command::new("bash")
        .args(["scripts/compile-agents.sh"])
        .output()
        .map_err(|e| AppError::Internal(format!("compile-agents.sh failed: {}", e)))?;

    if !compile.status.success() {
        return Err(AppError::Internal(format!(
            "Agent compilation failed: {}",
            String::from_utf8_lossy(&compile.stderr)
        )));
    }

    // Reload the in-memory registry so the new agents appear immediately.
    state.agents.reload_from_disk().map_err(|e| {
        AppError::Internal(format!(
            "Agents compiled but in-memory registry reload failed: {}",
            e
        ))
    })?;

    let agents_compiled = std::fs::read_dir("agents/compiled")
        .map(|dir| {
            dir.filter(|e| {
                e.as_ref()
                    .map_or(false, |e| e.path().extension().map_or(false, |x| x == "json"))
            })
            .count()
        })
        .unwrap_or_else(|_| state.agents.count());

    crate::security::log_audit_event(
        &state.db,
        None,
        None,
        "agents_uploaded",
        &serde_json::json!({
            "uploaded": uploaded.len(),
            "skipped": skipped.len(),
            "total_compiled": agents_compiled,
        }),
    )
    .await
    .ok();

    let msg = format!(
        "Uploaded {} agent{}, skipped {}, {} total in roster.",
        uploaded.len(),
        if uploaded.len() == 1 { "" } else { "s" },
        skipped.len(),
        agents_compiled
    );

    Ok(Json(UploadResponse {
        success: true,
        uploaded,
        skipped,
        agents_compiled,
        message: msg,
    }))
}

/// Derive `(division, slug)` from a markdown body and original filename.
///
/// Priority:
///   1. `**YODA Role ID:** \`<division>/<slug>\`` line in the body.
///   2. `round:` field in YAML frontmatter (e.g. `qc-r1`).
///   3. Falls back to (`capomastro`, sanitized filename stem).
fn derive_division_slug(content: &str, original_filename: &str) -> (String, String) {
    // 1) **YODA Role ID:** `engineering/security-engineer`
    for line in content.lines() {
        let l = line.trim();
        if let Some(rest) = l.strip_prefix("**YODA Role ID:**") {
            let inner = rest.trim().trim_matches('`').trim();
            if let Some((div, slug)) = inner.split_once('/') {
                let div = sanitize_segment(div);
                let slug = sanitize_segment(slug);
                if !div.is_empty() && !slug.is_empty() {
                    return (div, slug);
                }
            }
        }
    }

    // 2) frontmatter `round: qc-r1` + frontmatter `name: security-engineer`
    let mut round = String::new();
    let mut name = String::new();
    let trimmed = content.trim_start();
    if trimmed.starts_with("---") {
        let rest = &trimmed[3..];
        if let Some(end) = rest.find("\n---") {
            for line in rest[..end].lines() {
                if let Some(v) = line.strip_prefix("round:") {
                    round = sanitize_segment(v.trim().trim_matches('"'));
                } else if let Some(v) = line.strip_prefix("name:") {
                    name = sanitize_segment(v.trim().trim_matches('"'));
                }
            }
        }
    }

    let slug_fallback = sanitize_segment(
        PathBuf::from(original_filename)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "agent".into())
            .as_str(),
    );

    let slug = if !name.is_empty() { name } else { slug_fallback };
    let div = if !round.is_empty() { round } else { "capomastro".to_string() };
    (div, slug)
}

/// Lowercase, dash-separated, filesystem-safe path segment.
fn sanitize_segment(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c.to_ascii_lowercase()
            } else if c == ' ' || c == '.' || c == '/' {
                '-'
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

// ─── Git Helpers ─────────────────────────────────────────────────────

/// Check if the upstream remote is configured.
fn check_upstream_remote() -> bool {
    Command::new("git")
        .args(["remote", "get-url", "upstream"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Get the local HEAD hash relevant to agents content.
fn get_local_agents_head() -> Option<String> {
    Command::new("git")
        .args(["log", "-1", "--format=%H", "--", "agents/upstream/"])
        .output()
        .ok()
        .and_then(|o| {
            let hash = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if hash.is_empty() { None } else { Some(hash) }
        })
}

/// Get the date of the last sync (last commit touching agents/upstream/).
fn get_last_sync_date() -> Option<String> {
    Command::new("git")
        .args(["log", "-1", "--format=%ai", "--", "agents/upstream/"])
        .output()
        .ok()
        .and_then(|o| {
            let date = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if date.is_empty() { None } else { Some(date) }
        })
}

/// Fetch upstream and return (upstream_head, new_agents, modified_agents).
fn fetch_upstream_changes() -> Result<(Option<String>, Vec<NewAgentInfo>, Vec<String>), String> {
    // Fetch without merging
    let fetch = Command::new("git")
        .args(["fetch", "upstream"])
        .output()
        .map_err(|e| format!("fetch failed: {}", e))?;

    if !fetch.status.success() {
        return Err(String::from_utf8_lossy(&fetch.stderr).to_string());
    }

    // Get upstream HEAD
    let head_output = Command::new("git")
        .args(["rev-parse", "upstream/main"])
        .output()
        .map_err(|e| format!("rev-parse failed: {}", e))?;

    let upstream_head = if head_output.status.success() {
        Some(String::from_utf8_lossy(&head_output.stdout).trim().to_string())
    } else {
        None
    };

    // Diff to find new and modified files
    let diff = Command::new("git")
        .args(["diff", "--name-status", "HEAD..upstream/main", "--", "agents/upstream/"])
        .output()
        .map_err(|e| format!("diff failed: {}", e))?;

    let diff_text = String::from_utf8_lossy(&diff.stdout);
    let mut new_agents = Vec::new();
    let mut modified_agents = Vec::new();

    for line in diff_text.lines() {
        let parts: Vec<&str> = line.splitn(2, '\t').collect();
        if parts.len() != 2 {
            continue;
        }
        let (status, filepath) = (parts[0].trim(), parts[1].trim());

        if !filepath.ends_with(".md") {
            continue;
        }

        match status {
            "A" => {
                // New agent — extract division from path
                let division = filepath
                    .strip_prefix("agents/upstream/")
                    .and_then(|p| p.split('/').next())
                    .unwrap_or("unknown")
                    .to_string();

                let title = read_agent_title_from_upstream(filepath);

                new_agents.push(NewAgentInfo {
                    filename: filepath.to_string(),
                    division,
                    title,
                });
            }
            "M" => {
                modified_agents.push(filepath.to_string());
            }
            _ => {}
        }
    }

    Ok((upstream_head, new_agents, modified_agents))
}

/// Try to read the H1 title from an upstream agent file (fetched but not merged).
fn read_agent_title_from_upstream(filepath: &str) -> Option<String> {
    let output = Command::new("git")
        .args(["show", &format!("upstream/main:{}", filepath)])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let content = String::from_utf8_lossy(&output.stdout);
    content
        .lines()
        .find(|l| l.starts_with("# "))
        .map(|l| l.trim_start_matches("# ").trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_agent_info() {
        let info = NewAgentInfo {
            filename: "agents/upstream/engineering/new-agent.md".into(),
            division: "engineering".into(),
            title: Some("New Agent".into()),
        };
        assert_eq!(info.division, "engineering");
        assert_eq!(info.title, Some("New Agent".into()));
    }
}
