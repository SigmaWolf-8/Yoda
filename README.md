# YODA — Developer's Front-End Intelligence Platform

**Capomastro Holdings Ltd. — Applied Physics Division**

Recursive multi-agent, multi-engine development intelligence platform.
Every task passes through a mandatory four-step adversarial refinement protocol:
three review cycles where three separate AI engines independently evaluate,
critique, and enrich the output, followed by a final production step
incorporating all improvements.

## Modes

- **Yoda** (The Counselor) — Research, analysis, strategic reports
- **Yoda Ronin** (The Warrior) — Same workflow + ordered AI implementation
  instructions + production-tested code blocks

## Architecture

- **Backend:** Rust / Axum / PostgreSQL (sqlx compile-time checked)
- **Frontend:** React + TypeScript + Vite + Tailwind CSS
- **Crypto:** PlenumNET (Phase Encryption, TLSponge-385, TIS-27, TL-DSA, TL-KEM)
- **Inference:** Engine-agnostic — self-hosted (llama.cpp), commercial API, or free-tier
- **Agents:** 147+ roles from agency-agents (MIT) + Capomastro proprietary

## Repository Structure

```
yoda/
├── Cargo.toml                     ← Rust workspace root
├── crates/
│   ├── yoda-orchestrator/         ← DAG engine, task state machine, assembly
│   ├── yoda-inference-router/     ← engine-agnostic async HTTP clients
│   ├── yoda-knowledge-base/       ← storage rules, indexing, retrieval
│   ├── yoda-task-bible/           ← Task Bible CRUD, code block nesting
│   ├── yoda-api/                  ← Axum routes, WebSocket, auth middleware
│   └── yoda-plenumnet-bridge/     ← TIS-27, TL-DSA, Phase Encryption, tunnels
├── tools/
│   └── yoda-agent-compiler/       ← BUILD-TIME CLI: MD → JSON agent compiler
├── frontend/                      ← React SPA (Vite + TypeScript + Tailwind)
├── agents/
│   ├── upstream/                  ← Forked agency-agents (MIT, read-only sync)
│   ├── capomastro/                ← Proprietary Capomastro agents
│   └── compiled/                  ← Output of yoda-agent-compiler (gitignored)
└── scripts/
    ├── sync-upstream.sh
    ├── compile-agents.sh
    └── deploy.sh
```

## Quick Start

```bash
# Build everything
cargo build --workspace

# Compile agents (build-time, run after agent changes)
./scripts/compile-agents.sh

# Run the backend
cargo run --bin yoda-api

# Frontend (development)
cd frontend && npm run dev
```

## Licenses

- `agents/upstream/` — MIT License (see LICENSE-MIT)
- All other code — Proprietary (see LICENSE-PROPRIETARY)
- PlenumNET primitives — Capomastro Holdings Ltd.

## Documentation

- TM-2026-020.1 — YODA Product Specification v1.5
- TM-2026-020.2 — PlenumNET Inference Deployment Guide

---

*Capomastro Holdings Ltd. — Applied Physics Division*
*Sherwood Park, Alberta, Canada*
*RSalvi@Salvigroup.com*
