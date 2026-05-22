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
        r#"# YODA one-click local installer (Windows PowerShell)
# Installs everything (Rust, Node, Postgres) via winget, builds, and starts.
# Usage:
#   irm {base}/api/install/install.ps1 | iex

$ErrorActionPreference = 'Stop'
$InstallRoot = 'C:\Capomastro\Yoda'
$SourceUrl   = '{base}/api/install/source.tar.gz'
$Tarball     = Join-Path $env:TEMP 'yoda-workspace-snapshot.tar.gz'
$PgPassword  = 'yoda'
$DbUser      = 'yoda'
$DbName      = 'yoda'

Write-Host ''
Write-Host '== YODA One-Click Installer ==' -ForegroundColor Cyan
Write-Host "Target: $InstallRoot"
Write-Host ''

# ── Self-elevate to admin (winget package installs require it) ──
$me = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {{
    Write-Host 'Re-launching as Administrator...' -ForegroundColor Yellow
    $cmd = "irm $SourceUrl.Replace('source.tar.gz','install.ps1') | iex"
    Start-Process powershell -Verb RunAs -ArgumentList '-NoExit','-Command',"irm {base}/api/install/install.ps1 | iex"
    exit 0
}}

function Test-Cmd($name) {{ [bool](Get-Command $name -ErrorAction SilentlyContinue) }}

# Reload PATH from registry so freshly-installed tools resolve in this session.
function Refresh-Path {{
    $machine = [Environment]::GetEnvironmentVariable('Path','Machine')
    $user    = [Environment]::GetEnvironmentVariable('Path','User')
    $env:Path = "$machine;$user"
}}

function Ensure-Winget {{
    if (Test-Cmd winget) {{ return }}
    Write-Error 'winget not found. Install "App Installer" from Microsoft Store, then re-run.'
    exit 1
}}

function Winget-Install($id, $checkCmd) {{
    if (Test-Cmd $checkCmd) {{ Write-Host "  $checkCmd already installed."; return }}
    Write-Host "  Installing $id ..." -ForegroundColor Yellow
    winget install --id $id --silent --accept-source-agreements --accept-package-agreements --disable-interactivity 2>&1 | Out-Null
    Refresh-Path
    if (-not (Test-Cmd $checkCmd)) {{
        Write-Warning "  $id installed but $checkCmd still not on PATH — open a new shell and re-run."
        exit 1
    }}
}}

# ── [1/8] Prerequisites via winget ──────────────────────────────
Write-Host '[1/8] Installing prerequisites (Rust, Node, Postgres) via winget...' -ForegroundColor Green
Ensure-Winget
Winget-Install 'Rustlang.Rustup'       'rustc'
Winget-Install 'OpenJS.NodeJS.LTS'     'node'
# Postgres silent install — sets the postgres-superuser password to $PgPassword
if (-not (Test-Cmd psql)) {{
    Write-Host '  Installing PostgreSQL.PostgreSQL.16 ...' -ForegroundColor Yellow
    winget install --id PostgreSQL.PostgreSQL.16 --silent --accept-source-agreements --accept-package-agreements --disable-interactivity --override "--mode unattended --superpassword $PgPassword --servicename postgresql --serviceaccount postgres --servicepassword $PgPassword" 2>&1 | Out-Null
    Refresh-Path
    # Postgres binaries land in C:\Program Files\PostgreSQL\<v>\bin — add to PATH for this session
    $pgBin = Get-ChildItem 'C:\Program Files\PostgreSQL' -ErrorAction SilentlyContinue |
             Sort-Object Name -Descending | Select-Object -First 1
    if ($pgBin) {{ $env:Path = "$($pgBin.FullName)\bin;$env:Path" }}
}}
foreach ($cmd in 'rustc','cargo','node','npm','psql') {{
    if (-not (Test-Cmd $cmd)) {{ Write-Error "Required tool '$cmd' still missing after install."; exit 1 }}
}}

# ── [2/8] Wipe target if non-empty ──────────────────────────────
if (Test-Path $InstallRoot) {{
    $existing = Get-ChildItem -Force $InstallRoot -ErrorAction SilentlyContinue
    if ($existing) {{
        Write-Host "[2/8] Removing existing $InstallRoot ..." -ForegroundColor Green
        Remove-Item -Recurse -Force $InstallRoot
    }}
}}
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null

# ── [3/8] Download + extract ────────────────────────────────────
Write-Host '[3/8] Downloading + extracting source...' -ForegroundColor Green
Invoke-WebRequest -Uri $SourceUrl -OutFile $Tarball -UseBasicParsing
tar -xzf $Tarball -C $InstallRoot
if ($LASTEXITCODE -ne 0) {{ Write-Error "tar extraction failed"; exit 1 }}
Remove-Item $Tarball -Force -ErrorAction SilentlyContinue

# ── [4/8] Configure .env ────────────────────────────────────────
Write-Host '[4/8] Writing .env ...' -ForegroundColor Green
$envFile = Join-Path $InstallRoot '.env'
$envExample = Join-Path $InstallRoot '.env.example'
if (Test-Path $envExample) {{ Copy-Item $envExample $envFile -Force }} else {{ '' | Set-Content $envFile }}
$bytes = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$jwt = [Convert]::ToBase64String($bytes)
$dbUrl = "postgres://${{DbUser}}:${{PgPassword}}@localhost:5432/${{DbName}}"
# Replace existing keys or append.
$content = Get-Content $envFile -Raw
function Set-EnvLine($txt, $key, $val) {{
    if ($txt -match "(?m)^$key=") {{ return ($txt -replace "(?m)^$key=.*", "$key=$val") }}
    return ($txt + "`n$key=$val")
}}
$content = Set-EnvLine $content 'DATABASE_URL' $dbUrl
$content = Set-EnvLine $content 'JWT_SECRET'   $jwt
$content = Set-EnvLine $content 'BIND_PORT'    '3000'
Set-Content -Path $envFile -Value $content -NoNewline

# ── [5/8] Create db user + db ───────────────────────────────────
Write-Host '[5/8] Creating Postgres user/db ...' -ForegroundColor Green
$env:PGPASSWORD = $PgPassword
$null = & psql -U postgres -h localhost -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DbUser'"
if ($LASTEXITCODE -ne 0) {{ Write-Error 'Cannot connect to Postgres as superuser. Check service.'; exit 1 }}
& psql -U postgres -h localhost -d postgres -c "DO `$`$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='$DbUser') THEN CREATE ROLE $DbUser LOGIN PASSWORD '$PgPassword'; END IF; END `$`$;" | Out-Null
& psql -U postgres -h localhost -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DbName'" | Out-Null
if ($LASTEXITCODE -ne 0 -or -not (& psql -U postgres -h localhost -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DbName'")) {{
    & psql -U postgres -h localhost -d postgres -c "CREATE DATABASE $DbName OWNER $DbUser;" | Out-Null
}}

# ── [6/8] Apply migrations ──────────────────────────────────────
Write-Host '[6/8] Applying migrations ...' -ForegroundColor Green
$env:PGPASSWORD = $PgPassword
Get-ChildItem (Join-Path $InstallRoot 'migrations\*.sql') | Sort-Object Name | ForEach-Object {{
    Write-Host "    -> $($_.Name)"
    & psql -U $DbUser -h localhost -d $DbName -f $_.FullName -v ON_ERROR_STOP=0 2>&1 | Out-Null
}}

# ── [7/8] Build backend + frontend ──────────────────────────────
Push-Location $InstallRoot
try {{
    Write-Host '[7/8] Building backend (cargo build --release — 10-20 min first time) ...' -ForegroundColor Green
    & cargo build --release --bin yoda-api
    if ($LASTEXITCODE -ne 0) {{ Write-Error 'cargo build failed'; exit 1 }}
    Write-Host '       Building frontend (npm install + build) ...' -ForegroundColor Green
    Push-Location 'frontend'
    & npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {{ Write-Error 'npm install failed'; exit 1 }}
    & npm run build
    if ($LASTEXITCODE -ne 0) {{ Write-Error 'npm run build failed'; exit 1 }}
    Pop-Location
}} finally {{ Pop-Location }}

# ── [8/8] Start the server ──────────────────────────────────────
Write-Host '[8/8] Starting YODA on http://localhost:3000 ...' -ForegroundColor Green
$exe = Join-Path $InstallRoot 'target\release\yoda-api.exe'
Start-Process -FilePath $exe -WorkingDirectory $InstallRoot
Start-Sleep -Seconds 3
Start-Process 'http://localhost:3000'

Write-Host ''
Write-Host '== Done. YODA is running at http://localhost:3000 ==' -ForegroundColor Cyan
Write-Host "Source:   $InstallRoot"
Write-Host "Env:      $envFile"
Write-Host "Database: $dbUrl"
Write-Host ''
"#,
        base = base_url
    )
}
