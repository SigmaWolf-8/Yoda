-- Delivery is a separate fact from issuance.
--
-- Finalising an invoice makes it payable; emailing it is a second call that can
-- fail on its own. Without these columns the register would have to either stay
-- silent about delivery or imply it, and "we raised it" is not the same claim as
-- "the debtor received it".
--
-- `stripe_customer_id` is also widened in use: it is now written as soon as the
-- customer is known, not only on success, so a demand that fails midway still
-- says who it was addressed to at Stripe.

ALTER TABLE collections_demands
    ADD COLUMN IF NOT EXISTS delivery_state TEXT,
    ADD COLUMN IF NOT EXISTS delivery_error TEXT;

-- A demand still sitting in `pending` is a reservation against the position:
-- an invoice may exist at Stripe that this database did not manage to record.
-- Indexed because the issuance path counts these on every demand.
CREATE INDEX IF NOT EXISTS collections_demands_open_idx
    ON collections_demands (position_id)
    WHERE state IN ('pending', 'issued');
