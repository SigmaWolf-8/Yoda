// entry.ts — portable KaTeX rendering pipeline.
//
// Renders every `[data-math]` / `.math` element in a subtree, sanitises the
// output, and keeps watching for elements added later. Exposed as a UMD library
// (`KaTeXRender`) so a plain HTML page can use it with two tags:
//
//   <link rel="stylesheet" href="katex-render.css">
//   <script src="katex-render.min.js"></script>
//
// Nothing is rendered twice: each element is stamped once it has been handled.

import katex from 'katex';
import DOMPurify from 'dompurify';
import 'katex/dist/katex.min.css';

const RENDERED_FLAG = 'data-katex-rendered';
const DEBOUNCE_MS = 50;

/**
 * DOMPurify configuration.
 *
 * The SVG profile is load-bearing, not decorative: KaTeX draws radicals,
 * accents, braces and arrows as inline SVG. Dropping `svg` does not "harden"
 * the output — it silently deletes the bar off every square root and the hat
 * off every accent, leaving maths that renders but reads wrong.
 */
const PURIFY_CONFIG = {
  USE_PROFILES: { html: true, mathMl: true, svg: true },
  KEEP_CONTENT: false,
} as const;

/**
 * Renders all unrendered maths elements inside `root`.
 *
 * Failures are contained per element: invalid TeX marks that one element as
 * `error` and the rest of the pass continues.
 */
export function renderMath(
  root: Element | Document | ShadowRoot = document,
  selector: string = `[data-math]:not([${RENDERED_FLAG}]), .math:not([${RENDERED_FLAG}])`
): void {
  const elements = root.querySelectorAll(selector);
  const len = elements.length;

  if (len === 0) return;

  for (let i = 0; i < len; i++) {
    const el = elements[i] as HTMLElement;

    if (el.hasAttribute(RENDERED_FLAG)) continue;

    const raw = el.textContent || '';
    const display = el.hasAttribute('data-display') || el.classList.contains('display-math');
    const container = document.createElement('span');

    try {
      katex.render(raw, container, {
        displayMode: display,
        throwOnError: false,
        strict: 'ignore',
        trust: false,
        macros: {},
      });

      el.innerHTML = DOMPurify.sanitize(container.innerHTML, PURIFY_CONFIG);
      el.setAttribute(RENDERED_FLAG, 'true');
    } catch {
      // The source stays visible; the element is stamped so the observer does
      // not retry it on every mutation.
      el.setAttribute(RENDERED_FLAG, 'error');
    }
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let observedRoot: Element | Document = document.body;

const observer = new MutationObserver((mutations: MutationRecord[]) => {
  let needsUpdate = false;
  const mLen = mutations.length;

  for (let i = 0; i < mLen; i++) {
    const m = mutations[i];

    if (m.type === 'childList') {
      const addedLen = m.addedNodes.length;
      for (let j = 0; j < addedLen; j++) {
        if (m.addedNodes[j].nodeType === Node.ELEMENT_NODE) {
          needsUpdate = true;
          break;
        }
      }
    } else if (m.type === 'attributes' && m.attributeName !== RENDERED_FLAG) {
      needsUpdate = true;
    }

    if (needsUpdate) break;
  }

  if (!needsUpdate) return;

  if (debounceTimer !== null) clearTimeout(debounceTimer);

  debounceTimer = setTimeout(() => {
    renderMath(observedRoot);
    debounceTimer = null;
  }, DEBOUNCE_MS);
});

/** Renders `target` immediately, then keeps it up to date as it changes. */
export function startObserver(target: Document | Element = document): void {
  observedRoot = target instanceof Document ? target.body : target;
  renderMath(observedRoot);
  observer.observe(observedRoot, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-math', 'class', 'data-display'],
  });
}

/** Stops watching and cancels any pending debounced pass. */
export function stopObserver(): void {
  observer.disconnect();
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

export { renderMath as forceRender };

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => startObserver(), { once: true });
} else {
  startObserver();
}
