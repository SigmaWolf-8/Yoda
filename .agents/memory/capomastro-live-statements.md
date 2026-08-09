---
name: Capomastro live statements
description: Rules governing the on-request computation of the estate's trial balance, balance sheet, income statement and debt call — rate sourcing, accrual arithmetic, and what must never be posted.
---

# Live statements: standing rules

The statements endpoint recomputes on every request from the workbook positions
plus live published reference rates. The workbook is the *starting position*,
never the answer.

## A missing rate withholds the total; it never substitutes a constant

If a rate source cannot be reached, the dependent accrual is `null` with the
transport error attached, and every total that would have consumed it is
withheld wholesale.

**Why:** an assumed rate is indistinguishable from a real one once it is
printed, and a partial sum presented as a total is simply a wrong total. There
are no fallback constants anywhere in this path, and none may be added.

**How to apply:** any new derived figure must propagate `null` rather than
coerce to zero, and the UI must render withheld figures as an explicit gap with
the reason, not as a dash that reads like nothing was owed.

## Interest divides last

Accrual is `principal × rate × days ÷ basis`, with the division performed last
at the money scale.

**Why:** rounding the day-count fraction (e.g. 130/365) to a working scale
before multiplying pushes a large principal off by a cent. One cent on one
obligation is an audit finding.

**How to apply:** never precompute a year fraction as a standalone value to
multiply by. There are unit tests in the decimal module asserting both the
correct figure and the cent that the wrong ordering produces.

## Principal comes from the balance sheet, not the terms file

The terms file declares only terms — index, spread, day count, call basis.
Principal is read from the workbook's own liability line.

**Why:** if principal lived in the terms file it could silently drift from the
audited statement, and the debt schedule would stop tying.

**How to apply:** a liability with no declared terms is reported as
*unmodelled* and excluded from the accrual — never assumed interest-free. Terms
with no matching liability line are reported as orphans. Both are surfaced, not
swallowed.

## Bullion appreciation is disclosed, not posted

The estate is on a historical-cost basis, so the gold revaluation surplus
appears as a memo disclosure and is deliberately absent from the trial balance.

**Why:** recognising it would require an IAS 16 revaluation election and an OCI
reserve. Posting it silently would inflate assets and break the tie to the
audited workbook.

## Reconciliation checks compare values, not rendered strings

Comparing formatted output fails `2153000000000` against `2153000000000.00` —
the same money at two scales — and reports balanced books as broken. Rescale
both operands to a common scale and compare numerically before formatting.
