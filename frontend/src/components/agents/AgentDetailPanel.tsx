import { useMemo } from 'react';
import { Lock, Copy, Pencil, Loader2 } from 'lucide-react';
import type { AgentWithStats, AgentDivision } from '../../types';
import { DIVISIONS } from '../../types/agent';
import { useRecentTasks } from '../../api/hooks/useTasks';

interface Props {
  agents: AgentWithStats[];
  division: AgentDivision;
  selectedIdx: number | null;
  onSelectIdx: (idx: number | null) => void;
  onEdit: (agent: AgentWithStats) => void;
  onCopyTemplate: (agent: AgentWithStats) => void;
}

export function AgentDetailPanel({ agents, division, selectedIdx, onSelectIdx, onEdit, onCopyTemplate }: Props) {
  const divMeta = DIVISIONS.find(d => d.id === division);
  const divAgents = useMemo(() => agents.filter(a => a.division === division), [agents, division]);
  const agent = selectedIdx !== null ? divAgents[selectedIdx] : divAgents[0];
  const activeIdx = selectedIdx ?? 0;
  const isCM = division === 'capomastro';

  const { data: recentTasks, isLoading: tasksLoading } = useRecentTasks();

  if (!divMeta || divAgents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6 text-[var(--color-text-muted)]">
        <p className="text-sm">No agents in this division</p>
      </div>
    );
  }

  if (!agent) return null;

  const s = agent.stats;
  const prodPct = s.total_calls > 0 ? Math.round((s.as_producer / s.total_calls) * 100) : 0;
  const revPct = 100 - prodPct;

  return (
    <div className="h-full overflow-y-auto">
      {/* Division header */}
      <div className="px-5 pt-5 pb-3 border-b border-[var(--color-border-subtle)]">
        <div className="flex items-center gap-2.5 mb-1">
          <span className="w-3 h-3 rounded-full bg-[hsl(210,70%,65%)]" />
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{divMeta.label}</h2>
          <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-[hsl(210,80%,55%)]/8 text-[hsl(210,70%,65%)] border border-[hsl(210,80%,55%)]/15">
            {isCM ? 'Proprietary' : 'MIT licensed'}
          </span>
        </div>
        <p className="text-[10px] text-[var(--color-text-muted)] font-mono">
          {divAgents.length} agents · {divMeta.ring} shell
        </p>
      </div>

      {/* Agent dropdown selector */}
      <div className="px-5 py-3 border-b border-[var(--color-border-subtle)]">
        <label className="block text-[9px] text-[var(--color-text-muted)] uppercase tracking-wider font-semibold mb-1.5">
          Agent ({divAgents.length} in division)
        </label>
        <select
          value={activeIdx}
          onChange={e => onSelectIdx(parseInt(e.target.value))}
          className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-xs font-medium text-[var(--color-text-primary)] focus:outline-none focus:border-[hsl(210,80%,55%)] transition-colors"
        >
          {divAgents.map((a, i) => (
            <option key={a.agent_id} value={i}>
              {a.display_name} — {a.stats.total_calls} calls
            </option>
          ))}
        </select>
      </div>

      {/* Agent detail */}
      <div className="px-5 py-4 space-y-4">
        {/* Header */}
        <div>
          <h3 className="text-[15px] font-semibold text-[var(--color-text-primary)]">{agent.display_name}</h3>
          <p className="text-[9px] text-[var(--color-text-muted)] font-mono mt-0.5">{agent.agent_id}</p>
          <div className="mt-2 flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-md text-[9px] font-medium bg-[hsl(210,80%,55%)]/6 text-[hsl(210,70%,65%)]">
              {agent.primary_role === 'Both' ? 'Producer + Reviewer' : agent.primary_role}
            </span>
          </div>
        </div>

        {/* Locked banner for Capomastro */}
        {isCM && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[hsl(210,80%,55%)]/4 border border-[hsl(210,80%,55%)]/12 text-[10px] text-[hsl(210,70%,65%)]">
            <Lock className="w-3.5 h-3.5" />
            Capomastro proprietary · Read-only for non-owners
          </div>
        )}

        {/* About */}
        {agent.about && (
          <Section label="About this agent">
            <p className="text-[11px] text-[var(--color-text-secondary)] leading-relaxed">{agent.about}</p>
          </Section>
        )}

        {/* Key Skills */}
        {agent.key_skills.length > 0 && (
          <Section label="Key skills">
            <div className="space-y-1.5">
              {agent.key_skills.map((sk, i) => (
                <div key={i} className="flex items-start gap-2 text-[10px] text-[var(--color-text-secondary)] leading-relaxed">
                  <span className="w-1 h-1 rounded-full bg-[hsl(210,70%,65%)] flex-shrink-0 mt-[6px]" />
                  {sk}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Usage Stats */}
        <Section label="Usage statistics">
          <div className="grid grid-cols-3 gap-1.5">
            <StatBox label="Calls" value={String(s.total_calls)} />
            <StatBox label="Approval" value={`${s.approval_rate}%`} />
            <StatBox label="Confidence" value={`${s.avg_confidence}%`} />
          </div>
          <div className="grid grid-cols-2 gap-1.5 mt-1.5">
            <StatBoxBar label="As producer" value={`${s.as_producer} (${prodPct}%)`} pct={prodPct} color="hsl(210,70%,65%)" />
            <StatBoxBar label="As reviewer" value={`${s.as_reviewer} (${revPct}%)`} pct={revPct} color="hsl(270,50%,65%)" />
          </div>
          <div className="grid grid-cols-2 gap-1.5 mt-1.5">
            <StatBox label="This week" value={String(s.calls_this_week)} />
            <StatBox label="Last used" value={s.last_used ? new Date(s.last_used).toLocaleDateString() : '—'} small />
          </div>
        </Section>

        {/* Competencies */}
        <Section label="Competencies">
          <div className="flex flex-wrap gap-1">
            {agent.competencies.map(c => (
              <span key={c} className="px-2 py-0.5 rounded text-[8px] font-medium bg-[hsl(210,80%,55%)]/6 text-[hsl(210,70%,65%)] border border-[hsl(210,80%,55%)]/12">
                {c}
              </span>
            ))}
          </div>
        </Section>

        {/* Review Criteria */}
        <Section label="Review criteria">
          <div className="flex flex-wrap gap-1">
            {agent.review_criteria.map((c, i) => (
              <span
                key={c}
                className={`px-2 py-0.5 rounded text-[8px] font-medium border ${
                  i === 0
                    ? 'bg-[hsl(210,80%,55%)]/6 text-[hsl(210,70%,65%)] border-[hsl(210,80%,55%)]/15'
                    : 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-muted)] border-[var(--color-border-default)]'
                }`}
              >
                {c}
              </span>
            ))}
          </div>
        </Section>

        {/* Compatible Reviewers */}
        {agent.compatible_reviewers.length > 0 && (
          <Section label="Compatible reviewers">
            <div className="space-y-1">
              {agent.compatible_reviewers.map(r => (
                <div key={r} className="flex items-center gap-2 text-[9px] text-[var(--color-text-secondary)] font-mono">
                  <span className="w-1 h-1 rounded-full bg-[hsl(210,70%,65%)]" />
                  {r}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Recent Tasks — live system activity from the database */}
        <Section label="Recent tasks">
          {tasksLoading ? (
            <div className="flex items-center gap-2 py-2 text-[10px] text-[var(--color-text-muted)]">
              <Loader2 className="w-3 h-3 animate-spin" />
              Loading…
            </div>
          ) : !recentTasks || recentTasks.length === 0 ? (
            <p className="text-[10px] text-[var(--color-text-muted)] italic py-1">No tasks recorded yet.</p>
          ) : (
            <div className="space-y-0">
              {recentTasks.map((t, i) => (
                <div key={i} className="flex items-center gap-2 py-1.5 border-b border-[var(--color-border-subtle)] last:border-0 text-[9px]">
                  <span className="flex-1 min-w-0 truncate text-[var(--color-text-secondary)] font-mono">
                    {t.task_number} — {t.title}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded text-[7px] font-semibold flex-shrink-0 ${
                    t.status === 'ESCALATED'
                      ? 'bg-[hsl(270,50%,65%)]/8 text-[hsl(270,50%,65%)]'
                      : 'bg-[hsl(210,80%,55%)]/6 text-[hsl(210,70%,65%)]'
                  }`}>
                    {t.status}
                  </span>
                  <span className="text-[var(--color-text-muted)] flex-shrink-0">{t.time_ago}</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={() => onCopyTemplate(agent)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-medium bg-[var(--color-surface-tertiary)] text-[var(--color-text-secondary)] border border-[var(--color-border-default)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            <Copy className="w-3 h-3" />
            Copy as template
          </button>
          {isCM ? (
            <button
              disabled
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-medium bg-[var(--color-surface-tertiary)] text-[var(--color-text-muted)] border border-[var(--color-border-default)] opacity-30 cursor-not-allowed"
            >
              <Lock className="w-3 h-3" />
              Locked
            </button>
          ) : (
            <button
              onClick={() => onEdit(agent)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-medium bg-[hsl(210,80%,55%)]/8 text-[hsl(210,70%,65%)] border border-[hsl(210,80%,55%)]/18 hover:bg-[hsl(210,80%,55%)]/15 transition-colors"
            >
              <Pencil className="w-3 h-3" />
              Edit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Helpers ── */

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[8px] text-[var(--color-text-muted)] uppercase tracking-wider font-semibold mb-2">{label}</p>
      {children}
    </div>
  );
}

function StatBox({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-md bg-[var(--color-surface-tertiary)]/50 px-2.5 py-2 border border-[var(--color-border-subtle)]">
      <p className="text-[7px] text-[var(--color-text-muted)] uppercase tracking-wider">{label}</p>
      <p className={`font-semibold text-[var(--color-text-primary)] mt-0.5 ${small ? 'text-[10px]' : 'text-sm'}`}>{value}</p>
    </div>
  );
}

function StatBoxBar({ label, value, pct, color }: { label: string; value: string; pct: number; color: string }) {
  return (
    <div className="rounded-md bg-[var(--color-surface-tertiary)]/50 px-2.5 py-2 border border-[var(--color-border-subtle)]">
      <p className="text-[7px] text-[var(--color-text-muted)] uppercase tracking-wider">{label}</p>
      <p className="text-xs font-semibold text-[var(--color-text-primary)] mt-0.5">{value}</p>
      <div className="h-1 rounded-full bg-[var(--color-border-subtle)] mt-1.5 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}
