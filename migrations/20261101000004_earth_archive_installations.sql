CREATE TABLE earth_archive_installations (
    id uuid PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES organizations(id),
    token_hash text UNIQUE NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked boolean NOT NULL DEFAULT false,
    last_report_at timestamptz,
    report jsonb
);
CREATE INDEX earth_archive_installations_org ON earth_archive_installations(org_id,created_at DESC);
