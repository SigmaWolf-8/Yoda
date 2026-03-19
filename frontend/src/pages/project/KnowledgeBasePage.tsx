import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Search, ArrowLeft, Loader2, Database } from 'lucide-react';
import { useProject, useKnowledgeBase } from '../../api/hooks';
import { KBSearchBar } from '../../components/kb/KBSearchBar';
import { KBTagFilter } from '../../components/kb/KBTagFilter';
import { KBEntryCard } from '../../components/kb/KBEntryCard';

export function KnowledgeBasePage() {
  const { id } = useParams<{ id: string }>();
  const { data: project } = useProject(id);

  const [query, setQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);

  const params = useMemo(() => ({
    q: query || undefined,
    tags: selectedTags.size > 0 ? [...selectedTags].join(',') : undefined,
    archived: showArchived || undefined,
  }), [query, selectedTags, showArchived]);

  const { data: entries, isLoading } = useKnowledgeBase(id, params);

  // Collect all unique tags for the filter sidebar
  const allTags = useMemo(() => {
    if (!entries) return [];
    const tags: string[] = [];
    for (const e of entries) tags.push(...e.tags);
    return tags;
  }, [entries]);

  function toggleTag(tag: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* ── Left sidebar: tags ── */}
      <aside className="w-56 flex-shrink-0 border-r border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)] flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border-subtle)]">
          <Link
            to={`/projects/${id}`}
            className="p-1 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <Search className="w-4 h-4 text-[var(--color-gold-400)]" />
          <div>
            <h1 className="text-sm font-semibold text-[var(--color-text-primary)]">Knowledge Base</h1>
            {project && <p className="text-[10px] text-[var(--color-text-muted)]">{project.name}</p>}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          <KBTagFilter
            allTags={allTags}
            selected={selectedTags}
            onToggle={toggleTag}
            onClear={() => setSelectedTags(new Set())}
          />

          {/* Archive toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-[var(--color-border-default)] bg-[var(--color-surface-tertiary)] accent-[var(--color-gold-500)]"
            />
            <span className="text-[11px] text-[var(--color-text-muted)]">Show archived</span>
          </label>
        </div>
      </aside>

      {/* ── Main: search + results ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Search bar */}
        <div className="p-4 border-b border-[var(--color-border-subtle)]">
          <KBSearchBar
            value={query}
            onChange={setQuery}
            resultCount={entries?.length}
          />
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-[var(--color-text-muted)] py-12 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Searching…</span>
            </div>
          ) : !entries?.length ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Database className="w-10 h-10 text-[var(--color-text-muted)] mb-4" />
              <p className="text-sm text-[var(--color-text-tertiary)]">
                {query || selectedTags.size > 0
                  ? 'No entries match your search.'
                  : 'Knowledge base is empty. Complete a pipeline to populate it.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-w-3xl">
              {entries.map((entry) => (
                <KBEntryCard key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
