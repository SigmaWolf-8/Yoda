import { Wifi, WifiOff, Clock, CheckCircle2, AlertTriangle, XCircle, Loader2 } from 'lucide-react';
import type { Task } from '../../types';

interface Props {
  tasks: Task[];
  connected: boolean;
  intensity?: 'full' | 'medium' | 'light';
  startedAt?: string;
}

export function PipelineStatusBar({ tasks, connected, intensity = 'full', startedAt }: Props) {
  const total = tasks.length;
  const final = tasks.filter((t) => t.status === 'FINAL').length;
  const escalated = tasks.filter((t) => t.status === 'ESCALATED').length;
  const cancelled = tasks.filter((t) => t.status === 'CANCELLED').length;
  const inProgress = tasks.filter((t) => t.status.startsWith('STEP_')).length;
  const queued = total - final - escalated - cancelled - inProgress;

  // Elapsed
  let elapsed = '';
  if (startedAt) {
    const s = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
    if (s < 60) elapsed = `${s}s`;
    else {
      const m = Math.floor(s / 60);
      elapsed = `${m}m ${s % 60}s`;
    }
  }

  const INTENSITY_LABEL: Record<string, string> = {
    full: '13 calls/task',
    medium: '9 calls/task',
    light: '5 calls/task',
  };

  return (
    <div className="flex items-center gap-4 px-4 py-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)]/80 backdrop-blur-sm text-xs">
      {/* Connection */}
      <div className="flex items-center gap-1.5">
        {connected ? (
          <Wifi className="w-3 h-3 text-[var(--color-ok)]" />
        ) : (
          <WifiOff className="w-3 h-3 text-[var(--color-err)]" />
        )}
        <span className={connected ? 'text-[var(--color-ok)]' : 'text-[var(--color-err)]'}>
          {connected ? 'Live' : 'Disconnected'}
        </span>
      </div>

      <div className="w-px h-3 bg-[var(--color-border-subtle)]" />

      {/* Task counts */}
      <div className="flex items-center gap-3">
        <span className="text-[var(--color-text-muted)]">
          {total} tasks
        </span>
        {inProgress > 0 && (
          <span className="flex items-center gap-1 text-[var(--color-plex-400)]">
            <Loader2 className="w-3 h-3 animate-spin" />
            {inProgress} active
          </span>
        )}
        {final > 0 && (
          <span className="flex items-center gap-1 text-[var(--color-ok)]">
            <CheckCircle2 className="w-3 h-3" />
            {final} done
          </span>
        )}
        {escalated > 0 && (
          <span className="flex items-center gap-1 text-[var(--color-warn)]">
            <AlertTriangle className="w-3 h-3" />
            {escalated}
          </span>
        )}
        {cancelled > 0 && (
          <span className="flex items-center gap-1 text-[var(--color-err)]">
            <XCircle className="w-3 h-3" />
            {cancelled}
          </span>
        )}
      </div>

      <div className="flex-1" />

      {/* Intensity */}
      <span className="px-1.5 py-0.5 rounded bg-[var(--color-surface-tertiary)] text-[var(--color-text-muted)] uppercase font-semibold tracking-wider">
        {intensity} · {INTENSITY_LABEL[intensity]}
      </span>

      {/* Elapsed */}
      {elapsed && (
        <div className="flex items-center gap-1 text-[var(--color-text-muted)]">
          <Clock className="w-3 h-3" />
          {elapsed}
        </div>
      )}
    </div>
  );
}
