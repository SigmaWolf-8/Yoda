-- YODA Migration 003: Performance Indexes
--
-- GIN indexes on JSONB columns for containment queries.
-- Trigram indexes for fuzzy text search (pg_trgm).
-- Partial indexes for frequently filtered subsets.
-- pgvector HNSW index for approximate nearest neighbor embedding search.
-- B-tree composites for hierarchical lookups and audit trail queries.
--
-- These indexes are critical for performance at scale. Without them,
-- the knowledge base search, task tree navigation, and audit trail
-- queries degrade to sequential scans.

-- ═══════════════════════════════════════════════════════════════════════
-- GIN INDEXES (JSONB containment / existence queries)
-- ═══════════════════════════════════════════════════════════════════════

-- Tasks: "find all tasks requiring backend-architect competency"
-- Query: WHERE competencies @> '["backend-architect"]'
CREATE INDEX idx_tasks_competencies_gin
    ON tasks USING GIN (competencies jsonb_path_ops);

-- Tasks: "find all tasks with specific dependencies"
-- Query: WHERE dependencies @> '["1.3.1.1"]'
CREATE INDEX idx_tasks_dependencies_gin
    ON tasks USING GIN (dependencies jsonb_path_ops);

-- Task Bible: "find entries with Rust code blocks"
-- Query: WHERE code_blocks @> '[{"language": "rust"}]'
CREATE INDEX idx_task_bible_code_blocks_gin
    ON task_bible_entries USING GIN (code_blocks jsonb_path_ops);

-- Knowledge Base: "find entries tagged with crypto/TL-DSA"
-- Query: WHERE tags @> '["crypto/TL-DSA"]'
CREATE INDEX idx_kb_tags_gin
    ON knowledge_base USING GIN (tags jsonb_path_ops);

-- Task Reviews: "find reviews where security criteria failed"
-- Query: WHERE verdict @> '{"pass_fail": {"security": false}}'
CREATE INDEX idx_task_reviews_verdict_gin
    ON task_reviews USING GIN (verdict jsonb_path_ops);

-- Audit Log: "find events matching specific payload criteria"
CREATE INDEX idx_audit_log_payload_gin
    ON audit_log USING GIN (payload jsonb_path_ops);

-- ═══════════════════════════════════════════════════════════════════════
-- TRIGRAM INDEXES (fuzzy text search via pg_trgm)
-- ═══════════════════════════════════════════════════════════════════════

-- Tasks: fuzzy search on task titles.
-- Query: WHERE title ILIKE '%webhook%' or title % 'webhook'
CREATE INDEX idx_tasks_title_trgm
    ON tasks USING GIN (title gin_trgm_ops);

-- Knowledge Base: fuzzy search on content.
-- Query: WHERE content ILIKE '%retry logic%'
CREATE INDEX idx_kb_content_trgm
    ON knowledge_base USING GIN (content gin_trgm_ops);

-- Knowledge Base: fuzzy search on summary.
CREATE INDEX idx_kb_summary_trgm
    ON knowledge_base USING GIN (summary gin_trgm_ops);

-- Projects: fuzzy search on project names.
CREATE INDEX idx_projects_name_trgm
    ON projects USING GIN (name gin_trgm_ops);

-- ═══════════════════════════════════════════════════════════════════════
-- PARTIAL INDEXES (filtered subsets for common query patterns)
-- ═══════════════════════════════════════════════════════════════════════

-- Knowledge Base: active (non-archived) entries only.
-- Most queries exclude archived entries. This index is much smaller
-- than a full index and speeds up the common case.
CREATE INDEX idx_kb_active
    ON knowledge_base (project_id, created_at DESC)
    WHERE archived = FALSE;

-- Knowledge Base: pinned entries (always included in agent context).
CREATE INDEX idx_kb_pinned
    ON knowledge_base (project_id)
    WHERE pinned = TRUE;

-- Tasks: in-progress tasks (anything not FINAL or ESCALATED).
-- The DAG engine queries this constantly to find work.
CREATE INDEX idx_tasks_in_progress
    ON tasks (project_id, workflow_position)
    WHERE status NOT IN ('FINAL', 'ESCALATED');

-- Tasks: tasks awaiting review (the four review states).
CREATE INDEX idx_tasks_pending_review
    ON tasks (project_id)
    WHERE status IN ('STEP_1_REVIEW', 'STEP_2_REVIEW', 'STEP_3_REVIEW');

-- Refresh tokens: non-revoked, non-expired tokens.
-- Already created in migration 001, listed here for completeness.
-- CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens ...

-- ═══════════════════════════════════════════════════════════════════════
-- PGVECTOR HNSW INDEX (approximate nearest neighbor)
-- ═══════════════════════════════════════════════════════════════════════

-- Knowledge Base: semantic similarity search on embeddings.
-- HNSW (Hierarchical Navigable Small World) provides fast ANN with
-- configurable recall/speed tradeoff.
--
-- m = 16: connections per layer (higher = better recall, more memory)
-- ef_construction = 64: build-time search width (higher = better index quality)
--
-- Cosine distance (<=>) is standard for normalized embeddings.
CREATE INDEX idx_kb_embedding_hnsw
    ON knowledge_base USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- ═══════════════════════════════════════════════════════════════════════
-- B-TREE COMPOSITE INDEXES (hierarchical lookups, ordered access)
-- ═══════════════════════════════════════════════════════════════════════

-- Projects: list projects for an org (the most common project query).
CREATE INDEX idx_projects_org_id
    ON projects (org_id, created_at DESC);

-- Tasks: hierarchical lookup — find tasks by project + task_number.
-- The UNIQUE constraint already creates this, but listing for clarity.
-- (tasks_project_number_unique provides the B-tree index)

-- Tasks: find children of a parent task.
CREATE INDEX idx_tasks_parent
    ON tasks (parent_task_id)
    WHERE parent_task_id IS NOT NULL;

-- Task Results: find all results for a task, ordered by step.
CREATE INDEX idx_task_results_task_step
    ON task_results (task_id, step_number);

-- Task Reviews: find all reviews for a result.
CREATE INDEX idx_task_reviews_result
    ON task_reviews (task_result_id, created_at);

-- Task Bible: find entry by task_id (already UNIQUE, but also need project lookup).
CREATE INDEX idx_task_bible_project
    ON task_bible_entries (task_number);

-- Audit Log: query audit trail for a task, ordered by time.
CREATE INDEX idx_audit_log_task_time
    ON audit_log (task_id, created_at DESC)
    WHERE task_id IS NOT NULL;

-- Audit Log: query audit trail for a project, ordered by time.
CREATE INDEX idx_audit_log_project_time
    ON audit_log (project_id, created_at DESC)
    WHERE project_id IS NOT NULL;

-- Audit Log: query by event type (e.g., all key_rotated events).
CREATE INDEX idx_audit_log_event_type
    ON audit_log (event_type, created_at DESC);

-- Engine Configs: lookup by org (settings page load).
-- (engine_configs_org_slot_unique provides the primary lookup)

-- Capability Scores: find scores for an engine+role combo.
CREATE INDEX idx_capability_scores_engine_role
    ON capability_scores (org_id, engine_slot, agent_role);

-- Knowledge Base: find entries by source task (linking KB entries back to tasks).
CREATE INDEX idx_kb_source_task
    ON knowledge_base (source_task_id)
    WHERE source_task_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- UPDATED_AT TRIGGERS
-- ═══════════════════════════════════════════════════════════════════════
-- Automatically update the updated_at column on row modification.

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_projects
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_tasks
    BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_knowledge_base
    BEFORE UPDATE ON knowledge_base
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_engine_configs
    BEFORE UPDATE ON engine_configs
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_github_configs
    BEFORE UPDATE ON github_configs
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_capability_scores
    BEFORE UPDATE ON capability_scores
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
