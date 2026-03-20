import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Zap } from 'lucide-react';
import { useRegister } from '../../api/hooks';
import { extractErrorMessage } from '../../types';

export function RegisterPage() {
  const navigate = useNavigate();
  const register = useRegister();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);

    if (password !== confirmPassword) {
      setLocalError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setLocalError('Password must be at least 8 characters');
      return;
    }

    register.mutate(
      { name, email, password },
      { onSuccess: () => navigate('/') },
    );
  }

  const strength =
    password.length === 0
      ? 0
      : password.length < 8
        ? 1
        : password.length < 12
          ? 2
          : 3;
  const strengthColors = ['', 'bg-red-500', 'bg-yellow-500', 'bg-green-500'];
  const strengthLabels = ['', 'Weak', 'Fair', 'Strong'];

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-surface-primary)] px-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-[var(--color-gold-500)] flex items-center justify-center">
              <Zap className="w-5 h-5 text-[var(--color-navy-950)]" />
            </div>
            <h1 className="font-display text-3xl text-[var(--color-text-primary)]">YODA</h1>
          </div>
          <p className="text-sm text-[var(--color-text-tertiary)]">Create your account</p>
        </div>

        <div className="bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] rounded-xl p-8">
          {(localError || register.error) && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {localError || extractErrorMessage(register.error, 'Registration failed')}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">Name</label>
              <input
                type="text" value={name} onChange={(e) => setName(e.target.value)} required
                className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] focus:ring-1 focus:ring-[var(--color-gold-500)]/30 transition-colors"
                placeholder="Your name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">Email</label>
              <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] focus:ring-1 focus:ring-[var(--color-gold-500)]/30 transition-colors"
                placeholder="you@company.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">Password</label>
              <input
                type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] focus:ring-1 focus:ring-[var(--color-gold-500)]/30 transition-colors"
                placeholder="••••••••"
              />
              {password.length > 0 && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-[var(--color-surface-tertiary)] overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${strengthColors[strength]}`} style={{ width: `${(strength / 3) * 100}%` }} />
                  </div>
                  <span className="text-sm text-[var(--color-text-tertiary)]">{strengthLabels[strength]}</span>
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">Confirm password</label>
              <input
                type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required
                className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] focus:ring-1 focus:ring-[var(--color-gold-500)]/30 transition-colors"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit" disabled={register.isPending}
              className="w-full py-2.5 rounded-lg bg-[var(--color-gold-500)] text-[var(--color-navy-950)] font-semibold hover:bg-[var(--color-gold-400)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {register.isPending ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-[var(--color-text-tertiary)]">
            Already have an account?{' '}
            <Link to="/login" className="text-[var(--color-gold-400)] hover:text-[var(--color-gold-300)] transition-colors">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
