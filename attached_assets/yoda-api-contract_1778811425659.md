# YODA — API Contract

**Document Reference: TM-2026-020.1-API**
**Version: 1.0**
**Date: March 19, 2026**

Shared source of truth for frontend (Task List A) and backend (Task List B).
Every endpoint, its HTTP method, URL, request body, response body, and error
format are defined here. Both the React hooks and Axum routes implement
against this document.

---

## Conventions

- **Base URL:** `/api` (frontend proxied via Vite dev server or same-origin in production)
- **Auth:** All endpoints except `/api/auth/*` and `GET /health` require `Authorization: Bearer <JWT>` header. API keys accepted via `X-API-Key: <key>` header as alternative auth.
- **Content-Type:** `application/json` for all request and response bodies.
- **IDs:** UUID v4 strings.
- **Timestamps:** ISO 8601 with timezone (`2026-03-19T14:22:00Z`).
- **Pagination:** Not in MVP. Lists return all results. Pagination added when needed.

### Error Format (all endpoints)

```json
{
  "error": "Human-readable message",
  "code": "ERROR_CODE",
  "details": {}
}
```

| Status | Code | Meaning |
|--------|------|---------|
| 400 | `BAD_REQUEST` | Malformed request body or params |
| 401 | `UNAUTHORIZED` | Missing, invalid, or expired token |
| 403 | `FORBIDDEN` | Valid token but insufficient permissions |
| 404 | `NOT_FOUND` | Resource does not exist |
| 409 | `CONFLICT` | Duplicate resource (e.g., email already registered) |
| 422 | `VALIDATION_ERROR` | Request parsed but failed validation |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Server error |

---

## 1. Auth Endpoints

### POST /api/auth/register

Create a new user account. Auto-creates a default organization.

**Request:**
```json
{
  "email": "user@company.com",
  "password": "securepassword123",
  "name": "Jane Doe"
}
```

**Response (201):**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@company.com",
    "name": "Jane Doe",
    "created_at": "2026-03-19T14:22:00Z"
  },
  "token": "jwt-access-token",
  "refresh_token": "jwt-refresh-token"
}
```

**Errors:** 409 if email exists, 422 if password < 8 chars.

---

### POST /api/auth/login

**Request:**
```json
{
  "email": "user@company.com",
  "password": "securepassword123"
}
```

**Response (200):**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@company.com",
    "name": "Jane Doe",
    "created_at": "2026-03-19T14:22:00Z"
  },
  "token": "jwt-access-token",
  "refresh_token": "jwt-refresh-token"
}
```

**Errors:** 401 if invalid credentials.

---

### POST /api/auth/refresh

Exchange a refresh token for a new access + refresh token pair. Old refresh token is invalidated (rotation).

**Request:**
```json
{
  "refresh_token": "jwt-refresh-token"
}
```

**Response (200):**
```json
{
  "token": "new-jwt-access-token",
  "refresh_token": "new-jwt-refresh-token"
}
```

**Errors:** 401 if refresh token invalid or expired.

---

### POST /api/auth/logout

Invalidate the current session. No request body required.

**Response:** 204 No Content

---

## 2. Organization Endpoints

### POST /api/orgs

Create a new organization. Creator becomes owner.

**Request:**
```json
{
  "name": "Capomastro Holdings"
}
```

**Response (201):**
```json
{
  "org": {
    "id": "uuid",
    "name": "Capomastro Holdings",
    "created_at": "2026-03-19T14:22:00Z"
  }
}
```

---

### GET /api/orgs

List organizations the current user belongs to.

**Response (200):**
```json
{
  "orgs": [
    {
      "id": "uuid",
      "name": "Capomastro Holdings",
      "role": "owner",
      "created_at": "2026-03-19T14:22:00Z"
    }
  ]
}
```

---

### POST /api/orgs/:id/invite

Invite a user to the organization. Requires owner or admin role.

**Request:**
```json
{
  "email": "teammate@company.com",
  "role": "member"
}
```

**Response (201):**
```json
{
  "invitation": {
    "email": "teammate@company.com",
    "role": "member",
    "org_id": "uuid",
    "created_at": "2026-03-19T14:22:00Z"
  }
}
```

**Errors:** 403 if not owner/admin, 409 if already a member.

---

### PUT /api/orgs/:id/members/:user_id

Change a member's role. Requires owner role.

**Request:**
```json
{
  "role": "admin"
}
```

**Response (200):**
```json
{
  "member": {
    "user_id": "uuid",
    "org_id": "uuid",
    "role": "admin"
  }
}
```

**Errors:** 403 if not owner, 404 if member not found.

---

## 3. Project Endpoints

All project endpoints are scoped to the user's current organization.

### POST /api/projects

**Request:**
```json
{
  "name": "Document Signing API",
  "mode": "ronin",
  "org_id": "uuid"
}
```

**Response (201):**
```json
{
  "project": {
    "id": "uuid",
    "name": "Document Signing API",
    "mode": "ronin",
    "org_id": "uuid",
    "settings": {
      "review_intensity": "full",
      "decomposition_budget": 30
    },
    "created_at": "2026-03-19T14:22:00Z",
    "updated_at": "2026-03-19T14:22:00Z"
  }
}
```

---

### GET /api/projects?org_id=uuid

List projects for an organization.

**Response (200):**
```json
{
  "projects": [
    {
      "id": "uuid",
      "name": "Document Signing API",
      "mode": "ronin",
      "org_id": "uuid",
      "settings": {},
      "created_at": "2026-03-19T14:22:00Z",
      "updated_at": "2026-03-19T14:22:00Z"
    }
  ]
}
```

---

### GET /api/projects/:id

Get a single project with full settings.

**Response (200):**
```json
{
  "project": {
    "id": "uuid",
    "name": "Document Signing API",
    "mode": "ronin",
    "org_id": "uuid",
    "settings": {
      "review_intensity": "full",
      "decomposition_budget": 30
    },
    "created_at": "2026-03-19T14:22:00Z",
    "updated_at": "2026-03-19T14:22:00Z"
  }
}
```

---

### PUT /api/projects/:id

**Request:**
```json
{
  "name": "Updated Name",
  "mode": "yoda",
  "settings": {
    "review_intensity": "medium",
    "decomposition_budget": 50
  }
}
```

**Response (200):** Same shape as GET.

---

### DELETE /api/projects/:id

**Response:** 204 No Content

---

## 4. Query Endpoints

### POST /api/projects/:id/query

Submit a new query. The backend decomposes it and returns either a single task (simple query) or a proposed task tree (complex query requiring approval if budget exceeded).

**Request:**
```json
{
  "text": "Build a REST API with three endpoints: create document, sign document, verify signature",
  "mode": "ronin"
}
```

**Response (200) — direct execution (within budget):**
```json
{
  "status": "executing",
  "task_ids": ["uuid", "uuid", "uuid"],
  "task_count": 12
}
```

**Response (200) — budget exceeded, needs approval:**
```json
{
  "status": "pending_approval",
  "task_tree": {
    "root": "Build REST API",
    "tasks": [
      {
        "task_number": "1.1.1.1",
        "title": "Implement create document endpoint",
        "competencies": ["backend-architect"],
        "dependencies": []
      }
    ],
    "total_tasks": 42,
    "budget": 30
  }
}
```

---

### POST /api/projects/:id/query/approve

Approve a proposed task tree after budget review.

**Request:**
```json
{
  "task_tree": { "...same tree from pending_approval response..." }
}
```

**Response (200):**
```json
{
  "status": "executing",
  "task_ids": ["uuid", "..."],
  "task_count": 42
}
```

---

## 5. Task Endpoints

### GET /api/projects/:id/tasks

List all tasks for a project, returned as a flat array with parent references for tree construction.

**Response (200):**
```json
{
  "tasks": [
    {
      "id": "uuid",
      "project_id": "uuid",
      "task_number": "1.1.1.1",
      "title": "Implement token exchange endpoint",
      "competencies": ["backend-architect", "security-engineer"],
      "dependencies": ["uuid-of-dep-1"],
      "status": "STEP_2_REVIEW",
      "parent_task_id": "uuid-or-null",
      "workflow_position": 47,
      "mode": "ronin",
      "primary_engine": "a",
      "primary_agent_role": "engineering-backend-architect",
      "created_at": "2026-03-19T14:22:00Z",
      "updated_at": "2026-03-19T15:41:00Z"
    }
  ]
}
```

---

### GET /api/tasks/:id

Get a single task with its results, reviews, and current step detail.

**Response (200):**
```json
{
  "task": {
    "id": "uuid",
    "project_id": "uuid",
    "task_number": "1.1.1.1",
    "title": "Implement token exchange endpoint",
    "competencies": ["backend-architect"],
    "dependencies": ["uuid"],
    "status": "FINAL",
    "parent_task_id": null,
    "workflow_position": 47,
    "mode": "ronin",
    "primary_engine": "a",
    "primary_agent_role": "engineering-backend-architect",
    "created_at": "2026-03-19T14:22:00Z",
    "updated_at": "2026-03-19T15:41:00Z"
  },
  "results": [
    {
      "id": "uuid",
      "task_id": "uuid",
      "step_number": 1,
      "result_content": "...",
      "engine_id": "a",
      "agent_role": "engineering-backend-architect",
      "tis27_hash": "hash-string",
      "created_at": "2026-03-19T14:25:00Z"
    }
  ],
  "reviews": [
    {
      "id": "uuid",
      "task_result_id": "uuid",
      "engine_id": "b",
      "agent_role": "engineering-security-engineer",
      "verdict": {
        "pass_fail": {
          "compilation": true,
          "security": false,
          "edge_cases": true
        },
        "issues": [
          {
            "severity": "high",
            "description": "Missing input validation on token parameter",
            "reference": "line 23",
            "suggested_fix": "Add validate_token() call before processing"
          }
        ],
        "suggestions": ["Add rate limiting to this endpoint"],
        "enrichments": ["Consider adding OpenTelemetry tracing span"],
        "confidence": 0.87
      },
      "tis27_hash": "hash-string",
      "censorship_flagged": false,
      "created_at": "2026-03-19T14:26:00Z"
    }
  ]
}
```

---

### POST /api/tasks/:id/retry

Re-run the current step for a task.

**Response (200):**
```json
{
  "task": { "...task object with status reset to current step production..." }
}
```

---

### POST /api/tasks/:id/escalate

Force a task to ESCALATED status for human review.

**Response (200):**
```json
{
  "task": { "...task object with status = ESCALATED..." }
}
```

---

### POST /api/tasks/:id/cancel

Cancel a task. Stops processing.

**Response (200):**
```json
{
  "task": { "...task object with status = CANCELLED..." }
}
```

---

## 6. Task Bible Endpoints

### GET /api/projects/:id/bible

List Task Bible entries for a project.

**Response (200):**
```json
{
  "entries": [
    {
      "id": "uuid",
      "task_id": "uuid",
      "task_number": "1.1.1.1",
      "title": "Implement token exchange endpoint",
      "status": "FINAL",
      "code_block_count": 2,
      "review_count": 9,
      "tl_dsa_signature": "sig-present",
      "created_at": "2026-03-19T14:22:00Z"
    }
  ]
}
```

---

### GET /api/bible/:task_id

Get a single Task Bible entry with full detail: all results, reviews, code blocks, signatures.

**Response (200):**
```json
{
  "entry": {
    "id": "uuid",
    "task_id": "uuid",
    "task_number": "1.1.1.1",
    "title": "Implement token exchange endpoint",
    "results": [
      {
        "step_number": 1,
        "result_content": "...",
        "engine_id": "a",
        "agent_role": "engineering-backend-architect",
        "tis27_hash": "hash"
      },
      { "step_number": 2, "..." : "..." },
      { "step_number": 3, "..." : "..." },
      { "step_number": 4, "..." : "..." }
    ],
    "reviews": [
      {
        "step_number": 1,
        "engine_id": "a",
        "agent_role": "engineering-senior-developer",
        "verdict": { "..." : "..." },
        "censorship_flagged": false
      }
    ],
    "final_output": "The complete final refined output text...",
    "code_blocks": [
      {
        "filename": "webhook_retry.rs",
        "language": "rust",
        "content": "pub async fn retry_with_backoff...",
        "version": "final",
        "line_count": 47
      },
      {
        "filename": "retry_config.rs",
        "language": "rust",
        "content": "pub struct RetryConfig...",
        "version": "final",
        "line_count": 23
      }
    ],
    "tl_dsa_signature": "base64-encoded-signature",
    "signature_chain": [
      {
        "step": 1,
        "hash": "tis27-hash",
        "timestamp": "2026-03-19T14:25:00Z"
      }
    ],
    "timestamps": {
      "decomposed_at": "2026-03-19T14:22:00Z",
      "step_1_completed": "2026-03-19T14:26:00Z",
      "step_2_completed": "2026-03-19T14:31:00Z",
      "step_3_completed": "2026-03-19T14:35:00Z",
      "finalized_at": "2026-03-19T14:37:00Z"
    }
  }
}
```

---

## 7. Knowledge Base Endpoints

### GET /api/projects/:id/kb

Search the knowledge base for a project. Supports hybrid search (keyword + semantic).

**Query parameters:**
- `q` — search query string (optional)
- `tags` — comma-separated tag list (optional)
- `archived` — `true`/`false` (default: `false`)
- `pinned` — `true`/`false` (optional, filter for pinned only)

**Response (200):**
```json
{
  "entries": [
    {
      "id": "uuid",
      "project_id": "uuid",
      "content": "Summary or excerpt of stored knowledge...",
      "tags": ["crypto", "crypto/TL-DSA", "architecture"],
      "archived": false,
      "pinned": true,
      "boost_score": 1.5,
      "relevance_score": 0.92,
      "created_at": "2026-03-15T10:00:00Z",
      "updated_at": "2026-03-19T14:22:00Z"
    }
  ]
}
```

---

### PUT /api/kb/:id

Update a knowledge base entry (tags, boost, archive, pin).

**Request:**
```json
{
  "tags": ["crypto", "crypto/TL-DSA", "security"],
  "boost_score": 2.0,
  "archived": false,
  "pinned": true
}
```

**Response (200):**
```json
{
  "entry": { "...updated entry..." }
}
```

---

### DELETE /api/kb/:id

Permanently delete a knowledge base entry.

**Response:** 204 No Content

---

## 8. Engine Configuration Endpoints

### GET /api/settings/engines

Get all three engine configurations.

**Response (200):**
```json
{
  "engines": [
    {
      "id": "uuid",
      "slot": "a",
      "hosting_mode": "self_hosted",
      "endpoint_url": "http://localhost:8001",
      "auth_type": "none",
      "model_name": "Qwen3.5-27B",
      "model_family": "qwen",
      "family_override": null,
      "health_status": "online",
      "last_health_check": "2026-03-19T15:40:00Z",
      "latency_ms": 2300,
      "queue_depth": 0
    },
    {
      "id": "uuid",
      "slot": "b",
      "hosting_mode": "commercial",
      "endpoint_url": "https://api.anthropic.com/v1/messages",
      "auth_type": "api_key",
      "model_name": "claude-sonnet-4-6",
      "model_family": "claude",
      "family_override": null,
      "health_status": "online",
      "last_health_check": "2026-03-19T15:40:30Z",
      "latency_ms": 450,
      "queue_depth": 0
    },
    {
      "id": "uuid",
      "slot": "c",
      "hosting_mode": "free_tier",
      "endpoint_url": "https://generativelanguage.googleapis.com/v1beta/models",
      "auth_type": "bearer",
      "model_name": "gemini-2.5-flash",
      "model_family": "gemini",
      "family_override": null,
      "health_status": "online",
      "last_health_check": "2026-03-19T15:40:15Z",
      "latency_ms": 800,
      "queue_depth": 0,
      "daily_messages_used": 142,
      "daily_messages_limit": 150
    }
  ]
}
```

**Note:** `credentials` (API keys, tokens) are NEVER returned in GET responses. Only stored and used server-side.

---

### PUT /api/settings/engines/:slot

Update an engine configuration. `slot` is `a`, `b`, or `c`.

**Request:**
```json
{
  "hosting_mode": "commercial",
  "endpoint_url": "https://api.anthropic.com/v1/messages",
  "auth_type": "api_key",
  "credentials": "sk-ant-api-key-here",
  "model_name": "claude-sonnet-4-6",
  "family_override": null
}
```

`credentials` is write-only — accepted on PUT, never returned on GET.

**Response (200):**
```json
{
  "engine": { "...engine config without credentials..." }
}
```

---

### POST /api/settings/engines/validate-diversity

Check that the three configured engines are in three different model families.

**Request:** No body (reads current configuration).

**Response (200):**
```json
{
  "valid": true,
  "engines": [
    { "slot": "a", "model_name": "Qwen3.5-27B",        "family": "qwen",    "status": "green" },
    { "slot": "b", "model_name": "claude-sonnet-4-6",   "family": "claude",  "status": "green" },
    { "slot": "c", "model_name": "gemini-2.5-flash",    "family": "gemini",  "status": "green" }
  ],
  "message": "Three distinct model families confirmed"
}
```

**Response (200) — conflict:**
```json
{
  "valid": false,
  "engines": [
    { "slot": "a", "model_name": "Qwen3.5-27B",  "family": "qwen", "status": "red" },
    { "slot": "b", "model_name": "Qwen3.5-9B",   "family": "qwen", "status": "red" },
    { "slot": "c", "model_name": "DeepSeek-R1",   "family": "deepseek", "status": "green" }
  ],
  "message": "Engines A and B both use Qwen variants — same training lineage. Select a different model family for one engine."
}
```

---

## 9. Settings Endpoints

### GET /api/settings/project/:id

Get project-specific settings.

**Response (200):**
```json
{
  "settings": {
    "review_intensity": "full",
    "decomposition_budget": 30,
    "mode": "ronin"
  }
}
```

---

### PUT /api/settings/project/:id

**Request:**
```json
{
  "review_intensity": "medium",
  "decomposition_budget": null,
  "mode": "yoda"
}
```

`decomposition_budget: null` means unlimited (disabled).

**Response (200):**
```json
{
  "settings": { "...updated..." }
}
```

---

### GET /api/lineages

Serve the model lineage database.

**Response (200):**
```json
{
  "qwen": ["Qwen3.5-397B", "Qwen3.5-27B", "Qwen3.5-9B", "Qwen3.5-35B-A3B", "Qwen2.5-Coder-32B"],
  "deepseek": ["DeepSeek-V3.2", "DeepSeek-R1", "DeepSeek-R1-Distill-Qwen-32B", "DeepSeek-R1-Distill-Llama-70B"],
  "llama": ["Llama-3.1-8B", "Llama-3.1-70B", "Llama-4-Maverick", "Llama-4-Scout"],
  "claude": ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
  "gemini": ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-3-pro"],
  "grok": ["grok-3", "grok-3-mini"],
  "glm": ["GLM-5", "GLM-4.7"],
  "kimi": ["Kimi-K2.5", "Kimi-K2"],
  "mistral": ["Mistral-Nemo-12B", "Mistral-Large-3"]
}
```

---

## 10. Audit Endpoints

### GET /api/audit/:task_id

Get audit records for a task.

**Response (200):**
```json
{
  "records": [
    {
      "id": "uuid",
      "task_id": "uuid",
      "event_type": "STEP_1_PRODUCTION",
      "payload_hash": "tis27-hash-of-inference-response",
      "tl_dsa_signature": "base64-sig",
      "engine_id": "a",
      "model_version": "Qwen3.5-27B",
      "created_at": "2026-03-19T14:25:00Z"
    }
  ]
}
```

---

### GET /api/audit/:task_id/export/json

Download a complete signed JSON audit trail for a task. Returns a file download.

**Response (200):** `Content-Type: application/json`, `Content-Disposition: attachment; filename="audit-{task_number}.json"`

The JSON contains the full audit record with TL-DSA signature chain, all inference hashes, all reviewer verdicts, all result versions, and timestamps. The frontend uses this JSON as source data for jsPDF-based PDF generation.

---

## 11. API Key Endpoints

### POST /api/keys

Create a new API key for programmatic access.

**Request:**
```json
{
  "name": "CI Pipeline Key"
}
```

**Response (201):**
```json
{
  "key": {
    "id": "uuid",
    "name": "CI Pipeline Key",
    "prefix": "yk_3f8a",
    "created_at": "2026-03-19T14:22:00Z"
  },
  "secret": "yk_3f8a...full-key-shown-once-only"
}
```

**The `secret` field is shown exactly once.** It is never stored in plaintext and cannot be retrieved again.

---

### GET /api/keys

List API keys (no secrets).

**Response (200):**
```json
{
  "keys": [
    {
      "id": "uuid",
      "name": "CI Pipeline Key",
      "prefix": "yk_3f8a",
      "created_at": "2026-03-19T14:22:00Z"
    }
  ]
}
```

---

### DELETE /api/keys/:id

Revoke an API key.

**Response:** 204 No Content

---

## 12. GitHub Integration Endpoints

### PUT /api/settings/github-pat

Store a GitHub Personal Access Token for Ronin Git integration. Stored encrypted (Phase Encryption, high_security mode) server-side.

**Request:**
```json
{
  "token": "ghp_xxxxxxxxxxxxxxxxxxxx"
}
```

**Response (200):**
```json
{
  "configured": true,
  "username": "SigmaWolf-8"
}
```

Backend validates the token against the GitHub API before storing.

---

### GET /api/settings/github-pat

Check if a GitHub PAT is configured.

**Response (200):**
```json
{
  "configured": true,
  "username": "SigmaWolf-8"
}
```

or

```json
{
  "configured": false,
  "username": null
}
```

**The token value is NEVER returned.**

---

## 13. Mode Promotion Endpoints

### POST /api/projects/:id/promote

Promote a Yoda project to Ronin mode. Inherits all existing context.

**Response (200):**
```json
{
  "project": { "...project with mode = ronin..." }
}
```

---

### POST /api/tasks/:id/escalate-to-yoda

Escalate a Ronin task to Yoda analysis mode.

**Response (200):**
```json
{
  "task": { "...task..." },
  "yoda_task_id": "uuid-of-new-yoda-analysis-task"
}
```

---

## 14. Health Endpoint

### GET /health

No auth required. Used by monitoring.

**Response (200):**
```json
{
  "status": "ok",
  "version": "0.1.0",
  "engines": {
    "a": "online",
    "b": "online",
    "c": "offline"
  }
}
```

---

## 15. WebSocket — Pipeline Status

### GET /ws/pipeline/:project_id

Upgrade to WebSocket connection. Requires valid JWT as query param: `?token=jwt-here`.

The server broadcasts events as JSON messages:

### TaskStateChange

```json
{
  "type": "TaskStateChange",
  "task_id": "uuid",
  "task_number": "1.1.1.1",
  "previous_status": "STEP_1_PRODUCTION",
  "new_status": "STEP_1_REVIEW",
  "timestamp": "2026-03-19T14:25:30Z"
}
```

### EngineActivity

```json
{
  "type": "EngineActivity",
  "task_id": "uuid",
  "engine_id": "b",
  "agent_role": "engineering-security-engineer",
  "action": "review_started",
  "step_number": 1,
  "timestamp": "2026-03-19T14:25:31Z"
}
```

### StepProgress

```json
{
  "type": "StepProgress",
  "task_id": "uuid",
  "step_number": 1,
  "reviews_completed": 2,
  "reviews_total": 3,
  "timestamp": "2026-03-19T14:26:00Z"
}
```

### ReviewComplete

```json
{
  "type": "ReviewComplete",
  "task_id": "uuid",
  "step_number": 1,
  "engine_id": "c",
  "agent_role": "testing-evidence-collector",
  "passed": true,
  "confidence": 0.91,
  "censorship_flagged": false,
  "timestamp": "2026-03-19T14:26:15Z"
}
```

### TaskComplete

```json
{
  "type": "TaskComplete",
  "task_id": "uuid",
  "task_number": "1.1.1.1",
  "final_status": "FINAL",
  "tl_dsa_signed": true,
  "timestamp": "2026-03-19T14:37:00Z"
}
```

### PipelineComplete

```json
{
  "type": "PipelineComplete",
  "project_id": "uuid",
  "total_tasks": 12,
  "completed": 11,
  "escalated": 1,
  "elapsed_seconds": 892,
  "timestamp": "2026-03-19T14:37:05Z"
}
```

### EngineHealthChange

```json
{
  "type": "EngineHealthChange",
  "engine_id": "c",
  "previous_status": "online",
  "new_status": "offline",
  "timestamp": "2026-03-19T14:38:00Z"
}
```

---

*Capomastro Holdings Ltd. — Applied Physics Division*
*Così sia, Fratello.*
