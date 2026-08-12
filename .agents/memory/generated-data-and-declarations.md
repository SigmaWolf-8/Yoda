---
name: Generated data files vs. hand-authored declarations
description: Why a correction hand-edited into an extracted data file is not a correction, and how the Capomastro ledger enforces that.
---

# A hand edit to a generated file is not a correction

Any data file produced by an extraction script is one re-run away from reverting.
If a figure is struck, removed or corrected, the *declaration* must live in its own
hand-authored file that the extractor reads and applies; the generated file is only
ever an output.

**Why:** the Capomastro ledger JSON is extracted from a source workbook that is a
historical artefact and is never edited. A liability declared void ab initio was
removed by editing the extracted JSON directly. The extractor still built that row
from the workbook, so the next re-run would have silently resurrected a nine-figure
liability and dropped its disclosure — with the balance sheet still footing, because
the extractor would have recomputed the totals around it. Nothing would have looked
wrong.

**How to apply:** when correcting extracted data,

- put the declaration in a separate input file the extractor loads, and treat a
  missing declaration file as a hard error, not an empty list;
- apply the correction to the *raw extract* before any total, ratio or listing is
  derived, so no downstream figure is ever computed with the corrected item in it;
- declare both the before and after amounts of any offsetting entry and abort if
  either fails to match — a correction that silently adjusts a line whose starting
  point nobody checked is worse than no correction;
- finish with a sweep that refuses to write output in which the removed label
  still appears anywhere outside its own disclosure;
- prove it by re-running the extractor and diffing against the hand-corrected
  file. Byte-identical output is the only evidence the two paths agree.

Runtime should carry the same guard independently: the statements layer re-checks
that no struck label appears in any presented listing, so a bad regeneration shows
as a failed reconciliation on the page rather than as a plausible number.
