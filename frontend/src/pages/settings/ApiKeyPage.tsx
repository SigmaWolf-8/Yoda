import { useState } from 'react';
import { Key, Plus, Trash2, Copy, Check, Loader2, AlertTriangle } from 'lucide-react';
import { useApiKeys, useCreateApiKey, useDeleteApiKey } from '../../api/hooks';

export function ApiKeyPage() {
  const { data: keys, isLoading } = useApiKeys();
  const createKey = useCreateApiKey();
  const deleteKey = useDeleteApiKey();

  const [showCreate, setShowCreate] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!keyName.trim()) return;
    createKey.mutate(
      { name: keyName.trim() },
      {
        onSuccess: (data) => {
          setNewSecret(data.secret);
          setKeyName('');
        },
      },
    );
  }

  function handleCopy() {
    if (newSecret) {
      navigator.clipboard.writeText(newSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleDelete(id: string) {
    deleteKey.mutate(id, { onSuccess: () => setDeleteTarget(null) });
  }

  function closeCreateModal() {
    setShowCreate(false);
    setNewSecret(null);
    setKeyName('');
    createKey.reset();
  }

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Key className="w-5 h-5 text-[var(--color-gold-400)]" />
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">API Keys</h1>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-gold-500)] text-[var(--color-navy-950)] text-sm font-semibold hover:bg-[var(--color-gold-400)] transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create Key
        </button>
      </div>

      <p className="text-sm text-[var(--color-text-tertiary)] mb-6">
        API keys allow programmatic access to YODA via the <code className="text-xs bg-[var(--color-surface-tertiary)] px-1.5 py-0.5 rounded">X-API-Key</code> header.
      </p>

      {/* Key list */}
      <div className="bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center gap-2 text-[var(--color-text-muted)] p-6">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading keys…</span>
          </div>
        ) : !keys?.length ? (
          <div className="p-8 text-center">
            <Key className="w-8 h-8 text-[var(--color-text-muted)] mx-auto mb-3" />
            <p className="text-sm text-[var(--color-text-tertiary)]">No API keys yet.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--color-border-subtle)]">
                <th className="text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider px-5 py-3">Name</th>
                <th className="text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider px-5 py-3">Key Prefix</th>
                <th className="text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider px-5 py-3">Created</th>
                <th className="w-12 px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-surface-tertiary)]/30 transition-colors">
                  <td className="px-5 py-3 text-sm text-[var(--color-text-primary)] font-medium">{k.name}</td>
                  <td className="px-5 py-3">
                    <code className="text-xs bg-[var(--color-surface-tertiary)] px-2 py-0.5 rounded text-[var(--color-text-secondary)]">
                      {k.prefix}…
                    </code>
                  </td>
                  <td className="px-5 py-3 text-sm text-[var(--color-text-muted)]">
                    {new Date(k.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => setDeleteTarget(k.id)}
                      className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Revoke key"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] rounded-xl p-6 animate-fade-in">
            {newSecret ? (
              /* Secret reveal */
              <div>
                <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
                  Key created
                </h3>
                <div className="flex items-start gap-2 mb-4 p-3 rounded-lg bg-[var(--color-gold-500)]/5 border border-[var(--color-gold-500)]/20">
                  <AlertTriangle className="w-4 h-4 text-[var(--color-gold-400)] flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-[var(--color-gold-300)]">
                    This key will only be shown once. Copy it now.
                  </p>
                </div>
                <div className="relative mb-4">
                  <code className="block w-full p-3 pr-12 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-xs text-[var(--color-text-primary)] break-all select-all">
                    {newSecret}
                  </code>
                  <button
                    onClick={handleCopy}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                  >
                    {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <button
                  onClick={closeCreateModal}
                  className="w-full py-2 rounded-lg text-sm font-semibold bg-[var(--color-gold-500)] text-[var(--color-navy-950)] hover:bg-[var(--color-gold-400)] transition-colors"
                >
                  Done
                </button>
              </div>
            ) : (
              /* Name input */
              <div>
                <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
                  Create API key
                </h3>
                <form onSubmit={handleCreate} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
                      Key name
                    </label>
                    <input
                      type="text"
                      value={keyName}
                      onChange={(e) => setKeyName(e.target.value)}
                      required
                      className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] focus:ring-1 focus:ring-[var(--color-gold-500)]/30 transition-colors"
                      placeholder="e.g. CI Pipeline Key"
                    />
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={closeCreateModal}
                      className="flex-1 py-2 rounded-lg text-sm font-medium text-[var(--color-text-tertiary)] bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] hover:bg-[var(--color-surface-hover)] transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={createKey.isPending}
                      className="flex-1 py-2 rounded-lg text-sm font-semibold bg-[var(--color-gold-500)] text-[var(--color-navy-950)] hover:bg-[var(--color-gold-400)] disabled:opacity-50 transition-colors"
                    >
                      {createKey.isPending ? 'Creating…' : 'Create'}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] rounded-xl p-6 animate-fade-in">
            <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
              Revoke API key?
            </h3>
            <p className="text-sm text-[var(--color-text-tertiary)] mb-5">
              This action cannot be undone. Any integrations using this key will stop working.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2 rounded-lg text-sm font-medium text-[var(--color-text-tertiary)] bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteTarget)}
                disabled={deleteKey.isPending}
                className="flex-1 py-2 rounded-lg text-sm font-semibold bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
              >
                {deleteKey.isPending ? 'Revoking…' : 'Revoke key'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
