import { useState, useRef, useEffect } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { useSubmitQuery } from '../../api/hooks';
import type { QueryResult } from '../../types';

const PLACEHOLDERS = {
  yoda: 'Analyze the security implications of migrating from RSA-4096 to TL-DSA…',
  ronin: 'Build a REST API with create document, sign document, and verify signature endpoints…',
};

interface Props {
  projectId: string;
  mode: 'yoda' | 'ronin';
  onResult?: (result: QueryResult) => void;
}

export function QueryInput({ projectId, mode, onResult }: Props) {
  const [text, setText] = useState('');
  const submit = useSubmitQuery(projectId);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    }
  }, [text]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || submit.isPending) return;
    submit.mutate(
      { text: text.trim(), mode },
      {
        onSuccess: (result) => {
          if (result.status === 'executing') setText('');
          onResult?.(result);
        },
      },
    );
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="relative">
      <div className="bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] rounded-xl overflow-hidden focus-within:border-[var(--color-gold-500)]/40 transition-colors">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={PLACEHOLDERS[mode]}
          rows={2}
          disabled={submit.isPending}
          className="w-full px-4 pt-4 pb-2 bg-transparent text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] resize-none focus:outline-none disabled:opacity-60"
        />
        <div className="flex items-center justify-between px-4 pb-3">
          <span className="text-[10px] text-[var(--color-text-muted)]">
            {mode === 'ronin' ? 'Produces code + implementation instructions' : 'Produces research + analysis'}
            {' · '}
            <kbd className="px-1 py-0.5 rounded bg-[var(--color-surface-tertiary)] text-[9px]">Enter</kbd> to send
            {' · '}
            <kbd className="px-1 py-0.5 rounded bg-[var(--color-surface-tertiary)] text-[9px]">Shift+Enter</kbd> for newline
          </span>
          <button
            type="submit"
            disabled={!text.trim() || submit.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-gold-500)] text-[var(--color-navy-950)] text-xs font-semibold hover:bg-[var(--color-gold-400)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {submit.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            Send
          </button>
        </div>
      </div>

      {submit.error && (
        <p className="mt-2 text-xs text-[var(--color-err)]">
          Failed to submit query. Check that your engines are configured and online.
        </p>
      )}
    </form>
  );
}
