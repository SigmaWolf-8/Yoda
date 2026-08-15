---
name: Issuing payment demands over a card rail
description: Invariants for turning a ledger receivable into a real invoice — reservation, ambiguous processor outcomes, rounding direction, and the per-charge ceiling.
---

# Demanding money against a live ledger position

## A card rail cannot carry a large balance

A single Stripe charge tops out at 99,999,999 minor units (**$999,999.99**).
Estate positions are in the billions, so every demand is a *payment on account*:
the invoice carries an amount within the ceiling and states the full outstanding
figure it is drawn against in the footer and metadata.

**Why:** the alternatives are all worse — scaling the figure silently changes
what is demanded, and refusing outright means the rail cannot be used at all.

**How to apply:** never round a balance down to fit. Clip explicitly, disclose
the ceiling in the UI, and allow several demands to run against one position.

## Pending is a reservation, not a draft

The row is written *before* the processor is called, inside a transaction that
holds `pg_advisory_xact_lock(hashtext(position_id))`, and the free balance is
summed over `state IN ('pending','issued')`. The lock is released at commit —
it guards the arithmetic, never the network round trip.

**Why:** two operators calling the same position concurrently otherwise both
read the same free balance and both raise an invoice for it. Processor-side
idempotency does not help: a retry that generates a new demand id is a new key
and therefore a new charge.

## Refusal and silence are different failures

* The processor **refusing** (4xx it actually returned) is definite → close the
  row as failed; nothing payable exists.
* The processor **not answering** (timeout, 5xx, or a local failure after the
  call) is ambiguous → leave the row pending, still reserving its amount.

**Why:** closing an ambiguous row releases the money for a second demand while a
real, payable invoice may be sitting at the processor.

**How to apply:** put the demand's own id in the invoice metadata at creation
and persist the returned invoice id *before* the line item and finalisation.
Recovery then means searching the processor by that metadata and adopting what
it reports — never inventing an id to close the gap.

## Rounding has a direction

A user-supplied amount finer than the minor unit is **refused**, not rescaled: a
rounded figure demands a sum nobody authorised. A computed default is
**truncated** toward zero, never rounded half-up, or it can exceed the very
balance the check that produced it will allow.

## Issuance and delivery are separate facts

Finalising makes an invoice payable; emailing it is a second call with its own
outcome. Record and display them separately — "issued" must never render as
"served" unless the processor confirmed the send.

## Fail closed on an unpriced position

If the accrual cannot be computed (rate source down), the position is not
demandable at all. Invoicing the principal alone understates the claim on paper
the debtor keeps, and that paper outlives the outage.
