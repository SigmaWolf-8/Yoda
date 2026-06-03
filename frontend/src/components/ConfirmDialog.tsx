import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Custom confirmation modal — replaces window.confirm, which is silently
 * blocked in sandboxed iframes (e.g. the Replit preview pane).
 */
export function ConfirmDialog({
  open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  destructive = false, onConfirm, onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onMouseDown={onCancel}
    >
      <div
        className="w-full max-w-md mx-4 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-primary)] shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-5 py-4 border-b border-[var(--color-border-subtle)]">
          {destructive && (
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[var(--color-err)]/10 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-[var(--color-err)]" />
            </div>
          )}
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] mt-1">
            {title}
          </h2>
        </div>
        <div className="px-5 py-4 text-sm text-[var(--color-text-secondary)] leading-relaxed">
          {message}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)]/40 rounded-b-lg">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)] transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
              destructive
                ? 'bg-[var(--color-err)] text-white hover:bg-[var(--color-err)]/90'
                : 'bg-[var(--color-plex-500)] text-white hover:bg-[var(--color-plex-400)]'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
