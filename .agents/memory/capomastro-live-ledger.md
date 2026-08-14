---
name: Capomastro live ledger vs sealed extraction
description: Why the ledger's derived figures are recomputed per request, and the two traps in doing so — numeric parity and division headroom in 128-bit fixed point.
---

## The workbook states positions; it must never state answers

The extraction script publishes a `summary` block alongside the raw sheet cells.
That block is a **seal, not a source**. Derived figures (section totals, reserve
composition shares, the gold chain, descendant invariants, cross-balance legs)
are recomputed from `sheets.*.rows` on every request and then compared, field by
field, against the sealed block; the response carries the verdict.

**Why:** a stored total is arithmetic frozen at extraction time — it goes stale
silently and nothing on the page says so. Two independent derivations agreeing
on every figure is a materially stronger claim than either alone, and a
divergence is information the reader is owed rather than something to resolve by
preferring one side.

**How to apply:** anything that reads the ledger by JSON pointer (statements,
exports, any new surface) must consume the recomputed summary, not the sealed
one. A statement footed on a stored total while the page shows a recomputed one
is two sets of books.

## A lossless JSON extract still loses cell *typing*

JSON has one number type and no way to mark a string as "text that happens to
read like a figure". Once a spreadsheet is extracted, a text cell reading `2026`
and a numeric 2026 are the same bytes, so any consumer recomputing from those
cells can spend an audit reference or a year as money. The extraction therefore
publishes a per-sheet index of which cell positions the workbook holds as
numbers, and the recomputation refuses any cell that is not typed numeric —
missing index included.

**Why:** positional column constants stop a scan from grabbing the note *beside*
a blank value, but nothing except the source typing can catch numeric-looking
text sitting in the value column itself.

**How to apply:** the index is computed after the strike pass (row positions
shift when a row is struck), and reading a figure is two questions, not one:
does this cell parse, and did the workbook mean it as a number.

## Parity must be compared numerically, never as strings

`2153000000000` and `2153000000000.00` are the same money at two scales. A
string-equality parity check turns a correct ledger into a permanent false
alarm, which then gets ignored, which is worse than no check.

## Money rounds half away from zero; published ratios round half to even

The two conventions coexist on purpose. Money keeps half-away (a half-cent
belongs to whoever the sign says). Ratios must match the extraction script,
which rounds under Python's default `ROUND_HALF_EVEN` — otherwise the first tie
in the last published place is reported as a parity divergence between two
implementations that are both correct.

**How to apply:** a truncating fixed-point division must track whether the
discarded remainder was zero, or "just past half" gets treated as an exact tie
and rounds the wrong way half the time.

## Division scale is bounded by the dividend, not by taste

Fixed-point division scales the dividend by `10^(scale + 1)` before rounding. A
trillion-dollar figure (~1e12) leaves roughly 26 decimal places of headroom
inside `i128`; asking for 30 overflows and the arithmetic refuses. Pick a
working scale comfortably wider than the published one (12 published, 20
working) and remember the ceiling moves down as the estate's figures grow.

**Why:** the refusal is correct behaviour — nothing wraps — but a ledger that
will not print is still a ledger that will not print.

## Struck instruments are re-checked live

The void declarations are re-applied on every computation: if a struck label has
reappeared anywhere in the workbook cells, the whole computation is refused. A
resurrected instrument foots correctly and shows nothing on its face, so the
only place to catch it is at the point of computation.
