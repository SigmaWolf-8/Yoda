---
name: Treatise plaintext cleaning
description: Rules for cleaning/unifying the Capomastro "Edified Treatise" attachments into clean plaintext.
---

The Capomastro/PlenumNET "Edified Treatise" attachments are accumulations of the
same few treatises (URI/URL, ISO 4217, Absolute Reconciliation Protocol, PlenumNET
verification-code mechanism) repeated ~4x each as variant drafts, plus pasted-in AI
self-summaries and a task-instruction preamble.

"Unify" = collapse duplicates to ONE clean copy of each distinct treatise (pick the
fullest variant); drop the AI self-summaries and the instruction preamble.

Cleaning rules ("strip markdown, remove em/en dashes, clean plaintext" while
preserving math + glyphs):
- Remove: markdown bold via `**`, backticks, code-fence lines (```), markdown
  heading marks (line-start `#{1,6} `).
- Convert dash family em/en/horizontal-bar/figure/non-breaking-hyphen/minus to
  ASCII "-"; smart quotes to straight; ellipsis to "..."; drop nbsp/soft-hyphen.
- Do NOT blanket-strip `#` or `|`. They appear in KaTeX (`\#`, `|...|` abs-value /
  bra-ket) and in meaningful prose ("introduced by a hash #"). Only strip a `#`
  that is an actual markdown heading marker.
- A bare `*` between operands is MULTIPLICATION, not markdown bold: convert to `×`
  (already used in the corpus). Deleting it corrupts the algebra.
- Do NOT touch underscores (math identifiers like U_alpha, seg_1, Asset_{Resource}).
- PRESERVE all glyphs (Phoenician, Katakana, Arabic, Aramaic, Greek Milesian, 攵, ॐ,
  ∫ ≈ ∀ ∞ Δ Σ Ω) and KaTeX delimiters \[ \] \( \) $$.

**Why:** the user re-runs this exact request; naive stripping of `* # |` silently
corrupts equations and deletes multiplication operators.
**How to apply:** extract the fullest copy of each section by line range,
concatenate with `===` dividers, run a line-based transform, then verify residual
markdown chars = 0 and KaTeX/glyph counts > 0 before delivering.
