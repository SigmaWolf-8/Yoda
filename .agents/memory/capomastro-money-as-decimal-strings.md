---
name: Capomastro money as decimal strings
description: Published financial figures are exact decimal strings end to end; no layer may re-derive them in a float.
---

Every monetary figure and every derived ratio in the Capomastro sovereign
record is computed **once**, in exact decimal, by the ledger extraction script,
and travels as a canonical decimal **string** through the API and into the UI.

The rule: **no layer downstream of extraction may do money arithmetic.**
- The API handler selects and forwards values. It does not add, divide, or
  convert to `f64`.
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

**How to apply:** when adding a figure to this record, add it to the extraction
script (Decimal in, canonical string out) and pass it through untouched. If a
new display needs a derived quantity, derive it in the extractor, not in the
handler or the component. Treat any `as_f64`, `Number(...)`, `parseFloat`, or
arithmetic operator applied to one of these values as a defect.

The same applies to amounts parsed out of ISO 20022 messages: keep them as the
string the message carried, so a decimal never passes through a float on its
way to or from the wire.
