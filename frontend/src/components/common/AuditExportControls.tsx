import { FileJson, Download, Loader2 } from 'lucide-react';
import { useExportAuditJSON } from '../../api/hooks';

interface Props {
  taskId: string;
}

export function AuditExportControls({ taskId }: Props) {
  const exportJSON = useExportAuditJSON();

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => exportJSON.mutate(taskId)}
        disabled={exportJSON.isPending}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-[var(--color-ok)]/5 text-[var(--color-ok)] border border-[var(--color-ok)]/20 hover:bg-[var(--color-ok)]/10 disabled:opacity-50 transition-colors"
      >
        {exportJSON.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileJson className="w-3 h-3" />}
        Signed JSON
      </button>
    </div>
  );
}
