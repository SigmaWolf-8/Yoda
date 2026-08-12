---
name: KaTeX output sanitization
description: Why maths HTML must go through one sanitizer, and which two parts of the DOMPurify config look like dead weight but are load-bearing.
---

# Sanitizing KaTeX output

KaTeX is a compiler, not a sanitizer. Its input here is sealed documents and
canon text the app does not author, and its output is injected as HTML. All of
it goes through a single exported sanitize function; no other code in the app
may inject maths markup.

## The SVG profile is load-bearing — do not "harden" it away

A reviewer will suggest dropping DOMPurify's SVG profile as least privilege,
reasoning that KaTeX emits HTML + MathML. That is wrong. KaTeX draws the
radical bar of `\sqrt`, every stretchy accent, `\xrightarrow` and `\overbrace`
as inline `<svg><path>`.

**Why it matters more than a normal regression:** removing the profile does not
break rendering, it *deletes strokes*. The expression still typesets and no
longer means what it says — the worst failure mode available for a document of
record. DOMPurify's SVG profile already drops `<foreignObject>`, the escape
hatch that makes SVG risky in the first place.

**How to apply:** there is a test asserting `svg`/`path` survive for those four
commands. If it fails, the config was narrowed, not the maths.

## MathML `<semantics>`/`<annotation>` must be added back by hand

They are absent from DOMPurify's MathML profile, and with `KEEP_CONTENT` off
their removal takes the entire accessible MathML twin with it — leaving
sighted-only output that still looks correct. Both carry text, not behaviour.

## Hostile TeX does not exercise the sanitizer

With `trust: false`, KaTeX refuses `\href` and escapes markup inside `\text{}`
on its own. A test that only feeds bad TeX therefore proves KaTeX works and
says nothing about DOMPurify. Test the sanitize function directly with markup
KaTeX would never emit.

A related trap: the raw TeX source survives verbatim inside the MathML
`<annotation>` text node, so substring assertions like
`expect(html).not.toContain('javascript:')` fail on inert text. Assert on parsed
DOM structure and attributes, never on substrings of the markup.
