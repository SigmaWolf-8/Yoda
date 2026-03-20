import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Copy,
  Download,
  Check,
  Loader2,
  AlertTriangle,
  Terminal,
  ExternalLink,
  Wifi,
  WifiOff,
  AlertCircle,
} from 'lucide-react';
import { OLLAMA_TAG, OLLAMA_TAG_DISPLAY, MANUAL_INSTALL_URL } from './EngineSlot';

// ── Types ──────────────────────────────────────────────────────────────────────

type OS = 'bash' | 'powershell';

type PollingState =
  | { phase: 'idle' }
  | { phase: 'waiting' }
  | { phase: 'connected'; address: string }
  | { phase: 'timeout' }
  | { phase: 'error'; message: string };

interface Props {
  modelName: string;
  onClose: () => void;
  mode?: 'install' | 'connect';
}

// ── Script generators ─────────────────────────────────────────────────────────
// NOTE: Inside these template literals, bash/PowerShell variable references
// that use ${VAR} syntax MUST be escaped as \${VAR} so TypeScript does not
// treat them as template expressions. PowerShell backtick continuations are
// written as \` (escaped backtick) so they don't close the TS template.

function makeBashScript(modelName: string, ollamaTag: string, sessionToken: string, crsUrl: string): string {
  return `#!/usr/bin/env bash
# YODA — PlenumNET + Ollama self-host installer
# Model: ${modelName}  |  Token: ${sessionToken}
set -euo pipefail

SESSION_TOKEN="${sessionToken}"
CRS_URL="${crsUrl}"
OLLAMA_MODEL="${ollamaTag}"
PLENUMNET_DIR="\$HOME/PlenumNET"

echo "=== YODA Self-Host Installer ==="
echo "Model : \$OLLAMA_MODEL"
echo ""

# ── 1. Detect local IP ────────────────────────────────────────────────
if [[ "\$(uname -s)" == "Darwin" ]]; then
  LOCAL_IP=\$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "0.0.0.0")
else
  LOCAL_IP=\$(hostname -I 2>/dev/null | awk '{print \$1}' || echo "0.0.0.0")
fi
CUBE_ENDPOINT="\${LOCAL_IP}:51820"
echo "Local endpoint : \$CUBE_ENDPOINT"

# ── 2. Install PlenumNET (inter-cube only) ────────────────────────────
echo ""
echo "Installing PlenumNET (inter-cube)..."
if [ -d "\$PLENUMNET_DIR" ]; then
  echo "  → Directory exists, pulling latest..."
  git -C "\$PLENUMNET_DIR" pull --ff-only || true
else
  git clone https://github.com/SigmaWolf-8/Ternary "\$PLENUMNET_DIR"
fi

echo "  → Building inter-cube daemon (this may take a few minutes)..."
cd "\$PLENUMNET_DIR"
cargo build --release --package inter-cube

# ── 3. Register with YODA CRS (embeds session token) ─────────────────
echo ""
echo "Registering with YODA CRS..."
if [[ "\$(uname -s)" == "Darwin" ]]; then
  PUB_KEY=\$(echo -n "\${LOCAL_IP}:51820" | shasum -a 256 | cut -d' ' -f1)
else
  PUB_KEY=\$(echo -n "\${LOCAL_IP}:51820" | sha256sum | cut -d' ' -f1)
fi

REG_RESPONSE=\$(curl -sf -X POST "\${CRS_URL}/api/salvi/inter-cube/crs/register" \\
  -H "Content-Type: application/json" \\
  -d '{"endpoint":"'\$CUBE_ENDPOINT'","publicKey":"'\$PUB_KEY'","sessionToken":"'\$SESSION_TOKEN'"}' \\
  2>&1) || {
  echo "  ✗ Registration failed. Check your internet connection."
  echo "    (CRS URL: \$CRS_URL)"
  exit 1
}

echo "  ✓ Registered with YODA CRS"

# ── 4. Verify CRS health ──────────────────────────────────────────────
echo ""
echo "Verifying CRS connectivity..."
REGISTERED=false
for i in \$(seq 1 12); do
  sleep 5
  if curl -sf "\${CRS_URL}/health" > /dev/null 2>&1; then
    echo "  ✓ Tunnel is live — registered with YODA CRS"
    REGISTERED=true
    break
  fi
  echo "  ... checking (\$((i * 5))s)"
done

if [ "\$REGISTERED" = false ]; then
  echo "  ✗ CRS not reachable within 60s. Check your internet connection."
  exit 1
fi

# ── 5. Start inter-cube daemon in background ──────────────────────────
echo ""
echo "Starting PlenumNET tunnel daemon..."
CUBE_MODE=cube \\
CUBE_CRS_URL="\$CRS_URL" \\
CUBE_ENDPOINT="\$CUBE_ENDPOINT" \\
CUBE_SESSION_TOKEN="\$SESSION_TOKEN" \\
CUBE_ROLE=inference \\
"\$PLENUMNET_DIR/target/release/inter-cube-daemon" &
DAEMON_PID=\$!
echo "  ✓ Daemon started (PID \$DAEMON_PID)"
sleep 2

# ── 6. Install Ollama ─────────────────────────────────────────────────
echo ""
echo "Installing Ollama..."
if command -v ollama &>/dev/null; then
  echo "  → Ollama already installed, skipping"
else
  curl -fsSL https://ollama.com/install.sh | sh
fi

# ── 7. Pull model ─────────────────────────────────────────────────────
echo ""
echo "Pulling model: \$OLLAMA_MODEL"
echo "  (This downloads several GB — it may take a while)"
ollama pull "\$OLLAMA_MODEL"

# ── 8. Start Ollama server ────────────────────────────────────────────
echo ""
echo "Starting Ollama server on localhost:11434..."
ollama serve &>/dev/null &
sleep 1
echo "  ✓ Ollama is running"

# ── 9. Done ───────────────────────────────────────────────────────────
echo ""
echo "=============================="
echo "  Setup complete!"
echo "  Model  : \$OLLAMA_MODEL"
echo "  Tunnel : \$CUBE_ENDPOINT → YODA CRS"
echo "=============================="
echo ""
echo "NOTE: The tunnel will stop when this terminal closes."
echo "To reconnect after reboot, re-run:"
echo ""
echo "  CUBE_MODE=cube \\\\"
echo "  CUBE_CRS_URL=${crsUrl} \\\\"
echo "  CUBE_ENDPOINT=\$CUBE_ENDPOINT \\\\"
echo "  CUBE_ROLE=inference \\\\"
echo "  \$PLENUMNET_DIR/target/release/inter-cube-daemon &"
echo ""
echo "Persistent service install (launchd/systemd) is planned for a future version."
`;
}

function makePsScript(modelName: string, ollamaTag: string, sessionToken: string, crsUrl: string): string {
  return `# YODA — PlenumNET + Ollama self-host installer (Windows)
# Model: ${modelName}  |  Token: ${sessionToken}
$ErrorActionPreference = "Stop"

$SESSION_TOKEN = "${sessionToken}"
$CRS_URL = "${crsUrl}"
$OLLAMA_MODEL = "${ollamaTag}"
$PLENUMNET_DIR = "$env:USERPROFILE\\PlenumNET"

Write-Host "=== YODA Self-Host Installer ===" -ForegroundColor Cyan
Write-Host "Model : $OLLAMA_MODEL"
Write-Host ""

# ── 1. Detect local IP ────────────────────────────────────────────────
$ip = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notmatch '^127\.' -and $_.IPAddress -notmatch '^169\.254' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Sort-Object @{ Expression = { switch -Wildcard ($_.InterfaceAlias) { 'Wi-Fi*' { 0 } 'Ethernet*' { 1 } default { 2 } } } } |
  Select-Object -First 1).IPAddress
if (-not $ip) { $ip = "0.0.0.0" }
$CUBE_ENDPOINT = "$ip:51820"
Write-Host "Local endpoint : $CUBE_ENDPOINT"

# ── 2. Check / install Rust ───────────────────────────────────────────
Write-Host ""
Write-Host "Checking Rust..."
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  Write-Host "  -> Rust not found - installing rustup..."
  $rustupExe = "$env:TEMP\\rustup-init.exe"
  Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile $rustupExe
  Start-Process -FilePath $rustupExe -ArgumentList "-y" -Wait -NoNewWindow
  $env:PATH += ";$env:USERPROFILE\\.cargo\\bin"
  Write-Host "  OK Rust installed"
} else {
  Write-Host "  OK Rust already installed"
}

# ── 3. Check Git ──────────────────────────────────────────────────────
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "Git not found. Please install Git for Windows:" -ForegroundColor Yellow
  Write-Host "  https://git-scm.com/download/win" -ForegroundColor Cyan
  Write-Host "Then re-run this script."
  exit 1
}

# ── 4. Install PlenumNET (inter-cube only) ────────────────────────────
Write-Host ""
Write-Host "Installing PlenumNET (inter-cube)..."
if (Test-Path $PLENUMNET_DIR) {
  Write-Host "  -> Directory exists, pulling latest..."
  git -C $PLENUMNET_DIR pull --ff-only 2>$null
} else {
  git clone https://github.com/SigmaWolf-8/Ternary $PLENUMNET_DIR
}

Write-Host "  -> Building inter-cube daemon (this may take a few minutes)..."
Push-Location $PLENUMNET_DIR
cargo build --release --package inter-cube
Pop-Location

# ── 5. Register with YODA CRS ─────────────────────────────────────────
Write-Host ""
Write-Host "Registering with YODA CRS..."
$pubKey = ([System.Security.Cryptography.SHA256]::Create().ComputeHash(
  [System.Text.Encoding]::UTF8.GetBytes($CUBE_ENDPOINT)) |
  ForEach-Object { $_.ToString("x2") }) -join ""

$regBody = ConvertTo-Json @{
  endpoint     = $CUBE_ENDPOINT
  publicKey    = $pubKey
  sessionToken = $SESSION_TOKEN
}

try {
  $regResp = Invoke-RestMethod \`
    -Uri "$CRS_URL/api/salvi/inter-cube/crs/register" \`
    -Method Post \`
    -ContentType "application/json" \`
    -Body $regBody
  Write-Host "  OK Registered as $($regResp.address)"
} catch {
  Write-Host "  FAIL Registration failed: $_" -ForegroundColor Red
  Write-Host "    (CRS URL: $CRS_URL)"
  exit 1
}

# ── 6. Verify CRS health ──────────────────────────────────────────────
Write-Host ""
Write-Host "Verifying CRS connectivity..."
$registered = $false
for ($i = 1; $i -le 12; $i++) {
  Start-Sleep -Seconds 5
  try {
    Invoke-RestMethod -Uri "$CRS_URL/health" -TimeoutSec 5 | Out-Null
    Write-Host "  OK Tunnel is live - registered with YODA CRS"
    $registered = $true
    break
  } catch {
    Write-Host "  ... checking ($($i * 5)s)"
  }
}

if (-not $registered) {
  Write-Host "  FAIL CRS not reachable within 60s." -ForegroundColor Red
  exit 1
}

# ── 7. Start inter-cube daemon in background ──────────────────────────
Write-Host ""
Write-Host "Starting PlenumNET tunnel daemon..."
$daemonPath = "$PLENUMNET_DIR\\target\\release\\inter-cube-daemon.exe"
$env:CUBE_MODE = "cube"
$env:CUBE_CRS_URL = $CRS_URL
$env:CUBE_ENDPOINT = $CUBE_ENDPOINT
$env:CUBE_SESSION_TOKEN = $SESSION_TOKEN
$env:CUBE_ROLE = "inference"
$daemonProc = Start-Process -FilePath $daemonPath -NoNewWindow -PassThru
Write-Host "  OK Daemon started (PID $($daemonProc.Id))"
Start-Sleep -Seconds 2

# ── 8. Install Ollama ─────────────────────────────────────────────────
Write-Host ""
Write-Host "Installing Ollama..."
if (Get-Command ollama -ErrorAction SilentlyContinue) {
  Write-Host "  -> Ollama already installed, skipping"
} else {
  $installed = $false
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host "  -> Installing via winget..."
    winget install Ollama.Ollama -e --silent
    $installed = $true
  }
  if (-not $installed) {
    Write-Host "  -> Downloading Ollama installer..."
    $ollamaExe = "$env:TEMP\\ollama-windows-amd64.exe"
    Invoke-WebRequest -Uri "https://ollama.com/download/windows" -OutFile $ollamaExe
    Start-Process -FilePath $ollamaExe -ArgumentList "/S" -Wait -NoNewWindow
  }
  $env:PATH += ";$env:LOCALAPPDATA\\Programs\\Ollama"
  Write-Host "  OK Ollama installed"
}

# ── 9. Pull model ─────────────────────────────────────────────────────
Write-Host ""
Write-Host "Pulling model: $OLLAMA_MODEL"
Write-Host "  (This downloads several GB - it may take a while)"
ollama pull $OLLAMA_MODEL

# ── 10. Start Ollama server ───────────────────────────────────────────
Write-Host ""
Write-Host "Starting Ollama server on localhost:11434..."
Start-Process -FilePath "ollama" -ArgumentList "serve" -NoNewWindow
Start-Sleep -Seconds 1
Write-Host "  OK Ollama is running"

# ── 11. Done ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "==============================" -ForegroundColor Green
Write-Host "  Setup complete!" -ForegroundColor Green
Write-Host "  Model  : $OLLAMA_MODEL" -ForegroundColor Green
Write-Host "  Tunnel : $CUBE_ENDPOINT -> YODA CRS" -ForegroundColor Green
Write-Host "==============================" -ForegroundColor Green
Write-Host ""
Write-Host "NOTE: The tunnel will stop when this window closes." -ForegroundColor Yellow
Write-Host "To reconnect after reboot, run in PowerShell:"
Write-Host ""
Write-Host "  $env:CUBE_MODE='cube'"
Write-Host "  $env:CUBE_CRS_URL='${crsUrl}'"
Write-Host "  $env:CUBE_ENDPOINT=\$CUBE_ENDPOINT"
Write-Host "  $env:CUBE_ROLE='inference'"
Write-Host "  & '$daemonPath'"
Write-Host ""
Write-Host "Persistent service install (Windows Service) is planned for a future version."
`;
}

// ── Reconnect-only scripts (no Ollama install / model pull) ──────────────────

function makeReconnectBashScript(sessionToken: string, crsUrl: string): string {
  return `#!/usr/bin/env bash
# YODA — PlenumNET reconnect (tunnel only, no reinstall)
# Token: ${sessionToken}
set -euo pipefail

SESSION_TOKEN="${sessionToken}"
CRS_URL="${crsUrl}"
PLENUMNET_DIR="\$HOME/PlenumNET"
DAEMON="\$PLENUMNET_DIR/target/release/inter-cube-daemon"

echo "=== YODA PlenumNET Reconnect ==="

# ── 0. Check daemon exists ────────────────────────────────────────────
if [[ ! -f "\$DAEMON" ]]; then
  echo ""
  echo "  ✗ Daemon not found at: \$DAEMON"
  echo "    Run the full Install script first to build PlenumNET, then use Connect."
  exit 1
fi

# ── 1. Detect local IP ────────────────────────────────────────────────
if [[ "\$(uname -s)" == "Darwin" ]]; then
  LOCAL_IP=\$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || \
    route get default 2>/dev/null | awk '/interface:/{print \$2}' | xargs ipconfig getifaddr 2>/dev/null || echo "")
else
  LOCAL_IP=\$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if(\$i=="src") print \$(i+1)}' | head -1)
  [[ -z "\$LOCAL_IP" ]] && LOCAL_IP=\$(hostname -I 2>/dev/null | awk '{print \$1}')
fi
LOCAL_IP=\${LOCAL_IP:-"0.0.0.0"}
CUBE_ENDPOINT="\${LOCAL_IP}:51820"
echo "Local endpoint : \$CUBE_ENDPOINT"
[[ "\$LOCAL_IP" == "0.0.0.0" ]] && echo "  ⚠ Could not detect local IP — routing may not work correctly."

# ── 2. Register with YODA CRS ─────────────────────────────────────────
echo ""
echo "Registering with YODA CRS..."
if [[ "\$(uname -s)" == "Darwin" ]]; then
  PUB_KEY=\$(echo -n "\${LOCAL_IP}:51820" | shasum -a 256 | cut -d' ' -f1)
else
  PUB_KEY=\$(echo -n "\${LOCAL_IP}:51820" | sha256sum | cut -d' ' -f1)
fi

curl -sf -X POST "\${CRS_URL}/api/salvi/inter-cube/crs/register" \\
  -H "Content-Type: application/json" \\
  -d '{"endpoint":"'\$CUBE_ENDPOINT'","publicKey":"'\$PUB_KEY'","sessionToken":"'\$SESSION_TOKEN'"}' \\
  > /dev/null || { echo "  ✗ Registration failed. Is your internet connected?"; exit 1; }
echo "  ✓ Registered with YODA CRS"

# ── 3. Kill any old daemon, start fresh ──────────────────────────────
echo ""
echo "Starting PlenumNET tunnel daemon..."
pkill -f "inter-cube-daemon" 2>/dev/null || true
sleep 0.5

CUBE_MODE=cube \\
CUBE_CRS_URL="\$CRS_URL" \\
CUBE_ENDPOINT="\$CUBE_ENDPOINT" \\
CUBE_SESSION_TOKEN="\$SESSION_TOKEN" \\
CUBE_ROLE=inference \\
"\$DAEMON" &
echo "  ✓ Daemon started (PID \$!)"

echo ""
echo "  Tunnel active — YODA Monitoring will update within 10s."
echo "  Keep this terminal open to maintain the tunnel."
`;
}

function makeReconnectPsScript(sessionToken: string, crsUrl: string): string {
  return `# YODA — PlenumNET reconnect (tunnel only, no reinstall)
# Token: ${sessionToken}
$ErrorActionPreference = "Stop"

$SESSION_TOKEN = "${sessionToken}"
$CRS_URL = "${crsUrl}"
$PLENUMNET_DIR = "$env:USERPROFILE\\PlenumNET"

Write-Host "=== YODA PlenumNET Reconnect ===" -ForegroundColor Cyan

# ── 1. Detect local IP ────────────────────────────────────────────────
$ip = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notmatch '^127\.' -and $_.IPAddress -notmatch '^169\.254' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Sort-Object @{ Expression = { switch -Wildcard ($_.InterfaceAlias) { 'Wi-Fi*' { 0 } 'Ethernet*' { 1 } default { 2 } } } } |
  Select-Object -First 1).IPAddress
if (-not $ip) { $ip = "0.0.0.0" }
$CUBE_ENDPOINT = "$ip:51820"
Write-Host "Local endpoint : $CUBE_ENDPOINT"
if ($ip -eq "0.0.0.0") {
  Write-Host "  WARN Could not detect local IP - registration will proceed but routing may fail." -ForegroundColor Yellow
}

# ── 2. Register with YODA CRS ─────────────────────────────────────────
Write-Host ""
Write-Host "Registering with YODA CRS..."
$pubKey = ([System.Security.Cryptography.SHA256]::Create().ComputeHash(
  [System.Text.Encoding]::UTF8.GetBytes($CUBE_ENDPOINT)) |
  ForEach-Object { $_.ToString("x2") }) -join ""

$regBody = ConvertTo-Json @{
  endpoint     = $CUBE_ENDPOINT
  publicKey    = $pubKey
  sessionToken = $SESSION_TOKEN
}

try {
  $regResp = Invoke-RestMethod \`
    -Uri "$CRS_URL/api/salvi/inter-cube/crs/register" \`
    -Method Post \`
    -ContentType "application/json" \`
    -Body $regBody
  Write-Host "  OK Registered as $($regResp.address)"
} catch {
  Write-Host "  FAIL Registration failed: $_" -ForegroundColor Red
  exit 1
}

# ── 3. Start PlenumNET tunnel daemon ──────────────────────────────────
Write-Host ""
Write-Host "Starting PlenumNET tunnel daemon..."
$daemonPath = "$PLENUMNET_DIR\\target\\release\\inter-cube-daemon.exe"

if (-not (Test-Path $daemonPath)) {
  Write-Host ""
  Write-Host "  FAIL Daemon not found at: $daemonPath" -ForegroundColor Red
  Write-Host "    Run the full Install script first to build PlenumNET, then use Connect." -ForegroundColor Yellow
  exit 1
}

Get-Process -Name "inter-cube-daemon" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

$env:CUBE_MODE = "cube"
$env:CUBE_CRS_URL = $CRS_URL
$env:CUBE_ENDPOINT = $CUBE_ENDPOINT
$env:CUBE_SESSION_TOKEN = $SESSION_TOKEN
$env:CUBE_ROLE = "inference"
$daemonProc = Start-Process -FilePath $daemonPath -NoNewWindow -PassThru
Write-Host "  OK Daemon started (PID $($daemonProc.Id))"

Write-Host ""
Write-Host "  Tunnel active - YODA Monitoring will update within 10s." -ForegroundColor Green
Write-Host "  Keep this window open to maintain the tunnel." -ForegroundColor Yellow
`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ModelInstallModal({ modelName, onClose, mode = 'install' }: Props) {
  const crsUrl = (import.meta.env.VITE_CRS_URL as string | undefined) ?? '';
  // modelName may be a display name ('Gemma-3.4B') or an Ollama tag ('gemma3:4b').
  // Resolve whichever form is stored in the DB.
  const ollamaTag = OLLAMA_TAG[modelName] ?? (OLLAMA_TAG_DISPLAY[modelName] ? modelName : undefined);
  const manualUrl = MANUAL_INSTALL_URL[modelName] ?? MANUAL_INSTALL_URL[OLLAMA_TAG_DISPLAY[modelName] ?? ''];
  const isManual = !!manualUrl && !ollamaTag;

  const [sessionToken] = useState<string>(() => crypto.randomUUID());
  const [os, setOs] = useState<OS>(() =>
    /Win/i.test(navigator.userAgent) ? 'powershell' : 'bash',
  );
  const [copied, setCopied] = useState(false);
  const [polling, setPolling] = useState<PollingState>({ phase: 'idle' });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCount = useRef(0);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const isConnect = mode === 'connect';

  const bashScript = isConnect
    ? makeReconnectBashScript(sessionToken, crsUrl)
    : makeBashScript(modelName, ollamaTag ?? '', sessionToken, crsUrl);
  const psScript = isConnect
    ? makeReconnectPsScript(sessionToken, crsUrl)
    : makePsScript(modelName, ollamaTag ?? '', sessionToken, crsUrl);
  const script = os === 'bash' ? bashScript : psScript;
  const fileName = os === 'bash'
    ? (isConnect ? 'yoda-reconnect.sh' : 'yoda-setup.sh')
    : (isConnect ? 'yoda-reconnect.ps1' : 'yoda-setup.ps1');
  const mime = os === 'bash' ? 'text/x-shellscript' : 'text/plain';

  const startPolling = useCallback(() => {
    if (!crsUrl || isManual) return;
    setPolling({ phase: 'waiting' });
    pollCount.current = 0;

    pollRef.current = setInterval(async () => {
      pollCount.current += 1;
      if (pollCount.current > 200) {
        clearInterval(pollRef.current!);
        setPolling({ phase: 'timeout' });
        return;
      }
      try {
        const res = await fetch(`${crsUrl}/api/yoda/crs/session/${sessionToken}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: { status: string; address?: string } = await res.json();
        if (data.status === 'registered' && data.address) {
          clearInterval(pollRef.current!);
          setPolling({ phase: 'connected', address: data.address });
        }
      } catch (e) {
        clearInterval(pollRef.current!);
        setPolling({ phase: 'error', message: String(e) });
      }
    }, 3000);
  }, [crsUrl, isManual, sessionToken]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;

    const FOCUSABLE = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');

    const getFocusable = () =>
      Array.from(modalRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);

    const firstFocusable = getFocusable()[0];
    firstFocusable?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const focusable = getFocusable();
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      if (pollRef.current) clearInterval(pollRef.current);
      previousFocusRef.current?.focus();
    };
  }, [onClose]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    startPolling();
  };

  const handleDownload = () => {
    const blob = new Blob([script], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    startPolling();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={isConnect ? `Reconnect ${modelName} to PlenumNET` : `Install ${modelName}`}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div ref={modalRef} className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[var(--color-surface-primary)] border border-[var(--color-border-default)] shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isConnect ? 'bg-blue-500/15' : 'bg-[var(--color-gold-500)]/15'}`}>
              <Terminal className={`w-4 h-4 ${isConnect ? 'text-blue-400' : 'text-[var(--color-gold-400)]'}`} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
                {isConnect ? <>Reconnect to PlenumNET — {modelName}</> : <>Install &amp; Connect — {modelName}</>}
              </h2>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                {isConnect
                  ? 'Re-run the tunnel script on your machine to restore the connection'
                  : 'Run the script on your server to establish a PlenumNET tunnel'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors text-[var(--color-text-muted)]"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 flex-1">

          {/* CRS URL warning */}
          {!crsUrl && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>
                <strong>CRS URL not configured.</strong> The generated script will only work when YODA is deployed.
                Set the <code className="bg-amber-500/20 px-1 rounded">VITE_CRS_URL</code> environment variable to your deployed domain.
              </span>
            </div>
          )}

          {/* Manual install notice */}
          {isManual ? (
            <div className="p-4 rounded-xl bg-[var(--color-surface-tertiary)] border border-[var(--color-border-subtle)] space-y-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-[var(--color-gold-400)]" />
                <span className="text-sm font-medium text-[var(--color-text-primary)]">
                  Manual installation required
                </span>
              </div>
              <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                <strong>{modelName}</strong> is not available via Ollama. Download the model weights directly
                from the provider and serve it using a compatible runtime (vLLM, llama.cpp, etc.).
              </p>
              <a
                href={manualUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-gold-400)] hover:text-[var(--color-gold-300)] transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Download from provider
              </a>
            </div>
          ) : (
            <>
              {/* OS tabs */}
              <div className="flex gap-1 p-1 rounded-lg bg-[var(--color-surface-secondary)] w-fit">
                {(['bash', 'powershell'] as OS[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setOs(tab)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      os === tab
                        ? 'bg-[var(--color-surface-primary)] text-[var(--color-text-primary)] shadow-sm'
                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                    }`}
                  >
                    {tab === 'bash' ? 'macOS / Linux' : 'Windows'}
                  </button>
                ))}
              </div>

              {/* Script block */}
              <div className="relative">
                <pre className="w-full h-64 overflow-auto p-3 rounded-xl bg-[var(--color-navy-950)] border border-[var(--color-border-subtle)] text-[10px] text-[var(--color-text-secondary)] font-mono leading-relaxed whitespace-pre select-all">
                  {script}
                </pre>
              </div>

              {/* Copy / Download */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-gold-500)] text-[var(--color-navy-950)] text-xs font-semibold hover:bg-[var(--color-gold-400)] transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied!' : 'Copy script'}
                </button>
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-surface-tertiary)] text-[var(--color-text-secondary)] text-xs font-medium hover:bg-[var(--color-surface-hover)] transition-colors border border-[var(--color-border-default)]"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download {fileName}
                </button>
              </div>

              {/* Polling state */}
              {polling.phase !== 'idle' && (
                <div className={`flex items-start gap-3 p-3.5 rounded-xl border text-xs ${
                  polling.phase === 'waiting'
                    ? 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                    : polling.phase === 'connected'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : 'bg-red-500/10 border-red-500/30 text-red-300'
                }`}>
                  {polling.phase === 'waiting' && (
                    <>
                      <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin mt-0.5" />
                      <div>
                        <p className="font-medium">Waiting for your server to connect…</p>
                        <p className="mt-0.5 opacity-75">Run the script on your server, then come back here.</p>
                      </div>
                    </>
                  )}
                  {polling.phase === 'connected' && (
                    <>
                      <Wifi className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium">
                          Connected — registered as <code className="bg-emerald-500/20 px-1 rounded">{polling.address}</code>
                        </p>
                        <p className="mt-0.5 opacity-75">
                          You can close this window. Set the Endpoint URL to{' '}
                          <code className="bg-emerald-500/20 px-1 rounded">http://localhost:11434</code>.
                        </p>
                      </div>
                    </>
                  )}
                  {polling.phase === 'timeout' && (
                    <>
                      <WifiOff className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium">No connection after 10 minutes.</p>
                        <p className="mt-0.5 opacity-75">Re-run the script and try again. Make sure it completed without errors.</p>
                      </div>
                    </>
                  )}
                  {polling.phase === 'error' && (
                    <>
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium">Connection check failed</p>
                        <p className="mt-0.5 opacity-75">{polling.message}</p>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Instructions */}
              <div className="p-3 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-subtle)] space-y-1.5">
                <p className="text-[10px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">What the script does</p>
                <ol className="text-xs text-[var(--color-text-muted)] space-y-1 list-decimal list-inside leading-relaxed">
                  <li>Clones &amp; builds the PlenumNET daemon (inter-cube only)</li>
                  <li>Opens an outbound tunnel to YODA — <strong>no ports need opening</strong></li>
                  <li>Installs Ollama and pulls <code className="bg-[var(--color-surface-primary)] px-1 rounded">{ollamaTag}</code></li>
                  <li>Starts Ollama on <code className="bg-[var(--color-surface-primary)] px-1 rounded">localhost:11434</code> (never public)</li>
                </ol>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
