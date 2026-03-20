import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Zap } from 'lucide-react';
import { useLogin } from '../../api/hooks';
import { extractErrorMessage } from '../../types';

export function LoginPage() {
  const navigate = useNavigate();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    login.mutate(
      { email, password, remember },
      { onSuccess: () => navigate('/') },
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-surface-primary)] px-4">
      <div className="w-full max-w-md animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-[var(--color-gold-500)] flex items-center justify-center">
              <Zap className="w-5 h-5 text-[var(--color-navy-950)]" />
            </div>
            <h1 className="font-display text-3xl text-[var(--color-text-primary)]">
              YODA
            </h1>
          </div>
          <p className="text-sm text-[var(--color-text-tertiary)]">
            Development Intelligence Platform
          </p>
        </div>

        {/* Form */}
        <div className="bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] rounded-xl p-8">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-6">
            Sign in to your account
          </h2>

          {login.error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {extractErrorMessage(login.error, 'Login failed')}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] focus:ring-1 focus:ring-[var(--color-gold-500)]/30 transition-colors"
                placeholder="you@company.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] focus:ring-1 focus:ring-[var(--color-gold-500)]/30 transition-colors pr-10"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="remember"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="w-4 h-4 rounded border-[var(--color-border-default)] bg-[var(--color-surface-tertiary)] accent-[var(--color-gold-500)]"
              />
              <label htmlFor="remember" className="text-sm text-[var(--color-text-secondary)]">
                Remember me
              </label>
            </div>

            <button
              type="submit"
              disabled={login.isPending}
              className="w-full py-2.5 rounded-lg bg-[var(--color-gold-500)] text-[var(--color-navy-950)] font-semibold hover:bg-[var(--color-gold-400)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {login.isPending ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-[var(--color-text-tertiary)]">
            No account?{' '}
            <Link
              to="/register"
              className="text-[var(--color-gold-400)] hover:text-[var(--color-gold-300)] transition-colors"
            >
              Create one
            </Link>
          </p>
        </div>

        <p className="mt-8 text-center text-sm text-[var(--color-text-muted)]">
          Capomastro Holdings Ltd. — Applied Physics Division
        </p>
      </div>
    </div>
  );
}
