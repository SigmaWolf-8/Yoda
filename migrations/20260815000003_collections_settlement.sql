-- Settlement columns and webhook plumbing for the collections register.
--
-- Task: show a payment the moment it lands. Stripe pushes invoice lifecycle
-- events to a public webhook; each event is matched back to a demand by the
-- demandId carried in the invoice's metadata, and the settlement fact is
-- recorded here so the register can state when payment arrived without asking
-- Stripe.
--
-- This deliberately does NOT re-open the "payment state is never stored"
-- question by copying Stripe's mutable status. What lands here is an *event
-- record*: which signed event settled the row, when, and for how much. The
-- register still reads the live invoice from Stripe when it can — these
-- columns are the estate's own posting of a settlement it was told about.

ALTER TABLE collections_demands
    ADD COLUMN IF NOT EXISTS settlement_state       TEXT,
    ADD COLUMN IF NOT EXISTS settled_at             TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS settled_amount_cents   BIGINT,
    ADD COLUMN IF NOT EXISTS settlement_event_id    TEXT;

-- Every Stripe event this webhook has accepted, keyed by Stripe's own event
-- id. Stripe redelivers; inserting here with ON CONFLICT DO NOTHING is what
-- makes a redelivered `invoice.paid` a no-op instead of a second posting.
CREATE TABLE IF NOT EXISTS collections_webhook_events (
    id          TEXT        PRIMARY KEY,
    event_type  TEXT        NOT NULL,
    demand_id   UUID,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Webhook endpoints this service registered at Stripe, with the signing
-- secret Stripe issued for each. The Replit Stripe connection does not carry
-- a webhook signing secret, so the endpoint is created over the REST API and
-- its secret is held here — the same pattern the managed-webhook tooling
-- uses. One row per URL: dev domain and production domain each get their own.
CREATE TABLE IF NOT EXISTS collections_webhook_endpoints (
    url             TEXT        PRIMARY KEY,
    endpoint_id     TEXT        NOT NULL,
    signing_secret  TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
