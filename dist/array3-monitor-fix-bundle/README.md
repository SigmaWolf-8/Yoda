# Array3 Monitor — Local-Host Fetch Fix Bundle

## TL;DR

The Array3 Monitor page at `/monitoring` showed **"Saved, but fetch failed — check token/ports"** whenever the page was loaded from any hostname other than `localhost` / `127.0.0.1` — even when the YODA daemons were running on the same machine. The page hard-coded its local-vs-relay decision to those two strings, so loading it from a LAN/public IP (e.g. `http://24.65.67.91:<port>/monitoring`) flipped it into relay-only mode and the local daemons were never contacted.

NAT traversal is already handled by the outbound WSS relay. The bug is purely client-side host detection in `frontend/public/array3-monitor.html`.

## What this bundle contains

```
array3-monitor-fix-bundle/
├── README.md                       ← you are here
├── history.md                      ← chronological list of every prior wrong suggestion
├── verify.md                       ← DevTools Network checklist + curl probes
├── array3-monitor.html.patch       ← unified diff, applies with `patch -p1`
├── array3-monitor.html.fixed       ← full patched copy for drop-in replacement
├── apply-fix.sh                    ← bash apply script (Linux / macOS / WSL)
└── apply-fix.ps1                   ← PowerShell apply script (Windows)
```

## How to apply

### Option A — drop-in replacement (simplest)

From the repo root:

```bash
bash array3-monitor-fix-bundle/apply-fix.sh
```

or on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File array3-monitor-fix-bundle\apply-fix.ps1
```

Both scripts copy `array3-monitor.html.fixed` over `frontend/public/array3-monitor.html` and print next steps.

### Option B — apply as a patch

From the repo root:

```bash
patch -p1 < array3-monitor-fix-bundle/array3-monitor.html.patch
```

## What changed (4 edits, all in `frontend/public/array3-monitor.html`)

1. **`useRelay` default flipped.** Was `let useRelay = !_isLocal;` — any non-`localhost` hostname forced relay mode. Now defaults to `useRelay = window.location.origin.includes('plenumnet.replit.app')` so every non-relay origin is local-capable. The existing zero-alive-nodes → relay fallback (~line 900) is preserved for genuine remote users with a token configured.
2. **`_isServerHosted` path whitelist extended** to include `/monitoring`, so users who load the page from `plenumnet.replit.app/monitoring` get cookie-auth + `/monitor/slots` instead of being pushed to bearer-token mode.
3. **Status line now names the host and ports** being tried: e.g. `Connecting to local daemons at 24.65.67.91:11488,11515,11906…`.
4. **Categorized failure messages** in `applyConfigAndReconnect`. Instead of the generic "check token/ports", the user now sees one of:
   - `Cannot reach daemons at <host>:<ports> (<type>: <error>) — check daemons are running and bound to a routable interface.`
   - `Relay token rejected (401) — verify it matches the server RELAY_API_TOKEN.`
   - `No nodes registered with relay — start a daemon or check the relay cluster.`
   - `Saved — relay token required for remote mode. Add a token or start local daemons.`
   - `Relay error <code> — see overlay for details.`

## Verifying the fix

See `verify.md` for the full DevTools Network checklist. The short version: load `/monitoring` from `http://<your-host>:<port>`, open DevTools → Network, and confirm three requests to `${hostname}:11488`, `${hostname}:11515`, `${hostname}:11906` with **no** calls to `plenumnet.replit.app` (unless all three local fetches fail).
