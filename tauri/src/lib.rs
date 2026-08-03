//! # YODA Desktop Shell
//!
//! A Tauri v2 window that hosts the React UI and runs the Axum API
//! (`yoda-api`) as a bundled sidecar process.
//!
//! Lifecycle:
//!   * `setup`  — resolve environment, spawn the `yoda-api` sidecar, pipe its
//!                stdout/stderr into this process' console.
//!   * `Exit`   — kill the sidecar so no orphaned server survives the window.
//!
//! Configuration comes from `.env.local` (preferred) or `.env`, searched from
//! the working directory, the executable's ancestors (covers `cargo tauri dev`)
//! and the platform config directory (covers an installed app). Anything not
//! found there falls back to the local Docker Compose defaults.
//!
//! Copyright (c) 2026 Capomastro Holdings Ltd. — Applied Physics Division

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{App, AppHandle, Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Name of the sidecar as declared in `tauri.conf.json` → `bundle.externalBin`.
const SIDECAR: &str = "yoda-api";

/// Env files searched, in priority order. The first value found wins, so a
/// developer's `.env.local` overrides the shared `.env`.
const ENV_FILES: [&str; 2] = [".env.local", ".env"];

/// Defaults matching `docker-compose.yml` / `.env.local.example`.
///
/// `BIND_ADDR` is deliberately loopback: a desktop app has no reason to expose
/// its API to the local network, and the Replit/Docker default (`0.0.0.0`)
/// would do exactly that.
const DEFAULTS: [(&str, &str); 5] = [
    (
        "DATABASE_URL",
        "postgres://yoda:yoda_secret@localhost:5432/yoda",
    ),
    ("BIND_ADDR", "127.0.0.1"),
    ("BIND_PORT", "3000"),
    ("RUST_LOG", "info"),
    ("YODA_RUNTIME", "desktop"),
];

/// Live handle to the sidecar. `None` once it has been reaped or killed.
#[derive(Default)]
struct Sidecar(Mutex<Option<CommandChild>>);

impl Sidecar {
    fn store(&self, child: CommandChild) {
        if let Ok(mut slot) = self.0.lock() {
            *slot = Some(child);
        }
    }

    /// Terminate the backend. Safe to call more than once — shutdown can arrive
    /// via `ExitRequested` and again via `Exit`.
    fn kill(&self) {
        // A panic elsewhere can poison the mutex; shutdown still has to run, so
        // take the guard either way rather than unwrapping.
        let mut slot = match self.0.lock() {
            Ok(slot) => slot,
            Err(poisoned) => poisoned.into_inner(),
        };
        if let Some(child) = slot.take() {
            match child.kill() {
                Ok(()) => eprintln!("[yoda-desktop] sidecar stopped"),
                Err(e) => eprintln!("[yoda-desktop] failed to stop sidecar: {e}"),
            }
        }
    }
}

// ─── Env resolution ──────────────────────────────────────────────────

/// Parse a `KEY=value` file. Blank lines and `#` comments are skipped, an
/// optional leading `export ` is stripped, and one layer of matching quotes is
/// removed. Deliberately minimal — no interpolation, no multi-line values.
fn parse_env_file(path: &Path) -> HashMap<String, String> {
    let mut vars = HashMap::new();
    let Ok(contents) = std::fs::read_to_string(path) else {
        return vars;
    };

    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        if key.is_empty() {
            continue;
        }
        let value = value.trim();
        let value = value
            .strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
            .unwrap_or(value);
        vars.insert(key.to_string(), value.to_string());
    }
    vars
}

/// Directories that may hold an env file, nearest-first.
///
/// In `cargo tauri dev` the executable sits at `tauri/target/debug/`, so
/// walking the executable's ancestors finds the repo root. In an installed
/// build the ancestors are the install prefix and the config dir is where an
/// operator is told to drop their `.env.local`.
fn env_search_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();

    if let Ok(cwd) = std::env::current_dir() {
        dirs.push(cwd);
    }
    if let Ok(exe) = std::env::current_exe() {
        dirs.extend(exe.ancestors().skip(1).take(5).map(PathBuf::from));
    }
    if let Ok(config) = app.path().app_config_dir() {
        dirs.push(config);
    }
    if let Ok(resources) = app.path().resource_dir() {
        dirs.push(resources);
    }

    dirs.dedup();
    dirs
}

/// Build the sidecar's environment: env files first, then the process
/// environment (an explicitly exported `DATABASE_URL` must win over a stale
/// file), then defaults for anything still missing.
fn backend_env(app: &AppHandle) -> HashMap<String, String> {
    let mut env: HashMap<String, String> = HashMap::new();

    for dir in env_search_dirs(app) {
        for name in ENV_FILES {
            let candidate = dir.join(name);
            if !candidate.is_file() {
                continue;
            }
            println!("[yoda-desktop] reading {}", candidate.display());
            for (key, value) in parse_env_file(&candidate) {
                env.entry(key).or_insert(value);
            }
        }
    }

    for key in DEFAULTS.iter().map(|(k, _)| *k).chain([
        "DATABASE_URL",
        "JWT_SECRET",
        "JWT_REFRESH_SECRET",
        "CORS_ORIGIN",
        "AGENTS_COMPILED_PATH",
        "MODEL_LINEAGES_PATH",
        "FRONTEND_DIST_PATH",
    ]) {
        if let Ok(value) = std::env::var(key) {
            env.insert(key.to_string(), value);
        }
    }

    for (key, value) in DEFAULTS {
        env.entry(key.to_string()).or_insert_with(|| value.to_string());
    }

    // Bundled resources win over relative paths: an installed app's working
    // directory is wherever the launcher happened to be, so `./agents/compiled`
    // would resolve to nothing. Only override when the resource actually
    // shipped — in `cargo tauri dev` the repo-relative defaults are correct.
    if let Ok(resources) = app.path().resource_dir() {
        let agents = resources.join("agents").join("compiled");
        if agents.is_dir() {
            env.insert(
                "AGENTS_COMPILED_PATH".into(),
                agents.to_string_lossy().into_owned(),
            );
        }
        let lineages = resources.join("model_lineages.json");
        if lineages.is_file() {
            env.insert(
                "MODEL_LINEAGES_PATH".into(),
                lineages.to_string_lossy().into_owned(),
            );
        }
    }

    // Tauri serves the UI itself from the bundle, so the backend's static-file
    // fallback has nothing to serve. Point it somewhere inert rather than
    // letting it log about a missing `./frontend/dist`.
    if let Ok(config) = app.path().app_config_dir() {
        env.entry("FRONTEND_DIST_PATH".into())
            .or_insert_with(|| config.to_string_lossy().into_owned());
    }

    env
}

// ─── Sidecar lifecycle ───────────────────────────────────────────────

fn spawn_backend(app: &AppHandle) -> Result<CommandChild, String> {
    let env = backend_env(app);
    let addr = format!(
        "{}:{}",
        env.get("BIND_ADDR").map(String::as_str).unwrap_or("?"),
        env.get("BIND_PORT").map(String::as_str).unwrap_or("?")
    );

    let (mut rx, child) = app
        .shell()
        .sidecar(SIDECAR)
        .map_err(|e| format!("sidecar '{SIDECAR}' not found in the bundle: {e}"))?
        .envs(env)
        .spawn()
        .map_err(|e| format!("failed to start '{SIDECAR}': {e}"))?;

    println!("[yoda-desktop] sidecar '{SIDECAR}' starting on {addr}");

    // The backend logs JSON to stdout/stderr. Forward both so `cargo tauri dev`
    // and a debug-build console show backend failures instead of a blank window.
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    print!("[yoda-api] {}", String::from_utf8_lossy(&bytes))
                }
                CommandEvent::Stderr(bytes) => {
                    eprint!("[yoda-api] {}", String::from_utf8_lossy(&bytes))
                }
                CommandEvent::Error(err) => eprintln!("[yoda-api] error: {err}"),
                CommandEvent::Terminated(payload) => {
                    eprintln!(
                        "[yoda-api] exited (code {:?}, signal {:?}) — the UI will fail to reach \
                         the API until the app is restarted. Common causes: port already in use, \
                         or PostgreSQL not running (`docker compose --profile db up -d`).",
                        payload.code, payload.signal
                    );
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(child)
}

fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    match spawn_backend(&handle) {
        Ok(child) => app.state::<Sidecar>().store(child),
        // A failed spawn must not abort startup: the window still renders and
        // shows the UI's own "backend unreachable" state, which is far easier
        // to diagnose than an app that refuses to open.
        Err(e) => eprintln!("[yoda-desktop] {e}"),
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Sidecar::default())
        .setup(|app| setup(app))
        .build(tauri::generate_context!())
        .expect("failed to build the YODA desktop application")
        .run(|app, event| match event {
            RunEvent::ExitRequested { .. } | RunEvent::Exit => {
                app.state::<Sidecar>().kill();
            }
            _ => {}
        });
}
