import { useState } from 'react';
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';
import { Hash, ArrowLeftRight } from 'lucide-react';
import type { TaskResult } from '../../types/task-result';

interface Props {
  results: TaskResult[];
}

export function ResultViewer({ results }: Props) {
  const sorted = [...results].sort((a, b) => a.step_number - b.step_number);
  const [activeStep, setActiveStep] = useState(sorted.length > 0 ? sorted[sorted.length - 1].step_number : 1);
  const [diffMode, setDiffMode] = useState(false);
  const [diffLeft, setDiffLeft] = useState(0);
  const [diffRight, setDiffRight] = useState(Math.min(1, sorted.length - 1));

  const activeResult = sorted.find((r) => r.step_number === activeStep);

  if (!sorted.length) {
    return <p className="text-sm text-[var(--color-text-muted)] p-4">No results available.</p>;
  }

  return (
    <div>
      {/* Tab bar */}
      <div className="flex items-center border-b border-[var(--color-border-subtle)]">
        <div className="flex flex-1">
          {sorted.map((r) => {
            const label = r.step_number === 4 ? 'Final' : `Result ${r.step_number}`;
            return (
              <button
                key={r.step_number}
                onClick={() => { setActiveStep(r.step_number); setDiffMode(false); }}
                className={`px-4 py-2.5 text-sm font-medium transition-colors ${
                  !diffMode && activeStep === r.step_number
                    ? 'text-[var(--color-gold-400)] border-b-2 border-[var(--color-gold-500)]'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        {sorted.length >= 2 && (
          <button
            onClick={() => setDiffMode(!diffMode)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${
              diffMode
                ? 'text-[var(--color-gold-400)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
            }`}
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            Diff
          </button>
        )}
      </div>

      {/* Content */}
      {diffMode ? (
        <div>
          {/* Diff selector */}
          <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-surface-tertiary)]/30 border-b border-[var(--color-border-subtle)]">
            <select
              value={diffLeft}
              onChange={(e) => setDiffLeft(Number(e.target.value))}
              className="px-2 py-1 rounded text-sm bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)]"
            >
              {sorted.map((r, i) => (
                <option key={i} value={i}>
                  {r.step_number === 4 ? 'Final' : `Result ${r.step_number}`}
                </option>
              ))}
            </select>
            <ArrowLeftRight className="w-3 h-3 text-[var(--color-text-muted)]" />
            <select
              value={diffRight}
              onChange={(e) => setDiffRight(Number(e.target.value))}
              className="px-2 py-1 rounded text-sm bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)]"
            >
              {sorted.map((r, i) => (
                <option key={i} value={i}>
                  {r.step_number === 4 ? 'Final' : `Result ${r.step_number}`}
                </option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto text-sm">
            <ReactDiffViewer
              oldValue={sorted[diffLeft]?.result_content ?? ''}
              newValue={sorted[diffRight]?.result_content ?? ''}
              splitView={true}
              compareMethod={DiffMethod.WORDS}
              useDarkTheme={true}
              styles={{
                variables: {
                  dark: {
                    diffViewerBackground: 'var(--color-navy-900)',
                    addedBackground: 'rgba(34, 197, 94, 0.08)',
                    removedBackground: 'rgba(239, 68, 68, 0.08)',
                    wordAddedBackground: 'rgba(34, 197, 94, 0.2)',
                    wordRemovedBackground: 'rgba(239, 68, 68, 0.2)',
                    addedGutterBackground: 'rgba(34, 197, 94, 0.12)',
                    removedGutterBackground: 'rgba(239, 68, 68, 0.12)',
                    gutterBackground: 'var(--color-navy-800)',
                    gutterBackgroundDark: 'var(--color-navy-900)',
                    codeFoldBackground: 'var(--color-navy-800)',
                    codeFoldGutterBackground: 'var(--color-navy-800)',
                    emptyLineBackground: 'var(--color-navy-900)',
                  },
                },
                line: { fontSize: '13px', lineHeight: '1.5' },
              }}
            />
          </div>
        </div>
      ) : activeResult ? (
        <div className="p-4">
          {/* TIS-27 hash badge */}
          <div className="flex items-center gap-1.5 mb-3 text-[11px] text-[var(--color-text-muted)]">
            <Hash className="w-3 h-3" />
            <span className="font-mono">TIS-27: {activeResult.tis27_hash}</span>
            <span>· Engine {activeResult.engine_id.toUpperCase()}</span>
            <span>· {activeResult.agent_role}</span>
          </div>
          <pre className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap break-words leading-relaxed">
            {activeResult.result_content}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
