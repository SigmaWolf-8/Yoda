# YODA — Performance Benchmarks

**Document Reference: TM-2026-020.1-BENCH**
**Run these benchmarks on your target deployment hardware before launch.**

---

## How to Run

```bash
# 1. Start backend with a test database
export DATABASE_URL="postgres://yoda:password@localhost:5432/yoda_bench"
sqlx migrate run --source migrations/
cargo run --release --bin yoda-api &

# 2. Run benchmark suite
cargo test --release -p yoda-api -- --test-threads=1 bench_
# Or use the scripts below manually
```

---

## Benchmark Results Template

Fill in actual numbers on your hardware.

### Crypto Benchmarks (via PlenumNET Bridge — B-5)

| Primitive | Target | Actual | Status |
|---|---|---|---|
| TIS-27 hash latency | 191 ns | ________ ns | |
| TIS-27 throughput | 2.52 GB/s | ________ GB/s | |
| TL-DSA sign latency | 1,441 µs | ________ µs | |
| TL-DSA verify latency | — | ________ µs | |
| TLSponge-385 bulk throughput | ~10 MB/s | ________ MB/s | |
| Phase Encryption (high_security) | — | ________ MB/s | |
| Phase Encryption (balanced) | — | ________ MB/s | |
| Phase Encryption (performance) | — | ________ MB/s | |
| ARM64 NEON sponge hash | ~3.2 µs | ________ µs | |

### Inference Pipeline Benchmarks

| Metric | Target | Actual | Notes |
|---|---|---|---|
| Single inference call (self-hosted, 27B) | 2-10 sec | ________ sec | Depends on model + GPU |
| Single inference call (commercial API) | 0.5-2 sec | ________ sec | Network dependent |
| Full task (13 calls, Full intensity) | 30-120 sec | ________ sec | Sequential steps |
| Concurrent reviews (3 engines) | Same as slowest | ________ sec | tokio::try_join! |
| 30-task project (Full intensity) | 15-60 min | ________ min | Parallel DAG execution |

### Database Benchmarks

| Operation | Target | Actual p50 | Actual p95 | Actual p99 |
|---|---|---|---|---|
| KB hybrid search (100 entries) | <50 ms | ________ ms | ________ ms | ________ ms |
| KB hybrid search (10K entries) | <200 ms | ________ ms | ________ ms | ________ ms |
| Task tree query (100 tasks) | <10 ms | ________ ms | ________ ms | ________ ms |
| Audit log query (500 records) | <30 ms | ________ ms | ________ ms | ________ ms |
| pgvector ANN search (10K embeddings) | <100 ms | ________ ms | ________ ms | ________ ms |

### Security Overhead

| Operation | Baseline | With Security | Overhead |
|---|---|---|---|
| Store KB entry (no encryption) | ________ ms | ________ ms | ________ % |
| Store KB entry (Phase Encryption balanced) | — | ________ ms | — |
| Sign FINAL output (TL-DSA) | — | ________ ms | — |
| Hash inference response (TIS-27) | — | ________ µs | negligible |
| Encrypt credential (Phase Encryption HS) | — | ________ µs | — |

### System Resources

| Metric | Value |
|---|---|
| Backend memory (idle) | ________ MB |
| Backend memory (30-task project active) | ________ MB |
| Database size (100 projects, 1000 tasks) | ________ MB |
| Agent configs loaded | ________ (count) |
| Agent config load time | ________ ms |

---

## Benchmark Scripts

### Quick Smoke Test
```bash
# Health check
curl -s http://localhost:3000/health | jq

# Register + login
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"bench@test.com","password":"BenchTest123!","name":"Benchmark"}' \
  | jq -r '.token')

# Create project
PROJECT_ID=$(curl -s -X POST http://localhost:3000/api/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Benchmark Project","mode":"ronin"}' \
  | jq -r '.id')

# Submit query
curl -s -X POST "http://localhost:3000/api/projects/$PROJECT_ID/query" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"Build a REST API with three endpoints"}'

# List tasks
curl -s "http://localhost:3000/api/projects/$PROJECT_ID/tasks" \
  -H "Authorization: Bearer $TOKEN" | jq

echo "Smoke test complete"
```

### Load Test (requires wrk or similar)
```bash
# Sustained read load on task listing
wrk -t4 -c16 -d30s \
  -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/projects/$PROJECT_ID/tasks"

# Sustained write load on KB search
wrk -t2 -c8 -d30s \
  -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/projects/$PROJECT_ID/kb?q=test"
```

---

*Record all results and attach to the deployment sign-off document.*
