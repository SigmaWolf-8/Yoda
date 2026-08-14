import 'katex/dist/katex.min.css';
/**
 * Renders all unrendered maths elements inside `root`.
 *
 * Failures are contained per element: invalid TeX marks that one element as
 * `error` and the rest of the pass continues.
 */
export declare function renderMath(root?: Element | Document | ShadowRoot, selector?: string): void;
/** Renders `target` immediately, then keeps it up to date as it changes. */
export declare function startObserver(target?: Document | Element): void;
/** Stops watching and cancels any pending debounced pass. */
export declare function stopObserver(): void;
export { renderMath as forceRender };
