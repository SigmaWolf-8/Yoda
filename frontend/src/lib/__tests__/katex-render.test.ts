// Verification for the KaTeX render pipeline: that maths is typeset, that
// hostile TeX cannot smuggle markup through KaTeX into the DOM, that broken
// TeX degrades instead of throwing, and that the observer coalesces churn and
// actually stops when told to.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import katex from 'katex';
import {
  DEBOUNCE_MS,
  RENDERED_FLAG,
  forceRender,
  renderMath,
  renderTexToSafeHtml,
  sanitizeMathHtml,
  startObserver,
  stopObserver,
} from '../katex-render';

// jsdom delivers MutationObserver records on the microtask checkpoint, which
// fake timers do not advance. Yield the queue before touching the clock or the
// debounce will not have been scheduled yet and the test measures nothing.
const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

// KaTeX with trust:false already refuses most hostile input, which means a test
// that only feeds it bad TeX proves KaTeX works and says nothing about the
// sanitiser. These go at the sanitiser directly, as if KaTeX had handed back
// markup we did not expect.
describe('sanitizeMathHtml (the security boundary itself)', () => {
  test.each([
    ['script element', '<span class="katex"><script>alert(1)</script></span>', 'script'],
    ['event handler', '<span class="katex" onmouseover="alert(1)">x</span>', '[onmouseover]'],
    ['error handler', '<span class="katex"><img src="x" onerror="alert(1)"></span>', '[onerror]'],
    ['iframe', '<span class="katex"><iframe src="//evil.test"></iframe></span>', 'iframe'],
    ['form', '<span class="katex"><form action="//evil.test"><input></form></span>', 'form'],
    ['input', '<span class="katex"><input value="x"></span>', 'input'],
    ['style element', '<span class="katex"><style>body{display:none}</style></span>', 'style'],
  ])('strips %s from maths markup', (_label, dirty, gone) => {
    document.body.innerHTML = sanitizeMathHtml(dirty);
    expect(document.querySelectorAll(gone)).toHaveLength(0);
  });

  // Guards against a well-meaning "least privilege" edit that turns the SVG
  // profile off: \sqrt, accents, arrows and braces are drawn as inline <svg>,
  // so dropping the profile deletes the stroke and leaves an equation that
  // still renders and no longer means what it says.
  test.each(['\\sqrt{x}', '\\widehat{ABC}', '\\xrightarrow{f}', '\\overbrace{x+y}'])(
    'keeps the drawn strokes of %s',
    (tex) => {
      const html = renderTexToSafeHtml(tex, { displayMode: true })!;
      document.body.innerHTML = html;
      expect(document.querySelectorAll('svg').length).toBeGreaterThan(0);
      expect(document.querySelectorAll('path').length).toBeGreaterThan(0);
    },
  );

  test('drops the SVG escape hatch that would smuggle HTML back in', () => {
    document.body.innerHTML = sanitizeMathHtml(
      '<svg><foreignObject><img src="x" onerror="alert(1)"></foreignObject></svg>',
    );
    expect(document.querySelectorAll('foreignObject')).toHaveLength(0);
    expect(document.querySelectorAll('img')).toHaveLength(0);
  });

  test('strips a scripting URL while leaving the link text', () => {
    document.body.innerHTML = sanitizeMathHtml(
      '<span class="katex"><a href="javascript:alert(1)">click</a></span>',
    );
    const anchor = document.querySelector('a');
    expect(anchor?.getAttribute('href') ?? null).toBeNull();
    expect(document.body.textContent).toContain('click');
  });

  test('keeps the inline styles KaTeX lays maths out with', () => {
    document.body.innerHTML = sanitizeMathHtml(
      '<span class="vlist" style="height:1.2em;vertical-align:-0.3em;">x</span>',
    );
    expect(document.querySelector('.vlist')?.getAttribute('style')).toContain('height');
  });

  test('keeps the MathML semantics wrapper instead of dropping the whole branch', () => {
    document.body.innerHTML = sanitizeMathHtml(
      '<math><semantics><mrow><mi>x</mi></mrow>' +
        '<annotation encoding="application/x-tex">x</annotation></semantics></math>',
    );
    expect(document.querySelector('semantics')).not.toBeNull();
    expect(document.querySelector('annotation')?.getAttribute('encoding')).toBe(
      'application/x-tex',
    );
  });
});

describe('katex-render', () => {
  beforeEach(() => {
    stopObserver();
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    stopObserver();
    vi.useRealTimers();
  });

  test('typesets [data-math] and .math nodes and flags them as rendered', () => {
    document.body.innerHTML = `
      <div id="target" data-math="true">\\frac{1}{2}</div>
      <span class="math">E = mc^2</span>
    `;

    renderMath();

    const attrEl = document.getElementById('target')!;
    const classEl = document.querySelector('.math')!;

    expect(attrEl.getAttribute(RENDERED_FLAG)).toBe('true');
    expect(classEl.getAttribute(RENDERED_FLAG)).toBe('true');
    expect(attrEl.querySelector('.katex')).not.toBeNull();
    expect(classEl.querySelector('.katex')).not.toBeNull();
  });

  test('keeps the MathML twin so the maths stays readable to screen readers', () => {
    const html = renderTexToSafeHtml('\\frac{1}{2}', { displayMode: true })!;
    document.body.innerHTML = html;

    expect(document.querySelector('math')).not.toBeNull();
    expect(document.querySelector('annotation')?.textContent).toContain('\\frac');
  });

  test('does not typeset the same node twice', () => {
    document.body.innerHTML = `<div id="once" data-math="true">x^2</div>`;

    renderMath();
    const first = document.getElementById('once')!.innerHTML;

    renderMath();
    expect(document.getElementById('once')!.innerHTML).toBe(first);
  });

  test('strips script tags and event handlers smuggled through raw TeX', () => {
    document.body.innerHTML = `
      <div id="xss" data-math="true">\\text{<script>alert("xss")</script><img src=x onerror="alert(1)">}</div>
    `;

    renderMath();

    const target = document.getElementById('xss')!;
    expect(target.getAttribute(RENDERED_FLAG)).toBe('true');
    expect(target.querySelectorAll('script')).toHaveLength(0);
    expect(target.querySelectorAll('[onerror]')).toHaveLength(0);
    expect(target.innerHTML).not.toContain('alert(1)');
  });

  test('refuses to build a link out of a scripting URL', () => {
    // trust:false makes KaTeX decline \href outright, so the command is typeset
    // as error text. The literal TeX survives inside the MathML <annotation>,
    // which is a text node by definition — assert on the DOM, not on the
    // substring, or this test passes for the wrong reason.
    const html = renderTexToSafeHtml('\\href{javascript:alert(1)}{click}');
    expect(html).not.toBeNull();

    document.body.innerHTML = html!;
    expect(document.querySelectorAll('a')).toHaveLength(0);
    expect(document.querySelectorAll('[href]')).toHaveLength(0);
    expect(document.querySelector('annotation')?.children ?? []).toHaveLength(0);
  });

  test('falls back to plain text, not raw markup, when KaTeX throws outright', () => {
    vi.spyOn(katex, 'renderToString').mockImplementation(() => {
      throw new Error('katex exploded');
    });

    document.body.innerHTML = `<div id="hard" data-math="true">\\sqrt{x}</div>`;
    expect(() => renderMath()).not.toThrow();

    const target = document.getElementById('hard')!;
    expect(target.getAttribute(RENDERED_FLAG)).toBe('error');
    expect(target.children).toHaveLength(0);
    expect(target.textContent).toBe('\\sqrt{x}');
    expect(renderTexToSafeHtml('\\sqrt{x}')).toBeNull();
  });

  test('degrades on invalid TeX instead of throwing or leaving the node bare', () => {
    document.body.innerHTML = `<div id="bad" data-math="true">\\invalidCommand{abc}</div>`;

    expect(() => renderMath()).not.toThrow();

    const target = document.getElementById('bad')!;
    expect(target.getAttribute(RENDERED_FLAG)).toBe('true');
    expect(target.innerHTML).not.toBe('');
  });

  test('debounces typesetting of nodes inserted after the first pass', async () => {
    document.body.innerHTML = `<div id="container"></div>`;
    startObserver(document.body);
    forceRender(document.body);

    const inserted = document.createElement('div');
    inserted.setAttribute('data-math', 'true');
    inserted.textContent = '\\sqrt{x}';
    document.getElementById('container')!.appendChild(inserted);

    await flushMicrotasks();

    vi.advanceTimersByTime(20);
    expect(inserted.getAttribute(RENDERED_FLAG)).toBeNull();

    vi.advanceTimersByTime(35);
    expect(inserted.getAttribute(RENDERED_FLAG)).toBe('true');
    expect(inserted.querySelector('.katex')).not.toBeNull();
  });

  test('watches two roots at once without either stealing the other', async () => {
    document.body.innerHTML = `<div id="left"></div><div id="right"></div>`;
    const left = document.getElementById('left')!;
    const right = document.getElementById('right')!;

    startObserver(left);
    startObserver(right);

    const inLeft = document.createElement('div');
    inLeft.setAttribute('data-math', 'true');
    inLeft.textContent = '\\alpha';
    left.appendChild(inLeft);

    const inRight = document.createElement('div');
    inRight.setAttribute('data-math', 'true');
    inRight.textContent = '\\beta';
    right.appendChild(inRight);

    await flushMicrotasks();
    vi.advanceTimersByTime(DEBOUNCE_MS + 5);

    expect(inLeft.getAttribute(RENDERED_FLAG)).toBe('true');
    expect(inRight.getAttribute(RENDERED_FLAG)).toBe('true');

    // Tearing one down must not blind the other.
    stopObserver(left);

    const alsoRight = document.createElement('div');
    alsoRight.setAttribute('data-math', 'true');
    alsoRight.textContent = '\\gamma';
    right.appendChild(alsoRight);

    await flushMicrotasks();
    vi.advanceTimersByTime(DEBOUNCE_MS + 5);

    expect(alsoRight.getAttribute(RENDERED_FLAG)).toBe('true');
  });

  test('re-arming the same root does not stack observers', async () => {
    startObserver(document.body);
    startObserver(document.body);
    startObserver(document.body);

    const inserted = document.createElement('div');
    inserted.setAttribute('data-math', 'true');
    inserted.textContent = '\\delta';
    document.body.appendChild(inserted);

    await flushMicrotasks();
    vi.advanceTimersByTime(DEBOUNCE_MS + 5);

    expect(inserted.getAttribute(RENDERED_FLAG)).toBe('true');
    expect(inserted.querySelectorAll('.katex')).toHaveLength(1);
  });

  test('stops typesetting once the observer is halted', async () => {
    startObserver(document.body);
    stopObserver();

    const inserted = document.createElement('div');
    inserted.setAttribute('data-math', 'true');
    inserted.textContent = '\\alpha';
    document.body.appendChild(inserted);

    await flushMicrotasks();
    vi.advanceTimersByTime(200);

    expect(inserted.getAttribute(RENDERED_FLAG)).toBeNull();
  });
});
