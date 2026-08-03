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
    // A phone is optional, and the server does the real normalizing. Mirror
    // only its outer bounds here so the common typo is caught without a
    // round-trip — anything subtler is the server's answer to give, and a
    // check that disagreed with it would be worse than no check at all.
    const phoneDigits = phone.replace(/\D/g, '');
    if (phone.trim() && phoneDigits.length < 10) {
      setLocalError('That number looks too short — include the area code, like 780 555 1234.');
      return;
    }
    if (phoneDigits.length > 15) {
      setLocalError('That number is longer than any phone number in use.');
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
          <p className="text-sm text-[var(--color-text-tertiary)]">Create your account and set up how you'll sign in</p>
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
                  Save this secret key
                </h2>
                <p className="text-sm text-[var(--color-text-tertiary)]">
                  It's now stored on this device, and it stays here — signing in
                  from this machine won't ask you for it. But you are shown it
                  only once, and you'll need it to sign in from any other
                  computer. Copy it somewhere safe now.
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
              <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">Mobile number <span className="text-[var(--color-text-muted)] font-normal">— optional</span></label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="780 555 1234" />
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Add it and we'll text you a 6-digit code every time you sign in.
                Leave it blank and we won't.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">Pick three numbers</label>
              <p className="mb-2.5 text-xs text-[var(--color-text-muted)]">
                One from each row — like a 3-digit PIN you choose yourself.
                You'll pick these same three every time you sign in.
              </p>
              <div className="space-y-2">
                {['1st', '2nd', '3rd'].map((axis, ai) => (
                  <div key={axis} className="flex items-center gap-2">
                    <span className="w-7 text-xs text-[var(--color-text-tertiary)]">{axis}</span>
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
                Your three numbers · {cube[0]} · {cube[1]} · {cube[2]} — remember them; you pick them again every time you sign in.
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
