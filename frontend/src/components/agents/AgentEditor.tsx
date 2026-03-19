import { useState, useEffect } from 'react';
import { Plus, X, Loader2 } from 'lucide-react';
import { useCreateAgent, useUpdateAgent } from '../../api/hooks';
import type { AgentConfig, AgentDivision, AgentUpsertPayload } from '../../types';
import { DIVISIONS } from '../../types/agent';
import { extractErrorMessage } from '../../types';

interface Props {
  agent?: AgentConfig | null;
  templateFrom?: AgentConfig | null;
  onClose: () => void;
}

const EDITABLE_DIVISIONS = DIVISIONS.filter(d => d.id !== 'capomastro');

export function AgentEditor({ agent, templateFrom, onClose }: Props) {
  const isEditing = !!agent;
  const source = templateFrom ?? agent;

  const [displayName, setDisplayName] = useState(source?.display_name ?? '');
  const [division, setDivision] = useState<AgentDivision>(
    source?.division === 'capomastro' ? 'engineering' : (source?.division ?? 'engineering')
  );
  const [about, setAbout] = useState(source?.about ?? '');
  const [keySkills, setKeySkills] = useState(source?.key_skills.join('\n') ?? '');
  const [competencies, setCompetencies] = useState(source?.competencies.join(', ') ?? '');
  const [reviewCriteria, setReviewCriteria] = useState(
    source?.review_criteria.filter(c => c !== 'enhancement').join(', ') ?? ''
  );
  const [compatReviewers, setCompatReviewers] = useState(source?.compatible_reviewers.join(', ') ?? '');
  const [role, setRole] = useState<'Producer' | 'Reviewer' | 'Both'>(source?.primary_role ?? 'Producer');

  const createAgent = useCreateAgent();
  const updateAgent = useUpdateAgent(agent?.agent_id ?? '');

  useEffect(() => {
    if (templateFrom) {
      setDisplayName(`${templateFrom.display_name} (Copy)`);
      setDivision(templateFrom.division === 'capomastro' ? 'engineering' : templateFrom.division);
      setAbout(templateFrom.about);
      setKeySkills(templateFrom.key_skills.join('\n'));
      setCompetencies(templateFrom.competencies.join(', '));
      setReviewCriteria(templateFrom.review_criteria.filter(c => c !== 'enhancement').join(', '));
      setCompatReviewers(templateFrom.compatible_reviewers.join(', '));
      setRole(templateFrom.primary_role);
    }
  }, [templateFrom]);

  function parseList(s: string): string[] {
    return s.split(',').map(x => x.trim()).filter(Boolean);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: AgentUpsertPayload = {
      display_name: displayName.trim(),
      division,
      about,
      key_skills: keySkills.split('\n').map(s => s.trim()).filter(Boolean),
      competencies: parseList(competencies),
      review_criteria: ['enhancement', ...parseList(reviewCriteria)],
      compatible_reviewers: parseList(compatReviewers),
      primary_role: role,
      template_from: templateFrom ? templateFrom.agent_id : undefined,
    };
    if (isEditing) {
      updateAgent.mutate(payload, { onSuccess: () => onClose() });
    } else {
      createAgent.mutate(payload, { onSuccess: () => onClose() });
    }
  }

  const isPending = createAgent.isPending || updateAgent.isPending;
  const error = createAgent.error || updateAgent.error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-2xl bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] rounded-xl animate-fade-in max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border-subtle)]">
          <h3 className="text-base font-semibold text-[var(--color-text-primary)]">
            {isEditing ? 'Edit agent' : templateFrom ? 'Copy agent from template' : 'Create new agent'}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-[hsl(210,80%,55%)]/5 border border-[hsl(210,80%,55%)]/15 text-[hsl(210,70%,65%)] text-xs">
              {extractErrorMessage(error, 'Failed to save agent')}
            </div>
          )}

          <p className="text-[10px] text-[var(--color-text-muted)] leading-relaxed">
            Write the "About" and "Key skills" in first-person plural voice — "We specialize in..." not "This agent specializes in..."
            Enhancement is automatically included as the first review criteria.
          </p>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Display name</label>
              <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)} required placeholder="e.g. API Security Reviewer"
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[hsl(210,80%,55%)] transition-colors" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Role</label>
              <select value={role} onChange={e => setRole(e.target.value as typeof role)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[hsl(210,80%,55%)]">
                <option value="Producer">Producer</option>
                <option value="Reviewer">Reviewer</option>
                <option value="Both">Both</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Division</label>
            <select value={division} onChange={e => setDivision(e.target.value as AgentDivision)}
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[hsl(210,80%,55%)]">
              {EDITABLE_DIVISIONS.map(d => <option key={d.id} value={d.id}>{d.label} ({d.ring} shell)</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">About this agent <span className="font-normal text-[var(--color-text-muted)]">(first-person "we" voice)</span></label>
            <textarea value={about} onChange={e => setAbout(e.target.value)} required rows={5} placeholder="We are a senior ... specializing in ..."
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[hsl(210,80%,55%)] resize-y" />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Key skills <span className="font-normal text-[var(--color-text-muted)]">(one per line)</span></label>
            <textarea value={keySkills} onChange={e => setKeySkills(e.target.value)} rows={4} placeholder={"Architecture decisions — we define service boundaries\nCode quality — we evaluate naming and structure"}
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-xs font-mono text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[hsl(210,80%,55%)] resize-y" />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Competencies <span className="font-normal text-[var(--color-text-muted)]">(comma-separated)</span></label>
            <input type="text" value={competencies} onChange={e => setCompetencies(e.target.value)} placeholder="react, typescript, security, performance"
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[hsl(210,80%,55%)]" />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Additional review criteria <span className="font-normal text-[var(--color-text-muted)]">(enhancement is auto-included first)</span></label>
            <input type="text" value={reviewCriteria} onChange={e => setReviewCriteria(e.target.value)} placeholder="compilation, test-coverage, error-handling"
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[hsl(210,80%,55%)]" />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Compatible reviewers <span className="font-normal text-[var(--color-text-muted)]">(comma-separated agent IDs)</span></label>
            <input type="text" value={compatReviewers} onChange={e => setCompatReviewers(e.target.value)} placeholder="testing-evidence-collector, engineering-security-engineer"
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[hsl(210,80%,55%)]" />
          </div>
        </form>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-[var(--color-border-subtle)]">
          <button type="button" onClick={onClose}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium text-[var(--color-text-tertiary)] bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] hover:bg-[var(--color-surface-hover)]">
            Cancel
          </button>
          <button onClick={handleSubmit as any} disabled={isPending || !displayName.trim() || !about.trim()}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold bg-[hsl(210,80%,55%)]/10 text-[hsl(210,70%,65%)] border border-[hsl(210,80%,55%)]/20 hover:bg-[hsl(210,80%,55%)]/18 disabled:opacity-50 transition-colors">
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {isEditing ? 'Save changes' : 'Create agent'}
          </button>
        </div>
      </div>
    </div>
  );
}
