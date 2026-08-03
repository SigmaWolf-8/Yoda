# YODA — Local Install & Desktop App

Run YODA entirely on your own machine: the Axum backend, the React frontend,
PostgreSQL in Docker, and — optionally — a native desktop window that wraps all
of it.

Two ways to run:

| | Command | What you get |
|---|---|---|
| **Web** | `cargo run --bin yoda-api` + `npm run dev` | YODA in your browser at `http://localhost:5173` |
| **Desktop** | `cd tauri && cargo tauri dev` | A native window; the backend starts and stops with it |

The fast path:

```bash
git clone https://github.com/SigmaWolf-8/Yoda.git yoda
cd yoda
bash scripts/local-setup.sh
```

`local-setup.sh` checks every prerequisite, writes a `.env.local` with freshly
generated secrets, starts PostgreSQL, installs frontend dependencies and
compiles the agent roster. It never installs a toolchain for you — anything
missing is reported with the exact command to fix it. Use
`bash scripts/local-setup.sh --check` to verify prerequisites without changing
anything.

On Windows, run the script under Git Bash or WSL, or follow
[Manual setup](#manual-setup) below.

---

## 1. Prerequisites

| Tool | Version | Needed for | Install |
|---|---|---|---|
| Rust | 1.77.2+ (stable) | Backend and desktop shell | <https://rustup.rs> |
| Node.js | 20+ | Frontend build | <https://nodejs.org> |
| npm | ships with Node | Frontend build | — |
| Docker | 24+ | Local PostgreSQL | <https://docs.docker.com/get-docker/> |
| Tauri CLI | v2 | Desktop app only | `cargo install tauri-cli --version '^2.0.0' --locked` |

`npm` is the supported package manager for `frontend/` — `package-lock.json` is
the committed lockfile. A `pnpm-lock.yaml` also exists in the tree; ignore it
unless you know why you want it.

Docker is optional if you already run **PostgreSQL 16 with the pgvector
extension**. Point `DATABASE_URL` at it and skip the Docker steps.

### Platform Tauri dependencies

Only needed for the desktop app. The upstream reference is
<https://tauri.app/start/prerequisites/>.

**Linux (Debian / Ubuntu):**

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev \
  libayatana-appindicator3-dev librsvg2-dev patchelf \
  build-essential curl wget file
```

Fedora: `webkit2gtk4.1-devel gtk3-devel libsoup3-devel libappindicator-gtk3-devel librsvg2-devel patchelf`.
Arch: `webkit2gtk-4.1 gtk3 libsoup3 libappindicator-gtk3 librsvg patchelf base-devel`.

**macOS:**

```bash
xcode-select --install
```

**Windows:**

* [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
  with the *Desktop development with C++* workload.
* [WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/)
  (already present on Windows 11 and up-to-date Windows 10).

---

## 2. Environment

```bash
cp .env.local.example .env.local
openssl rand -hex 32   # → JWT_SECRET
openssl rand -hex 32   # → JWT_REFRESH_SECRET
```

`.env.local` is gitignored. Its defaults match the Docker Compose database, so
`DATABASE_URL` needs no edit. Only the two `CHANGE_ME` secrets do.

Key variables:

| Variable | Local default | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://yoda:yoda_secret@localhost:5432/yoda` | Matches `docker-compose.yml` |
| `BIND_ADDR` | `127.0.0.1` | Loopback for desktop; containers use `0.0.0.0` |
| `BIND_PORT` | `3000` | Change it and rebuild the frontend (see [below](#changing-the-backend-port)) |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | *(generated)* | Must differ from each other |
| `AGENTS_COMPILED_PATH` | `./agents/compiled` | The packaged app overrides this with its bundled copy |

The backend does **not** read `.env.local` on its own. Export it first:

```bash
set -a; . ./.env.local; set +a
```

The Tauri shell *does* read it — see [How the desktop app is
wired](#how-the-desktop-app-is-wired).

---

## 3. PostgreSQL

```bash
docker compose --profile db up -d      # database only, no image build
docker compose logs -f postgres        # watch it come up
docker compose down                    # stop it
```

`docker-compose.yml` carries two profiles:

* **`db`** (or no profile at all) — PostgreSQL only. What you want for local
  development, since the backend runs natively.
* **`full`** — backend *and* database in containers:
  `docker compose --profile full up -d`. This builds the Rust image, which
  takes several minutes.

`docker-compose.local.yml` is an optional laptop-friendly override — a
predictable container name, no restart-on-boot, slow-query logging, and a
configurable host port:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d

# already using 5432 for something else?
POSTGRES_HOST_PORT=55432 \
  docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
```

Migrations run automatically when `yoda-api` starts — there is no separate
migration step.

---

## 4. Run it — web

Two terminals:

```bash
# terminal 1 — backend on :3000
set -a; . ./.env.local; set +a
cargo run --bin yoda-api

# terminal 2 — frontend on :5173
cd frontend
npm ci        # first time only
npm run dev
```

Open <http://localhost:5173>. Vite proxies `/api` and `/ws` to
`http://localhost:3000`, so the SPA talks to the backend same-origin.

The first `cargo run` compiles the whole workspace and takes a while.

---

## 5. Run it — desktop

```bash
cargo install tauri-cli --version '^2.0.0' --locked   # once
cd tauri
cargo tauri dev
```

A window opens with the React UI. Before it does, Tauri runs
`node scripts/build-sidecar.mjs` (compiles `yoda-api`, stages it as a sidecar)
and starts the Vite dev server. Backend logs are prefixed `[yoda-api]` in the
terminal you launched from.

Front-end edits hot-reload. Changes to `tauri/src/` restart the window; changes
to `crates/` need `cargo tauri dev` restarting so the sidecar is rebuilt.

### Build an installer

```bash
cd tauri
cargo tauri build
```

Output lands in `tauri/target/release/bundle/`:

| Platform | Artifact |
|---|---|
| macOS | `dmg/YODA_0.1.0_<arch>.dmg`, `macos/YODA.app` |
| Windows | `nsis/YODA_0.1.0_x64-setup.exe`, `msi/YODA_0.1.0_x64_en-US.msi` |
| Linux | `appimage/YODA_0.1.0_amd64.AppImage`, `deb/`, `rpm/` |

Tauri only bundles for the platform you are building on — no cross-compiling.

**The installer is unsigned.** `tauri.conf.json` ships placeholder signing
config (`macOS.signingIdentity: null`, `windows.certificateThumbprint: null`);
supply your own certificates to produce a distributable build. Unsigned
artifacts trigger Gatekeeper on macOS and SmartScreen on Windows.

**The installed app still needs PostgreSQL.** The bundle carries the backend,
the frontend and the agent roster — it does not carry a database. The machine
running it needs PostgreSQL 16 + pgvector reachable at the `DATABASE_URL` in
its `.env.local`.

---

## How the desktop app is wired

```
┌──────────────────── Tauri window (com.capomastro.yoda) ────────────────────┐
│                                                                            │
│   WebView                              tauri/src/lib.rs                    │
│   ├── dev  → http://localhost:5173     ├── setup:  spawn yoda-api sidecar  │
│   └── prod → bundled frontend/dist     └── exit:   kill it                 │
│                    │                                    │                  │
└────────────────────┼────────────────────────────────────┼──────────────────┘
                     │  HTTP /api + WS /ws                │  stdout/stderr
                     ▼                                    ▼
              yoda-api sidecar  ──────────────────►  your terminal
              127.0.0.1:3000
                     │
                     ▼
              PostgreSQL (Docker) localhost:5432
```

* **`tauri/tauri.conf.json`** — `devUrl` is the Vite dev server;
  `frontendDist` is `../frontend/dist` for production. `bundle.externalBin`
  declares the `yoda-api` sidecar.
* **`tauri/src/lib.rs`** — spawns the sidecar in `setup`, forwards its output,
  and kills it on `Exit`. A failed spawn is logged but does not block the
  window from opening, so you see the UI's error state rather than nothing.
* **Environment** — the shell reads `.env.local`, then `.env`, searching the
  working directory, the executable's ancestors, and the platform config dir
  (`~/.config/com.capomastro.yoda` on Linux,
  `~/Library/Application Support/com.capomastro.yoda` on macOS,
  `%APPDATA%\com.capomastro.yoda` on Windows). Real environment variables win
  over file values; anything still unset falls back to the Compose defaults.
  To reconfigure an *installed* app, drop a `.env.local` in that config dir.
* **`scripts/build-sidecar.mjs`** — compiles the backend, copies it to
  `tauri/binaries/yoda-api-<target-triple>` (the name Tauri requires), and
  stages `agents/compiled/` plus `model_lineages.json` in `tauri/resources/`.
* **`scripts/build-frontend.mjs`** — production frontend build with
  `VITE_API_BASE_URL=http://127.0.0.1:3000/api`. Required: a packaged app is
  served from `tauri://localhost`, where a relative `/api` would hit the asset
  protocol instead of the backend.

### Changing the backend port

`BIND_PORT` is baked into the packaged frontend at build time. To move off
3000, set it in **both** places:

```bash
# .env.local
BIND_PORT=3100

# and when building
BIND_PORT=3100 cargo tauri build
```

`scripts/build-frontend.mjs` and `frontend/vite.config.ts` both read
`BIND_PORT`, so the proxy target and the baked-in API base stay in step.

---

## Manual setup

If you cannot run `scripts/local-setup.sh`:

```bash
cp .env.local.example .env.local          # then edit both CHANGE_ME secrets
docker compose --profile db up -d         # PostgreSQL
cd frontend && npm ci && cd ..            # frontend deps
bash scripts/compile-agents.sh            # agent roster
```

On Windows without bash, replace the last line with:

```powershell
cargo run --release --manifest-path tools/yoda-agent-compiler/Cargo.toml -- `
  --upstream agents/upstream --custom agents/capomastro --output agents/compiled
```

---

## Troubleshooting

**`error: failed to run custom build command for 'yoda-desktop'`**
Missing platform WebKit/GTK headers. Install the packages from
[Platform Tauri dependencies](#platform-tauri-dependencies) and rerun.

**Window opens blank**
Vite is not on 5173. `strictPort: true` makes it fail loudly rather than
silently move ports — check the terminal for the real error. If a stale
process holds the port: `lsof -ti:5173 | xargs kill`.

**UI loads but every request fails**
The sidecar died. Look for `[yoda-api] exited` in the terminal. Usual causes:

* PostgreSQL is not running → `docker compose --profile db up -d`
* Port 3000 is already taken → free it, or see
  [Changing the backend port](#changing-the-backend-port)
* `DATABASE_URL` is wrong → check `.env.local`

**`sidecar 'yoda-api' not found in the bundle`**
`tauri/binaries/yoda-api-<triple>` is missing. Run
`node scripts/build-sidecar.mjs` from the repo root.

**`role "yoda" does not exist` / `database "yoda" does not exist`**
The Postgres volume was created with different credentials. Wipe it:
`docker compose down -v && docker compose --profile db up -d`. **This deletes
all local data.**

**`0 agents` in the UI**
The roster never compiled. Run `bash scripts/compile-agents.sh` and restart the
backend.

**Docker Compose builds the whole Rust image on `up`**
You are on the `full` profile. Use `--profile db` for the database alone.

---

## Related documentation

* [`README.md`](README.md) — project overview
* [`.env.example`](.env.example) — full variable reference (Replit / server)
* [`docs/local-llm-windows.md`](docs/local-llm-windows.md) — running a local
  inference engine
* [`docs/00_START_HERE.md`](docs/00_START_HERE.md) — architecture

---

Copyright (c) 2026 Capomastro Holdings Ltd. — Applied Physics Division
