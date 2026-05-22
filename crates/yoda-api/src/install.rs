//! Local install endpoints.
//!
//! Serves a source tarball and a Windows PowerShell installer that fetches the
//! tarball, extracts it to C:\Capomastro\Yoda, and prints next steps.
//!
//! Both endpoints are public (no auth) so a fresh machine with nothing but a
//! browser or PowerShell can pull the installer.

use axum::{
    body::Body,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use axum_extra::extract::Host;
use std::path::PathBuf;
use tokio::fs::File;
use tokio_util::io::ReaderStream;

/// Resolve the path to the prebuilt source tarball.
fn tarball_path() -> PathBuf {
    std::env::var("YODA_INSTALL_TARBALL")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("./downloads/yoda-workspace-snapshot.tar.gz"))
}

/// GET /api/install/source.tar.gz — streams the workspace snapshot.
pub async fn download_source() -> Response {
    let path = tarball_path();
    let file = match File::open(&path).await {
        Ok(f) => f,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                "Source tarball not available",
            )
                .into_response();
        }
    };

    let size = file.metadata().await.ok().map(|m| m.len());
    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/gzip"),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("attachment; filename=\"yoda-workspace-snapshot.tar.gz\""),
    );
    if let Some(len) = size {
        if let Ok(v) = HeaderValue::from_str(&len.to_string()) {
            headers.insert(header::CONTENT_LENGTH, v);
        }
    }
    (StatusCode::OK, headers, body).into_response()
}

/// GET /api/install/install.ps1 — returns a Windows PowerShell installer script.
///
/// The script downloads the tarball from this same server, extracts it to
/// C:\Capomastro\Yoda, copies .env.example -> .env, and prints the manual
/// build steps (cargo build --release, npm install, db migrations).
pub async fn windows_installer(Host(host): Host) -> Response {
    // Validate Host strictly before embedding in a script that will be piped
    // to `iex`. Only allow hostname chars + optional :port. Reject anything
    // else (a malicious Host header could otherwise break out of the PS1
    // single-quoted string and inject PowerShell code → client-side RCE).
    let host_ok = !host.is_empty()
        && host.len() <= 253
        && host
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b':'));
    if !host_ok {
        return (StatusCode::BAD_REQUEST, "invalid Host header").into_response();
    }

    // Allow override via env (e.g., behind reverse proxy or for CI).
    let base = std::env::var("YODA_INSTALL_BASE_URL")
        .unwrap_or_else(|_| format!("https://{}", host));
    let body = render_ps1(&base);

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("attachment; filename=\"install-yoda.ps1\""),
    );
    (StatusCode::OK, headers, body).into_response()
}

fn render_ps1(base_url: &str) -> String {
    format!(
        r#"# YODA local installer (Windows PowerShell)
# Installs the YODA workspace to C:\Capomastro\Yoda
# Usage:
#   irm {base}/api/install/install.ps1 | iex
# or save and run:
#   .\install-yoda.ps1

$ErrorActionPreference = 'Stop'
$InstallRoot = 'C:\Capomastro\Yoda'
$SourceUrl   = '{base}/api/install/source.tar.gz'
$Tarball     = Join-Path $env:TEMP 'yoda-workspace-snapshot.tar.gz'

Write-Host ''
Write-Host '== YODA Local Installer ==' -ForegroundColor Cyan
Write-Host "Target: $InstallRoot"
Write-Host "Source: $SourceUrl"
Write-Host ''

# 1. Ensure target dir exists and is empty-ish
if (Test-Path $InstallRoot) {{
    $existing = Get-ChildItem -Force $InstallRoot -ErrorAction SilentlyContinue
    if ($existing) {{
        Write-Host "Directory $InstallRoot already exists and is not empty." -ForegroundColor Yellow
        $resp = Read-Host 'Wipe and reinstall? (y/N)'
        if ($resp -ne 'y' -and $resp -ne 'Y') {{
            Write-Host 'Aborted.' -ForegroundColor Red
            exit 1
        }}
        Remove-Item -Recurse -Force $InstallRoot
    }}
}}
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null

# 2. Download the tarball
Write-Host '[1/4] Downloading source tarball...' -ForegroundColor Green
Invoke-WebRequest -Uri $SourceUrl -OutFile $Tarball -UseBasicParsing

# 3. Extract — tar.exe ships with Windows 10 1803+
Write-Host '[2/4] Extracting to' $InstallRoot '...' -ForegroundColor Green
if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {{
    Write-Error 'tar.exe not found. Requires Windows 10 1803+ or install bsdtar.'
    exit 1
}}
tar -xzf $Tarball -C $InstallRoot
if ($LASTEXITCODE -ne 0) {{
    Write-Error "tar extraction failed (exit $LASTEXITCODE)"
    exit 1
}}
Remove-Item $Tarball -Force -ErrorAction SilentlyContinue

# 4. Prep .env
Write-Host '[3/4] Preparing .env ...' -ForegroundColor Green
$envExample = Join-Path $InstallRoot '.env.example'
$envFile    = Join-Path $InstallRoot '.env'
if ((Test-Path $envExample) -and -not (Test-Path $envFile)) {{
    Copy-Item $envExample $envFile
    Write-Host '  .env created from .env.example — edit DATABASE_URL before first run.'
}}

# 5. Prerequisite check (warn only)
Write-Host '[4/4] Checking prerequisites...' -ForegroundColor Green
function Test-Cmd($name) {{ [bool](Get-Command $name -ErrorAction SilentlyContinue) }}
$missing = @()
foreach ($cmd in 'cargo','rustc','node','npm','psql') {{
    if (-not (Test-Cmd $cmd)) {{ $missing += $cmd }}
}}
if ($missing.Count -gt 0) {{
    Write-Host ''
    Write-Host 'Missing prerequisites:' -ForegroundColor Yellow
    foreach ($m in $missing) {{ Write-Host "  - $m" }}
    Write-Host 'Install:'
    Write-Host '  Rust:     https://rustup.rs'
    Write-Host '  Node.js:  https://nodejs.org  (LTS)'
    Write-Host '  Postgres: https://www.postgresql.org/download/windows/'
}}

Write-Host ''
Write-Host '== Source installed. Manual build steps: ==' -ForegroundColor Cyan
Write-Host "  cd $InstallRoot"
Write-Host '  notepad .env             # set DATABASE_URL, JWT_SECRET'
Write-Host '  cargo build --release    # backend (10-20 min first time)'
Write-Host '  cd frontend; npm install; npm run build; cd ..'
Write-Host '  # Apply migrations (requires running Postgres):'
Write-Host '  Get-ChildItem migrations\*.sql | ForEach-Object {{ psql $env:DATABASE_URL -f $_.FullName }}'
Write-Host '  # Start:'
Write-Host '  .\target\release\yoda-api.exe'
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green
"#,
        base = base_url
    )
}
