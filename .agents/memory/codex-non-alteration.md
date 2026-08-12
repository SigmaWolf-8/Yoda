---
name: Sealed Codex documents are non-alterable
description: The treatise HTML served by the Codex page is governed by a stated Non-Alteration Clause — what that forbids, and where to fix rendering instead.
---

# The sealed Codex documents may not be edited

The Codex page states, on its own face, that each document is loaded as its
original file and that nothing paraphrases, summarises, reformats or rewords the
source text — the frame renders exactly what was sealed. The documents are
governing instruments, not app content.

**Why:** the promise is made to the reader in the UI. Editing the files makes
that statement false, and the value of a governing document is entirely in its
being unaltered. This holds even for changes that are obviously improvements.

**How to apply:** it forbids more than rewording. Do not repoint their asset
URLs, do not self-host their CDN dependencies, do not normalise their markup, do
not rewrite their inline render scripts — even to fix genuinely broken
behaviour. Note they do not share a maths convention between them (one drives
KaTeX over `.math` elements, another uses `$$` with auto-render), so a single
sweeping "fix" across all of them would be wrong on the merits as well.

If their rendering needs to change, the change belongs in the app around them —
the page, the frame, or a wrapper — or it needs the owner's explicit instruction
to break the seal.
