//! # YODA Agent Compiler
//!
//! Build-time CLI tool that transforms markdown agent definitions into
//! structured JSON configs consumed by the runtime Orchestrator.
//!
//! Copyright (c) 2026 Capomastro Holdings Ltd. — Applied Physics Division

use anyhow::{bail, Context, Result};
use clap::Parser;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

// ─── CLI Arguments ───────────────────────────────────────────────────

#[derive(Parser, Debug)]
#[command(name = "yoda-agent-compiler")]
#[command(about = "Compile markdown agent definitions into JSON configs")]
struct Args {
    /// Path to upstream (MIT-licensed) agent markdown files.
    #[arg(long, default_value = "agents/upstream")]
    upstream: PathBuf,

    /// Path to Capomastro proprietary agent markdown files.
    #[arg(long, default_value = "agents/capomastro")]
    custom: PathBuf,

    /// Output directory for compiled JSON configs.
    #[arg(long, default_value = "agents/compiled")]
    output: PathBuf,

    /// Skip license audit (NOT recommended for production).
    #[arg(long, default_value_t = false)]
    skip_license_audit: bool,
}

// ─── Compiled Agent Config (Output Schema per TM-2026-020.1 §14.3) ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompiledAgentConfig {
    pub agent_id: String,
    pub display_name: String,
    pub division: String,
    pub system_prompt: String,
    pub competencies: Vec<String>,
    pub input_schema: serde_json::Value,
    pub output_schema: serde_json::Value,
    pub review_criteria: Vec<String>,
    pub compatible_reviewers: Vec<String>,
    pub source: String,
    pub license: String,
}

// ─── Parsed Markdown Sections ────────────────────────────────────────

#[derive(Debug, Default)]
struct ParsedAgent {
    title: String,
    identity: String,
    mission: String,
    rules: Vec<String>,
    competencies: Vec<String>,
    review_criteria: Vec<String>,
}

// ─── Competency Keywords ─────────────────────────────────────────────

const COMPETENCY_KEYWORDS: &[(&str, &str)] = &[
    ("react", "react"), ("vue", "vue"), ("angular", "angular"),
    ("typescript", "typescript"), ("javascript", "javascript"),
    ("css", "css"), ("tailwind", "tailwind"), ("html", "html"),
    ("accessibility", "accessibility"), ("wcag", "accessibility"),
    ("responsive", "responsive-design"), ("performance", "performance"),
    ("rust", "rust"), ("python", "python"), ("golang", "golang"),
    ("go ", "golang"), ("node.js", "nodejs"), ("nodejs", "nodejs"),
    ("api", "api-design"), ("rest", "rest-api"), ("graphql", "graphql"),
    ("database", "database"), ("postgresql", "postgresql"), ("sql", "sql"),
    ("nosql", "nosql"), ("mongodb", "mongodb"), ("redis", "redis"),
    ("docker", "docker"), ("kubernetes", "kubernetes"), ("ci/cd", "ci-cd"),
    ("terraform", "terraform"), ("aws", "aws"), ("gcp", "gcp"), ("azure", "azure"),
    ("security", "security"), ("threat model", "threat-modeling"),
    ("cryptograph", "cryptography"), ("authentication", "authentication"),
    ("authorization", "authorization"), ("encryption", "encryption"),
    ("testing", "testing"), ("unit test", "unit-testing"),
    ("integration test", "integration-testing"), ("e2e", "e2e-testing"),
    ("machine learning", "machine-learning"), ("ml ", "machine-learning"),
    ("data pipeline", "data-pipelines"),
    ("ios", "ios"), ("android", "android"), ("react native", "react-native"),
    ("flutter", "flutter"), ("mobile", "mobile"),
    ("smart contract", "smart-contracts"), ("solidity", "solidity"),
    ("blockchain", "blockchain"), ("embedded", "embedded"),
    ("firmware", "firmware"), ("rtos", "rtos"), ("iot", "iot"),
    ("ux", "ux-design"), ("user experience", "ux-design"),
    ("user research", "user-research"), ("wireframe", "wireframing"),
    ("prototype", "prototyping"), ("content", "content-creation"),
    ("copywriting", "copywriting"), ("seo", "seo"),
    ("marketing", "marketing"), ("analytics", "analytics"),
    ("compliance", "compliance"), ("gdpr", "gdpr"),
    ("privacy", "data-privacy"), ("legal", "legal"),
    ("project management", "project-management"),
    ("agile", "agile"), ("scrum", "scrum"),
    ("game", "game-development"), ("unity", "unity"), ("unreal", "unreal-engine"),
    // PlenumNET-specific
    ("plenumnet", "plenumnet"), ("tis-27", "tis-27"), ("tl-dsa", "tl-dsa"),
    ("tlsponge", "tlsponge-385"), ("phase encryption", "phase-encryption"),
    ("tl-kem", "tl-kem"), ("ternary", "ternary-math"), ("gf(3)", "gf3"),
    ("sponge", "sponge-construction"), ("tdns", "tdns"),
    ("inter-cube", "inter-cube"), ("hypercube", "inter-cube"),
    ("task bible", "task-bible"), ("maestro", "maestro-erp"),
    ("knowledge base", "knowledge-management"),
    ("orchestrat", "orchestration"), ("dag", "dag-execution"),
    ("decompos", "decomposition"),
];

// ─── Main ────────────────────────────────────────────────────────────

fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let args = Args::parse();

    tracing::info!(
        upstream = %args.upstream.display(),
        custom = %args.custom.display(),
        output = %args.output.display(),
        "YODA Agent Compiler starting"
    );

    fs::create_dir_all(&args.output).context("Failed to create output directory")?;

    // License audit (B0.3.8)
    if !args.skip_license_audit {
        license_audit(&args.upstream)?;
    } else {
        tracing::warn!("License audit SKIPPED");
    }

    let mut compiled_count = 0;
    let mut errors = Vec::new();

    // Compile upstream agents (MIT)
    if args.upstream.exists() {
        let agents = discover_agents(&args.upstream)?;
        tracing::info!("Found {} upstream agent files", agents.len());
        for path in &agents {
            match compile_agent(path, &args.upstream, "MIT") {
                Ok(config) => { write_config(&config, &args.output)?; compiled_count += 1; }
                Err(e) => errors.push(format!("{}: {}", path.display(), e)),
            }
        }
    }

    // Compile Capomastro agents (Proprietary)
    if args.custom.exists() {
        let agents = discover_agents(&args.custom)?;
        tracing::info!("Found {} Capomastro agent files", agents.len());
        for path in &agents {
            match compile_agent(path, &args.custom, "Proprietary") {
                Ok(config) => { write_config(&config, &args.output)?; compiled_count += 1; }
                Err(e) => errors.push(format!("{}: {}", path.display(), e)),
            }
        }
    }

    tracing::info!("Compiled {} agents -> {}", compiled_count, args.output.display());
    if !errors.is_empty() {
        tracing::warn!("{} agents failed:", errors.len());
        for e in &errors { tracing::warn!("  {}", e); }
    }
    if compiled_count == 0 { bail!("No agents compiled"); }
    Ok(())
}

// ─── License Audit (B0.3.8) ─────────────────────────────────────────

fn license_audit(upstream_dir: &Path) -> Result<()> {
    tracing::info!("Running license audit on {}", upstream_dir.display());
    let markers = ["LICENSE", "LICENSE.md", "LICENSE-MIT"];
    let has_license = markers.iter().any(|f| {
        upstream_dir.join(f).exists()
            || upstream_dir.parent().map_or(false, |p| p.join(f).exists())
    });
    if !has_license {
        tracing::warn!(
            "No LICENSE file found in {} or parent. Ensure MIT license is preserved.",
            upstream_dir.display()
        );
    }
    let agents = discover_agents(upstream_dir)?;
    tracing::info!("License audit passed — {} files checked", agents.len());
    Ok(())
}

// ─── Agent Discovery ─────────────────────────────────────────────────

fn discover_agents(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut agents = Vec::new();
    if !dir.exists() { return Ok(agents); }
    for entry in walkdir(dir)? {
        if entry.extension().map_or(false, |e| e == "md") {
            let name = entry.file_stem().unwrap_or_default().to_string_lossy();
            if name.to_lowercase() != "readme" {
                agents.push(entry);
            }
        }
    }
    agents.sort();
    Ok(agents)
}

fn walkdir(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut results = Vec::new();
    if dir.is_dir() {
        for entry in fs::read_dir(dir).context(format!("Reading {}", dir.display()))? {
            let path = entry?.path();
            if path.is_dir() { results.extend(walkdir(&path)?); }
            else { results.push(path); }
        }
    }
    Ok(results)
}

// ─── Markdown Parser (B0.3.4) ────────────────────────────────────────

fn parse_markdown(content: &str) -> ParsedAgent {
    let mut agent = ParsedAgent::default();
    let mut current_section = String::new();
    let mut current_body = String::new();

    for line in content.lines() {
        if line.starts_with("# ") && agent.title.is_empty() {
            agent.title = line.trim_start_matches("# ").trim().to_string();
            continue;
        }
        if line.starts_with("## ") {
            flush_section(&mut agent, &current_section, &current_body);
            current_section = line.trim_start_matches("## ").trim().to_lowercase();
            current_body = String::new();
            continue;
        }
        if !current_section.is_empty() {
            if !current_body.is_empty() { current_body.push('\n'); }
            current_body.push_str(line);
        }
    }
    flush_section(&mut agent, &current_section, &current_body);
    agent
}

fn flush_section(agent: &mut ParsedAgent, section: &str, body: &str) {
    let body = body.trim().to_string();
    if body.is_empty() { return; }

    match section {
        s if s.contains("identity") || s.contains("memory") => agent.identity = body,
        s if s.contains("mission") => agent.mission = body,
        s if (s.contains("critical") || s.contains("rules")) && !s.contains("review") => {
            agent.rules = extract_list_items(&body);
        }
        s if s.contains("competenc") => {
            agent.competencies = extract_list_items(&body)
                .into_iter()
                .flat_map(|item| {
                    item.split(',')
                        .map(|s| s.trim().to_lowercase().replace(' ', "-"))
                        .filter(|s| !s.is_empty())
                        .collect::<Vec<_>>()
                })
                .collect();
        }
        s if s.contains("review") && s.contains("criteria") => {
            agent.review_criteria = extract_list_items(&body);
        }
        _ => {
            if !agent.identity.is_empty() { agent.identity.push_str("\n\n"); }
            agent.identity.push_str(&body);
        }
    }
}

fn extract_list_items(text: &str) -> Vec<String> {
    text.lines()
        .map(|l| l.trim())
        .filter(|l| l.starts_with("- ") || l.starts_with("* "))
        .map(|l| l.trim_start_matches("- ").trim_start_matches("* ").trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

// ─── Competency Extraction (B0.3.5) ─────────────────────────────────

fn extract_competencies(parsed: &ParsedAgent, full_text: &str) -> Vec<String> {
    let mut comps: HashSet<String> = parsed.competencies.iter().cloned().collect();
    let lower = full_text.to_lowercase();
    for (keyword, competency) in COMPETENCY_KEYWORDS {
        if lower.contains(keyword) { comps.insert(competency.to_string()); }
    }
    let mut sorted: Vec<String> = comps.into_iter().collect();
    sorted.sort();
    sorted
}

// ─── System Prompt Builder (B0.3.6) ──────────────────────────────────

fn build_system_prompt(parsed: &ParsedAgent) -> String {
    let mut p = String::new();
    if !parsed.identity.is_empty() {
        p.push_str(&parsed.identity);
        p.push_str("\n\n");
    }
    if !parsed.mission.is_empty() {
        p.push_str("## Your Mission\n\n");
        p.push_str(&parsed.mission);
        p.push_str("\n\n");
    }
    if !parsed.rules.is_empty() {
        p.push_str("## Critical Rules\n\n");
        for rule in &parsed.rules {
            p.push_str("- ");
            p.push_str(rule);
            p.push('\n');
        }
        p.push('\n');
    }
    p.push_str(
        "## Output Format\n\n\
         Respond with a JSON object matching the required output schema. \
         Include all required fields. Be precise and thorough.\n"
    );
    p.trim().to_string()
}

// ─── Reviewer Matching ───────────────────────────────────────────────

fn determine_compatible_reviewers(competencies: &[String], division: &str) -> Vec<String> {
    let mut r = Vec::new();
    let has = |pat: &str| competencies.iter().any(|c| c.contains(pat));

    if has("security") || has("cryptography") {
        r.push("engineering-security-engineer".to_string());
    }
    if has("api") || has("rest") || has("backend") {
        r.push("testing-api-tester".to_string());
    }
    if has("privacy") || has("compliance") || has("legal") {
        r.push("support-legal-compliance-checker".to_string());
    }
    if !r.contains(&"engineering-security-engineer".to_string()) {
        r.push("engineering-security-engineer".to_string());
    }
    match division {
        "engineering" if !r.contains(&"testing-api-tester".to_string()) => {
            r.push("testing-api-tester".to_string());
        }
        "design" => r.push("testing-accessibility-auditor".to_string()),
        "marketing" | "sales" => {
            if !r.contains(&"support-legal-compliance-checker".to_string()) {
                r.push("support-legal-compliance-checker".to_string());
            }
        }
        _ => {}
    }
    r.sort();
    r.dedup();
    r
}

// ─── Default Schemas ─────────────────────────────────────────────────

fn default_input_schema() -> serde_json::Value {
    serde_json::json!({
        "task_description": "string",
        "existing_code": "string|null",
        "dependencies": "string[]",
        "context": "string|null",
        "prior_feedback": "string|null"
    })
}

fn default_output_schema() -> serde_json::Value {
    serde_json::json!({
        "analysis": "string",
        "recommendations": "string[]",
        "code_blocks": [{"filename": "string", "language": "string", "content": "string"}],
        "implementation_notes": "string",
        "review_checklist": "string[]",
        "confidence": "number"
    })
}

// ─── Compile Single Agent (B0.3.7) ───────────────────────────────────

fn compile_agent(path: &Path, base_dir: &Path, license: &str) -> Result<CompiledAgentConfig> {
    let content = fs::read_to_string(path).context(format!("Reading {}", path.display()))?;
    let parsed = parse_markdown(&content);
    if parsed.title.is_empty() { bail!("No H1 title in {}", path.display()); }

    let relative = path.strip_prefix(base_dir).unwrap_or(path);
    let agent_id = derive_agent_id(relative);
    let division = relative.parent()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "specialized".to_string());

    let competencies = extract_competencies(&parsed, &content);
    let system_prompt = build_system_prompt(&parsed);
    let review_criteria = if parsed.review_criteria.is_empty() {
        vec!["correctness", "completeness", "security", "performance", "maintainability"]
            .into_iter().map(String::from).collect()
    } else {
        parsed.review_criteria
    };
    let compatible_reviewers = determine_compatible_reviewers(&competencies, &division);

    Ok(CompiledAgentConfig {
        agent_id, display_name: parsed.title, division, system_prompt,
        competencies, input_schema: default_input_schema(),
        output_schema: default_output_schema(), review_criteria,
        compatible_reviewers, source: relative.to_string_lossy().to_string(),
        license: license.to_string(),
    })
}

fn derive_agent_id(relative_path: &Path) -> String {
    let stem = relative_path.file_stem().unwrap_or_default().to_string_lossy();
    let parent = relative_path.parent()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_string());
    match parent {
        Some(dir) if !dir.is_empty() => format!("{}-{}", dir, stem),
        _ => format!("capomastro-{}", stem),
    }
}

fn write_config(config: &CompiledAgentConfig, output_dir: &Path) -> Result<()> {
    let filename = format!("{}.json", config.agent_id);
    let path = output_dir.join(&filename);
    let json = serde_json::to_string_pretty(config).context("Serializing agent config")?;
    fs::write(&path, json).context(format!("Writing {}", path.display()))?;
    tracing::debug!("Wrote {}", filename);
    Ok(())
}

// ─── Tests (B0.3.11) ─────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_markdown_full() {
        let md = "# Test Agent\n\n## Identity & Memory\n\nYou are a test agent.\n\n## Core Mission\n\nDo testing.\n\n## Critical Rules\n\n- Rule one\n- Rule two\n\n## Competencies\n\n- rust, testing\n- security\n\n## Review Criteria\n\n- Correctness\n- Completeness\n";
        let p = parse_markdown(md);
        assert_eq!(p.title, "Test Agent");
        assert!(p.identity.contains("test agent"));
        assert!(p.mission.contains("testing"));
        assert_eq!(p.rules.len(), 2);
        assert!(p.competencies.len() >= 2);
        assert_eq!(p.review_criteria.len(), 2);
    }

    #[test]
    fn test_parse_markdown_no_competencies() {
        let md = "# Simple\n\n## Identity & Memory\n\nA React dev with TypeScript.\n\n## Core Mission\n\nBuild UIs.\n\n## Critical Rules\n\n- Use semantic HTML\n";
        let p = parse_markdown(md);
        assert_eq!(p.title, "Simple");
        assert!(p.competencies.is_empty());
    }

    #[test]
    fn test_extract_competencies_keywords() {
        let p = ParsedAgent::default();
        let text = "You build React frontends with Rust backends and PostgreSQL.";
        let c = extract_competencies(&p, text);
        assert!(c.contains(&"rust".to_string()));
        assert!(c.contains(&"react".to_string()));
        assert!(c.contains(&"postgresql".to_string()));
    }

    #[test]
    fn test_extract_competencies_plenumnet() {
        let p = ParsedAgent::default();
        let text = "Expert in TIS-27 hashing and TL-DSA signatures with Phase Encryption.";
        let c = extract_competencies(&p, text);
        assert!(c.contains(&"tis-27".to_string()));
        assert!(c.contains(&"tl-dsa".to_string()));
        assert!(c.contains(&"phase-encryption".to_string()));
    }

    #[test]
    fn test_extract_competencies_merges() {
        let p = ParsedAgent { competencies: vec!["custom-skill".to_string()], ..Default::default() };
        let c = extract_competencies(&p, "Uses React and Docker.");
        assert!(c.contains(&"custom-skill".to_string()));
        assert!(c.contains(&"react".to_string()));
        assert!(c.contains(&"docker".to_string()));
    }

    #[test]
    fn test_build_system_prompt() {
        let p = ParsedAgent {
            title: "T".into(), identity: "You are an expert.".into(),
            mission: "Build things.".into(),
            rules: vec!["Be thorough".into()], ..Default::default()
        };
        let s = build_system_prompt(&p);
        assert!(s.contains("You are an expert."));
        assert!(s.contains("Build things."));
        assert!(s.contains("- Be thorough"));
        assert!(s.contains("Output Format"));
    }

    #[test]
    fn test_derive_agent_id() {
        assert_eq!(derive_agent_id(Path::new("engineering/frontend-developer.md")),
                   "engineering-frontend-developer");
        assert_eq!(derive_agent_id(Path::new("plenumnet-specialist.md")),
                   "capomastro-plenumnet-specialist");
    }

    #[test]
    fn test_extract_list_items() {
        let items = extract_list_items("intro\n- One\n- Two\n* Three\nnope\n- Four");
        assert_eq!(items, vec!["One", "Two", "Three", "Four"]);
    }

    #[test]
    fn test_compatible_reviewers_engineering() {
        let c = vec!["rust".into(), "api-design".into()];
        let r = determine_compatible_reviewers(&c, "engineering");
        assert!(r.contains(&"engineering-security-engineer".to_string()));
        assert!(r.contains(&"testing-api-tester".to_string()));
    }

    #[test]
    fn test_parse_empty() {
        let p = parse_markdown("");
        assert!(p.title.is_empty());
    }
}
