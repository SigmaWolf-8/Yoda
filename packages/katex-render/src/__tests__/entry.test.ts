import katex from 'katex';
import { renderMath, forceRender, startObserver, stopObserver } from '../entry';

// Comfortably past the module's 50 ms debounce window.
const DEBOUNCE_SETTLE = 60;

/** Lets jsdom deliver queued MutationObserver records. */
const flushMicrotasks = (): Promise<void> => Promise.resolve();

describe('KaTeX pipeline — DOM rendering and sanitisation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '';
    stopObserver();
  });

  afterEach(() => {
    stopObserver();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('renders valid LaTeX and stamps the rendered flag', () => {
    document.body.innerHTML = `
      <div id="target" data-math="true">\\frac{1}{2}</div>
      <span class="math">E = mc^2</span>
    `;

    renderMath();

    const mathEl = document.getElementById('target')!;
    const classEl = document.querySelector('.math')!;

    expect(mathEl.getAttribute('data-katex-rendered')).toBe('true');
    expect(classEl.getAttribute('data-katex-rendered')).toBe('true');
    expect(mathEl.querySelector('.katex')).not.toBeNull();
    expect(classEl.querySelector('.katex')).not.toBeNull();
  });

  test('renders display maths when data-display is present', () => {
    document.body.innerHTML = `<div id="d" data-math="true" data-display>\\sum_{i=1}^{n} i</div>`;
    renderMath();
    const el = document.getElementById('d')!;
    expect(el.querySelector('.katex-display')).not.toBeNull();
  });

  test('treats .display-math as display mode too', () => {
    document.body.innerHTML = `<div id="d" class="math display-math">\\int_0^1 x\\,dx</div>`;
    renderMath();
    expect(document.getElementById('d')!.querySelector('.katex-display')).not.toBeNull();
  });

  test('keeps the SVG structures KaTeX draws for radicals', () => {
    // Guard against "hardening" the sanitiser by dropping the SVG profile:
    // that silently deletes the bar over a square root.
    document.body.innerHTML = `<div id="r" data-math="true">\\sqrt{x+1}</div>`;
    renderMath();
    const el = document.getElementById('r')!;
    expect(el.querySelector('.katex')).not.toBeNull();
    expect(el.querySelectorAll('svg, .sqrt').length).toBeGreaterThan(0);
  });

  test('strips scripts and inline event handlers from rendered output', () => {
    document.body.innerHTML = `
      <div id="xss-target" data-math="true">
        \\text{<script>alert("xss")</script><img src="x" onerror="alert(1)">}
      </div>
    `;

    renderMath();

    const target = document.getElementById('xss-target')!;
    expect(target.getAttribute('data-katex-rendered')).toBe('true');
    expect(target.querySelectorAll('script').length).toBe(0);
    expect(target.querySelector('img')?.hasAttribute('onerror')).toBeFalsy();
    expect(target.innerHTML).not.toContain('onerror');
  });

  test('handles invalid LaTeX without throwing or blanking the page', () => {
    document.body.innerHTML = `<div id="invalid-math" data-math="true">\\invalidCommand{abc}</div>`;

    expect(() => renderMath()).not.toThrow();

    const target = document.getElementById('invalid-math')!;
    expect(target.getAttribute('data-katex-rendered')).toBe('true');
    expect(document.body.textContent).not.toBe('');
  });

  test('never renders the same element twice', () => {
    document.body.innerHTML = `<div id="once" data-math="true">a^2</div>`;
    renderMath();
    const first = document.getElementById('once')!.innerHTML;
    renderMath();
    expect(document.getElementById('once')!.innerHTML).toBe(first);
  });

  test('is a no-op when there is nothing to render', () => {
    document.body.innerHTML = `<div>plain</div>`;
    expect(() => renderMath()).not.toThrow();
    expect(document.body.innerHTML).toBe('<div>plain</div>');
  });

  test('renders within an explicit subtree only', () => {
    document.body.innerHTML = `
      <div id="inside"><span class="math">x^2</span></div>
      <span id="outside" class="math">y^2</span>
    `;
    renderMath(document.getElementById('inside')!);
    expect(document.querySelector('#inside .math')!.getAttribute('data-katex-rendered')).toBe('true');
    expect(document.getElementById('outside')!.getAttribute('data-katex-rendered')).toBeNull();
  });

  test('debounces the observer on dynamic insertion', async () => {
    document.body.innerHTML = `<div id="container"></div>`;
    startObserver();
    forceRender();

    const container = document.getElementById('container')!;
    const newMath = document.createElement('div');
    newMath.setAttribute('data-math', 'true');
    newMath.id = 'dynamic-node';
    newMath.textContent = '\\sqrt{x}';
    container.appendChild(newMath);

    // jsdom delivers MutationObserver records on a microtask; fake timers do
    // not flush those, so the callback has to be given a turn before its
    // debounce timer exists at all.
    await flushMicrotasks();

    jest.advanceTimersByTime(20);
    expect(newMath.getAttribute('data-katex-rendered')).toBeNull();

    jest.advanceTimersByTime(35);
    expect(newMath.getAttribute('data-katex-rendered')).toBe('true');
    expect(newMath.querySelector('.katex')).not.toBeNull();
  });

  test('collapses a burst of mutations into a single pass', async () => {
    document.body.innerHTML = `<div id="c"></div>`;
    startObserver();
    const c = document.getElementById('c')!;

    for (let i = 0; i < 5; i++) {
      const n = document.createElement('div');
      n.setAttribute('data-math', 'true');
      n.textContent = `x^{${i}}`;
      c.appendChild(n);
      await flushMicrotasks();
      jest.advanceTimersByTime(10);
    }

    // Each insertion restarted the 50 ms window, so nothing has rendered yet.
    expect(c.querySelectorAll('[data-katex-rendered]').length).toBe(0);

    jest.advanceTimersByTime(DEBOUNCE_SETTLE);
    expect(c.querySelectorAll('[data-katex-rendered="true"]').length).toBe(5);
  });

  test('re-renders when a watched attribute changes', async () => {
    document.body.innerHTML = `<div id="late">z^2</div>`;
    startObserver();

    const el = document.getElementById('late')!;
    el.className = 'math';

    await flushMicrotasks();
    jest.advanceTimersByTime(DEBOUNCE_SETTLE);

    expect(el.getAttribute('data-katex-rendered')).toBe('true');
  });

  test('ignores mutations that add no elements', async () => {
    document.body.innerHTML = `<div id="t"></div>`;
    startObserver();

    const t = document.getElementById('t')!;
    t.appendChild(document.createTextNode('just text'));

    await flushMicrotasks();
    jest.advanceTimersByTime(DEBOUNCE_SETTLE);

    expect(t.querySelectorAll('[data-katex-rendered]').length).toBe(0);
    expect(t.textContent).toBe('just text');
  });

  test('marks an element as error when the renderer throws', () => {
    const spy = jest.spyOn(katex, 'render').mockImplementation(() => {
      throw new Error('renderer exploded');
    });

    document.body.innerHTML = `<div id="boom" data-math="true">x</div>`;
    expect(() => renderMath()).not.toThrow();
    expect(document.getElementById('boom')!.getAttribute('data-katex-rendered')).toBe('error');

    spy.mockRestore();
  });

  test('halts observation when stopObserver is invoked', () => {
    startObserver();
    stopObserver();

    const newMath = document.createElement('div');
    newMath.setAttribute('data-math', 'true');
    newMath.id = 'detached-node';
    newMath.textContent = '\\alpha';
    document.body.appendChild(newMath);

    jest.advanceTimersByTime(100);
    expect(newMath.getAttribute('data-katex-rendered')).toBeNull();
  });

  test('stopObserver is safe to call repeatedly', () => {
    startObserver();
    expect(() => {
      stopObserver();
      stopObserver();
    }).not.toThrow();
  });
});