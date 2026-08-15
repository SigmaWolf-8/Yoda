-- Formal demands issued against the estate's receivable positions.
--
-- Stripe holds the invoice: its amount, its status, its hosted payment page and
-- every state change after issue. This table holds only what Stripe cannot know
-- — which ledger position a given invoice was raised against, and what the
-- position stood at when the demand went out. Nothing here is a second copy of
-- an invoice; the invoice is read from Stripe on every request.
--
-- The row is written before the invoice is finalised and updated after, so a
-- demand that fails halfway leaves evidence rather than vanishing.

CREATE TABLE IF NOT EXISTS collections_demands (
    id                  UUID PRIMARY KEY,
    -- The receivable this demand is drawn against (`AST-CASH`, …), and the
    -- balance-sheet line it reads its principal from. Both are recorded because
    -- a terms file can be re-issued with different ids.
    position_id         TEXT        NOT NULL,
    ledger_line         TEXT        NOT NULL,
    obligor             TEXT        NOT NULL,
    -- What the position stood at, in exact decimal, at the moment of demand.
    -- Kept as text: this is money, and no layer below the extractor is allowed
    -- to put a figure through a float.
    outstanding_usd     TEXT        NOT NULL,
    -- The portion actually demanded now, in minor units, as sent to Stripe.
    demanded_cents      BIGINT      NOT NULL CHECK (demanded_cents > 0),
    currency            TEXT        NOT NULL DEFAULT 'usd',
    debtor_email        TEXT        NOT NULL,
    debtor_name         TEXT,
    memo                TEXT,
    stripe_customer_id  TEXT,
    stripe_invoice_id   TEXT,
    hosted_invoice_url  TEXT,
    -- `pending` until Stripe accepts the invoice, then `issued`, or `failed`
    -- with the reason. The *payment* state is never stored here — it is read
    -- from Stripe, so this table can never disagree with the payment processor.
    state               TEXT        NOT NULL DEFAULT 'pending',
    failure_reason      TEXT,
    issued_by           UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS collections_demands_position_idx
    ON collections_demands (position_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS collections_demands_invoice_idx
    ON collections_demands (stripe_invoice_id)
    WHERE stripe_invoice_id IS NOT NULL;
