import { useState, useMemo } from 'react';
import { Tag, ChevronRight, ChevronDown, X } from 'lucide-react';

interface Props {
  allTags: string[];
  selected: Set<string>;
  onToggle: (tag: string) => void;
  onClear: () => void;
}

interface TagNode {
  name: string;
  fullPath: string;
  children: TagNode[];
  count: number;
}

function buildTagTree(tags: string[]): TagNode[] {
  const freq = new Map<string, number>();
  for (const t of tags) {
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }

  const roots: TagNode[] = [];
  const nodeMap = new Map<string, TagNode>();

  const uniqueTags = [...new Set(tags)].sort();

  for (const tag of uniqueTags) {
    const parts = tag.split('/');
    let parentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const fullPath = parts.slice(0, i + 1).join('/');
      if (!nodeMap.has(fullPath)) {
        const node: TagNode = {
          name: parts[i],
          fullPath,
          children: [],
          count: freq.get(fullPath) ?? 0,
        };
        nodeMap.set(fullPath, node);

        if (i === 0) {
          roots.push(node);
        } else if (nodeMap.has(parentPath)) {
          nodeMap.get(parentPath)!.children.push(node);
        }
      }
      parentPath = fullPath;
    }
  }

  return roots;
}

function TagNodeRow({
  node,
  depth,
  selected,
  onToggle,
}: {
  node: TagNode;
  depth: number;
  selected: Set<string>;
  onToggle: (tag: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const isSelected = selected.has(node.fullPath);

  return (
    <div>
      <div
        className="flex items-center gap-1.5 py-1 rounded hover:bg-[var(--color-surface-tertiary)]/30 transition-colors cursor-pointer"
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        {hasChildren ? (
          <button onClick={() => setExpanded(!expanded)} className="flex-shrink-0">
            {expanded
              ? <ChevronDown className="w-3 h-3 text-[var(--color-text-muted)]" />
              : <ChevronRight className="w-3 h-3 text-[var(--color-text-muted)]" />
            }
          </button>
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}
        <label className="flex items-center gap-1.5 flex-1 min-w-0 cursor-pointer">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggle(node.fullPath)}
            className="w-3.5 h-3.5 rounded border-[var(--color-border-default)] bg-[var(--color-surface-tertiary)] accent-[var(--color-gold-500)] flex-shrink-0"
          />
          <span className={`text-[11px] truncate ${isSelected ? 'text-[var(--color-gold-400)] font-medium' : 'text-[var(--color-text-secondary)]'}`}>
            {node.name}
          </span>
        </label>
        {node.count > 0 && (
          <span className="text-[9px] text-[var(--color-text-muted)] pr-2">{node.count}</span>
        )}
      </div>
      {expanded && hasChildren && node.children.map((child) => (
        <TagNodeRow key={child.fullPath} node={child} depth={depth + 1} selected={selected} onToggle={onToggle} />
      ))}
    </div>
  );
}

export function KBTagFilter({ allTags, selected, onToggle, onClear }: Props) {
  const tree = useMemo(() => buildTagTree(allTags), [allTags]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Tag className="w-3.5 h-3.5 text-[var(--color-gold-400)]" />
          <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Tags</span>
        </div>
        {selected.size > 0 && (
          <button
            onClick={onClear}
            className="flex items-center gap-1 text-[9px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
          >
            <X className="w-2.5 h-2.5" />
            Clear ({selected.size})
          </button>
        )}
      </div>
      {tree.length === 0 ? (
        <p className="text-[10px] text-[var(--color-text-muted)] py-2">No tags yet.</p>
      ) : (
        <div className="space-y-0">
          {tree.map((node) => (
            <TagNodeRow key={node.fullPath} node={node} depth={0} selected={selected} onToggle={onToggle} />
          ))}
        </div>
      )}
    </div>
  );
}
