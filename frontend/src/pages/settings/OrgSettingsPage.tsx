import { useState } from 'react';
import { Building2, UserPlus, Shield, Crown, User, Loader2 } from 'lucide-react';
import { useOrganizations, useInviteMember } from '../../api/hooks';
import { usePageHeader } from '../../context/PageHeader';

export function OrgSettingsPage() {
  const { data: orgs, isLoading } = useOrganizations();
  const org = orgs?.[0]; // current org — MVP: single org per user
  const invite = useInviteMember(org?.id ?? '');

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');

  function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    invite.mutate(
      { email: inviteEmail.trim(), role: inviteRole },
      {
        onSuccess: () => {
          setShowInvite(false);
          setInviteEmail('');
          setInviteRole('member');
        },
      },
    );
  }

  const roleIcon = (role: string) => {
    switch (role) {
      case 'owner': return <Crown className="w-3.5 h-3.5 text-[var(--color-gold-400)]" />;
      case 'admin': return <Shield className="w-3.5 h-3.5 text-[var(--color-plex-400)]" />;
      default:      return <User className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />;
    }
  };

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = {
      owner: 'bg-[var(--color-gold-500)]/10 text-[var(--color-gold-400)] border-[var(--color-gold-500)]/20',
      admin: 'bg-[var(--color-plex-500)]/10 text-[var(--color-plex-400)] border-[var(--color-plex-500)]/20',
      member: 'bg-[var(--color-navy-700)]/50 text-[var(--color-text-tertiary)] border-[var(--color-border-default)]',
    };
    return (
      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${colors[role] ?? colors.member}`}>
        {roleIcon(role)}
        {role.charAt(0).toUpperCase() + role.slice(1)}
      </span>
    );
  };

  usePageHeader({
    icon: Building2,
    title: 'Organization',
    subtitle: 'Manage your organization members and settings.',
  });

  if (isLoading) {
    return (
      <div className="p-6 lg:p-8 max-w-3xl mx-auto animate-fade-in">
        <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading organization…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto animate-fade-in">

      {/* Org Info */}
      <div className="bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] rounded-xl p-6 mb-6">
        <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
          Organization name
        </label>
        <p className="text-[var(--color-text-primary)] font-medium">
          {org?.name ?? 'No organization'}
        </p>
      </div>

      {/* Members */}
      <div className="bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] rounded-xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Members</h2>
          <button
            onClick={() => setShowInvite(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--color-gold-500)]/10 text-[var(--color-gold-400)] text-sm font-medium hover:bg-[var(--color-gold-500)]/20 border border-[var(--color-gold-500)]/20 transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Invite
          </button>
        </div>

        {/* Member list — MVP shows current user as owner */}
        <div className="space-y-3">
          <div className="flex items-center justify-between py-3 px-4 rounded-lg bg-[var(--color-surface-tertiary)]/50">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[var(--color-gold-500)]/20 flex items-center justify-center">
                <span className="text-xs font-semibold text-[var(--color-gold-400)]">Y</span>
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--color-text-primary)]">You</p>
                <p className="text-xs text-[var(--color-text-muted)]">{org?.role ?? 'owner'}</p>
              </div>
            </div>
            {roleBadge(org?.role ?? 'owner')}
          </div>
        </div>
      </div>

      {/* Invite Modal */}
      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] rounded-xl p-6 animate-fade-in">
            <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
              Invite team member
            </h3>

            {invite.error && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                Failed to send invitation. They may already be a member.
              </div>
            )}

            <form onSubmit={handleInvite} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
                  Email address
                </label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] focus:ring-1 focus:ring-[var(--color-gold-500)]/30 transition-colors"
                  placeholder="teammate@company.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
                  Role
                </label>
                <div className="flex gap-3">
                  {(['member', 'admin'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setInviteRole(r)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                        inviteRole === r
                          ? 'bg-[var(--color-gold-500)]/10 text-[var(--color-gold-400)] border-[var(--color-gold-500)]/30'
                          : 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-tertiary)] border-[var(--color-border-default)] hover:border-[var(--color-border-strong)]'
                      }`}
                    >
                      {r.charAt(0).toUpperCase() + r.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowInvite(false)}
                  className="flex-1 py-2 rounded-lg text-sm font-medium text-[var(--color-text-tertiary)] bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] hover:bg-[var(--color-surface-hover)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={invite.isPending}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold bg-[var(--color-gold-500)] text-[var(--color-navy-950)] hover:bg-[var(--color-gold-400)] disabled:opacity-50 transition-colors"
                >
                  {invite.isPending ? 'Sending…' : 'Send invite'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
