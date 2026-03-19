import type { TaskStatus } from '../../types';

interface Props {
  status: TaskStatus;
  compact?: boolean;
}

const STEPS = [1, 2, 3, 4] as const;

function stepState(step: number, status: TaskStatus): 'done' | 'active' | 'pending' {
  const statusStep = getStepNumber(status);
  const isReview = status.includes('REVIEW');

  if (status === 'FINAL') return 'done';
  if (status === 'ESCALATED' || status === 'CANCELLED') {
    return step <= statusStep ? 'done' : 'pending';
  }
  if (step < statusStep) return 'done';
  if (step === statusStep) return 'active';
  return 'pending';
}

function getStepNumber(status: TaskStatus): number {
  if (status === 'FINAL') return 5;
  const match = status.match(/STEP_(\d)/);
  return match ? parseInt(match[1], 10) : 0;
}

const STATE_STYLES = {
  done:    'bg-[var(--color-ok)] text-[var(--color-navy-950)] border-[var(--color-ok)]',
  active:  'bg-[var(--color-plex-500)] text-white border-[var(--color-plex-400)] animate-pulse',
  pending: 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-muted)] border-[var(--color-border-default)]',
};

const LINE_STYLES = {
  done:    'bg-[var(--color-ok)]',
  active:  'bg-[var(--color-plex-500)]/50',
  pending: 'bg-[var(--color-border-default)]',
};

export function StepProgressIndicator({ status, compact }: Props) {
  const size = compact ? 'w-4 h-4 text-[7px]' : 'w-5 h-5 text-[8px]';
  const lineH = compact ? 'h-0.5' : 'h-0.5';

  return (
    <div className="flex items-center gap-0">
      {STEPS.map((step, i) => {
        const state = stepState(step, status);
        const nextState = i < 3 ? stepState(step + 1, status) : 'pending';
        const lineState = state === 'done' && nextState !== 'pending' ? 'done'
          : state === 'active' ? 'active'
          : 'pending';

        return (
          <div key={step} className="flex items-center">
            <div
              className={`${size} rounded-full border flex items-center justify-center font-bold flex-shrink-0 ${STATE_STYLES[state]}`}
              title={`Step ${step}: ${state}`}
            >
              {step}
            </div>
            {i < 3 && (
              <div className={`w-3 ${lineH} ${LINE_STYLES[lineState]}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
