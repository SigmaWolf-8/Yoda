import { useState } from 'react';
import {
  Pin,
  Archive,
  Trash2,
  TrendingUp,
  Tag,
  Clock,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useUpdateKBEntry, useDeleteKBEntry } from '../../api/hooks';
import type { KBEntry } from '../../types';

interface Props {
  entry: KBEntry;
}

export function KBEntryCard({ entry }: Props) {
  const update = useUpdateKBEntry();
  const remove = useDeleteKBEntry();
  const [expanded, setExpanded] = useState(false);
  const [boost, setBoost] = useState(entry.boost_score);
  const [showDelete, setShowDelete] = useState(false);

  function handlePin() {
    update.mutate({ id: entry.id, pinned: !entry.pinned });
  }

  function handleArchive() {
    update.mutate({ id: entry.id, archived: !entry.archived });
  }

  function handleBoostCommit() {
    if (boost !== entry.boost_score) {
      update.mutate({ id: entry.id, boost_score: boost });
    }
  }

  function handleDelete() {
    remove.mutate(entry.id);
    setShowDelete(false);
  }

  const excerpt = entry.content.length > 200
    ? entry.content.slice(0, 200) + '…'
    : entry.content;

  return (
    <div className={`rounded-xl border transition-colors ${
      entry.pinned
        ? 'border-[var(--color-gold-500)]/30 bg-[var(--color-gold-500)]/5'
        : entry.archived
          ? 'border-[var(--color-border-subtle)] bg-[var(--color-surface-tertiary)]/20 opacity-60'
          : 'border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)]'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between p-4 pb-2">
        <div className="flex-1 min-w-0">
          {/* Status badges */}
          <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
            {entry.pinned && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-[var(--color-gold-500)]/10 text-[var(--color-gold-400)] border border-[var(--color-gold-500)]/20">
                <Pin className="w-2.5 h-2.5" /> Pinned
              </span>
            )}
            {entry.archived && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-[var(--color-text-muted)]/10 text-[var(--color-text-muted)]">
                <Archive className="w-2.5 h-2.5" /> Archived
              </span>
            )}
            {entry.boost_score > 1 && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-[var(--color-plex-500)]/10 text-[var(--color-plex-400)] border border-[var(--color-plex-500)]/20">
                <TrendingUp className="w-2.5 h-2.5" /> {entry.boost_score.toFixed(1)}×
              </span>
            )}
            {entry.relevance_score !== undefined && (
              <span className="text-[9px] text-[var(--color-text-muted)]">
                {Math.round(entry.relevance_score * 100)}% match
              </span>
            )}
          </div>

          {/* Excerpt */}
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed line-clamp-3">
            {excerpt}
          </p>
        </div>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] flex-shrink-0 ml-2"
        >
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </div>

      {/* Tags + metadata */}
      <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
        {entry.tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-[var(--color-surface-tertiary)] text-[var(--color-text-tertiary)] border border-[var(--color-border-default)]"
          >
            <Tag className="w-2 h-2" /> {tag}
          </span>
        ))}
        <span className="flex items-center gap-1 text-[9px] text-[var(--color-text-muted)] ml-auto">
          <Clock className="w-2.5 h-2.5" />
          {new Date(entry.updated_at).toLocaleDateString()}
        </span>
      </div>

      {/* Expanded: actions + boost */}
      {expanded && (
        <div className="px-4 pb-4 pt-2 border-t border-[var(--color-border-subtle)] space-y-3">
          {/* Full content */}
          <pre className="text-[11px] text-[var(--color-text-secondary)] whitespace-pre-wrap break-words leading-relaxed max-h-60 overflow-y-auto bg-[var(--color-surface-tertiary)]/30 rounded-lg p-3">
            {entry.content}
          </pre>

          {/* Boost slider */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-medium text-[var(--color-text-muted)]">
                Boost Score
              </label>
              <span className="text-[10px] font-mono text-[var(--color-plex-400)]">{boost.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={5}
              step={0.1}
              value={boost}
              onChange={(e) => setBoost(parseFloat(e.target.value))}
              onMouseUp={handleBoostCommit}
              onTouchEnd={handleBoostCommit}
              className="w-full h-1.5 rounded-full appearance-none bg-[var(--color-surface-tertiary)] accent-[var(--color-plex-500)] cursor-pointer"
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handlePin}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium border transition-colors ${
                entry.pinned
                  ? 'bg-[var(--color-gold-500)]/10 text-[var(--color-gold-400)] border-[var(--color-gold-500)]/20'
                  : 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-muted)] border-[var(--color-border-default)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              <Pin className="w-3 h-3" />
              {entry.pinned ? 'Unpin' : 'Pin'}
            </button>
            <button
              onClick={handleArchive}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-[var(--color-surface-tertiary)] text-[var(--color-text-muted)] border border-[var(--color-border-default)] hover:text-[var(--color-text-secondary)] transition-colors"
            >
              <Archive className="w-3 h-3" />
              {entry.archived ? 'Unarchive' : 'Archive'}
            </button>
            <div className="flex-1" />
            <button
              onClick={() => setShowDelete(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium text-[var(--color-err)] hover:bg-[var(--color-err)]/10 border border-transparent hover:border-[var(--color-err)]/20 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-xs bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] rounded-xl p-5 animate-fade-in">
            <p className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">Delete entry?</p>
            <p className="text-xs text-[var(--color-text-tertiary)] mb-4">
              This permanently removes the knowledge base entry. Audit log signatures are preserved.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowDelete(false)}
                className="flex-1 py-2 rounded-lg text-xs font-medium text-[var(--color-text-tertiary)] bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={remove.isPending}
                className="flex-1 py-2 rounded-lg text-xs font-semibold bg-[var(--color-err)]/10 text-[var(--color-err)] border border-[var(--color-err)]/20 hover:bg-[var(--color-err)]/20 transition-colors"
              >
                {remove.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
