import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';

/* ── Types ── */

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContextValue {
  toast: (type: ToastType, message: string, duration?: number) => void;
}

/* ── Context ── */

const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

/* ── Provider ── */

let toastCounter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((type: ToastType, message: string, duration = 4000) => {
    const id = `toast-${++toastCounter}`;
    setToasts((prev) => [...prev, { id, type, message, duration }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      {/* Toast container — fixed bottom-right */}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => removeToast(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ── Individual Toast ── */

const ICON_MAP = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const STYLE_MAP: Record<ToastType, string> = {
  success: 'border-[var(--color-ok)]/30 bg-[var(--color-ok)]/5',
  error:   'border-[var(--color-err)]/30 bg-[var(--color-err)]/5',
  warning: 'border-[var(--color-warn)]/30 bg-[var(--color-warn)]/5',
  info:    'border-[var(--color-plex-500)]/30 bg-[var(--color-plex-500)]/5',
};

const TEXT_MAP: Record<ToastType, string> = {
  success: 'text-[var(--color-ok)]',
  error:   'text-[var(--color-err)]',
  warning: 'text-[var(--color-warn)]',
  info:    'text-[var(--color-plex-400)]',
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon = ICON_MAP[toast.type];

  useEffect(() => {
    if (toast.duration && toast.duration > 0) {
      const timer = setTimeout(onDismiss, toast.duration);
      return () => clearTimeout(timer);
    }
  }, [toast.duration, onDismiss]);

  return (
    <div
      className={`flex items-start gap-2.5 px-4 py-3 rounded-xl border backdrop-blur-md shadow-lg animate-fade-in ${STYLE_MAP[toast.type]}`}
      role="alert"
    >
      <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${TEXT_MAP[toast.type]}`} />
      <p className="flex-1 text-xs text-[var(--color-text-secondary)] leading-relaxed">
        {toast.message}
      </p>
      <button
        onClick={onDismiss}
        className="p-0.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors flex-shrink-0"
        aria-label="Dismiss notification"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
