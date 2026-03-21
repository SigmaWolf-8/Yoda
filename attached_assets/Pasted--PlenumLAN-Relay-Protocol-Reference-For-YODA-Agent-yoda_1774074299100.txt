# PlenumLAN Relay Protocol Reference

**For: YODA Agent (yoda.replit.app)**
**CRS Authority: plenumnet.replit.app**

---

## Network Overview

PlenumLAN is a 2-node network. The CRS runs on Replit and provides both a registration API and a WebSocket relay. Cube nodes (like the YODA laptop) register over HTTPS, then open a persistent WebSocket for message passing. No port forwarding or public IP required.

| Node | Role | Address | Endpoint |
|------|------|---------|----------|
| CRS (Replit) | Registry + Relay | `1111111111111` | `https://plenumnet.replit.app` |
| YODA (Laptop) | Cube + LLM host | `1111111111112` | localhost only |

Addresses are 13-trit ternary. Flat: `1111111111112`. Dotted: `111.111.111.111.2`. Both are accepted everywhere.

---

## Step 1: Register with CRS

```
GET https://plenumnet.replit.app/api/salvi/inter-cube/relay/register
    ?publicKey=<hex-encoded-public-key>
    &endpoint=<self-description, e.g. "ws-relay" or "192.168.1.5:8081">
```

**Response (200):**
```json
{
  "address": "1111111111112",
  "addressDotted": "111.111.111.111.2",
  "endpoint": "ws-relay",
  "neighbors": [...],
  "registeredNeighbors": 0,
  "totalNeighbors": 26
}
```

Save the returned `address` — it is your identity on the network.

---

## Step 2: Connect WebSocket

```
wss://plenumnet.replit.app/ws/relay
```

### Authenticate (must be first message, within 10 seconds)

**Send:**
```json
{ "type": "auth", "address": "1111111111112", "publicKey": "<same key used in registration>" }
```

**Receive on success:**
```json
{ "type": "auth_ok", "address": "1111111111112", "connectedPeers": ["1111111111111"] }
```

**Receive on failure:**
```json
{ "type": "auth_fail", "error": "address not registered or publicKey mismatch" }
```

If no auth message is received within 10 seconds, the server closes the socket.

---

## Step 3: Relay Messages

After authentication, you can send messages to any other connected node.

### Send a message

**Send:**
```json
{
  "type": "relay",
  "to": "1111111111111",
  "msgType": "inference_request",
  "payload": "<string — typically JSON-stringified data>"
}
```

**Receive acknowledgment:**
```json
{ "type": "relay_ack", "to": "1111111111111", "delivered": true }
```

`delivered: true` means the target was connected and received it immediately.
`delivered: false` means the target is offline — the message is queued (up to 100 per destination) and delivered when they reconnect.

### Receive a message

When another node sends you a relay message, you receive:
```json
{
  "type": "relay",
  "from": "1111111111111",
  "msgType": "inference_request",
  "payload": "<the sender's payload string>"
}
```

---

## Keepalive

Send periodically (every 25s recommended):

**Send:** `{ "type": "ping" }`
**Receive:** `{ "type": "pong", "ts": 1742505600000 }`

---

## Peer List

**Send:** `{ "type": "peers" }`
**Receive:** `{ "type": "peers", "connected": ["1111111111111", "1111111111112"] }`

---

## Valid Message Types (post-auth)

| Type | Direction | Purpose |
|------|-----------|---------|
| `relay` | send/receive | Route a message to another node |
| `ping` | send | Keepalive |
| `pong` | receive | Keepalive response |
| `peers` | send | Request connected peer list |
| `relay_ack` | receive | Delivery confirmation for relay |

---

## HTTP Status Endpoints

| Endpoint | Method | Returns |
|----------|--------|---------|
| `/api/salvi/inter-cube/relay/status` | GET | Connected nodes, pending queues |
| `/api/salvi/inter-cube/relay/register` | GET | Register a new node |
| `/api/salvi/inter-cube/relay/heartbeat` | GET | Refresh registration (`?address=...`) |
| `/health/crs` | GET | CRS daemon health |

---

## Cube Daemon Local API (on the laptop, port 8081)

YODA talks to the local cube daemon over HTTP on localhost.

| Endpoint | Method | Returns |
|----------|--------|---------|
| `/api/salvi/inter-cube/node/info` | GET | Node address, mode, CRS URL, ports |
| `/health` | GET | Daemon health status |
| `/api/salvi/inter-cube/topology` | GET | 13D hypercube topology |
| `/api/salvi/inter-cube/fts/status` | GET | Fault tolerance: up/suspect/down/recovering |
| `/api/salvi/inter-cube/glb/stats` | GET | Geometric Load Balancer stats |
| `/api/salvi/inter-cube/con/stats` | GET | Cube Overlay Network stats |

### GET /api/salvi/inter-cube/node/info

```json
{
  "address": "1111111111112",
  "addressDotted": "111.111.111.111.2",
  "mode": "cube",
  "crsUrl": "https://plenumnet.replit.app",
  "ports": { "engine": "8080", "node": "8081" }
}
```

---

## LLM Inference (via llama-server on the laptop, port 8080)

The LLM engine runs on the same machine as the cube daemon, on a separate port.

### Direct local call

```
POST http://localhost:8080/v1/chat/completions
Content-Type: application/json

{
  "model": "deepseek-r1",
  "messages": [{ "role": "user", "content": "What is PlenumNET?" }],
  "temperature": 0.7,
  "max_tokens": 512
}
```

### Remote call via relay

YODA (on Replit) cannot call localhost:8080 directly. Instead, it sends an inference request through the relay to the cube node. The cube node's daemon receives the relay message, calls llama-server locally, and relays the response back.

**This requires the cube daemon to handle `msgType: "inference_request"` in its relay message handler.** This is the next integration step — the ws_relay.rs `incoming_rx` channel delivers these messages, but the daemon does not yet dispatch them to llama-server.

**Proposed envelope for inference via relay:**

YODA → CRS → Cube:
```json
{
  "type": "relay",
  "to": "1111111111112",
  "msgType": "inference_request",
  "payload": "{\"requestId\":\"abc-123\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}],\"maxTokens\":512}"
}
```

Cube → CRS → YODA:
```json
{
  "type": "relay",
  "to": "<yoda-address>",
  "msgType": "inference_response",
  "payload": "{\"requestId\":\"abc-123\",\"content\":\"Hello! I am running on PlenumLAN...\",\"model\":\"deepseek-r1\",\"tokens\":42}"
}
```

---

## Multi-Agent Addressing

Each agent gets unique ports: Agent N uses engine port `8080 + 2N` and node port `8081 + 2N`. Each agent has its own ternary address. The relay routes by ternary address, not by port.

| Agent | Engine Port | Node Port | Address (assigned by CRS) |
|-------|------------|-----------|---------------------------|
| Agent 0 | 8080 | 8081 | `1111111111112` |
| Agent 1 | 8082 | 8083 | `1111111111113` |
| Agent 2 | 8084 | 8085 | `1111111111121` |

---

## Reconnection

The Rust daemon's ws_relay.rs implements exponential backoff reconnection (2s → 4s → 8s → ... → 60s cap). On reconnect, it re-authenticates with the same address and public key. Queued messages are delivered immediately on reconnection.
