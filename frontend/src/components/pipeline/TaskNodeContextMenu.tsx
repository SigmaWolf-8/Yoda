import { RefreshCw, AlertTriangle, XCircle } from 'lucide-react';
import { useRetryTask, useEscalateTask, useCancelTask } from '../../api/hooks';

interface Props {
  taskId: string;
  x: number;
  y: number;
  onClose: () => void;
}

export function TaskNodeContextMenu({ taskId, x, y, onClose }: Props) {
  const retry = useRetryTask();
  const escalate = useEscalateTask();
  const cancel = useCancelTask();

  function handle(action: 'retry' | 'escalate' | 'cancel') {
    switch (action) {
      case 'retry':    retry.mutate(taskId);    break;
      case 'escalate': escalate.mutate(taskId); break;
      case 'cancel':   cancel.mutate(taskId);   break;
    }
    onClose();
  }

  return (
    <>
      <div className="fixed inset-0 z-50" onClick={onClose} />
      <div
        className="fixed z-50 w-40 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] shadow-xl py-1 animate-fade-in"
        style={{ left: x, top: y }}
      >
        <button
          onClick={() => handle('retry')}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)] transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry Step
        </button>
        <button
          onClick={() => handle('escalate')}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-warn)] hover:bg-[var(--color-warn)]/10 transition-colors"
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          Escalate
        </button>
        <hr className="my-1 border-[var(--color-border-subtle)]" />
        <button
          onClick={() => handle('cancel')}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-err)] hover:bg-[var(--color-err)]/10 transition-colors"
        >
          <XCircle className="w-3.5 h-3.5" />
          Cancel Task
        </button>
      </div>
    </>
  );
}
