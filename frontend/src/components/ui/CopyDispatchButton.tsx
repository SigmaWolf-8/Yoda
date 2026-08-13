import { useEffect, useRef, useState } from 'react';
import { Check, ClipboardCopy, Loader2, X } from 'lucide-react';
import { copyDispatch, type Dispatch } from '../../lib/clipboard';

/**
 * One button that puts a formatted record on the clipboard, ready to paste into
 * a message or an email.
 *
 * `build` is synchronous by contract. Safari only honours a clipboard write
 * that happens in the same turn as the click, so anything that has to be
 * fetched or re-encoded must already be in hand — pages here prepare their
 * payload in the background and pass `null` until it is ready, which disables
 * the button rather than letting it fail in the user's hand.
 *
 * When the clipboard is unavailable altogether — an insecure origin, an
 * embedding frame that withholds permission — the text is shown in a selectable
 * box instead. A copy button that silently does nothing is worse than one that
 * hands over the text and says so.
 */
export function CopyDispatchButton({
  build,
  label = 'Copy to send',
  preparingLabel = 'Preparing…',
  className = '',
  title,
}: {
  /** Returns the payload, or null while it is still being prepared. */
  build: () => Dispatch | null;
  label?: string;
  preparingLabel?: string;
  className?: string;
  title?: string;
}) {
  const [state, setState] = useState<'idle' | 'working' | 'rich' | 'plain'>('idle');
  const [manual, setManual] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Present the text already selected, so the fallback is one long-press away.
  useEffect(() => {
    if (manual && areaRef.current) {
      areaRef.current.focus();
      areaRef.current.select();
    }
  }, [manual]);

  /*
   * Hold the keyboard inside the dialog while it is open, and hand focus back
   * to the button that opened it. Without this, tabbing walks out into the page
   * behind the overlay — where a keyboard user has no way to tell that what
   * they are now focused on is unreachable by mouse.
   */
  useEffect(() => {
    if (!manual) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setManual(null);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button, textarea');
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [manual]);

  useEffect(() => {
    if (manual) return;
    returnFocusTo.current?.focus();
    returnFocusTo.current = null;
  }, [manual]);

  const ready = build() !== null;

  async function onClick() {
    const payload = build();
    if (!payload) return;
    setState('working');
    const outcome = await copyDispatch(payload);
    if (outcome === 'manual') {
      setState('idle');
      returnFocusTo.current = document.activeElement as HTMLElement | null;
      setManual(payload.text);
      return;
    }
    setState(outcome);
    timer.current = window.setTimeout(() => setState('idle'), 4000);
  }

  const copied = state === 'rich' || state === 'plain';

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={!ready || state === 'working'}
        title={title}
        aria-live="polite"
        className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          copied
            ? 'bg-emerald-500/15 text-emerald-400'
            : 'bg-[var(--color-gold-400)]/15 text-[var(--color-gold-400)] hover:bg-[var(--color-gold-400)]/25'
        } ${className}`}
      >
        {state === 'working' ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : copied ? (
          <Check className="w-3.5 h-3.5" />
        ) : (
          <ClipboardCopy className="w-3.5 h-3.5" />
        )}
        {state === 'working'
          ? 'Copying…'
          : state === 'rich'
            ? 'Copied — paste it anywhere'
            : state === 'plain'
              ? 'Copied as plain text'
              : ready
                ? label
                : preparingLabel}
      </button>

      {manual && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Copy manually"
          onClick={() => setManual(null)}
        >
          <div
            ref={dialogRef}
            className="bg-[var(--color-surface-primary)] border border-[var(--color-border-default)] w-full max-w-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-3">
              <div className="min-w-0">
                <div className="text-sm font-bold text-[var(--color-text-primary)]">
                  This browser would not let the page write to the clipboard
                </div>
                <p className="text-xs text-[var(--color-text-muted)] mt-1 leading-relaxed">
                  The text is below and already selected. Long-press or right-click it, choose
                  Copy, then paste it into your message or email.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setManual(null)}
                aria-label="Close"
                className="ml-auto p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <textarea
              ref={areaRef}
              readOnly
              value={manual}
              className="w-full h-72 bg-black/40 border border-[var(--color-border-subtle)] p-3 text-[11px] font-mono text-[var(--color-text-primary)] leading-relaxed"
            />
          </div>
        </div>
      )}
    </>
  );
}
