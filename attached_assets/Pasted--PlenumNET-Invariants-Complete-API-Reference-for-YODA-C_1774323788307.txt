# PlenumNET Invariants & Complete API Reference for YODA

**Capomastro Holdings Ltd. — Applied Physics Division**
**Authoritative reference for any agent working on YODA (yoda.replit.app)**
**CRS Authority: https://plenumnet.replit.app**

---

## SECTION 1: ABSOLUTE INVARIANTS — VIOLATIONS BREAK THE SYSTEM

### I-01: No BLAKE3, No SHA-256, No ed25519

PlenumNET uses its own cryptographic primitives. There are ZERO references to BLAKE3, SHA-256, or ed25519 anywhere in the codebase. Do not introduce, reference, or log them.

| Correct | Wrong |
|---------|-------|
| TL-Sponge-385 | BLAKE3 |
| TL-DSA-87 / PT26-DSA | ed25519 |
| TIS-27 | SHA-256 |
| TL-KEM | X25519 / ECDH |

If you see "PQ-native tunnel keys derived," the parenthetical MUST say `(TL-Sponge-385)`, never `(BLAKE3)`.

### I-02: Rep C Trit Encoding — {1, 2, 3} Only

Ternary trit values are 1, 2, 3. Never 0, 1, 2. There is no trit value 0.

- Valid address: `1111111111112`
- Invalid address: `1111111111110`

### I-03: Port Assignments Are Fixed

These are the production port assignments. Do not change them. Do not suggest alternatives. Do not override them in code.

Each LLM engine is paired with its own cube daemon instance. Agent N = engine port `8080 + 2N`, daemon port `8081 + 2N`.

| Agent | Engine Port | Daemon Port | `LLM_PORT` | `CUBE_API_PORT` |
|-------|-------------|-------------|------------|-----------------|
| A (N=0) | 8080 | 8081 | 8080 | 8081 |
| B (N=1) | 8082 | 8083 | 8082 | 8083 |
| C (N=2) | 8084 | 8085 | 8084 | 8085 |

The cube daemon reads `CUBE_API_PORT` (or `API_PORT`) and defaults to 8080 if unset. Each daemon's `LLM_PORT` points to its paired engine.

### I-04: Ternary Address Format

Addresses are 13-trit strings using Rep C encoding.

- Flat: `1111111111112`
- Dotted: `111.111.111.111.2` (groups of 3.3.3.3.1)
- Both forms accepted everywhere

CRS address (geometric center): `1111111111111`

### I-05: The Geometry IS the Protocol

Routing is geometric — Hamming distance in a 13D ternary hypercube (3^13 = 1,594,323 vertices, 26 neighbors per node). Do not describe it as a VPN, a mesh network, or a conventional P2P system. It is a self-organizing topological network where the address space defines the routing.

### I-06: Do Not Mock Crypto

All cryptographic operations use real TL-DSA-87 / PT26-DSA. No mock signatures, no placeholder keys, no ed25519 substitutes. A temporary random hex key for relay authentication is an acknowledged shortcut — do not present it as production crypto.

---

## SECTION 2: DAEMON CONFIGURATION

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CUBE_MODE` | `all` | `crs`, `cube`, `all`, or `keygen` |
| `CUBE_CRS_URL` | (required for cube) | CRS base URL — for YODA clusters, this is the LOCAL CRS (Daemon #1), NOT plenumnet.replit.app |
| `CUBE_API_PORT` | `8080` | Daemon HTTP API port |
| `API_PORT` | (alias) | Alias for CUBE_API_PORT |
| `CUBE_ENDPOINT` | `0.0.0.0:51820` | Wire protocol endpoint |
| `CUBE_ROLE` | (optional) | `inference`, `review`, `kb`, `infra`, `relay`, `standby` |
| `LLM_PORT` | `8080` | Where llama-server listens |
| `CUBE_IDENTITY_DIR` | `~/.plenumnet/identity/` | Master key storage |
| `CUBE_IDENTITY_PASSPHRASE` | (hostname fallback) | Encryption passphrase |

### Cluster Architecture — Local CRS Model

For any YODA or LAN deployment, cube setup is independent and self-contained:

- **Daemon #1 (Engine A, port 8081)** starts in `CUBE_MODE=crs` — it IS the local CRS for the cluster
- **Daemon #2 (Engine B, port 8083)** starts in `CUBE_MODE=cube` with `CUBE_CRS_URL=http://localhost:8081`
- **Daemon #3 (Engine C, port 8085)** starts in `CUBE_MODE=cube` with `CUBE_CRS_URL=http://localhost:8081`

The remote server (`plenumnet.replit.app`) is a monitoring dashboard and global registry. It receives deployment summaries so the dashboard can display cluster health. It is NOT the operational CRS for any local cluster. All cube registration, heartbeat, and relay happens locally through Daemon #1.

Each new deployment is independent. The deployer may or may not find a previous version of the daemon installed. If an existing version is found:
1. The deployer checks its version against the CRS reference (`GET /health/crs` → `version` field)
2. If versions differ, the deployer logs a `NOTE: Version mismatch` warning
3. The YODA frontend should poll `GET /health/crs` at `plenumnet.replit.app` and compare against the local daemon's `/health` response to detect when a newer version is available — display a blue indicator when an update is ready

### Deploying — Single Daemon

Deploy (or update) a single daemon with a single command in PowerShell:

```powershell
irm https://plenumnet.replit.app/api/deploy-daemon | iex
```

Or download and double-click the `.bat` installer:
```
https://plenumnet.replit.app/api/deploy-daemon.bat
```

### Deploying — YODA 3-Node Cluster (v0.4.0)

Deploy the full 3-daemon YODA cluster:

```powershell
irm https://plenumnet.replit.app/api/deploy-yoda | iex
```

Or download and double-click the `.bat` installer:
```
https://plenumnet.replit.app/api/deploy-yoda.bat
```

The YODA deployer automatically:
1. Clones or pulls the latest source to `C:\PlenumNET`
2. Stops any running daemon instances
3. Builds the release binary (`cargo build --release -p inter-cube`)
4. Checks the built version against the CRS reference version
5. Generates 3 PT26-DSA identities (if missing)
6. Starts Daemon #1 as the LOCAL CRS (`CUBE_MODE=crs`, port 8081)
7. Waits for the local CRS to be ready, then starts Daemons #2 and #3 as cube nodes registering with it
8. Posts a deployment summary to `plenumnet.replit.app` for monitoring
9. Creates a "Start YODA Daemons" desktop shortcut

If the daemon shows wrong behavior (e.g. ignoring `CUBE_API_PORT`, printing "BLAKE3", showing wrong version), re-run the deployer. Current deployer version is v0.4.0.

### Version Checking

The deployer performs a version check at step 4:
- **Local version**: read from the daemon binary output
- **CRS reference version**: queried from `GET https://plenumnet.replit.app/health/crs` → `version` field
- If they differ, a warning is printed but deployment continues
- The YODA frontend should periodically check `GET /health/crs` at plenumnet.replit.app and compare with the local daemon's version. When a newer version is available, show a blue indicator to prompt the user to re-run the deployer.

### Daemon Startup (Windows)

PlenumNET install path: `C:\PlenumNET`
Daemon binary: `C:\PlenumNET\target\release\inter-cube-daemon.exe`

Each engine gets its own daemon with its own identity. Separate identities are required because each daemon derives a unique ternary address from its master key (via TL-Sponge-385). Shared keys would produce the same address and collide at CRS.

| Agent | Identity Dir | Engine Port | Daemon Port | CUBE_MODE |
|-------|-------------|-------------|-------------|-----------|
| A | `$env:USERPROFILE\.plenumnet\identity-1\` | 8080 | 8081 | `crs` (local CRS) |
| B | `$env:USERPROFILE\.plenumnet\identity-2\` | 8082 | 8083 | `cube` |
| C | `$env:USERPROFILE\.plenumnet\identity-3\` | 8084 | 8085 | `cube` |

Generate each identity once with `CUBE_MODE=keygen`:
```powershell
$env:CUBE_MODE="keygen"
$env:CUBE_IDENTITY_DIR="$env:USERPROFILE\.plenumnet\identity-1"
& "C:\PlenumNET\target\release\inter-cube-daemon.exe"
# Repeat for identity-2, identity-3
```

Run each daemon in a separate terminal:

**Daemon A (Engine A — LOCAL CRS):**
```powershell
$env:CUBE_MODE="crs"
$env:CUBE_API_PORT="8081"
$env:CUBE_ENDPOINT="<local-ip>:8081"
$env:CUBE_IDENTITY_DIR="$env:USERPROFILE\.plenumnet\identity-1"
& "C:\PlenumNET\target\release\inter-cube-daemon.exe"
```

**Daemon B (Engine B — registers with local CRS):**
```powershell
$env:CUBE_MODE="cube"
$env:CUBE_API_PORT="8083"
$env:LLM_PORT="8082"
$env:CUBE_CRS_URL="http://localhost:8081"
$env:CUBE_ROLE="inference"
$env:CUBE_IDENTITY_DIR="$env:USERPROFILE\.plenumnet\identity-2"
& "C:\PlenumNET\target\release\inter-cube-daemon.exe"
```

**Daemon C (Engine C — registers with local CRS):**
```powershell
$env:CUBE_MODE="cube"
$env:CUBE_API_PORT="8085"
$env:LLM_PORT="8084"
$env:CUBE_CRS_URL="http://localhost:8081"
$env:CUBE_ROLE="inference"
$env:CUBE_IDENTITY_DIR="$env:USERPROFILE\.plenumnet\identity-3"
& "C:\PlenumNET\target\release\inter-cube-daemon.exe"
```

---

## SECTION 3: RELAY PROTOCOL

### Local CRS Endpoints (Daemon #1, localhost:8081)

These are the endpoints served by Daemon #1 when running as the local CRS. All cube registration and routing happens here — NOT at plenumnet.replit.app.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/salvi/inter-cube/crs/register` | POST | Register a cube node (body: `{publicKey, endpoint}`) |
| `/api/salvi/inter-cube/crs/heartbeat` | POST | Node heartbeat |
| `/api/salvi/inter-cube/crs/stats` | GET | CRS statistics |
| `/api/salvi/inter-cube/crs/lookup/:address` | GET | Look up a registered node |
| `/api/salvi/inter-cube/crs/neighbors/:address` | GET | Geometric neighbors |
| `/api/salvi/inter-cube/crs/deregister` | POST | Remove a node |
| `/health` | GET | CRS daemon health (includes `version` and `address` fields) |

### Remote CRS Daemon Registry (plenumnet.replit.app — monitoring only)

These endpoints are for the remote dashboard. They are NOT used for local cube operations.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/salvi/inter-cube/relay/register` | GET | Register node via relay (`?publicKey=...&endpoint=...`) — uses TL-Sponge address derivation when native CRS is offline |
| `/api/salvi/inter-cube/relay/heartbeat` | GET | Refresh registration (`?address=...&publicKey=...`) |
| `/api/salvi/inter-cube/relay/status` | GET | Connected nodes + pending queues |
| `/api/salvi/inter-cube/relay/deployment` | POST | Post deployment summary (used by deployer at step 8) |
| `/api/salvi/inter-cube/relay/deployments` | GET | Query deployment records (`?hostname=...` optional) |
| `/api/salvi/inter-cube/relay/cluster-health` | GET | Cluster health with per-daemon status (live/registered/deployed) |
| `/api/salvi/inter-cube/relay/purge-stale` | GET/POST | Purge stale registrations (`?maxAge=300000`) |
| `/health/crs` | GET | CRS reference health — includes `version` field for version checking |

### WebSocket Relay (remote — for cross-cluster communication)

**Endpoint:** `wss://plenumnet.replit.app/ws/relay`

**Auth (first message, 10s deadline):**
```json
{ "type": "auth", "address": "<assigned>", "publicKey": "<hex>" }
```
Response: `{ "type": "auth_ok", "address": "...", "connectedPeers": [...] }`

**Keepalive (every 25s):**
```json
{ "type": "ping" }
```

**Send message:**
```json
{ "type": "relay", "to": "<address>", "msgType": "<type>", "payload": "<json-string>" }
```
Ack: `{ "type": "relay_ack", "to": "...", "delivered": true|false }`

**Receive message:**
```json
{ "type": "relay", "from": "<address>", "msgType": "<type>", "payload": "<json-string>" }
```

**Peer list:**
```json
{ "type": "peers" }
```

Offline queue: up to 100 messages per destination, delivered on reconnect.

### Reconnection Protocol

On every reconnect (including after CRS restart):
1. Re-register via HTTP (local CRS clears in-memory registry on restart)
2. Open new WebSocket (if using remote relay for cross-cluster)
3. Re-authenticate with the address returned by registration

Backoff: 2s → 4s → 8s → ... → 60s cap.

---

## SECTION 4: INFERENCE VIA RELAY

### Discovering Cube Addresses

Cube addresses are assigned dynamically at registration time — never hardcode them. YODA discovers available inference nodes by:

1. **Relay status endpoint:** `GET /api/salvi/inter-cube/relay/status` returns all connected nodes with their addresses and roles.
2. **WebSocket peer list:** Send `{ "type": "peers" }` on the relay WebSocket to get currently connected peer addresses.
3. **Auth response:** The `auth_ok` message includes `connectedPeers` — the list of other nodes online at that moment.

YODA should maintain a live roster of cube addresses and route inference requests to any node with `role: "inference"`.

### Request (YODA → CRS → Cube)

```json
{
  "type": "relay",
  "to": "<cube-address>",
  "msgType": "inference_request",
  "payload": "{\"requestId\":\"<uuid>\",\"messages\":[...],\"maxTokens\":512,\"model\":\"local\",\"temperature\":0.7}"
}
```

Where `<cube-address>` is a 13-trit address discovered from the relay status or peer list (e.g. `1111111111112`). With 3 daemons running, there will be 3 distinct addresses — one per agent.

### Response (Cube → CRS → YODA)

**Success — `inference_response`:**
```json
{
  "type": "relay",
  "from": "<cube-address>",
  "msgType": "inference_response",
  "payload": "{\"requestId\":\"<uuid>\",\"content\":\"...\",\"model\":\"local\",\"tokens\":42,\"usage\":{...}}"
}
```

**Error — `inference_error`:**
```json
{
  "type": "relay",
  "from": "<cube-address>",
  "msgType": "inference_error",
  "payload": "{\"requestId\":\"<uuid>\",\"error\":\"LLM server unreachable...\"}"
}
```

### Payload Fields

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `requestId` | string (UUID) | yes | — |
| `messages` | array (OpenAI format) | yes | — |
| `maxTokens` | integer | no | 512 |
| `model` | string | no | "local" |
| `temperature` | float | no | 0.7 |

### Timeout

The daemon allows 120 seconds per LLM call. YODA should use its own timeout (e.g. 30s) and fall back to browser relay if no response arrives.

---

## SECTION 5: COMPLETE API REFERENCE — plenumnet.replit.app

All endpoints below are served from `https://plenumnet.replit.app`. Auth-required routes are marked.

### 5.1 Inter-Cube Infrastructure (Rust Daemon via Express Proxy)

**CRS Mode (port 8181 internal, proxied through Express):**

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/salvi/inter-cube/crs/register` | POST | API key optional | Register a cube node |
| `/api/salvi/inter-cube/crs/update-key` | POST | — | Update node's public key |
| `/api/salvi/inter-cube/crs/heartbeat` | POST | API key optional | Node heartbeat |
| `/api/salvi/inter-cube/crs/stats` | GET | — | CRS statistics |
| `/api/salvi/inter-cube/crs/lookup/:address` | GET | API key optional | Look up a registered node |
| `/api/salvi/inter-cube/crs/neighbors/:address` | GET | — | Get geometric neighbors |
| `/api/salvi/inter-cube/crs/deregister` | POST | API key optional | Remove a node |
| `/api/salvi/inter-cube/glb/forward` | POST | API key optional | Forward via Geometric Load Balancer |
| `/api/salvi/inter-cube/glb/stats` | GET | — | GLB statistics |
| `/api/salvi/inter-cube/glb/health` | GET | — | GLB health |
| `/api/salvi/inter-cube/con/neighbors` | GET | — | Cube Overlay Network neighbors |
| `/api/salvi/inter-cube/con/stats` | GET | — | CON statistics |
| `/api/salvi/inter-cube/con/tunnel/refresh` | POST | API key optional | Refresh tunnel keys |
| `/api/salvi/inter-cube/con/tunnel/upgrade-key` | POST | API key optional | Upgrade tunnel key |
| `/api/salvi/inter-cube/fts/status` | GET | — | Fault Tolerance Service status |
| `/api/salvi/inter-cube/fts/dead` | GET | — | Dead neighbors list |
| `/api/salvi/inter-cube/fts/config` | POST | API key optional | Update FTS config |
| `/api/salvi/inter-cube/routing/compute` | POST | — | Compute geometric route |
| `/api/salvi/inter-cube/address/validate` | POST | — | Validate ternary address |
| `/api/salvi/inter-cube/topology` | GET | — | 13D hypercube topology |
| `/health` | GET | — | Daemon health |

### 5.2 Cube Daemon Local API (on laptop — ports 8081 / 8083 / 8085)

Each daemon exposes the same endpoints on its `CUBE_API_PORT`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Daemon health |
| `/api/salvi/inter-cube/node/info` | GET | Node address, mode, CRS URL, ports |
| `/api/salvi/inter-cube/glb/forward` | POST | Forward via GLB |
| `/api/salvi/inter-cube/glb/stats` | GET | GLB stats |
| `/api/salvi/inter-cube/con/stats` | GET | CON stats |
| `/api/salvi/inter-cube/fts/status` | GET | FTS status |
| `/api/salvi/inter-cube/fts/dead` | GET | Dead neighbors |
| `/api/salvi/inter-cube/topology` | GET | Topology |
| `/api/salvi/inter-cube/address/validate` | POST | Validate address |

### 5.3 TL-DSA Cryptography

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/salvi/crypto/tl-dsa/spec` | GET | TL-DSA-87 specification |
| `/api/salvi/crypto/tl-dsa/keygen` | POST | Generate TL-DSA keypair |
| `/api/salvi/crypto/tl-dsa/sign` | POST | Sign message |
| `/api/salvi/crypto/tl-dsa/verify` | POST | Verify signature |

### 5.4 PT26-DSA Cryptography

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/salvi/crypto/pt26/spec` | GET | PT26-DSA specification |
| `/api/salvi/crypto/pt26/keygen` | POST | Generate PT26-DSA keypair |
| `/api/salvi/crypto/pt26/sign` | POST | Sign message |
| `/api/salvi/crypto/pt26/verify` | POST | Verify signature |

### 5.5 TL-KEM Key Encapsulation

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/salvi/crypto/tl-kem/spec` | GET | TL-KEM specification |

### 5.6 Cryptographic Hash (TL-Sponge-385)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/salvi/crypto/hash` | POST | TL-Sponge-385 hash |
| `/api/salvi/crypto/phase-benchmark` | GET | Phase encryption benchmark |

### 5.7 Phase Encryption v3

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/salvi/phase/config/:mode` | GET | Phase config for mode |
| `/api/salvi/phase/split` | POST | Phase-split data |
| `/api/salvi/phase/recombine` | POST | Phase-recombine data |
| `/api/salvi/phase/recommend` | GET | Recommended config |
| `/api/salvi/phase/batch/split` | POST | Batch phase-split |
| `/api/salvi/phase/batch/recombine` | POST | Batch phase-recombine |

### 5.8 Ternary Arithmetic

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/salvi/ternary/convert` | POST | Binary ↔ ternary conversion |
| `/api/salvi/ternary/add` | POST | Ternary addition |
| `/api/salvi/ternary/multiply` | POST | Ternary multiplication |
| `/api/salvi/ternary/rotate` | POST | Trit rotation |
| `/api/salvi/ternary/not` | POST | Ternary NOT |
| `/api/salvi/ternary/xor` | POST | Ternary XOR |
| `/api/salvi/ternary/batch` | POST | Batch operations |
| `/api/salvi/ternary/density/:tritCount` | GET | Information density for trit count |
| `/api/salvi/ternary/density-benchmark` | GET | Density benchmark |
| `/api/salvi/ternary/noether-verify` | POST | Noether symmetry verification |

### 5.9 HPTP Femtosecond Timing

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/salvi/timing/self-test` | GET | HPTP self-test |
| `/api/salvi/timing/error-budget` | GET | Error budget status |
| `/api/salvi/timing/timestamp` | GET | Current HPTP timestamp |
| `/api/salvi/timing/metrics` | GET | Timing metrics |
| `/api/salvi/timing/batch/:count` | GET | Batch timestamps |
| `/api/salvi/timing/epoch/anchors` | GET | Epoch anchors |
| `/api/salvi/timing/epoch/calendars` | GET | All calendar systems |
| `/api/salvi/timing/epoch/calendars/:system` | GET | Specific calendar (mayan, hebrew, chinese, vedic, egyptian, julian-day, islamic, byzantine, thirteen-moon, + 33 more) |

### 5.10 TDNS v2.5.0 (Ternary Domain Name System)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tdns/resolve` | GET | Resolve a ternary domain |
| `/api/tdns/records` | GET | List TDNS records |

### 5.11 TSA (RFC 3161 Time-Stamping Authority)

Base path: `/api/tsa/`

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/tsa/timestamp` | POST | App token | Issue RFC 3161 timestamp |
| `/api/tsa/timestamp/json` | POST | App token | Issue JSON timestamp |
| `/api/tsa/verify` | POST | — | Verify timestamp |
| `/api/tsa/certificate` | GET | — | TSA certificate info |
| `/api/tsa/certificate/download` | GET | — | Download TSA certificate |
| `/api/tsa/tokens` | GET | Admin | List API tokens |
| `/api/tsa/policy` | GET | — | TSA policy |
| `/api/tsa/health` | GET | — | TSA health |
| `/api/tsa/audit/query` | GET | — | Query audit log |
| `/api/tsa/export/json` | POST | — | Export audit as JSON |
| `/api/tsa/export/pdf` | POST | — | Export audit as PDF |
| `/api/tsa/export/verify` | POST | — | Verify export |

### 5.12 Hedera HCS Witnessing

Base path: `/api/hedera/`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/hedera/v1/witness` | POST | Submit witness record |
| `/api/hedera/v1/witness/:txId` | GET | Look up witness by txId |
| `/api/hedera/v1/verify` | POST | Verify witness |
| `/api/hedera/v1/topic` | GET | Topic info |
| `/api/hedera/v1/health` | GET | Hedera health |
| `/api/hedera/v1/stats` | GET | Witnessing statistics |

### 5.13 SFK Operations Pipeline

Base path: `/api/sfk/`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sfk/v1/operations` | POST | Submit operation |
| `/api/sfk/v1/operations/:id` | GET | Get operation by ID |
| `/api/sfk/v1/operations` | GET | List operations |
| `/api/sfk/v1/operations/:id` | DELETE | Delete operation |
| `/api/sfk/v1/stats` | GET | SFK stats |

### 5.14 Capability-Based Security (Phases 1–6)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/capabilities/issue` | POST | Issue capability token |
| `/api/capabilities/validate` | POST | Validate capability |
| `/api/capabilities/delegate` | POST | Delegate capability |
| `/api/capabilities/delegate/chain` | POST | Chain delegation |
| `/api/capabilities/verify-chain` | POST | Verify delegation chain |
| `/api/capabilities/audit` | GET | Audit log |
| `/api/capabilities/hardware/register` | POST | Register hardware token |
| `/api/capabilities/hardware/challenge` | POST | Hardware challenge |
| `/api/capabilities/hardware/verify` | POST | Verify hardware response |
| `/api/capabilities/hardware/issue` | POST | Issue hardware-backed cap |
| `/api/capabilities/certificate/issue` | POST | Issue certificate |
| `/api/capabilities/certificate/verify` | POST | Verify certificate |
| `/api/capabilities/certificate/:certId/rfc3161` | GET | Certificate RFC 3161 proof |
| `/api/capabilities/certificate/:certId/verify-data` | GET | Certificate verification data |
| `/api/capabilities/certificate/evidence-chain` | POST | Evidence chain |
| `/api/capabilities/certificate/stats` | GET | Certificate stats |
| `/api/capabilities/mesh/register` | POST | Register mesh node |
| `/api/capabilities/mesh/issue` | POST | Issue mesh capability |
| `/api/capabilities/mesh/propagate` | POST | Propagate through mesh |
| `/api/capabilities/mesh/discover` | GET | Discover mesh nodes |
| `/api/capabilities/mesh/validate` | POST | Validate mesh capability |
| `/api/capabilities/mesh/topology` | GET | Mesh topology |
| `/api/capabilities/mesh/health` | GET | Mesh health |
| `/api/capabilities/status` | GET | Overall capability status |
| `/api/capabilities/demo/expiration` | GET | Demo: expiration |
| `/api/capabilities/demo/delegation` | GET | Demo: delegation |
| `/api/capabilities/demo/confinement` | GET | Demo: confinement |
| `/api/capabilities/demo/certificates` | GET | Demo: certificates |
| `/api/capabilities/demo/mesh` | GET | Demo: mesh |

### 5.15 API Key Management

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/keys/generate` | POST | Admin | Generate API key |
| `/api/keys` | GET | Admin | List API keys |
| `/api/keys/stats` | GET | Admin | Key statistics |
| `/api/keys/scopes` | GET | — | Available scopes |
| `/api/keys/revoke/:id` | POST | Admin | Revoke key |
| `/api/keys/rotate/:id` | POST | Admin | Rotate key |
| `/api/keys/:id/logs` | GET | Admin | Key usage logs |
| `/api/keys/expiring` | GET | Admin | Expiring keys |
| `/api/keys/:id/rate-limit` | PATCH | Admin | Update rate limit |
| `/api/keys/rate-limit-tiers` | GET | — | Rate limit tiers |
| `/api/keys/entity-types` | GET | — | Entity types |
| `/api/keys/:id/metadata` | PATCH | Admin | Update metadata |
| `/api/keys/anomalies` | GET | Admin | Usage anomalies |
| `/api/keys/audit` | GET | Admin | Key audit log |
| `/api/keys/:id/audit` | GET | Admin | Key-specific audit |
| `/api/keys/validate-external` | GET | — | Validate external key |

### 5.16 Kong Konnect Gateway

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/kong/status` | GET | — | Kong connection status |
| `/api/kong/organization` | GET | — | Organization info |
| `/api/kong/control-planes` | GET | — | List control planes |
| `/api/kong/control-planes/:cpId/services` | GET | — | List services |
| `/api/kong/control-planes/:cpId/routes` | GET | — | List routes |
| `/api/kong/control-planes/:cpId/plugins` | GET | — | List plugins |
| `/api/kong/config` | GET | Admin | Gateway config |
| `/api/kong/control-planes/:cpId/services` | POST | Admin | Create service |
| `/api/kong/control-planes/:cpId/services/:serviceId/routes` | POST | Admin | Create route |
| `/api/kong/control-planes/:cpId/services/:serviceId/plugins` | POST | Admin | Create plugin |
| `/api/kong/control-planes/:cpId/sync-plenumnet` | POST | Admin | Sync PlenumNET services |
| `/api/kong/sync-all-control-planes` | POST | Admin | Sync all CPs |
| `/api/kong/service-catalog` | GET | — | Service catalog |
| `/api/kong/save-to-github` | POST | Admin | Save config to GitHub |
| `/api/kong/control-planes/:cpId/deploy-instructions` | GET | — | Deployment instructions |
| `/api/kong/control-planes/:cpId/generate-deployment` | POST | Admin | Generate deployment |
| `/api/kong/control-planes/:cpId/deploy-to-cloud` | POST | Admin | Deploy to cloud |

### 5.17 Security & HPTP Anomaly Detection

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/security/audit` | POST | Admin | Create audit entry |
| `/api/security/audit` | GET | Admin | List audit entries |
| `/api/security/audit/unresolved` | GET | Admin | Unresolved entries |
| `/api/security/audit/summary` | GET | Admin | Audit summary |
| `/api/security/audit/stats` | GET | Admin | Audit statistics |
| `/api/security/audit/:id` | GET | Admin | Get audit entry |
| `/api/security/audit/:id/resolve` | PATCH | Admin | Resolve entry |
| `/api/security/hptp/anomalies` | POST | Admin | Report anomaly |
| `/api/security/hptp/anomalies` | GET | Admin | List anomalies |
| `/api/security/hptp/status` | GET | Admin | HPTP status |
| `/api/security/hptp/fallback-analysis` | GET | Admin | Fallback analysis |
| `/api/security/hptp/stats` | GET | Admin | HPTP stats |
| `/api/security/hptp/thresholds` | GET | Admin | HPTP thresholds |
| `/api/security/hptp/fallback-modes` | GET | Admin | Fallback modes |
| `/api/security/hptp/redundancy` | GET | Admin | Redundancy status |

### 5.18 GitHub Integration

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/github/repos` | GET | Admin | List repositories |
| `/api/github/repos/:owner/:repo/tree` | GET | Admin | Repository tree |
| `/api/github/file/:owner/:repo` | GET | Admin | Read file |
| `/api/github/file/:owner/:repo` | PUT | Admin | Write file |
| `/api/github/file/:owner/:repo` | DELETE | Admin | Delete file |
| `/api/github/push-workflows/:owner/:repo` | POST | Admin | Push workflows |
| `/api/github/push-env/:owner/:repo` | POST | Admin | Push env config |
| `/api/github/push-batch/:owner/:repo` | POST | Admin | Push batch files |

### 5.19 TTC v4.2 Compression

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/demo/run` | POST | Run compression demo |
| `/api/demo/stats` | GET | Demo statistics |
| `/api/demo/session/:sessionId` | GET | Session data |
| `/api/demo/upload` | POST | Upload file for compression |
| `/api/demo/history` | GET | Compression history |
| `/api/demo/files` | GET | List compressed files |
| `/api/demo/data/:sessionId` | GET | Session detail |
| `/api/compression/file` | POST | Compress file |
| `/api/compression/decompress` | POST | Decompress file |
| `/api/compression/file/raw` | POST | Raw compress |
| `/api/compression/decompress/raw` | POST | Raw decompress |
| `/api/compression/db/store` | POST | Store in PlenumDB |
| `/api/compression/db/retrieve/:id` | GET | Retrieve from PlenumDB |
| `/api/compression/db/documents` | GET | List documents |
| `/api/compression/db/raw/:id` | GET | Raw document |
| `/api/compression/db/documents/:id` | DELETE | Delete document (auth) |

### 5.20 Tribonacci & Agent Array

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tribonacci/hook` | GET | Tribonacci hook point |
| `/api/tribonacci/permutation` | GET | Tribonacci permutation |
| `/api/tribonacci/coverage` | GET | Coverage analysis |
| `/api/tribonacci/hash` | GET | Tribonacci hash |
| `/api/tribonacci/sequence` | GET | Tribonacci sequence |
| `/api/tribonacci/generate-id` | POST | Generate Tribonacci ID |
| `/api/tribonacci/next-worker` | GET | Next worker in rotation |
| `/api/tribonacci/skip-lookup` | GET | Skip lookup |
| `/api/tribonacci/hash-distribution` | GET | Hash distribution |
| `/api/tribonacci/agent-array` | POST | Submit agent array query |
| `/api/tribonacci/agent-array/stream/:sessionId` | GET | Stream results (SSE) |
| `/api/tribonacci/agent-array/save` | POST | Save report |
| `/api/tribonacci/agent-array/reports` | GET | List reports |
| `/api/tribonacci/agent-array/reports/:id` | GET | Get report |
| `/api/tribonacci/agent-array/positions` | GET | Agent positions |

### 5.21 Ephemeris (Astronomical Calendar)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ephemeris/convert` | POST | Calendar conversion |
| `/api/ephemeris/position` | POST | Celestial position |
| `/api/ephemeris/batch` | POST | Batch positions |
| `/api/ephemeris/info` | GET | Ephemeris info |

### 5.22 Tonal Diffusion & Resonance

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tonal/field` | GET | Tonal field state |
| `/api/tonal/neighbors` | GET | Tonal neighbors |
| `/api/tonal/packet` | POST | Send tonal packet |
| `/api/resonance/status` | GET | Resonance status |
| `/api/resonance/sweep` | POST | Frequency sweep |
| `/api/resonance/rtt` | POST | Round-trip time |
| `/api/metrics/plenum` | GET | Plenum metrics |

### 5.23 PPTPro Integration

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/v1/status` | GET | Plenum key | Integration status |
| `/api/v1/safety/limits` | GET | Plenum key | Safety limits |
| `/api/v1/ternary/state` | GET | Plenum key | Ternary state |
| `/api/v1/entrain/advise` | POST | Plenum key | Entrainment advice |
| `/api/v1/logs/coherence` | POST | Plenum key | Log coherence data |

### 5.24 GDPR / Data Subject Rights

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/gdpr/data-export` | GET | User | Export user data |
| `/api/gdpr/delete-account` | DELETE | User | Delete account |
| `/api/gdpr/requests` | GET | User | List DSR requests |
| `/api/gdpr/policy` | GET | — | Privacy policy |

### 5.25 Whitepapers

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/whitepapers` | GET | — | List whitepapers |
| `/api/whitepapers/active` | GET | — | Active whitepapers |
| `/api/whitepapers/:id` | GET | — | Get whitepaper |
| `/api/whitepapers` | POST | Admin | Create whitepaper |

### 5.26 Notifications

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/notifications/test` | POST | Send test notification |
| `/api/notifications/status` | GET | Notification status |

### 5.27 Developer Signups

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/developer-signup` | POST | — | Submit signup |
| `/api/developer-signup/count` | GET | — | Signup count |
| `/api/admin/developer-signups` | GET | Admin | List signups |
| `/api/admin/developer-signups/:id` | DELETE | Admin | Delete signup |

### 5.28 Salvi Framework Docs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/salvi/docs` | GET | Framework documentation |
| `/api/salvi/vm/spec` | GET | Ternary VM specification |
| `/api/salvi/vm/conformance` | GET | VM conformance test results |

### 5.29 System

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | System health |
| `/api/verify` | GET | API key verification (requires key) |
| `/api/legal/:type` | GET | Legal documents |
| `/api/benchmark-report` | GET | Benchmark report |
| `/api/user/admin-status` | GET | User admin status |
| `/api/csp-reports` | POST | CSP violation reports |
| `/api/pqti-status` | GET | PQTI service status |
| `/api/install.ps1` | GET | PowerShell installer |
| `/api/deploy-daemon` | GET | Cube daemon deployer (PowerShell, `irm ... \| iex`) |
| `/api/deploy-daemon.bat` | GET | Cube daemon deployer (.bat download) |
| `/api/yoda-installer` | GET | YODA installer (auto-detect) |
| `/api/yoda-installer.bat` | GET | YODA installer (.bat) |

---

## SECTION 6: UI COLOR SCHEME

| Color | Meaning |
|-------|---------|
| Blue | Live / Active |
| Grey | Trouble / Degraded |
| Black | Down / Offline |

No green. No red. These are the only status colors.

---

## SECTION 7: DO NOT TOUCH

These files and systems are off-limits. Do not modify, mock, or rewrite them.

- `deployments/` directory
- `server/ternary.ts`
- `compress/decompress` pipeline
- `ternarydb.tsx`
- `tunnel_auth.rs`
- Engine endpoint URLs in YODA settings (user-configured)
- Port assignments (user-controlled)

---

## SECTION 8: TERMINOLOGY

| Term | Correct Usage |
|------|---------------|
| GLB | Geometric Load Balancer (NOT Global) |
| CON | Cube Overlay Network (NOT Connection Manager) |
| CRS | Cube Registration Service |
| FTS | Fault Tolerance Service |
| PT26-DSA | Daemon identity signature scheme |
| TL-DSA-87 | Address-bound signature scheme (Level 5 PQ) |
| TL-Sponge-385 | Cryptographic sponge (385-bit PQ security) |
| TIS-27 | Wire integrity sponge (43-bit) |
| TL-KEM | Ternary Lattice Key Encapsulation |
| PlenumLAN | A local Inter-Cube network (any topology — the network management layer built on Replit/Rust) |
| YODA | The frontend app at yoda.replit.app |
| Cube daemon | The Rust binary on the laptop |
| Local CRS | Daemon #1 in any YODA/LAN cluster — the operational CRS for cube registration and routing |
| Remote CRS | The monitoring dashboard at plenumnet.replit.app — receives deployment summaries, NOT the operational CRS |
| CRS Daemon Registry | The deployment tracking API at plenumnet.replit.app (`/api/salvi/inter-cube/relay/deployments`) |
| HPTP | High-Precision Timing Protocol (femtosecond) |
| TSA | Time-Stamping Authority (RFC 3161) |
| HCS | Hedera Consensus Service |
| SFK | SFK Operations Pipeline |
| TTC | Ternary Transport Compression v4.2 |
| TDNS | Ternary Domain Name System v2.5.0 |

---

## SECTION 9: YODA MONITORING QUICK REFERENCE

A single consolidated table of every endpoint YODA needs to monitor daemon infrastructure, WebSocket relay, and cluster health. All local endpoints assume the standard port layout: Daemon #1 = 8081 (CRS), Daemon #2 = 8083 (cube), Daemon #3 = 8085 (cube).

### 9.1 Local Daemon Monitoring (localhost)

| Monitoring Need | Method | Endpoint | Ports | Notes |
|----------------|--------|----------|-------|-------|
| Daemon health | GET | `http://localhost:{port}/health` | 8081, 8083, 8085 | Returns version, address, mode |
| Node info | GET | `http://localhost:{port}/api/salvi/inter-cube/node/info` | 8081, 8083, 8085 | Address, mode, CRS URL, ports |
| CRS stats | GET | `http://localhost:8081/api/salvi/inter-cube/crs/stats` | 8081 only | Registered node count, addresses |
| Registered node lookup | GET | `http://localhost:8081/api/salvi/inter-cube/crs/lookup/:address` | 8081 only | Look up any registered node |
| Geometric neighbors | GET | `http://localhost:8081/api/salvi/inter-cube/crs/neighbors/:address` | 8081 only | 26 potential neighbors in 13D hypercube |
| FTS dead nodes | GET | `http://localhost:{port}/api/salvi/inter-cube/fts/dead` | 8081, 8083, 8085 | Dead neighbor list |
| FTS status | GET | `http://localhost:{port}/api/salvi/inter-cube/fts/status` | 8081, 8083, 8085 | Fault tolerance health |
| GLB stats | GET | `http://localhost:{port}/api/salvi/inter-cube/glb/stats` | 8081, 8083, 8085 | Geometric load balancer stats |
| Topology | GET | `http://localhost:{port}/api/salvi/inter-cube/topology` | 8081, 8083, 8085 | 13D hypercube topology view |

### 9.2 Remote Monitoring (plenumnet.replit.app)

| Monitoring Need | Method | Endpoint | Notes |
|----------------|--------|----------|-------|
| Cluster health | GET | `/api/salvi/inter-cube/relay/cluster-health` | Per-daemon status (live/registered/deployed), relay throughput (msgsSent, msgsDelivered, msgsQueued, msgPerSec), WebSocket peers, uptime |
| Relay status | GET | `/api/salvi/inter-cube/relay/status` | Connected WebSocket nodes, pending queue count |
| Relay heartbeat | GET | `/api/salvi/inter-cube/relay/heartbeat?address=...&publicKey=...` | Refresh registration lastSeen |
| Deployment records | GET | `/api/salvi/inter-cube/relay/deployments?hostname=...` | Deployment history |
| Version check | GET | `/health/crs` | CRS reference version — compare with local `/health` version field |
| Purge stale | GET/POST | `/api/salvi/inter-cube/relay/purge-stale?maxAge=300000` | Clean up stale registrations |

### 9.3 WebSocket Relay (wss://plenumnet.replit.app/ws/relay)

| Action | Message | Response |
|--------|---------|----------|
| Authenticate | `{"type":"auth","address":"...","publicKey":"..."}` | `{"type":"auth_ok","address":"...","connectedPeers":[...]}` |
| Keepalive (25s) | `{"type":"ping"}` | `{"type":"pong","ts":...}` |
| List peers | `{"type":"peers"}` | `{"type":"peers","connected":[...]}` |
| Send message | `{"type":"relay","to":"...","msgType":"...","payload":"..."}` | `{"type":"relay_ack","to":"...","delivered":true/false}` |

### 9.4 LLM Engine Monitoring — YODA's Responsibility

LLM engine monitoring is NOT provided by the daemon infrastructure. YODA launches and manages the LLM engines (llama-server, etc.) and knows which ports they run on:

| Agent | LLM Engine Port | Example Health Check |
|-------|----------------|---------------------|
| A | 8080 | `GET http://localhost:8080/health` |
| B | 8082 | `GET http://localhost:8082/health` |
| C | 8084 | `GET http://localhost:8084/health` |

YODA should poll these directly. The daemon deployer does not start or manage LLM engines — only the cube daemons.

---

*Violations of these invariants will be rejected. This document is the source of truth for any agent integrating with PlenumNET.*
