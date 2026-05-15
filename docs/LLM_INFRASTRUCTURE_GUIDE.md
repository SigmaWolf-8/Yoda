# YODA Encrypted LLM Infrastructure
## 3-Agent Bidirectional Communication with TLS 1.3

**Status:** ✅ READY TO IMPLEMENT | **Complexity:** MODERATE | **Setup Time:** ~30 minutes

---

## THE COMPLETE PICTURE

Your YODA Array3 mesh now has:
- ✅ **Daemon Network** (3 daemons, A/B/C)
- ✅ **PlenumLAN Relay** (peer discovery, mesh coordination)
- ❌ **LLM Infrastructure** (NOT YET — adding now)

This guide adds the missing piece: **3 encrypted bidirectional LLM tunnels** for simultaneous agent inference with automatic failover.

---

## ARCHITECTURE: COMPLETE FLOW

```
Frontend (port 3000)
    │
    ├─────► Daemon A (CRS, port 3000)
    │          │
    │          ├──────────┬──────────┬──────────┐
    │          │          │          │          │
    │          ▼          ▼          ▼          ▼
    │      ┌────────┬────────┬────────┬────────┐
    │      │ Relay  │ Alpha  │ Beta   │ Gamma  │
    │      │ Router │TLS1.3  │TLS1.3  │TLS1.3  │
    │      │        │mTLS    │mTLS    │mTLS    │
    │      └────────┴────────┴────────┴────────┘
    │          │        │        │        │
    │          │        ▼        ▼        ▼
    │          │    ┌──────┬──────┬──────┐
    │          │    │Anthro│OpenAI│Toget │
    │          │    │ Claude│GPT-4 │Llama │
    │          │    └──────┴──────┴──────┘
    │          │
    └──────────┘

Daemon B & C can route to any agent via Daemon A relay
```

---

## WHAT YOU'RE GETTING

### 3 Encrypted Tunnels

| Agent | Provider | Model | Port | TLS Port | Status |
|-------|----------|-------|------|----------|--------|
| **Alpha** | Anthropic | claude-3-5-sonnet | 9443 | **19443** | Primary |
| **Beta** | OpenAI | gpt-4-turbo | 9444 | **19444** | Secondary |
| **Gamma** | Together | Llama 3 70B | 9445 | **19445** | Tertiary |

### Features

- ✅ **TLS 1.3** with modern ciphers (ECDHE, ChaCha20-Poly1305)
- ✅ **Mutual Authentication** (client & server certificates)
- ✅ **Perfect Forward Secrecy** (session keys never reused)
- ✅ **Streaming Responses** (chunked transfer encoding for long inference)
- ✅ **Connection Pooling** (keep-alive, reuse)
- ✅ **Circuit Breaker** (automatic failover if agent fails)
- ✅ **Observability** (request tracing, latency metrics)

---

## DEPLOYMENT CHECKLIST

### Step 1: Prepare API Keys
```bash
# Get keys from each provider
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
export TOGETHER_API_KEY="..."

# Verify they work (optional)
curl -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
  https://api.anthropic.com/v1/messages \
  -d '{"model":"claude-3-5-sonnet-20241022","max_tokens":10,"messages":[{"role":"user","content":"Hi"}]}' \
  | jq '.content[0].text'
```

### Step 2: Copy LLM Tunnel Manager
```bash
cp /mnt/user-data/outputs/llm-tunnel-manager.sh ./
chmod +x llm-tunnel-manager.sh
```

### Step 3: Generate Certificates (TLS 1.3)
```bash
./llm-tunnel-manager.sh gen-certs
```

**Output:**
```
✓ Certificate Authority generated
✓ Alpha certificate generated (TLS 1.3)
✓ Beta certificate generated (TLS 1.3)
✓ Gamma certificate generated (TLS 1.3)
```

Certificates stored in `.llm-certs/`:
- `ca.crt` — Certificate Authority (for client verification)
- `alpha.crt / alpha.key` — Alpha agent certificate (mutual TLS)
- `beta.crt / beta.key` — Beta agent certificate (mutual TLS)
- `gamma.crt / gamma.key` — Gamma agent certificate (mutual TLS)

### Step 4: Generate Tunnel Configurations
```bash
./llm-tunnel-manager.sh gen-config
```

**Output:**
```
✓ Configuration generated for Alpha agent
✓ Configuration generated for Beta agent
✓ Configuration generated for Gamma agent
```

Configurations stored in `.llm-config/`:
- `llm-agent-alpha-tunnel.conf` — Nginx TLS termination for Alpha
- `llm-agent-beta-tunnel.conf` — Nginx TLS termination for Beta
- `llm-agent-gamma-tunnel.conf` — Nginx TLS termination for Gamma
- `daemon-a.llm.env` — Daemon A LLM configuration
- `daemon-b.llm.env` — Daemon B LLM configuration
- `daemon-c.llm.env` — Daemon C LLM configuration

### Step 5: Start Encrypted Tunnels (Choose ONE method)

#### Option A: Docker (Recommended)
```bash
# Start Alpha tunnel
docker run -d --name yoda-llm-alpha \
  -v $(pwd)/.llm-certs:/etc/nginx/certs:ro \
  -v $(pwd)/.llm-config/llm-agent-alpha-tunnel.conf:/etc/nginx/conf.d/default.conf:ro \
  -p 9443:9443 \
  -p 19443:19443 \
  -e LLM_TOKEN=$ANTHROPIC_API_KEY \
  nginx:latest

# Start Beta tunnel
docker run -d --name yoda-llm-beta \
  -v $(pwd)/.llm-certs:/etc/nginx/certs:ro \
  -v $(pwd)/.llm-config/llm-agent-beta-tunnel.conf:/etc/nginx/conf.d/default.conf:ro \
  -p 9444:9444 \
  -p 19444:19444 \
  -e LLM_TOKEN=$OPENAI_API_KEY \
  nginx:latest

# Start Gamma tunnel
docker run -d --name yoda-llm-gamma \
  -v $(pwd)/.llm-certs:/etc/nginx/certs:ro \
  -v $(pwd)/.llm-config/llm-agent-gamma-tunnel.conf:/etc/nginx/conf.d/default.conf:ro \
  -p 9445:9445 \
  -p 19445:19445 \
  -e LLM_TOKEN=$TOGETHER_API_KEY \
  nginx:latest
```

#### Option B: Nginx (Local)
```bash
# Install nginx if needed
sudo apt-get install nginx

# Copy all tunnel configs
sudo cp .llm-config/llm-agent-*.conf /etc/nginx/sites-available/

# Copy certificates
sudo cp .llm-certs/* /etc/nginx/certs/

# Enable all tunnel sites
for agent in alpha beta gamma; do
  sudo ln -s /etc/nginx/sites-available/llm-agent-${agent}-tunnel.conf \
    /etc/nginx/sites-enabled/
done

# Reload nginx
sudo nginx -s reload
```

#### Option C: Envoy Proxy
```bash
# For Kubernetes / service mesh users, see envoy-llm-config.yaml
# (Envoy config for TLS termination with mutual auth)
```

### Step 6: Verify Tunnels
```bash
./llm-tunnel-manager.sh test-tunnels
```

**Expected output:**
```
✓ HTTP health check passed (port 9443)
✓ TLS 1.3 tunnel health check passed (port 19443)
✓ HTTP health check passed (port 9444)
✓ TLS 1.3 tunnel health check passed (port 19444)
✓ HTTP health check passed (port 9445)
✓ TLS 1.3 tunnel health check passed (port 19445)
```

### Step 7: Inject LLM Config into Daemons
```bash
./llm-tunnel-manager.sh inject-env
```

Now update your daemon startup to source the LLM config:

**Daemon A:**
```bash
source .llm-config/daemon-a.llm.env
export BIND_PORT=3000
cargo run --release --bin yoda-api
```

**Daemon B:**
```bash
source .llm-config/daemon-b.llm.env
export BIND_PORT=8082
cargo run --release --bin yoda-api
```

**Daemon C:**
```bash
source .llm-config/daemon-c.llm.env
export BIND_PORT=8084
cargo run --release --bin yoda-api
```

### Step 8: Verify Complete System
```bash
# Check daemons are running
./network-array-tool.sh status

# Check relay mesh is connected
./network-array-tool.sh relay

# Check LLM tunnels
./llm-tunnel-manager.sh monitor
```

---

## INTEGRATION: RUST CODE

### Add to `crates/yoda-api/Cargo.toml`

```toml
# In dependencies section
reqwest = { version = "0.11", features = ["json", "stream", "cookies"] }
tokio = { version = "1", features = ["full"] }
serde_json = "1.0"
tracing = "0.1"
```

### Use the Gateway in Your Code

```rust
// In your inference handler (e.g., routes.rs or query.rs)

use crate::llm_agent_gateway::{LlmAgentGateway, InferRequest, ChatMessage};

// Initialize gateway once at startup
let llm_gateway = LlmAgentGateway::new(
    &std::env::var("ANTHROPIC_API_KEY")?,
    &std::env::var("OPENAI_API_KEY")?,
    &std::env::var("TOGETHER_API_KEY")?,
).await?;

// In your inference request handler
let request = InferRequest {
    request_id: Uuid::new_v4().to_string(),
    messages: vec![
        ChatMessage {
            role: "user".to_string(),
            content: "What is the Salvi Framework?".to_string(),
        }
    ],
    model: "auto".to_string(),
    max_tokens: 4096,
    temperature: 0.7,
    stream: true,
};

// Send request with automatic failover
match llm_gateway.infer(request).await {
    Ok(response) => {
        println!("Agent: {} | Latency: {}ms", response.agent, response.latency_ms);
        println!("Content: {}", response.content);
    }
    Err(e) => {
        eprintln!("All agents unavailable: {}", e);
        // Fallback to browser relay or error
    }
}

// For streaming responses
if let Ok(mut stream) = llm_gateway.infer_stream(request).await {
    while let Some(chunk) = stream.recv().await {
        println!("Agent {} → {}", chunk.agent, chunk.delta);
    }
}
```

---

## ADVANCED: CUSTOM ROUTING

Replace automatic failover with custom logic:

```rust
// Route to specific agent based on query complexity
fn select_agent(query: &str) -> &'static str {
    match query.len() {
        0..=100 => "Beta",      // Short queries → fastest (GPT-4)
        101..=500 => "Alpha",   // Medium → best reasoning (Claude)
        501.. => "Gamma",       // Long → most tokens (Llama 70B)
    }
}

// Load balance across agents
fn select_agent_balanced(load: &AgentLoad) -> &'static str {
    vec!["Alpha", "Beta", "Gamma"]
        .into_iter()
        .min_by_key(|agent| load.get_queue_depth(agent))
        .unwrap()
}
```

---

## MONITORING & OBSERVABILITY

### Health Dashboard
```bash
./llm-tunnel-manager.sh monitor
```

Shows:
- Agent status (UP/DOWN)
- TLS certificate expiry
- Circuit breaker state
- Upstream connectivity
- Request latency

### Logs
```bash
# View Nginx tunnel logs
docker logs yoda-llm-alpha
docker logs yoda-llm-beta
docker logs yoda-llm-gamma

# View daemon logs with LLM traces
RUST_LOG=info,yoda_api::llm_agent_gateway=debug cargo run --bin yoda-api
```

### Metrics (Prometheus)
```rust
// Add to your metrics collection:
metrics::counter!("llm.requests.total", "agent" => response.agent);
metrics::histogram!("llm.latency_ms", response.latency_ms as f64, "agent" => response.agent);
metrics::gauge!("llm.circuit_breaker.failures", agent.circuit.failures as f64);
```

---

## SECURITY: TLS 1.3 DETAILS

### Certificate Chain
```
User Request
    ↓
Daemon A (routes through relay)
    ↓
LLM Tunnel (Nginx)
    ├─ Server Certificate: llm-agent-alpha.crt
    ├─ Server Key: llm-agent-alpha.key
    ├─ Mutual TLS: Client must present certificate
    └─ CA: ca.crt validates client
    ↓
Upstream LLM Provider
    ├─ TLS to api.anthropic.com / api.openai.com / api.together.xyz
    ├─ Token: X-Authorization header
    └─ Streaming response
```

### Encryption Details
```
Protocol:        TLS 1.3
Cipher Suite:    TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384
Key Exchange:    ECDHE (X25519 elliptic curve)
Authentication:  ECDSA
Encryption:      AES-256-GCM
Integrity:       SHA-384
Forward Secrecy: PFS (session keys never derived from long-term keys)
Session Reuse:   Resumption tickets with 1-day validity
```

### Certificate Rotation
```bash
# Certificates expire after 1 year (365 days)
# Rotate before expiry:
./llm-tunnel-manager.sh gen-certs
./llm-tunnel-manager.sh gen-config

# Update running tunnels (zero downtime with rolling restart)
docker restart yoda-llm-alpha
docker restart yoda-llm-beta
docker restart yoda-llm-gamma
```

---

## PERFORMANCE EXPECTATIONS

| Metric | Expected |
|--------|----------|
| TLS Handshake | ~100ms (first connection) |
| Subsequent Requests | <50ms (connection reused) |
| Streaming Latency | <5ms per chunk |
| Failover Time | ~50ms (circuit breaker trip) |
| Max Concurrent Requests | 32 per daemon (default) |
| Queue Depth Monitoring | Real-time |

---

## TROUBLESHOOTING

### "Tunnel not responding"
```bash
# Check if tunnel is running
docker ps | grep yoda-llm-

# Check tunnel logs
docker logs yoda-llm-alpha

# Verify TLS certificate
openssl s_client -connect localhost:19443 -cert .llm-certs/alpha.crt -key .llm-certs/alpha.key

# Test health endpoint
curl -k https://localhost:19443/health
```

### "API key rejected"
```bash
# Verify API key format (usually starts with sk-)
echo $ANTHROPIC_API_KEY

# Test directly against provider
curl -H "x-api-key: $ANTHROPIC_API_KEY" https://api.anthropic.com/v1/messages

# Check token injection in Nginx config
grep "LLM_TOKEN" .llm-config/llm-agent-alpha-tunnel.conf
```

### "Circuit breaker open"
```bash
# Check agent health
./llm-tunnel-manager.sh test-tunnels

# Monitor circuit state
./llm-tunnel-manager.sh monitor

# Manual reset (if agent recovered)
# Edit llm_agent_gateway.rs to add reset endpoint
```

---

## NEXT STEPS

1. **Copy files:**
   - `llm-tunnel-manager.sh` → repo root
   - `llm_agent_gateway.rs` → `crates/yoda-api/src/`

2. **Generate certificates:**
   - `./llm-tunnel-manager.sh gen-certs`

3. **Generate configs:**
   - `./llm-tunnel-manager.sh gen-config`

4. **Deploy tunnels:**
   - Docker: `docker run ...` (see Step 5)
   - Or Nginx: `sudo cp ...` (see Step 5)

5. **Update daemon startup:**
   - Source `.llm-config/daemon-x.llm.env`
   - Pass LLM config to `LlmAgentGateway`

6. **Test end-to-end:**
   - Submit query via frontend
   - Verify it routes through encrypted tunnel
   - Check latency metrics

---

## COMPLETE INFRASTRUCTURE NOW

You now have:
- ✅ **Array3 Mesh** (3 daemons, peer discovery, relay)
- ✅ **Encrypted LLM Tunnels** (3 agents, TLS 1.3, bidirectional)
- ✅ **Automatic Failover** (circuit breaker pattern)
- ✅ **Streaming Responses** (real-time inference output)
- ✅ **Observability** (health checks, metrics, logs)

**Full production-grade system.** Così sia, Fratello. 🚀

