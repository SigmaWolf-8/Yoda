import { useState } from 'react';
import Editor from '@monaco-editor/react';
import { X } from 'lucide-react';
import type { CodeBlock } from '../../types';

interface Props {
  files: CodeBlock[];
  activeFile?: string;
  onSelectFile: (filename: string) => void;
}

const LANG_MAP: Record<string, string> = {
  rs: 'rust', rust: 'rust',
  ts: 'typescript', typescript: 'typescript',
  js: 'javascript', javascript: 'javascript',
  py: 'python', python: 'python',
  sql: 'sql',
  toml: 'toml',
  yaml: 'yaml', yml: 'yaml',
  json: 'json',
  md: 'markdown',
  html: 'html',
  css: 'css',
  sh: 'shell', bash: 'shell',
};

function resolveLanguage(block: CodeBlock): string {
  if (LANG_MAP[block.language]) return LANG_MAP[block.language];
  const ext = block.filename.split('.').pop()?.toLowerCase() ?? '';
  return LANG_MAP[ext] ?? 'plaintext';
}

export function CodeEditorPanel({ files, activeFile, onSelectFile }: Props) {
  const active = files.find((f) => f.filename === activeFile) ?? files[0];

  if (!files.length) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-[var(--color-text-muted)]">
        No code blocks generated yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface-secondary)]">
      {/* File tabs */}
      <div className="flex items-center border-b border-[var(--color-border-subtle)] overflow-x-auto">
        {files.map((f) => {
          const isActive = f.filename === active?.filename;
          return (
            <button
              key={f.filename}
              onClick={() => onSelectFile(f.filename)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-mono whitespace-nowrap border-r border-[var(--color-border-subtle)] transition-colors ${
                isActive
                  ? 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-primary)] border-b-2 border-b-[var(--color-gold-500)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)]/30'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-current opacity-40" />
              {f.filename}
            </button>
          );
        })}
      </div>

      {/* Editor */}
      {active && (
        <div className="flex-1 min-h-0">
          <Editor
            key={active.filename}
            height="100%"
            language={resolveLanguage(active)}
            value={active.content}
            theme="vs-dark"
            options={{
              readOnly: true,
              minimap: { enabled: true, scale: 1 },
              scrollBeyondLastLine: false,
              lineNumbers: 'on',
              fontSize: 13,
              fontFamily: 'JetBrains Mono, Fira Code, monospace',
              renderLineHighlight: 'line',
              padding: { top: 12, bottom: 12 },
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              domReadOnly: true,
            }}
          />
        </div>
      )}

      {/* Status bar */}
      {active && (
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-[var(--color-border-subtle)] text-[9px] text-[var(--color-text-muted)]">
          <span>{active.language} · {active.line_count} lines</span>
          <span>Version: {active.version}</span>
        </div>
      )}
    </div>
  );
}
