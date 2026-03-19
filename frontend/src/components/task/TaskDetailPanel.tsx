import { useState } from 'react';
import {
  FileText,
  MessageSquare,
  Shield,
  Clock,
  Cpu,
  Hash,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { StepProgressIndicator } from '../pipeline/StepProgressIndicator';
import type { Task } from '../../types';
import type { TaskResult } from '../../types/task-result';
import type { TaskReview } from '../../types/task-review';

interface Props {
  task: Task;
  results: TaskResult[];
  reviews: TaskReview[];
}

export function TaskDetailPanel({ task, results, reviews }: Props) {
  const [tab, setTab] = useState<'overview' | 'results' | 'reviews'>('overview');

  const tabs = [
    { key: 'overview' as const, label: 'Overview', icon: FileText },
    { key: 'results' as const, label: `Results (${results.length})`, icon: FileText },
    { key: 'reviews' as const, label: `Reviews (${reviews.length})`, icon: MessageSquare },
  ];

  return (
    <div className="h-full flex flex-col bg-[var(--color-surface-secondary)]">
      {/* Header */}
      <div className="p-4 border-b border-[var(--color-border-subtle)]">
        <div className="flex items-center gap-2 mb-1.5">
          <code className="text-[10px] font-mono text-[var(--color-text-muted)] bg-[var(--color-surface-tertiary)] px-1.5 py-0.5 rounded">
            {task.task_number}
          </code>
          <span className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded ${
            task.status === 'FINAL'
              ? 'text-[var(--color-ok)] bg-[var(--color-ok)]/10'
              : task.status === 'ESCALATED'
                ? 'text-[var(--color-warn)] bg-[var(--color-warn)]/10'
                : 'text-[var(--color-plex-400)] bg-[var(--color-plex-500)]/10'
          }`}>
            {task.status.replace(/_/g, ' ')}
          </span>
        </div>
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">
          {task.title}
        </h3>
        <StepProgressIndicator status={task.status} />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--color-border-subtle)]">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors ${
              tab === key
                ? 'text-[var(--color-gold-400)] border-b-2 border-[var(--color-gold-500)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
            }`}
          >
            <Icon className="w-3 h-3" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'overview' && (
          <OverviewTab task={task} resultCount={results.length} reviewCount={reviews.length} />
        )}
        {tab === 'results' && <ResultsTab results={results} />}
        {tab === 'reviews' && <ReviewsTab reviews={reviews} />}
      </div>
    </div>
  );
}

/* ── Overview Tab ── */

function OverviewTab({ task, resultCount, reviewCount }: { task: Task; resultCount: number; reviewCount: number }) {
  return (
    <div className="space-y-4">
      <Section title="Assignment">
        <InfoRow icon={Cpu} label="Primary Engine" value={`Engine ${task.primary_engine?.toUpperCase()}`} />
        <InfoRow icon={Shield} label="Agent Role" value={task.primary_agent_role} />
        <InfoRow icon={Hash} label="Workflow Position" value={`#${task.workflow_position}`} />
        <InfoRow icon={FileText} label="Mode" value={task.mode.toUpperCase()} />
      </Section>

      <Section title="Competencies">
        <div className="flex gap-1 flex-wrap">
          {task.competencies.map((c) => (
            <span
              key={c}
              className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-[var(--color-plex-500)]/10 text-[var(--color-plex-400)] border border-[var(--color-plex-500)]/20"
            >
              {c}
            </span>
          ))}
        </div>
      </Section>

      <Section title="Pipeline Stats">
        <InfoRow icon={FileText} label="Result Versions" value={String(resultCount)} />
        <InfoRow icon={MessageSquare} label="Review Assessments" value={String(reviewCount)} />
      </Section>

      <Section title="Timestamps">
        <InfoRow icon={Clock} label="Created" value={new Date(task.created_at).toLocaleString()} />
        <InfoRow icon={Clock} label="Last Updated" value={new Date(task.updated_at).toLocaleString()} />
      </Section>
    </div>
  );
}

/* ── Results Tab ── */

function ResultsTab({ results }: { results: TaskResult[] }) {
  const sorted = [...results].sort((a, b) => a.step_number - b.step_number);

  if (!sorted.length) {
    return <p className="text-xs text-[var(--color-text-muted)]">No results yet.</p>;
  }

  return (
    <div className="space-y-3">
      {sorted.map((r) => (
        <ResultCard key={r.id} result={r} />
      ))}
    </div>
  );
}

function ResultCard({ result }: { result: TaskResult }) {
  const [expanded, setExpanded] = useState(false);
  const stepLabel = result.step_number === 4 ? 'Final Output' : `Step ${result.step_number} Result`;

  return (
    <div className="rounded-lg border border-[var(--color-border-subtle)] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-[var(--color-surface-tertiary)]/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="w-3 h-3 text-[var(--color-text-muted)]" /> : <ChevronRight className="w-3 h-3 text-[var(--color-text-muted)]" />}
          <span className={`text-xs font-semibold ${result.step_number === 4 ? 'text-[var(--color-ok)]' : 'text-[var(--color-text-primary)]'}`}>
            {stepLabel}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[9px] text-[var(--color-text-muted)]">
          <span>Engine {result.engine_id.toUpperCase()}</span>
          <span className="font-mono">{result.tis27_hash.slice(0, 12)}…</span>
        </div>
      </button>
      {expanded && (
        <div className="px-3 pb-3 border-t border-[var(--color-border-subtle)]">
          <pre className="mt-2 text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap break-words leading-relaxed max-h-60 overflow-y-auto">
            {result.result_content}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ── Reviews Tab ── */

function ReviewsTab({ reviews }: { reviews: TaskReview[] }) {
  const sorted = [...reviews].sort((a, b) => (a.step_number ?? 0) - (b.step_number ?? 0));

  if (!sorted.length) {
    return <p className="text-xs text-[var(--color-text-muted)]">No reviews yet.</p>;
  }

  return (
    <div className="space-y-3">
      {sorted.map((r) => (
        <ReviewCard key={r.id} review={r} />
      ))}
    </div>
  );
}

function ReviewCard({ review }: { review: TaskReview }) {
  const [expanded, setExpanded] = useState(false);
  const passCount = Object.values(review.verdict.pass_fail).filter(Boolean).length;
  const totalCriteria = Object.keys(review.verdict.pass_fail).length;
  const allPass = passCount === totalCriteria;

  return (
    <div className={`rounded-lg border overflow-hidden ${
      review.censorship_flagged
        ? 'border-[var(--color-warn)]/30 bg-[var(--color-warn)]/5'
        : 'border-[var(--color-border-subtle)]'
    }`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-[var(--color-surface-tertiary)]/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="w-3 h-3 text-[var(--color-text-muted)]" /> : <ChevronRight className="w-3 h-3 text-[var(--color-text-muted)]" />}
          <span className="text-xs font-semibold text-[var(--color-text-primary)]">
            Step {review.step_number ?? '?'} — Engine {review.engine_id.toUpperCase()}
          </span>
          {review.censorship_flagged && (
            <span className="text-[9px] font-semibold text-[var(--color-warn)] bg-[var(--color-warn)]/10 px-1.5 py-0.5 rounded">
              CENSORED
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-semibold ${allPass ? 'text-[var(--color-ok)]' : 'text-[var(--color-warn)]'}`}>
            {passCount}/{totalCriteria}
          </span>
          <span className="text-[9px] text-[var(--color-text-muted)]">
            {Math.round(review.verdict.confidence * 100)}%
          </span>
        </div>
      </button>
      {expanded && (
        <div className="px-3 pb-3 border-t border-[var(--color-border-subtle)] space-y-2 mt-0 pt-2">
          {/* Pass/Fail grid */}
          <div className="grid grid-cols-2 gap-1">
            {Object.entries(review.verdict.pass_fail).map(([criterion, passed]) => (
              <div
                key={criterion}
                className={`text-[9px] px-2 py-1 rounded ${
                  passed
                    ? 'bg-[var(--color-ok)]/10 text-[var(--color-ok)]'
                    : 'bg-[var(--color-err)]/10 text-[var(--color-err)]'
                }`}
              >
                {passed ? '✓' : '✗'} {criterion}
              </div>
            ))}
          </div>

          {/* Issues */}
          {review.verdict.issues.length > 0 && (
            <div>
              <p className="text-[9px] font-semibold text-[var(--color-text-muted)] uppercase mb-1">Issues</p>
              {review.verdict.issues.map((issue, i) => (
                <div key={i} className="text-[10px] text-[var(--color-text-secondary)] mb-1 pl-2 border-l-2 border-[var(--color-err)]/30">
                  <span className={`font-semibold uppercase mr-1 ${
                    issue.severity === 'critical' ? 'text-[var(--color-err)]'
                    : issue.severity === 'high' ? 'text-[var(--color-warn)]'
                    : 'text-[var(--color-text-muted)]'
                  }`}>{issue.severity}</span>
                  {issue.description}
                  {issue.reference && <span className="text-[var(--color-text-muted)]"> ({issue.reference})</span>}
                </div>
              ))}
            </div>
          )}

          {/* Suggestions */}
          {review.verdict.suggestions.length > 0 && (
            <div>
              <p className="text-[9px] font-semibold text-[var(--color-text-muted)] uppercase mb-1">Suggestions</p>
              {review.verdict.suggestions.map((s, i) => (
                <p key={i} className="text-[10px] text-[var(--color-text-tertiary)] pl-2">• {s}</p>
              ))}
            </div>
          )}

          <p className="text-[9px] font-mono text-[var(--color-text-muted)]">
            TIS-27: {review.tis27_hash.slice(0, 20)}…
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Helpers ── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
        {title}
      </p>
      {children}
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Cpu; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-xs py-0.5">
      <Icon className="w-3 h-3 text-[var(--color-text-muted)] flex-shrink-0" />
      <span className="text-[var(--color-text-muted)]">{label}:</span>
      <span className="text-[var(--color-text-secondary)]">{value}</span>
    </div>
  );
}
