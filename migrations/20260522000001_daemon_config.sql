-- Array3 daemon host/ports configuration (task #26).
-- Singleton row keyed by id=1 — defines where the Array3 monitor (and any
-- other YODA-side client) should probe for the three daemon HTTP services.
-- Defaults match the Kernel crate's out-of-the-box bind addresses.

CREATE TABLE IF NOT EXISTS daemon_config (
    id        SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    host      TEXT     NOT NULL DEFAULT '127.0.0.1',
    ports     INTEGER[] NOT NULL DEFAULT ARRAY[11488, 11515, 11906]::INTEGER[],
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO daemon_config (id, host, ports)
VALUES (1, '127.0.0.1', ARRAY[11488, 11515, 11906]::INTEGER[])
ON CONFLICT (id) DO NOTHING;
