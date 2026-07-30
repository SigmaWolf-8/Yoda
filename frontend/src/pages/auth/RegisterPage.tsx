import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Zap } from 'lucide-react';
import { gatePost, cubeToWire } from '../../api/gate';
import { storeThetaSeed } from '../../api/theta';
import { BevelBox } from '../../components/ui/BevelBox';

export function RegisterPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [cube, setCube] = useState<number[]>([1, 1, 1]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Shown once, after enrollment: the Θ-lock seed. It is already seated on
  // this device — this is the operator's only chance to copy it elsewhere.
  const [issuedSeed, setIssuedSeed] = useState<string | null>(null);

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
    // Phone is contact information, not a factor — the Gate sends no SMS.
    if (phone.trim() && !phone.startsWith('+')) {
      setLocalError('If you give a phone it must be E.164 (start with +, e.g. +15551234567)');
      return;
    }

    setSubmitting(true);
    try {
      // Native wire enrollment — creates the account AND registers the Θ-lock
      // seed + Crystal cube in one pass. No tokens issued here; the operator
      // then passes the 3-factor gate to sign in.
      const r = await gatePost('/gate/enroll', {
        name,
        email,
        password,
        phone,
        cube: cubeToWire(cube[0], cube[1], cube[2]),
      });
      // The seed is issued exactly once. Seat it on this device — it is what
      // makes this Crystal the possession factor.
      if (!r.seed) throw new Error('The gate issued no Crystal seed');
      storeThetaSeed(r.seed);
      setIssuedSeed(r.seed);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
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
  const inputCls =
    'w-full px-3.5 py-2.5 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] focus:ring-1 focus:ring-[var(--color-gold-500)]/30 transition-colors';

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-surface-primary)] px-4 py-10">
      <div className="w-full max-w-md animate-fade-in">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-[var(--color-gold-500)] flex items-center justify-center">
              <Zap className="w-5 h-5 text-[var(--color-navy-950)]" />
            </div>
            <h1 className="font-display text-3xl text-[var(--color-text-primary)]">YODA</h1>
          </div>
          <p className="text-sm text-[var(--color-text-tertiary)]">Enroll your account &amp; three factors</p>
        </div>

        <BevelBox className="bg-[var(--color-surface-secondary)] p-8">
          {localError && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {localError}
            </div>
          )}

          {issuedSeed ? (
            <div className="space-y-5">
              <div>
                <h2 className="font-display text-xl text-[var(--color-text-primary)] mb-1.5">
                  Your Crystal seed
                </h2>
                <p className="text-sm text-[var(--color-text-tertiary)]">
                  Seated on this device. It never leaves it — the Gate only ever
                  sees six digits derived from it and the angle of the hour.
                  Copy it somewhere safe: it is shown once, and you will need it
                  to pass the Gate from any other device.
                </p>
              </div>
              <div className="p-3.5 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-gold-500)]/30 font-mono text-xs break-all text-[var(--color-gold-500)] select-all">
                {issuedSeed}
              </div>
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="w-full py-2.5 rounded-lg bg-[var(--color-gold-500)] text-[var(--color-navy-950)] font-medium hover:opacity-90 transition-opacity"
              >
                I have kept it — go to the Gate
              </button>
            </div>
          ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className={inputCls} placeholder="Your name" />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputCls} placeholder="you@company.com" />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className={inputCls} placeholder="••••••••" />
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
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required className={inputCls} placeholder="••••••••" />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">Phone — contact only, not a key</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="Optional · +15551234567" />
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">One-time codes are sent here at every sign-in.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">Your Crystal cube (codepoint factor)</label>
              <div className="space-y-2">
                {['X', 'Y', 'Z'].map((axis, ai) => (
                  <div key={axis} className="flex items-center gap-2">
                    <span className="w-5 text-sm text-[var(--color-text-tertiary)]">{axis}</span>
                    <div className="flex gap-2 flex-1">
                      {[1, 2, 3].map((t) => {
                        const sel = cube[ai] === t;
                        return (
                          <button
                            key={t}
                            type="button"
                            onClick={() => {
                              const next = [...cube];
                              next[ai] = t;
                              setCube(next);
                            }}
                            className={`flex-1 py-2 rounded-lg border text-sm font-semibold transition-colors ${
                              sel
                                ? 'bg-[var(--color-gold-500)] text-[var(--color-navy-950)] border-[var(--color-gold-500)]'
                                : 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-secondary)] border-[var(--color-border-default)] hover:border-[var(--color-gold-500)]'
                            }`}
                          >
                            {t}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Codepoint · {cube[0]}.{cube[1]}.{cube[2]} — remember this; you select it to pass the gate.
              </p>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 rounded-lg bg-[var(--color-gold-500)] text-[var(--color-navy-950)] font-semibold hover:bg-[var(--color-gold-400)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Enrolling…' : 'Enroll account'}
            </button>
          </form>
          )}

          <p className="mt-6 text-center text-sm text-[var(--color-text-tertiary)]">
            Already have an account?{' '}
            <Link to="/login" className="text-[var(--color-gold-400)] hover:text-[var(--color-gold-300)] transition-colors">
              Sign in
            </Link>
          </p>
        </BevelBox>
      </div>
    </div>
  );
}
