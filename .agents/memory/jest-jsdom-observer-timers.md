---
name: MutationObserver tests under Jest fake timers
description: Why a debounced MutationObserver test fails under jest.useFakeTimers, and the one-line fix.
---

# MutationObserver + jest fake timers

A test that mutates the DOM, then calls `jest.advanceTimersByTime(...)` and
expects a debounced observer callback to have run, **fails**: the assertion sees
nothing rendered.

**Why:** jsdom delivers `MutationObserver` records on a *microtask*, and fake
timers do not flush microtasks. Inside a synchronous test body the callback has
not run yet, so the `setTimeout` it would schedule does not exist when
`advanceTimersByTime` fires. Advancing time cannot trigger a timer that was
never registered.

**How to apply:** make the test `async` and give the microtask queue a turn
after each mutation, before advancing timers:

```ts
const flushMicrotasks = (): Promise<void> => Promise.resolve();

el.appendChild(node);
await flushMicrotasks();      // observer callback runs, debounce timer starts
jest.advanceTimersByTime(60); // now the timer exists and can fire
```

The same ordering applies to any burst test: flush after *each* mutation, or the
"one pass per burst" assertion measures nothing.
