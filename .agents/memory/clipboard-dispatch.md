---
name: Copy-to-send clipboard payloads
description: Rules for the "copy this page and send it" buttons — two flavours, payloads built before the click, and what a copy of a sealed document may claim.
---

# Copy-to-send clipboard payloads

## Write both flavours, always

One clipboard item carrying `text/html` **and** `text/plain` serves both audiences from
one button: mail clients paste the HTML and keep headings and tables, message apps take
the plain text. Generate both from the same values in the same pass.

**Why:** a text-only copy loses every table in an email; an HTML-only copy pastes as a
wall of tags into a message app. Two buttons for the same content is worse UX than one
that lets the receiving app choose.

**How to apply:** lay the plain flavour out with padded columns and rules — it will be
read as-is, not rendered.

## Build the payload before the click, never during it

Safari only honours `navigator.clipboard.write` inside the turn that the click started.
Anything needing a `fetch`, a canvas re-encode, or an await must already be prepared;
the button stays disabled until it is.

**Why:** an async build inside the handler works in Chrome and silently fails in Safari
and on iOS, which is where this project's owner actually reads the app.

**How to apply:** prepare in an effect or `useMemo`, hand the button a synchronous
getter that returns `null` while preparing.

## Always have a fallback chain

`clipboard.write` → `clipboard.writeText` → hidden-textarea `execCommand` → show the
text in a selectable box. The Replit preview iframe and any insecure origin will refuse
the modern API outright.

**Why:** a copy button that does nothing looks like a broken app; handing over selectable
text still completes the user's actual goal.

## Inline images, under a byte budget

Images in a pasted email must be `data:` URIs. A `src` pointing back at the dev server
renders for nobody, since the project is not published.

**Why:** capping pixel dimensions does not cap encoded size — detail does — and mail
clients drop or truncate multi-megabyte clipboard payloads without saying so. Spend a
fixed character budget in priority order, then link the remainder and say which.

## Copying a sealed document

Codex documents are governed by the Non-Alteration Clause. A copy may re-tag markup for
email (the screen stylesheet will not travel) but must not re-case headings, reorder,
summarise, or interleave app-authored text such as a catalogue blurb inside the
reproduction.

**Why:** re-casing a heading and inserting a summary *is* alteration, and a footer
claiming "verbatim" over an altered body is the worst of both.

**How to apply:** wrapper metadata sits outside the rules that delimit the document; the
HTML and plain flavours each state only what is true of themselves, and both name the
canonical file as governing.
