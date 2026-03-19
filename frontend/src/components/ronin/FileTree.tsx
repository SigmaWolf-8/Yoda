import { useState } from 'react';
import {
  FileCode,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import type { CodeBlock } from '../../types';

interface Props {
  files: CodeBlock[];
  activeFile?: string;
  onSelectFile: (filename: string) => void;
}

/* ── Build directory tree from flat filenames ── */

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
  file?: CodeBlock;
}

function buildFileTree(files: CodeBlock[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', isDir: true, children: [] };

  for (const file of files) {
    const parts = file.filename.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join('/');

      let child = current.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          path,
          isDir: !isLast,
          children: [],
          file: isLast ? file : undefined,
        };
        current.children.push(child);
      }
      current = child;
    }
  }

  // Sort: directories first, then files, alphabetical
  function sortTree(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) {
      if (n.children.length) sortTree(n.children);
    }
  }
  sortTree(root.children);

  return root.children;
}

/* ── TreeNode renderer ── */

function TreeNodeRow({
  node,
  depth,
  activeFile,
  onSelectFile,
}: {
  node: TreeNode;
  depth: number;
  activeFile?: string;
  onSelectFile: (filename: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isActive = node.file?.filename === activeFile;

  const LANG_DOTS: Record<string, string> = {
    rust: 'bg-orange-400',
    typescript: 'bg-blue-400',
    javascript: 'bg-yellow-400',
    python: 'bg-green-400',
    sql: 'bg-purple-400',
    toml: 'bg-teal-400',
  };

  if (node.isDir) {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-1.5 py-1.5 pr-2 text-left hover:bg-[var(--color-surface-tertiary)]/50 transition-colors rounded"
          style={{ paddingLeft: `${depth * 14 + 6}px` }}
        >
          {expanded ? (
            <ChevronDown className="w-3 h-3 text-[var(--color-text-muted)]" />
          ) : (
            <ChevronRight className="w-3 h-3 text-[var(--color-text-muted)]" />
          )}
          {expanded ? (
            <FolderOpen className="w-3.5 h-3.5 text-[var(--color-gold-400)]" />
          ) : (
            <Folder className="w-3.5 h-3.5 text-[var(--color-gold-400)]" />
          )}
          <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
            {node.name}
          </span>
        </button>
        {expanded && node.children.map((child) => (
          <TreeNodeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            activeFile={activeFile}
            onSelectFile={onSelectFile}
          />
        ))}
      </div>
    );
  }

  // File node
  const dotColor = LANG_DOTS[node.file?.language ?? ''] ?? 'bg-[var(--color-text-muted)]';

  return (
    <button
      onClick={() => node.file && onSelectFile(node.file.filename)}
      className={`w-full flex items-center gap-1.5 py-1.5 pr-2 text-left rounded transition-colors ${
        isActive
          ? 'bg-[var(--color-gold-500)]/10 text-[var(--color-gold-400)]'
          : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-tertiary)]/50 hover:text-[var(--color-text-secondary)]'
      }`}
      style={{ paddingLeft: `${depth * 14 + 6}px` }}
    >
      <span className="w-3 flex-shrink-0" /> {/* align with chevrons */}
      <FileCode className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="text-[11px] font-mono truncate">{node.name}</span>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor}`} />
    </button>
  );
}

/* ── Main FileTree ── */

export function FileTree({ files, activeFile, onSelectFile }: Props) {
  const tree = buildFileTree(files);

  if (!files.length) {
    return (
      <div className="p-4 text-center">
        <FileCode className="w-6 h-6 text-[var(--color-text-muted)] mx-auto mb-2" />
        <p className="text-[10px] text-[var(--color-text-muted)]">No files generated yet.</p>
      </div>
    );
  }

  return (
    <div className="py-1.5 overflow-y-auto">
      {tree.map((node) => (
        <TreeNodeRow
          key={node.path}
          node={node}
          depth={0}
          activeFile={activeFile}
          onSelectFile={onSelectFile}
        />
      ))}
      <div className="px-3 pt-2 text-[9px] text-[var(--color-text-muted)]">
        {files.length} file{files.length !== 1 ? 's' : ''} · {files.reduce((s, f) => s + f.line_count, 0)} lines
      </div>
    </div>
  );
}
