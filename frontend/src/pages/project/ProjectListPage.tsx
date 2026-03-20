import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  FolderKanban,
  Loader2,
  Swords,
  GraduationCap,
  Clock,
  MoreVertical,
  Trash2,
} from 'lucide-react';
import { useOrganizations, useProjects, useCreateProject, useDeleteProject } from '../../api/hooks';
import { extractErrorMessage } from '../../types';
import { usePageHeader } from '../../context/PageHeader';
import { SectionHeader } from '../../components/common/SectionHeader';

export function ProjectListPage() {
  const navigate = useNavigate();
  const { data: orgs } = useOrganizations();
  const orgId = orgs?.[0]?.id;
  const { data: projects, isLoading } = useProjects(orgId);
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'yoda' | 'ronin'>('yoda');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !orgId) return;
    createProject.mutate(
      { name: name.trim(), mode, org_id: orgId },
      {
        onSuccess: (project) => {
          setShowCreate(false);
          setName('');
          navigate(`/projects/${project.id}`);
        },
      },
    );
  }

  function handleDelete(id: string) {
    deleteProject.mutate(id, { onSuccess: () => setMenuOpen(null) });
  }

  usePageHeader({
    icon: FolderKanban,
    title: 'Projects',
    subtitle: 'Manage your Yoda & Ronin projects',
  });

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto animate-fade-in">
      <SectionHeader title="Projects" accentColor="#38BDF8" />
      {/* Action bar */}
      <div className="flex items-center justify-end mb-6">
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-gold-500)] text-[var(--color-navy-950)] text-sm font-semibold hover:bg-[var(--color-gold-400)] transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Project
        </button>
      </div>

      {/* Project grid */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-[var(--color-text-muted)] py-20 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading projects…</span>
        </div>
      ) : !projects?.length ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FolderKanban className="w-10 h-10 text-[var(--color-text-muted)] mb-4" />
          <p className="text-[var(--color-text-tertiary)] text-sm">
            No projects yet. Create your first project to get started.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <div
              key={p.id}
              className="group relative bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] rounded-xl p-5 hover:border-[var(--color-gold-500)]/30 transition-colors cursor-pointer"
              onClick={() => navigate(`/projects/${p.id}`)}
            >
              {/* Mode badge */}
              <div className="flex items-center justify-between mb-3">
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${
                    p.mode === 'ronin'
                      ? 'bg-[var(--color-ronin-500)]/10 text-[var(--color-ronin-400)] border-[var(--color-ronin-500)]/20'
                      : 'bg-[var(--color-yoda-500)]/10 text-[var(--color-yoda-400)] border-[var(--color-yoda-500)]/20'
                  }`}
                >
                  {p.mode === 'ronin' ? <Swords className="w-3 h-3" /> : <GraduationCap className="w-3 h-3" />}
                  {p.mode}
                </span>

                {/* Context menu */}
                <div className="relative" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => setMenuOpen(menuOpen === p.id ? null : p.id)}
                    className="p-1 rounded-lg text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 hover:bg-[var(--color-surface-tertiary)] transition-all"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>
                  {menuOpen === p.id && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(null)} />
                      <div className="absolute right-0 top-full mt-1 z-40 w-36 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] shadow-xl py-1">
                        <button
                          onClick={() => handleDelete(p.id)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Name */}
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1 group-hover:text-[var(--color-gold-400)] transition-colors">
                {p.name}
              </h3>

              {/* Meta */}
              <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                <Clock className="w-3 h-3" />
                {new Date(p.updated_at).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Project Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] rounded-xl p-6 animate-fade-in">
            <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
              New Project
            </h3>

            {createProject.error && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {extractErrorMessage(createProject.error, 'Failed to create project')}
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
                  Project name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] focus:ring-1 focus:ring-[var(--color-gold-500)]/30 transition-colors"
                  placeholder="e.g. Document Signing API"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
                  Mode
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setMode('yoda')}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-colors ${
                      mode === 'yoda'
                        ? 'bg-[var(--color-yoda-500)]/10 border-[var(--color-yoda-500)]/30 text-[var(--color-yoda-400)]'
                        : 'bg-[var(--color-surface-tertiary)] border-[var(--color-border-default)] text-[var(--color-text-tertiary)] hover:border-[var(--color-border-strong)]'
                    }`}
                  >
                    <GraduationCap className="w-5 h-5" />
                    <span className="text-sm font-semibold">Yoda</span>
                    <span className="text-[10px] text-[var(--color-text-muted)]">Research &amp; Analysis</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('ronin')}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-colors ${
                      mode === 'ronin'
                        ? 'bg-[var(--color-ronin-500)]/10 border-[var(--color-ronin-500)]/30 text-[var(--color-ronin-400)]'
                        : 'bg-[var(--color-surface-tertiary)] border-[var(--color-border-default)] text-[var(--color-text-tertiary)] hover:border-[var(--color-border-strong)]'
                    }`}
                  >
                    <Swords className="w-5 h-5" />
                    <span className="text-sm font-semibold">Ronin</span>
                    <span className="text-[10px] text-[var(--color-text-muted)]">Code &amp; Implementation</span>
                  </button>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowCreate(false); createProject.reset(); }}
                  className="flex-1 py-2.5 rounded-lg text-sm font-medium text-[var(--color-text-tertiary)] bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] hover:bg-[var(--color-surface-hover)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createProject.isPending || !name.trim()}
                  className="flex-1 py-2.5 rounded-lg text-sm font-semibold bg-[var(--color-gold-500)] text-[var(--color-navy-950)] hover:bg-[var(--color-gold-400)] disabled:opacity-50 transition-colors"
                >
                  {createProject.isPending ? 'Creating…' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
