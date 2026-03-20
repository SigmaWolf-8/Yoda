import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  BookOpen,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Code,
  Shield,
  FileText,
  ChevronRight,
} from 'lucide-react';
import { useProject, useTaskBible, useTaskBibleEntry } from '../../api/hooks';
import { ResultViewer } from '../../components/task/ResultViewer';
import { InlineCodeBlocks } from '../../components/task/InlineCodeBlocks';
import { SignatureDisplay } from '../../components/task/SignatureDisplay';

export function TaskBiblePage() {
  const { id } = useParams<{ id: string }>();
  const { data: project } = useProject(id);
  const { data: entries, isLoading } = useTaskBible(id);
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>();
  const { data: detail, isLoading: detailLoading } = useTaskBibleEntry(selectedTaskId);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* ── Left: Entry List ── */}
      <div className="w-80 flex-shrink-0 border-r border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)] flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border-subtle)]">
          <Link
            to={`/projects/${id}`}
            className="p-1 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <BookOpen className="w-4 h-4 text-[var(--color-gold-400)]" />
          <div>
            <h1 className="text-sm font-semibold text-[var(--color-text-primary)]">Task Bible</h1>
            {project && <p className="text-xs text-[var(--color-text-muted)]">{project.name}</p>}
          </div>
        </div>

        {/* Entry list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center gap-2 text-[var(--color-text-muted)] p-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading entries…</span>
            </div>
          ) : !entries?.length ? (
            <div className="p-6 text-center">
              <BookOpen className="w-8 h-8 text-[var(--color-text-muted)] mx-auto mb-3" />
              <p className="text-sm text-[var(--color-text-muted)]">
                No Task Bible entries yet. Complete a pipeline to populate.
              </p>
            </div>
          ) : (
            <div className="py-1">
              {entries.map((entry) => {
                const isSelected = entry.task_id === selectedTaskId;
                return (
                  <button
                    key={entry.id}
                    onClick={() => setSelectedTaskId(entry.task_id)}
                    className={`w-full text-left px-4 py-3 border-b border-[var(--color-border-subtle)] transition-colors ${
                      isSelected
                        ? 'bg-[var(--color-gold-500)]/5 border-l-2 border-l-[var(--color-gold-500)]'
                        : 'hover:bg-[var(--color-surface-tertiary)]/30'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <code className="text-[11px] font-mono text-[var(--color-text-muted)]">
                        {entry.task_number}
                      </code>
                      {entry.status === 'FINAL' ? (
                        <CheckCircle2 className="w-3 h-3 text-[var(--color-ok)]" />
                      ) : (
                        <AlertTriangle className="w-3 h-3 text-[var(--color-warn)]" />
                      )}
                    </div>
                    <p className="text-sm font-medium text-[var(--color-text-primary)] line-clamp-1">
                      {entry.title}
                    </p>
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-[var(--color-text-muted)]">
                      {entry.code_block_count > 0 && (
                        <span className="flex items-center gap-0.5">
                          <Code className="w-2.5 h-2.5" />
                          {entry.code_block_count}
                        </span>
                      )}
                      <span className="flex items-center gap-0.5">
                        <FileText className="w-2.5 h-2.5" />
                        {entry.review_count} reviews
                      </span>
                      {entry.tl_dsa_signature && (
                        <span className="flex items-center gap-0.5">
                          <Shield className="w-2.5 h-2.5 text-[var(--color-ok)]" />
                          signed
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Right: Detail View ── */}
      <div className="flex-1 overflow-y-auto">
        {!selectedTaskId ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <BookOpen className="w-10 h-10 text-[var(--color-text-muted)] mb-4" />
            <p className="text-sm text-[var(--color-text-tertiary)]">
              Select an entry to view its complete audit trail.
            </p>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">
              Results, reviews, code blocks, and TL-DSA signatures — all in one view.
            </p>
          </div>
        ) : detailLoading ? (
          <div className="flex items-center gap-2 text-[var(--color-text-muted)] p-8">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading entry…</span>
          </div>
        ) : detail ? (
          <div className="p-6 space-y-6 animate-fade-in max-w-4xl">
            {/* Title + metadata */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <code className="text-sm font-mono text-[var(--color-text-muted)] bg-[var(--color-surface-tertiary)] px-2 py-0.5 rounded">
                  {detail.task_number}
                </code>
                <span className="text-xs font-semibold uppercase text-[var(--color-ok)] bg-[var(--color-ok)]/10 px-2 py-0.5 rounded">
                  FINAL
                </span>
              </div>
              <h2 className="text-lg font-bold text-[var(--color-text-primary)]">
                {detail.title}
              </h2>
              {detail.timestamps.finalized_at && (
                <p className="text-sm text-[var(--color-text-muted)] mt-1">
                  Finalized {new Date(detail.timestamps.finalized_at).toLocaleString()}
                </p>
              )}
            </div>

            {/* Final output */}
            <div className="bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-tertiary)]/30">
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">Final Output</p>
              </div>
              <div className="p-4">
                <pre className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap break-words leading-relaxed">
                  {detail.final_output}
                </pre>
              </div>
            </div>

            {/* Code blocks (Ronin) */}
            {detail.code_blocks.length > 0 && (
              <InlineCodeBlocks codeBlocks={detail.code_blocks} />
            )}

            {/* Result progression (diff viewer) */}
            <div className="bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-tertiary)]/30">
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                  Result Progression ({detail.results.length} versions)
                </p>
              </div>
              <ResultViewer results={detail.results} />
            </div>

            {/* Reviews */}
            <div className="bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] rounded-xl p-4">
              <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
                Review Assessments ({detail.reviews.length})
              </p>
              <div className="space-y-2">
                {detail.reviews.map((r, i) => {
                  const passCount = Object.values(r.verdict.pass_fail).filter(Boolean).length;
                  const total = Object.keys(r.verdict.pass_fail).length;
                  return (
                    <div
                      key={i}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg border text-sm ${
                        r.censorship_flagged
                          ? 'border-[var(--color-warn)]/30 bg-[var(--color-warn)]/5'
                          : 'border-[var(--color-border-subtle)]'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[var(--color-text-muted)]">
                          Step {r.step_number ?? '?'}
                        </span>
                        <span className="text-[var(--color-text-secondary)]">
                          Engine {r.engine_id.toUpperCase()} — {r.agent_role}
                        </span>
                        {r.censorship_flagged && (
                          <span className="text-[11px] font-semibold text-[var(--color-warn)] bg-[var(--color-warn)]/10 px-1.5 py-0.5 rounded">
                            CENSORED
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={passCount === total ? 'text-[var(--color-ok)]' : 'text-[var(--color-warn)]'}>
                          {passCount}/{total}
                        </span>
                        <span className="text-[var(--color-text-muted)]">
                          {Math.round(r.verdict.confidence * 100)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Signature chain */}
            <div className="bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] rounded-xl p-4">
              <SignatureDisplay
                signature={detail.tl_dsa_signature}
                chain={detail.signature_chain}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
