import { useRef, useEffect, useState, useCallback } from 'react';
import { Loader2, SendHorizonal, Bot, User, AlertTriangle } from 'lucide-react';
import type { Task } from '../../types/task';
import type { TaskMessage } from '../../types/task';
import { useAddTaskMessage } from '../../api/hooks/useTasks';

interface Props {
  task: Task;
  messages: TaskMessage[];
}

const PENDING_STATUSES = new Set([
  'QUEUED', 'ASSIGNED', 'STEP_1', 'STEP_1_PRODUCTION', 'STEP_1_REVIEW',
  'STEP_2', 'STEP_2_PRODUCTION', 'STEP_2_REVIEW',
  'STEP_3', 'STEP_3_PRODUCTION', 'STEP_3_REVIEW',
  'STEP_4_FINAL_OUTPUT', 'DECOMPOSING',
]);

function isPending(status: string) {
  return PENDING_STATUSES.has(status);
}

export function TaskThread({ task, messages }: Props) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const addMessage = useAddTaskMessage(task.id);

  const waiting = isPending(task.status);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, waiting]);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || addMessage.isPending || waiting) return;
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    addMessage.mutate(text);
  }, [input, addMessage, waiting]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const displayMessages = messages.length > 0
    ? messages
    : [{ id: 'synthetic-0', task_id: task.id, role: 'user' as const, content: task.title, created_at: task.created_at }];

  return (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      <div className="flex items-center gap-2 px-1 pb-3 border-b border-[var(--color-border-subtle)] mb-4 flex-shrink-0">
        <code className="text-xs font-mono text-[var(--color-text-muted)] bg-[var(--color-surface-tertiary)] px-1.5 py-0.5 rounded">
          {task.task_number}
        </code>
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold uppercase ${
          task.status === 'FINAL'
            ? 'bg-[var(--color-ok)]/10 text-[var(--color-ok)]'
            : task.status === 'ESCALATED'
              ? 'bg-[var(--color-warn)]/10 text-[var(--color-warn)]'
              : task.status === 'CANCELLED'
                ? 'bg-[var(--color-err)]/10 text-[var(--color-err)]'
                : 'bg-[var(--color-plex-500)]/10 text-[var(--color-plex-400)]'
        }`}>
          {task.status.replace(/_/g, ' ')}
        </span>
        {task.competencies?.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {task.competencies.map((c) => (
              <span key={c} className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-[var(--color-plex-500)]/10 text-[var(--color-plex-400)] border border-[var(--color-plex-500)]/20">
                {c}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-2">
        {displayMessages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}

        {/* Waiting indicator — shown after last user message while engine works */}
        {waiting && (
          <div className="flex items-start gap-2.5">
            <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center bg-[var(--color-plex-500)]/15 text-[var(--color-plex-400)]">
              <Bot className="w-3.5 h-3.5" />
            </div>
            <div className="bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] rounded-2xl rounded-tl-sm px-4 py-3 max-w-prose">
              <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                <span>
                  {task.error_message
                    ? task.error_message
                    : 'Thinking…'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Escalated / error indicator */}
        {task.status === 'ESCALATED' && task.error_message && (
          <div className="flex items-start gap-2.5">
            <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center bg-[var(--color-warn)]/15 text-[var(--color-warn)]">
              <AlertTriangle className="w-3.5 h-3.5" />
            </div>
            <div className="bg-[var(--color-warn)]/5 border border-[var(--color-warn)]/20 rounded-2xl rounded-tl-sm px-4 py-3 max-w-prose">
              <p className="text-xs font-semibold text-[var(--color-warn)] mb-1">Engine escalated</p>
              <p className="text-sm text-[var(--color-text-muted)] whitespace-pre-wrap break-words">
                {task.error_message}
              </p>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Follow-up input */}
      <div className="flex-shrink-0 mt-3 pt-3 border-t border-[var(--color-border-subtle)]">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); autoResize(); }}
            onKeyDown={handleKeyDown}
            placeholder={waiting ? 'Waiting for response…' : 'Ask a follow-up…'}
            disabled={waiting || addMessage.isPending}
            rows={1}
            className="flex-1 resize-none bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] rounded-xl px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-plex-400)] transition-colors disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || waiting || addMessage.isPending}
            className="p-2.5 rounded-xl bg-[var(--color-plex-500)] text-white hover:bg-[var(--color-plex-400)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            {addMessage.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <SendHorizonal className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: TaskMessage }) {
  const isUser = msg.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="flex items-end gap-2 max-w-[85%]">
          <div className="bg-[var(--color-plex-500)]/15 border border-[var(--color-plex-500)]/20 rounded-2xl rounded-br-sm px-4 py-2.5">
            <p className="text-sm text-[var(--color-text-primary)] whitespace-pre-wrap break-words">
              {msg.content}
            </p>
          </div>
          <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center bg-[var(--color-plex-500)]/20 text-[var(--color-plex-400)]">
            <User className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2.5">
      <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center bg-[var(--color-plex-500)]/15 text-[var(--color-plex-400)]">
        <Bot className="w-3.5 h-3.5" />
      </div>
      <div className="bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%]">
        <p className="text-sm text-[var(--color-text-primary)] leading-relaxed whitespace-pre-wrap break-words">
          {msg.content}
        </p>
      </div>
    </div>
  );
}
