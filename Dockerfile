# YODA Production Dockerfile
#
# Multi-stage build: compile Rust backend + build React frontend
# in builder stages, then copy only the artifacts to a slim runtime image.
#
# Usage:
#   docker build -t yoda:latest .
#   docker run -p 3000:3000 --env-file .env yoda:latest

# ═══════════════════════════════════════════════════════════════════════
# Stage 1: Build Rust backend
# ═══════════════════════════════════════════════════════════════════════
FROM rust:1.83-slim-bookworm AS backend-builder

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY Cargo.toml Cargo.lock* ./
COPY crates/ crates/
COPY tools/ tools/

# Build release binary
RUN cargo build --release --bin yoda-api

# ═══════════════════════════════════════════════════════════════════════
# Stage 2: Build React frontend
# ═══════════════════════════════════════════════════════════════════════
FROM node:20-slim AS frontend-builder

WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --production=false

COPY frontend/ ./
RUN npm run build

# ═══════════════════════════════════════════════════════════════════════
# Stage 3: Compile agents (build-time)
# ═══════════════════════════════════════════════════════════════════════
FROM rust:1.83-slim-bookworm AS agent-compiler

WORKDIR /build
COPY Cargo.toml Cargo.lock* ./
COPY crates/ crates/
COPY tools/ tools/
COPY agents/ agents/

RUN cargo build --release --bin yoda-agent-compiler
RUN mkdir -p agents/compiled && \
    ./target/release/yoda-agent-compiler \
      --upstream agents/upstream/ \
      --custom agents/capomastro/ \
      --output agents/compiled/ \
      --skip-license-audit

# ═══════════════════════════════════════════════════════════════════════
# Stage 4: Runtime image
# ═══════════════════════════════════════════════════════════════════════
FROM debian:bookworm-slim AS runtime

RUN apt-get update && \
    apt-get install -y ca-certificates libssl3 && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -s /bin/bash yoda
USER yoda
WORKDIR /app

# Copy artifacts from builder stages
COPY --from=backend-builder /build/target/release/yoda-api ./yoda-api
COPY --from=frontend-builder /build/frontend/dist ./frontend/dist
COPY --from=agent-compiler /build/agents/compiled ./agents/compiled
COPY model_lineages.json ./
COPY migrations/ ./migrations/

# Environment defaults
ENV BIND_ADDR=0.0.0.0
ENV BIND_PORT=3000
ENV AGENTS_COMPILED_PATH=./agents/compiled
ENV MODEL_LINEAGES_PATH=./model_lineages.json
ENV RUST_LOG=info

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

CMD ["./yoda-api"]
