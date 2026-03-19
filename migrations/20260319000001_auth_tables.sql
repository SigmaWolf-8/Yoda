-- YODA Migration 001: Authentication & Authorization
--
-- SaaS-ready multi-tenant auth: users, organizations, role-based membership,
-- and API keys for programmatic access.
--
-- All project data is scoped to organizations. Users can belong to multiple
-- orgs with different roles (owner/admin/member).

-- ═══════════════════════════════════════════════════════════════════════
-- USERS
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email       TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT users_email_unique UNIQUE (email)
);

-- Fast lookup by email (login flow).
CREATE INDEX idx_users_email ON users (email);

-- ═══════════════════════════════════════════════════════════════════════
-- ORGANIZATIONS
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE organizations (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════
-- ORGANIZATION MEMBERSHIP
-- ═══════════════════════════════════════════════════════════════════════
-- Roles:
--   owner  — full control (manage members, delete org, all admin powers)
--   admin  — invite members, manage projects, change member roles (except owner)
--   member — use projects, submit queries, view results

CREATE TABLE org_members (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (user_id, org_id)
);

-- List all members of an org (org settings page).
CREATE INDEX idx_org_members_org_id ON org_members (org_id);

-- List all orgs a user belongs to (org switcher).
CREATE INDEX idx_org_members_user_id ON org_members (user_id);

-- ═══════════════════════════════════════════════════════════════════════
-- API KEYS
-- ═══════════════════════════════════════════════════════════════════════
-- For programmatic access. The full key is shown once at creation.
-- Only the argon2 hash is stored. The prefix (first 8 chars) is stored
-- for display in the management UI.

CREATE TABLE api_keys (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    key_hash    TEXT NOT NULL,
    key_prefix  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- List API keys for a user.
CREATE INDEX idx_api_keys_user_id ON api_keys (user_id);

-- ═══════════════════════════════════════════════════════════════════════
-- REFRESH TOKENS
-- ═══════════════════════════════════════════════════════════════════════
-- Supports token rotation: each refresh token is single-use.
-- On refresh, the old token is invalidated and a new pair is issued.

CREATE TABLE refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup by token hash (refresh flow).
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens (token_hash) WHERE revoked = FALSE;

-- Cleanup expired tokens (background job).
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens (expires_at) WHERE revoked = FALSE;
