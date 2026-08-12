// ─────────────────────────────────────────────────────────────────────────────
// KATEX RENDER PIPELINE
//
// One place where TeX becomes DOM, and the only place allowed to produce HTML
// that a component will inject. Every string this module hands back has been
// through DOMPurify first: KaTeX is a compiler, not a sanitiser, and the TeX it
// compiles arrives from sealed documents and canon text we do not author.
//
// Two entry points:
//   renderTexToSafeHtml() — one expression, for components that already know
//                           where the maths is (React, server-rendered blocks).
//   renderMath()          — sweep a DOM subtree for [data-math] / .math nodes
//                           and typeset them in place, once each.
//   startObserver()       — renderMath() plus a debounced MutationObserver, for
//                           subtrees whose content arrives after mount.
//
// No side effects on import. Nothing here starts observing until asked.
// ─────────────────────────────────────────────────────────────────────────────
import katex from 'katex';
import DOMPurify from 'dompurify';
import type { Config as SanitizeConfig } from 'dompurify';
// @ts-ignore side-effect stylesheet import handled by Vite
import 'katex/dist/katex.min.css';

/** Marks a node as already typeset, so sweeps and the observer skip it. */
export const RENDERED_FLAG = 'data-katex-rendered';

/** How long the observer coalesces DOM churn before typesetting again. */
export const DEBOUNCE_MS = 50;

const DEFAULT_SELECTOR =
  `[data-math]:not([${RENDERED_FLAG}]), .math:not([${RENDERED_FLAG}])`;

// KaTeX emits a visual span tree plus a MathML twin for screen readers. The
// MathML twin is wrapped in <semantics>/<annotation>, neither of which is in
// DOMPurify's MathML profile — without adding them back the whole accessible
// branch is dropped on the floor (KEEP_CONTENT is off), leaving sighted-only
// output. Both carry text, not behaviour.
const SANITIZE_CONFIG: SanitizeConfig = {
  // The SVG profile is load-bearing, not boilerplate: KaTeX draws the radical
  // bar of \sqrt, every stretchy accent, \xrightarrow and \overbrace as inline
  // <svg><path>. Turn the profile off and those strokes vanish while the rest
  // of the expression still renders — a silently wrong equation, which is the
  // worst possible failure for a document of record. DOMPurify's SVG profile
  // already drops <foreignObject>, the escape hatch that makes SVG risky.
  USE_PROFILES: { html: true, mathMl: true, svg: true },
  // MathML's <semantics>/<annotation> carry KaTeX's screen-reader twin and are
  // absent from DOMPurify's profile; without them the whole accessible branch
  // is dropped (KEEP_CONTENT is off). Both hold text, not behaviour.
  ADD_TAGS: ['semantics', 'annotation'],
  ADD_ATTR: ['encoding'],
  // Nothing KaTeX emits is interactive or restyles the page. Anything here
  // turning up in maths markup means the markup is not KaTeX's.
  FORBID_TAGS: [
    'form', 'input', 'button', 'select', 'textarea', 'option',
    'style', 'link', 'base', 'meta', 'object', 'embed', 'template',
  ],
  KEEP_CONTENT: false,
};

/**
 * The security boundary. Exported so it can be tested directly and so anyone
 * holding maths markup from somewhere other than our own KaTeX call has a
 * sanctioned way through — nothing else in the app may inject maths HTML.
 */
export function sanitizeMathHtml(html: string): string {
  return DOMPurify.sanitize(html, SANITIZE_CONFIG) as unknown as string;
}

/**
 * Typeset a single expression and return HTML that is safe to inject.
 *
 * Returns `null` when KaTeX cannot produce anything at all — callers should
 * fall back to rendering the raw TeX as a *text node*, never as HTML. Note
 * that a merely malformed expression is not a failure: `throwOnError` is off,
 * so KaTeX renders the offending command in its error colour and we return
 * that. Only a hard throw yields `null`.
 */
export function renderTexToSafeHtml(
  tex: string,
  options: { displayMode?: boolean } = {},
): string | null {
  try {
    return sanitizeMathHtml(
      katex.renderToString(tex, {
        displayMode: options.displayMode ?? false,
        throwOnError: false,
        strict: 'ignore',
        trust: false,
        macros: {},
      }),
    );
  } catch {
    return null;
  }
}

/**
 * Typeset every un-rendered maths node under `root`, in place.
 *
 * Display mode is opt-in per node via `data-display` or `.display-math`.
 * A node that cannot be typeset is flagged `error` rather than left bare, so
 * the next sweep does not retry it forever and so the failure is inspectable
 * in the DOM instead of being silent.
 */
export function renderMath(
  root: Element | Document | ShadowRoot = document,
  selector: string = DEFAULT_SELECTOR,
): void {
  const elements = root.querySelectorAll(selector);

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i] as HTMLElement;
    if (el.hasAttribute(RENDERED_FLAG)) continue;

    const tex = el.textContent || '';
    const displayMode =
      el.hasAttribute('data-display') || el.classList.contains('display-math');

    const html = renderTexToSafeHtml(tex, { displayMode });

    if (html === null) {
      // Same guarantee the single-expression path gives its callers: on a hard
      // failure the TeX is shown as text, never left as unvetted markup.
      el.textContent = tex;
      el.setAttribute(RENDERED_FLAG, 'error');
      continue;
    }

    el.innerHTML = html;
    el.setAttribute(RENDERED_FLAG, 'true');
  }
}

function isInterestingMutation(mutations: MutationRecord[]): boolean {
  for (const m of mutations) {
    if (m.type === 'childList') {
      for (let j = 0; j < m.addedNodes.length; j++) {
        if (m.addedNodes[j].nodeType === Node.ELEMENT_NODE) return true;
      }
    } else if (m.type === 'attributes' && m.attributeName !== RENDERED_FLAG) {
      // Writing RENDERED_FLAG is our own doing; reacting to it would loop.
      return true;
    }
  }
  return false;
}

// One watch per observed root. A module-wide singleton would mean the second
// component to mount silently steals observation from the first, and either
// one unmounting would blind the other — a bug that only shows up once two
// maths-bearing views are on screen together.
interface Watch {
  observer: MutationObserver;
  cancelPending: () => void;
}

const watches = new Map<Element, Watch>();

function resolveRoot(target: Document | Element): Element | null {
  return target instanceof Document ? target.body : target;
}

/**
 * Typeset `target` now, then keep it typeset as its contents change.
 *
 * Idempotent per root: calling it again re-arms that root rather than stacking
 * observers, so React StrictMode's double-invoke is harmless. Callers must
 * pair this with stopObserver(target) on teardown or the observer outlives the
 * view it was watching.
 */
export function startObserver(target: Document | Element = document): void {
  const root = resolveRoot(target);
  if (!root) return;

  stopObserver(root);
  renderMath(root);

  if (typeof MutationObserver === 'undefined') return;

  let timer: ReturnType<typeof setTimeout> | null = null;

  const observer = new MutationObserver((mutations) => {
    if (!isInterestingMutation(mutations)) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      renderMath(root);
    }, DEBOUNCE_MS);
  });

  watches.set(root, {
    observer,
    cancelPending: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  });

  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-math', 'class', 'data-display'],
  });
}

/**
 * Stop observing `target` and drop any typesetting pass that had not fired.
 * With no argument, stops every root — teardown for tests and for the app as
 * a whole, not a way to clean up after one component.
 */
export function stopObserver(target?: Document | Element): void {
  if (target === undefined) {
    for (const root of Array.from(watches.keys())) stopWatch(root);
    return;
  }
  const root = resolveRoot(target);
  if (root) stopWatch(root);
}

function stopWatch(root: Element): void {
  const watch = watches.get(root);
  if (!watch) return;
  watch.observer.disconnect();
  watch.cancelPending();
  watches.delete(root);
}

export { renderMath as forceRender };
