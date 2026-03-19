# YODA — Developer's Front-End Intelligence Platform

**Capomastro Holdings Ltd. — Applied Physics Division**

Recursive multi-agent, multi-engine development intelligence platform with adversarial refinement.

## Repository Structure

```
yoda/
├── docs/
│   └── api-contract.md            ← Shared API contract (frontend ↔ backend)
├── frontend/                      ← React SPA (Task List A — complete)
│   ├── src/
│   ├── package.json
│   └── vite.config.ts
├── crates/                        ← Rust/Axum backend (Task List B)
│   ├── yoda-orchestrator/
│   ├── yoda-inference-router/
│   ├── yoda-knowledge-base/
│   ├── yoda-task-bible/
│   ├── yoda-api/
│   └── yoda-plenumnet-bridge/
├── tools/
│   └── yoda-agent-compiler/       ← Build-time CLI: MD → JSON agent compiler
├── agents/
│   ├── upstream/                  ← Forked agency-agents (MIT)
│   ├── capomastro/                ← Proprietary agents
│   └── compiled/                  ← Output of agent compiler (gitignored)
├── scripts/
│   ├── sync-upstream.sh
│   ├── compile-agents.sh
│   └── deploy.sh
├── Cargo.toml                     ← Rust workspace root
├── LICENSE-MIT                    ← For forked agent definitions
└── LICENSE-PROPRIETARY            ← For Capomastro-authored code
```

## Frontend (Task List A)

```bash
cd frontend
npm install
npm run dev        # Dev server on :5173 with proxy to backend
npm run build      # Production build → dist/
```

The frontend calls the Axum backend via `/api` endpoints defined in `docs/api-contract.md`.
When the backend is not running, the UI displays loading and error states gracefully.
When the backend goes live, real data flows immediately — no fake data, no simulations.

## Backend (Task List B)

```bash
cargo build --workspace
cargo run --bin yoda-api
```

See `docs/api-contract.md` for the complete endpoint specification.

## Documentation

- **TM-2026-020.1** — YODA Product Specification v1.5
- **TM-2026-020.2** — PlenumNET Inference Deployment Guide
- **docs/api-contract.md** — API Contract (frontend ↔ backend)

---

*Capomastro Holdings Ltd. — Applied Physics Division*
*Sherwood Park, Alberta, Canada*
*RSalvi@Salvigroup.com*

*Così sia, Fratello.*
