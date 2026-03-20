import { useState } from 'react';
import Editor from '@monaco-editor/react';
import { Copy, Check, FileCode, ChevronDown, ChevronRight } from 'lucide-react';
import type { CodeBlock } from '../../types';

interface Props {
  codeBlocks: CodeBlock[];
}

const LANG_COLORS: Record<string, string> = {
  rust:       'bg-orange-500/10 text-orange-400 border-orange-500/20',
  typescript: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  javascript: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  python:     'bg-green-500/10 text-green-400 border-green-500/20',
  sql:        'bg-purple-500/10 text-purple-400 border-purple-500/20',
  toml:       'bg-teal-500/10 text-teal-400 border-teal-500/20',
  yaml:       'bg-pink-500/10 text-pink-400 border-pink-500/20',
};

function CodeBlockCard({ block }: { block: CodeBlock }) {
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(block.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const langStyle = LANG_COLORS[block.language] ?? 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-muted)] border-[var(--color-border-default)]';

  return (
    <div className="rounded-lg border border-[var(--color-border-subtle)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-[var(--color-surface-tertiary)]/50">
        <div className="flex items-center gap-2">
          <button onClick={() => setExpanded(!expanded)} className="text-[var(--color-text-muted)]">
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
          <FileCode className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
          <span className="text-sm font-medium text-[var(--color-text-primary)] font-mono">
            {block.filename}
          </span>
          <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold border ${langStyle}`}>
            {block.language}
          </span>
          <span className="text-[11px] text-[var(--color-text-muted)]">
            {block.line_count} lines
          </span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-[var(--color-ok)]" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* Editor */}
      {expanded && (
        <div className="border-t border-[var(--color-border-subtle)]">
          <Editor
            height={Math.min(block.line_count * 19 + 16, 400)}
            language={block.language}
            value={block.content}
            theme="vs-dark"
            options={{
              readOnly: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              lineNumbers: 'on',
              fontSize: 12,
              fontFamily: 'JetBrains Mono, Fira Code, monospace',
              renderLineHighlight: 'none',
              overviewRulerLanes: 0,
              hideCursorInOverviewRuler: true,
              scrollbar: { vertical: 'hidden', horizontal: 'auto' },
              padding: { top: 8, bottom: 8 },
              domReadOnly: true,
            }}
          />
        </div>
      )}
    </div>
  );
}

export function InlineCodeBlocks({ codeBlocks }: Props) {
  if (!codeBlocks.length) return null;

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
        Code Blocks ({codeBlocks.length})
      </p>
      {codeBlocks.map((block, i) => (
        <CodeBlockCard key={`${block.filename}-${i}`} block={block} />
      ))}
    </div>
  );
}
