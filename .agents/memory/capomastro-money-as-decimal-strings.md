---
name: Capomastro money as decimal strings
description: Published financial figures are exact decimal strings end to end; no layer may re-derive them in a float.
---

Every monetary figure and every derived ratio must use authoritative
exact-decimal computation and travel as a decimal **string** through the API
and into the UI. Runtime recomputation is intentional (see the live-ledger
decision); the old extraction-only restriction is superseded.

The rule: **financial arithmetic must never use binary floating point.**
- Server-side derivations use the shared exact-decimal arithmetic; no `f64`.
- The frontend formats values by string manipulation — grouping digits,
  shifting the decimal point for abbreviated forms. Parsing to a JS `number` is
  confined to chart pixel geometry, and its result is never displayed as a
  figure; visible labels are formatted from the exact string.
- Ratios are the one inexact step (they involve a division). They are computed
  at high precision and published at a single declared scale, rather than being
  recomputed at each display site.

**Why:** a binary float cannot represent most decimal fractions. Round-tripping
a published figure through one silently perturbs it — a reserve valuation lost
digits and disagreed with the exact decimal computation, while still looking
plausible. Because each layer's rounding is invisible on its own, this class of
error is not caught by reading any single file; it only shows up when the exact
value is computed independently and compared.

**How to apply:** derive new quantities in the authoritative exact-decimal
computation, not separately in display components. Treat `as_f64`, `Number(...)`,
or `parseFloat` applied to financial values as a defect.

The same applies to amounts parsed out of ISO 20022 messages: keep them as the
string the message carried, so a decimal never passes through a float on its
way to or from the wire.
