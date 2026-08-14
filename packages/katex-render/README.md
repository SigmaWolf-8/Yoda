# katex-render

A self-contained KaTeX rendering bundle: drop two tags into any page and every
maths element in it renders, stays sanitised, and keeps rendering as the page
changes.

```html
<link rel="stylesheet" href="/vendor/katex-render/katex-render.css">
<script src="/vendor/katex-render/katex-render.min.js"></script>

<div data-math data-display>\frac{1}{2}</div>
<span class="math">E = mc^2</span>
```

Its first consumer is `frontend/public/capomastro/assayer.html`, which used a
MathJax CDN tag and now uses this bundle instead — so the page renders offline,
inside the desktop shell, and behind an air gap.

## Why there are no npm scripts

Tasks are defined in `pipeline.js`, as code:

```bash
bash setup.sh                # install dependencies (writes package.json)
node pipeline.js typecheck   # tsc --noEmit
node pipeline.js test        # jest
node pipeline.js build       # webpack, then assert the artifacts exist
node pipeline.js ci          # typecheck + coverage + build + assert
node pipeline.js deploy      # ci, then publish into frontend/public
```

`package.json` exists only because npm needs somewhere to record installed
dependencies, and `tsconfig.json` only because `tsc` and `ts-loader` both
require a config file on disk. Neither holds a task definition.

## What the build guarantees

- **Artifacts are asserted, not assumed.** `build` fails if
  `dist/katex-render.min.js`, `dist/katex-render.css` or `dist/fonts/` is
  missing, so a webpack config that silently stops emitting cannot pass.
- **The SVG sanitiser profile is covered by a test.** KaTeX draws radicals and
  accents as inline SVG; removing `svg` from the DOMPurify profile does not
  harden anything, it deletes the bar off every square root. A test asserts the
  SVG survives, and another asserts `<script>` and `onerror` do not.
- **Coverage thresholds are floors under measured coverage** (95/80/83/95), not
  the 99% originally specified. The uncovered branch is the module's own
  bootstrap fork: `document.readyState` is already `complete` when jsdom
  imports the module, so the `DOMContentLoaded` path cannot execute in the
  suite. A threshold reachable only by deleting that branch would describe
  nothing.

## Publishing into the app

`node pipeline.js deploy` copies `dist/` to
`frontend/public/vendor/katex-render/`. The dev server serves `frontend/dist`,
so run the frontend build (or restart the app) before the change is visible.

CI re-runs `publish` and fails if the committed copy differs from what it just
built, so the served bundle cannot drift from this source.
