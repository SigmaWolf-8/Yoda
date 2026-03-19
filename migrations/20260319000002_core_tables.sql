-- YODA Migration 002: Core Platform Tables
--
-- Projects, tasks, four-step refinement results, reviews, Task Bible,
-- Knowledge Base, engine configuration, audit log, and project keys.
--
-- Key design decisions:
-- - JSONB for flexible nested data (code_blocks, competencies, verdicts)
-- - vector(1536) for embedding-based semantic search (pgvector)
-- - All timestamps are TIMESTAMPTZ (UTC-aware)
-- - Soft deletes via archived flag on knowledge_base (hard delete available)
-- - Engine credentials encrypted at rest (Phase Encryption, stored as TEXT)

-- ═══════════════════════════════════════════════════════════════════════
-- PROJECTS
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE projects (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    mode        TEXT NOT NULL CHECK (mode IN ('yoda', 'ronin')),
    -- Project-level settings: review_intensity, decomposition_budget, etc.
    settings    JSONB NOT NULL DEFAULT '{
        "review_intensity": "full",
        "decomposition_budget": 30,
        "auto_archive_months": 24
    }'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════
-- TASKS
-- ═══════════════════════════════════════════════════════════════════════
-- Hierarchical task tree with four-step state machine.
-- task_number is the human-readable hierarchical ID: "1.3.2.1"

CREATE TABLE tasks (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- Hierarchical number: "1", "1.1", "1.1.1", "1.1.1.1", etc.
    task_number         TEXT NOT NULL,
    title               TEXT NOT NULL,
    -- Agent competency tags for role matching: ["backend-architect", "security-engineer"]
    competencies        JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Dependencies on other task numbers: ["1.3.1.1", "1.3.1.3"]
    dependencies        JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Four-step protocol state machine.
    status              TEXT NOT NULL DEFAULT 'DECOMPOSING' CHECK (status IN (
        'DECOMPOSING', 'QUEUED', 'ASSIGNED',
        'STEP_1_PRODUCTION', 'STEP_1_REVIEW',
        'STEP_2_PRODUCTION', 'STEP_2_REVIEW',
        'STEP_3_PRODUCTION', 'STEP_3_REVIEW',
        'STEP_4_FINAL_OUTPUT',
        'FINAL', 'ESCALATED'
    )),
    parent_task_id      UUID REFERENCES tasks(id) ON DELETE SET NULL,
    -- Global execution order (set by topological sort).
    workflow_position   INTEGER,
    mode                TEXT NOT NULL CHECK (mode IN ('yoda', 'ronin')),
    -- Engine assigned as primary producer.
    primary_engine_slot TEXT CHECK (primary_engine_slot IN ('a', 'b', 'c')),
    primary_agent_role  TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Task numbers are unique within a project.
    CONSTRAINT tasks_project_number_unique UNIQUE (project_id, task_number)
);

-- ═══════════════════════════════════════════════════════════════════════
-- TASK RESULTS
-- ═══════════════════════════════════════════════════════════════════════
-- Each task produces up to 4 results (one per step).
-- Result content is the full agent output (text, code, analysis).

CREATE TABLE task_results (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id         UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    -- Step 1, 2, 3, or 4 (final).
    step_number     SMALLINT NOT NULL CHECK (step_number BETWEEN 1 AND 4),
    result_content  TEXT NOT NULL,
    -- Which engine produced this result.
    engine_slot     TEXT NOT NULL CHECK (engine_slot IN ('a', 'b', 'c')),
    engine_model    TEXT NOT NULL,
    agent_role      TEXT NOT NULL,
    -- TIS-27 integrity hash computed on receipt from the engine.
    tis27_hash      TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One result per step per task.
    CONSTRAINT task_results_step_unique UNIQUE (task_id, step_number)
);

-- ═══════════════════════════════════════════════════════════════════════
-- TASK REVIEWS
-- ═══════════════════════════════════════════════════════════════════════
-- Each review step has 1-3 reviews (depending on intensity).
-- Reviews are from separate engines evaluating the result.

CREATE TABLE task_reviews (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_result_id      UUID NOT NULL REFERENCES task_results(id) ON DELETE CASCADE,
    -- Which engine produced this review.
    engine_slot         TEXT NOT NULL CHECK (engine_slot IN ('a', 'b', 'c')),
    engine_model        TEXT NOT NULL,
    agent_role          TEXT NOT NULL,
    -- Structured assessment: pass/fail per criterion, issues, suggestions,
    -- enrichments, confidence scores.
    verdict             JSONB NOT NULL,
    -- TIS-27 hash of the raw review response from the engine.
    tis27_hash          TEXT NOT NULL,
    -- Flagged if censorship detected (commercial/free-tier engines only).
    censorship_flagged  BOOLEAN NOT NULL DEFAULT FALSE,
    censorship_reason   TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════
-- TASK BIBLE ENTRIES
-- ═══════════════════════════════════════════════════════════════════════
-- The complete auditable record for a task. Created when a task reaches
-- FINAL or ESCALATED status. Ronin code blocks are nested inline.

CREATE TABLE task_bible_entries (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id             UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    -- Denormalized for fast access without joining tasks table.
    task_number         TEXT NOT NULL,
    title               TEXT NOT NULL,
    competencies        JSONB NOT NULL DEFAULT '[]'::jsonb,
    dependencies        JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- All four result versions as JSON array.
    all_results         JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- All review assessments (up to 9 at Full intensity) as JSON array.
    all_reviews         JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- The definitive output after four-step refinement.
    final_output        TEXT NOT NULL DEFAULT '',
    -- Ronin mode: inline code blocks. Yoda mode: empty array.
    -- Each element: { filename, language, content, version, line_count }
    code_blocks         JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- TL-DSA signature on the final output.
    tl_dsa_signature    TEXT,
    -- Chain of signatures linking this entry to previous entries.
    signature_chain     JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Timestamps for every state transition.
    timestamps          JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One bible entry per task.
    CONSTRAINT task_bible_task_unique UNIQUE (task_id)
);

-- ═══════════════════════════════════════════════════════════════════════
-- KNOWLEDGE BASE
-- ═══════════════════════════════════════════════════════════════════════
-- Per-user cumulative intelligence. Storage rule: decomposed queries are
-- saved automatically, non-decomposed queries are throwaway.
-- Supports hybrid search: BM25 (pg_trgm) + vector similarity (pgvector).

CREATE TABLE knowledge_base (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- The stored content (task output, research result, code pattern, etc.)
    content         TEXT NOT NULL,
    -- Summary for display in the KB browser.
    summary         TEXT NOT NULL DEFAULT '',
    -- Hierarchical tags: ["crypto/TL-DSA", "crypto/TIS-27", "architecture"]
    tags            JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Semantic embedding for vector similarity search.
    embedding       vector(1536),
    -- Soft delete: archived entries excluded from agent context injection.
    archived        BOOLEAN NOT NULL DEFAULT FALSE,
    -- Pinned entries always included in agent context regardless of age.
    pinned          BOOLEAN NOT NULL DEFAULT FALSE,
    -- Boost score: multiplier for retrieval ranking (default 1.0, range 0.0–5.0).
    boost_score     DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    -- Source task (if derived from a decomposed query).
    source_task_id  UUID REFERENCES tasks(id) ON DELETE SET NULL,
    -- Mode that produced this entry.
    source_mode     TEXT CHECK (source_mode IN ('yoda', 'ronin')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════
-- ENGINE CONFIGURATION
-- ═══════════════════════════════════════════════════════════════════════
-- Three engine slots (A, B, C), each configurable as self-hosted,
-- commercial, or free-tier. Scoped to organization.

CREATE TABLE engine_configs (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    -- Engine slot: a, b, or c.
    slot                TEXT NOT NULL CHECK (slot IN ('a', 'b', 'c')),
    hosting_mode        TEXT NOT NULL CHECK (hosting_mode IN ('self_hosted', 'commercial', 'free_tier')),
    endpoint_url        TEXT NOT NULL,
    auth_type           TEXT NOT NULL CHECK (auth_type IN ('bearer', 'api_key', 'none')),
    -- Encrypted at rest via Phase Encryption (high_security mode).
    -- Stored as hex-encoded ciphertext. Never exposed to frontend.
    credentials_encrypted TEXT,
    model_name          TEXT NOT NULL,
    model_family        TEXT NOT NULL,
    -- Manual family override (for custom/fine-tuned models).
    family_override     TEXT,
    health_status       TEXT NOT NULL DEFAULT 'offline' CHECK (health_status IN ('online', 'offline', 'suspect')),
    last_health_check   TIMESTAMPTZ,
    -- Metrics.
    avg_latency_ms      INTEGER,
    error_rate          DOUBLE PRECISION DEFAULT 0.0,
    -- Free-tier tracking.
    daily_message_limit INTEGER,
    daily_messages_used INTEGER DEFAULT 0,
    daily_reset_at      TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One config per slot per org.
    CONSTRAINT engine_configs_org_slot_unique UNIQUE (org_id, slot)
);

-- ═══════════════════════════════════════════════════════════════════════
-- AUDIT LOG
-- ═══════════════════════════════════════════════════════════════════════
-- Immutable record of every significant event. TL-DSA signed.

CREATE TABLE audit_log (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id             UUID REFERENCES tasks(id) ON DELETE SET NULL,
    project_id          UUID REFERENCES projects(id) ON DELETE SET NULL,
    -- Event type: task_created, step_completed, review_completed, task_final,
    -- task_escalated, key_rotated, etc.
    event_type          TEXT NOT NULL,
    -- TIS-27 hash of the event payload.
    payload_hash        TEXT NOT NULL,
    -- TL-DSA signature of this record.
    tl_dsa_signature    TEXT,
    -- Which engine was involved (if applicable).
    engine_slot         TEXT CHECK (engine_slot IN ('a', 'b', 'c')),
    engine_model        TEXT,
    -- Full event payload (for export).
    payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════
-- PROJECT KEYS
-- ═══════════════════════════════════════════════════════════════════════
-- Per-project TL-DSA keypairs. Private keys encrypted via Phase Encryption
-- (high_security mode). Supports key rotation.

CREATE TABLE project_keys (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id                  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- TL-DSA public key (hex-encoded, safe to expose).
    tl_dsa_public_key           TEXT NOT NULL,
    -- TL-DSA private key encrypted with Phase Encryption (high_security).
    -- NEVER exposed to frontend. Decrypted server-side only for signing.
    tl_dsa_private_key_encrypted TEXT NOT NULL,
    -- Which Phase Encryption mode was used (always high_security for keys).
    encryption_mode             TEXT NOT NULL DEFAULT 'high_security',
    -- Is this the currently active key for this project?
    active                      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Set when this key is rotated out (replaced by a new active key).
    rotated_at                  TIMESTAMPTZ
);

-- Fast lookup: active key for a project.
CREATE UNIQUE INDEX idx_project_keys_active
    ON project_keys (project_id) WHERE active = TRUE;

-- ═══════════════════════════════════════════════════════════════════════
-- GITHUB PAT STORAGE
-- ═══════════════════════════════════════════════════════════════════════
-- Encrypted GitHub Personal Access Token for Ronin Git integration.
-- Scoped to organization.

CREATE TABLE github_configs (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id                  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    -- Encrypted via Phase Encryption (high_security mode).
    pat_encrypted           TEXT NOT NULL,
    -- GitHub username (verified on save via API call).
    github_username         TEXT NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One GitHub config per org.
    CONSTRAINT github_configs_org_unique UNIQUE (org_id)
);

-- ═══════════════════════════════════════════════════════════════════════
-- CAPABILITY MATRIX
-- ═══════════════════════════════════════════════════════════════════════
-- Tracks per-(engine, agent_role) performance scores. Updated after each
-- review cycle via the meta-learning layer.

CREATE TABLE capability_scores (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    engine_slot     TEXT NOT NULL CHECK (engine_slot IN ('a', 'b', 'c')),
    model_name      TEXT NOT NULL,
    -- Agent role being evaluated (e.g., "engineering-backend-architect").
    agent_role      TEXT NOT NULL,
    -- Competency domain (e.g., "code_generation", "security_review").
    domain          TEXT NOT NULL,
    -- Score: 0.0 to 1.0, updated via exponential moving average.
    score           DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    -- How many review cycles contributed to this score.
    sample_count    INTEGER NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One score per (org, engine, role, domain) tuple.
    CONSTRAINT capability_scores_unique
        UNIQUE (org_id, engine_slot, agent_role, domain)
);
