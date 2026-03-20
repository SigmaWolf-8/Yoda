import { useState } from 'react';
import { Github, Check, Loader2, X } from 'lucide-react';
import { useGitHubPAT, useUpdateGitHubPAT } from '../../api/hooks';

export function GitHubPATSetting() {
  const { data: status, isLoading } = useGitHubPAT();
  const update = useUpdateGitHubPAT();
  const [token, setToken] = useState('');

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    update.mutate({ token: token.trim() }, {
      onSuccess: () => setToken(''),
    });
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Github className="w-4 h-4 text-[var(--color-gold-400)]" />
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">GitHub Integration</h3>
      </div>
      <p className="text-sm text-[var(--color-text-muted)] mb-3">
        Personal Access Token for Ronin Git integration — create branches, commit code, open PRs.
      </p>

      {/* Status */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] mb-3">
          <Loader2 className="w-3 h-3 animate-spin" /> Checking…
        </div>
      ) : status?.configured ? (
        <div className="flex items-center gap-2 text-sm text-[var(--color-ok)] mb-3">
          <Check className="w-3.5 h-3.5" />
          Connected as <span className="font-semibold">{status.username}</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] mb-3">
          <X className="w-3.5 h-3.5" />
          Not configured
        </div>
      )}

      <form onSubmit={handleSave} className="flex gap-2">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
          className="flex-1 px-3 py-2 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] focus:ring-1 focus:ring-[var(--color-gold-500)]/30 transition-colors"
        />
        <button
          type="submit"
          disabled={update.isPending || !token.trim()}
          className="px-4 py-2 rounded-lg bg-[var(--color-gold-500)] text-[var(--color-navy-950)] text-sm font-semibold hover:bg-[var(--color-gold-400)] disabled:opacity-50 transition-colors"
        >
          {update.isPending ? 'Saving…' : status?.configured ? 'Update' : 'Connect'}
        </button>
      </form>

      {update.error && (
        <p className="text-sm text-[var(--color-err)] mt-2">
          Failed to validate token. Check that it has the correct scopes.
        </p>
      )}
    </div>
  );
}
