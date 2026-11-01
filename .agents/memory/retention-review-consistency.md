---
name: Retention review consistency
description: Why paginated archive inspection and deletion validation use different snapshots.
---

Keep paginated inspection attached to one immutable, fully measured review.
An operator returning from a detail page should see the same counts and totals,
not silently switch to a different live inventory.

**Why:** acquisition can retire or add references between page requests.
Paginating live rows can skip or repeat references and disconnect the displayed
totals from what the operator inspected. Catalogue sizes cannot substitute for
measured local bytes, including missing files and protected partial downloads.

**How to apply:** expire old reviews explicitly rather than refreshing pages
in place. Preview and cleanup must independently remeasure under the acquisition
lock and fingerprint every reference and file, including unviewed pages.
The visible page is never the deletion list; confirmation applies to the
server-owned exact proposal across all pages.
