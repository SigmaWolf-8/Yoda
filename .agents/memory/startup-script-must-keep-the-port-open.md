---
name: The startup script must never close the API port
description: Why a build failure used to make the whole app unreachable, and the rules the Replit run script now follows.
---

# A failed build must not take the port down

When nothing is listening on the app's port, the Replit proxy serves its own
"Hmm... We couldn't reach this app" page. From inside the container everything
looks fine — there are simply no logs, because the process is gone. This reads to
the user as "the app won't open at all" and gives no clue where to look.

**Why:** the run script had `set -e` together with a hand-written fallback that
was supposed to keep the previously built binary serving when `cargo build`
failed. `set -e` aborts the script the instant the build returns non-zero, so the
fallback was unreachable dead code from the day it was written. Every compile
error — and every build interrupted by a concurrent `cargo` invocation competing
for the `target/` lock — closed the port completely instead of degrading to
slightly stale code.

**How to apply:** in any long-running start script,

- do not combine `set -e` with explicit `$?` checks; the `set -e` wins and the
  checks never run. Check failures explicitly (`if cmd; then … else … fi`) and
  leave `set -e` off where a fallback path exists;
- treat "the port stays open" as the top priority, above running current code.
  Serving a stale binary is recoverable; serving nothing is invisible;
- snapshot the currently working binary somewhere outside `target/` before a
  rebuild overwrites it, so there is always something known to boot;
- after swapping in a new binary, poll the port and revert to the snapshot if it
  does not come up — compiling successfully is not the same as booting;
- say loudly in the logs when running code is behind the source tree, or the next
  confusing symptom is a fix that appears not to have taken effect.

Related trap: running `cargo build` from a shell tool while the workflow is also
building contends on the same `target/` lock and can kill the workflow's build.
