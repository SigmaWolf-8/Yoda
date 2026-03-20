import { useState, useMemo } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Building2,
  Key,
  LogOut,
  ChevronDown,
  User as UserIcon,
} from 'lucide-react';
import { clearTokens, getStoredToken } from '../../api/client';

/** Decode JWT payload without verification (for display only). */
function decodeJWTPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

export function UserProfile() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const user = useMemo(() => {
    const token = getStoredToken();
    if (!token) return null;
    const payload = decodeJWTPayload(token);
    if (!payload) return null;
    return {
      name: (payload.name as string) ?? (payload.email as string) ?? 'User',
      email: (payload.email as string) ?? '',
    };
  }, []);

  const initials = user
    ? user.name
        .split(' ')
        .map((w) => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : 'Y';

  function handleLogout() {
    clearTokens();
    navigate('/login');
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-[var(--color-surface-tertiary)] transition-colors"
      >
        <div className="w-7 h-7 rounded-full bg-[var(--color-gold-500)]/20 border border-[var(--color-gold-500)]/30 flex items-center justify-center">
          <span className="text-xs font-bold text-[var(--color-gold-400)] leading-none">
            {initials}
          </span>
        </div>
        {user && (
          <span className="hidden sm:block text-sm text-[var(--color-text-secondary)] max-w-[120px] truncate">
            {user.name}
          </span>
        )}
        <ChevronDown className={`w-3.5 h-3.5 text-[var(--color-text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1.5 z-50 w-52 rounded-xl bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] shadow-xl overflow-hidden animate-fade-in">
            {/* User info header */}
            {user && (
              <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
                <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">{user.name}</p>
                <p className="text-sm text-[var(--color-text-muted)] truncate">{user.email}</p>
              </div>
            )}

            <div className="py-1">
              <NavLink
                to="/settings"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)] transition-colors"
              >
                <UserIcon className="w-4 h-4" />
                Settings
              </NavLink>
              <NavLink
                to="/settings/org"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)] transition-colors"
              >
                <Building2 className="w-4 h-4" />
                Organization
              </NavLink>
              <NavLink
                to="/settings/api-keys"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)] transition-colors"
              >
                <Key className="w-4 h-4" />
                API Keys
              </NavLink>
            </div>

            <div className="border-t border-[var(--color-border-subtle)] py-1">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
