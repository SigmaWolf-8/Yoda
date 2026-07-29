import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Boxes,
  KeyRound,
  Smartphone,
  Check,
  Loader2,
  ArrowLeft,
  Sparkles,
} from 'lucide-react';
import { extractErrorMessage } from '../../types';
import { BevelBox } from '../../components/ui/BevelBox';
import {
  useThreeFactorStart,
  useThreeFactorKnowledge,
  useThreeFactorPossessionRequest,
  useThreeFactorPossessionVerify,
  useThreeFactorCodepoint,
  type ThreeFactorStartResponse,
  type CodepointResponse,
} from '../../api/hooks/useThreeFactor';

type Step = 'idle' | 'knowledge' | 'possession' | 'codepoint' | 'connected';

const FACTORS: { key: Step; label: string; Icon: typeof KeyRound }[] = [
  { key: 'knowledge', label: 'Knowledge', Icon: KeyRound },
  { key: 'possession', label: 'Possession', Icon: Smartphone },
  { key: 'codepoint', label: 'Codepoint', Icon: Boxes },
];

const ORDER: Step[] = ['idle', 'knowledge', 'possession', 'codepoint', 'connected'];

export function CrystalAuthPage() {
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('idle');
  const [session, setSession] = useState<ThreeFactorStartResponse | null>(null);
  const [pin, setPin] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [devCode, setDevCode] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [selected, setSelected] = useState<{ x: number; y: number; z: number } | null>(null);
  const [result, setResult] = useState<CodepointResponse | null>(null);

  const start = useThreeFactorStart();
  const knowledge = useThreeFactorKnowledge();
  const possessionReq = useThreeFactorPossessionRequest();
  const possessionVerify = useThreeFactorPossessionVerify();
  const codepoint = useThreeFactorCodepoint();

  const hints = session?.dev_hints ?? null;

  function begin() {
    start.mutate(undefined, {
      onSuccess: (data) => {
        setSession(data);
        setStep('knowledge');
      },
    });
  }

  function submitKnowledge(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    knowledge.mutate(
      { session_id: session.session_id, pin },
      { onSuccess: () => setStep('possession') },
    );
  }

  function requestCode() {
    if (!session) return;
    possessionReq.mutate(
      { session_id: session.session_id },
      {
        onSuccess: (data) => {
          setCodeSent(true);
          setDevCode(data.dev_code);
        },
      },
    );
  }

  function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    possessionVerify.mutate(
      { session_id: session.session_id, code: Number(code) },
      { onSuccess: () => setStep('codepoint') },
    );
  }

  function alignCodepoint() {
    if (!session || !selected) return;
    codepoint.mutate(
      { session_id: session.session_id, ...selected },
      {
        onSuccess: (data) => {
          setResult(data);
          setStep('connected');
        },
      },
    );
  }

  const activeIndex = ORDER.indexOf(step);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-surface-primary)] px-4 py-10">
      <div className="w-full max-w-lg animate-fade-in">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-[var(--color-gold-500)] flex items-center justify-center">
              <Boxes className="w-5 h-5 text-[var(--color-navy-950)]" />
            </div>
            <h1 className="font-display text-3xl text-[var(--color-text-primary)]">
              The Crystal
            </h1>
          </div>
          <p className="text-sm text-[var(--color-text-tertiary)]">
            Three-Factor Zero-Knowledge Access · Friendly Approved Members
          </p>
        </div>

        {/* Factor stepper */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {FACTORS.map(({ key, label, Icon }, i) => {
            const idx = ORDER.indexOf(key);
            const done = activeIndex > idx;
            const current = step === key;
            return (
              <div key={key} className="flex items-center gap-2">
                <div className="flex flex-col items-center gap-1.5">
                  <div
                    className={[
                      'w-10 h-10 rounded-full flex items-center justify-center border transition-colors',
                      done
                        ? 'bg-[var(--color-gold-500)] border-[var(--color-gold-500)] text-[var(--color-navy-950)]'
                        : current
                          ? 'border-[var(--color-gold-500)] text-[var(--color-gold-400)]'
                          : 'border-[var(--color-border-default)] text-[var(--color-text-muted)]',
                    ].join(' ')}
                  >
                    {done ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                  </div>
                  <span
                    className={[
                      'text-[11px] font-medium tracking-wide',
                      current || done
                        ? 'text-[var(--color-text-secondary)]'
                        : 'text-[var(--color-text-muted)]',
                    ].join(' ')}
                  >
                    {label}
                  </span>
                </div>
                {i < FACTORS.length - 1 && (
                  <div
                    className={[
                      'w-8 h-px -mt-5',
                      activeIndex > idx
                        ? 'bg-[var(--color-gold-500)]'
                        : 'bg-[var(--color-border-default)]',
                    ].join(' ')}
                  />
                )}
              </div>
            );
          })}
        </div>

        <BevelBox className="bg-[var(--color-surface-secondary)] p-8">
          {/* ── Step: idle ── */}
          {step === 'idle' && (
            <div className="text-center">
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
                Enter the Crystal
              </h2>
              <p className="text-sm text-[var(--color-text-tertiary)] mb-6">
                Authenticate with three factors — something you know, something you
                hold, and a codepoint on the Array3 lattice — to be admitted as a
                Friendly Approved Member.
              </p>
              {start.error && <ErrorBox error={start.error} />}
              <button
                onClick={begin}
                disabled={start.isPending}
                className="w-full py-2.5 rounded-lg bg-[var(--color-gold-500)] text-[var(--color-navy-950)] font-semibold hover:bg-[var(--color-gold-400)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2"
              >
                {start.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {start.isPending ? 'Opening…' : 'Enter the Crystal'}
              </button>
            </div>
          )}

          {/* ── Step 1: Knowledge ── */}
          {step === 'knowledge' && (
            <form onSubmit={submitKnowledge}>
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
                Factor I — Knowledge
              </h2>
              <p className="text-sm text-[var(--color-text-tertiary)] mb-5">
                Enter your PIN.
              </p>
              {knowledge.error && <ErrorBox error={knowledge.error} />}
              <input
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                autoFocus
                required
                placeholder="••••"
                className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-center text-2xl tracking-[0.5em] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] focus:ring-1 focus:ring-[var(--color-gold-500)]/30 transition-colors"
              />
              {hints && <Hint>Demo PIN: {hints.pin}</Hint>}
              <SubmitButton pending={knowledge.isPending} label="Verify Knowledge" />
            </form>
          )}

          {/* ── Step 2: Possession ── */}
          {step === 'possession' && (
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
                Factor II — Possession
              </h2>
              <p className="text-sm text-[var(--color-text-tertiary)] mb-5">
                A one-time code is delivered to your enrolled handset.
              </p>
              {(possessionReq.error || possessionVerify.error) && (
                <ErrorBox error={possessionReq.error || possessionVerify.error} />
              )}

              {!codeSent ? (
                <button
                  onClick={requestCode}
                  disabled={possessionReq.isPending}
                  className="w-full py-2.5 rounded-lg bg-[var(--color-gold-500)] text-[var(--color-navy-950)] font-semibold hover:bg-[var(--color-gold-400)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2"
                >
                  {possessionReq.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Smartphone className="w-4 h-4" />
                  )}
                  Send code
                </button>
              ) : (
                <form onSubmit={submitCode}>
                  <p className="text-xs text-[var(--color-text-muted)] mb-2">
                    Code sent to {possessionReq.data?.sent_to}
                  </p>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoFocus
                    required
                    placeholder="000000"
                    className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-center text-2xl tracking-[0.4em] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] focus:ring-1 focus:ring-[var(--color-gold-500)]/30 transition-colors"
                  />
                  {devCode != null && (
                    <Hint>Dev code: {String(devCode).padStart(6, '0')}</Hint>
                  )}
                  <SubmitButton pending={possessionVerify.isPending} label="Verify Code" />
                  <button
                    type="button"
                    onClick={requestCode}
                    disabled={possessionReq.isPending}
                    className="mt-2 w-full text-xs text-[var(--color-gold-400)] hover:text-[var(--color-gold-300)] transition-colors"
                  >
                    Resend code
                  </button>
                </form>
              )}
            </div>
          )}

          {/* ── Step 3: Codepoint ── */}
          {step === 'codepoint' && (
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
                Factor III — Codepoint
              </h2>
              <p className="text-sm text-[var(--color-text-tertiary)] mb-5">
                Select your cube on the Array3 lattice.
              </p>
              {codepoint.error && <ErrorBox error={codepoint.error} />}

              <div className="flex justify-between gap-3 mb-4">
                {[1, 2, 3].map((z) => (
                  <div key={z} className="flex-1">
                    <div className="text-center text-[11px] font-medium text-[var(--color-text-muted)] mb-1.5">
                      Z {z}
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {[1, 2, 3].map((y) =>
                        [1, 2, 3].map((x) => {
                          const on =
                            selected?.x === x && selected?.y === y && selected?.z === z;
                          return (
                            <button
                              key={`${x}-${y}-${z}`}
                              type="button"
                              onClick={() => setSelected({ x, y, z })}
                              title={`(${x}, ${y}, ${z})`}
                              className={[
                                'aspect-square rounded-md border transition-all',
                                on
                                  ? 'bg-[var(--color-gold-500)] border-[var(--color-gold-400)] shadow-[0_0_12px_var(--color-gold-500)]'
                                  : 'bg-[var(--color-surface-tertiary)] border-[var(--color-border-default)] hover:border-[var(--color-gold-500)]/60',
                              ].join(' ')}
                            />
                          );
                        }),
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <p className="text-center text-xs text-[var(--color-text-muted)] mb-1">
                {selected
                  ? `Selected codepoint (${selected.x}, ${selected.y}, ${selected.z})`
                  : 'No cube selected'}
              </p>
              {hints && (
                <Hint>
                  Demo codepoint: ({hints.codepoint.x}, {hints.codepoint.y},{' '}
                  {hints.codepoint.z})
                </Hint>
              )}
              <button
                onClick={alignCodepoint}
                disabled={!selected || codepoint.isPending}
                className="mt-4 w-full py-2.5 rounded-lg bg-[var(--color-gold-500)] text-[var(--color-navy-950)] font-semibold hover:bg-[var(--color-gold-400)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2"
              >
                {codepoint.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Boxes className="w-4 h-4" />
                )}
                Align Codepoint
              </button>
            </div>
          )}

          {/* ── Connected ── */}
          {step === 'connected' && result && (
            <div className="text-center">
              <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-[var(--color-gold-500)] flex items-center justify-center">
                <Check className="w-7 h-7 text-[var(--color-navy-950)]" />
              </div>
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
                {result.status}
              </h2>
              <p className="text-sm text-[var(--color-text-tertiary)] mb-4">
                All three factors satisfied. Presence established for{' '}
                {result.expires_in_minutes} minutes.
              </p>
              <div className="mb-6 p-3 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)]">
                <div className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)] mb-1">
                  Presence Scalar
                </div>
                <div className="font-mono text-sm text-[var(--color-gold-400)] break-all">
                  {result.presence_scalar}
                </div>
              </div>
              <button
                onClick={() => navigate('/')}
                className="w-full py-2.5 rounded-lg bg-[var(--color-gold-500)] text-[var(--color-navy-950)] font-semibold hover:bg-[var(--color-gold-400)] transition-colors"
              >
                Enter YODA
              </button>
            </div>
          )}
        </BevelBox>

        <div className="mt-8 text-center">
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to standard sign in
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Small presentational helpers ──

function ErrorBox({ error }: { error: unknown }) {
  return (
    <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
      {extractErrorMessage(error, 'Authentication failed')}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 text-center text-xs text-[var(--color-text-muted)]">{children}</p>
  );
}

function SubmitButton({ pending, label }: { pending: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-4 w-full py-2.5 rounded-lg bg-[var(--color-gold-500)] text-[var(--color-navy-950)] font-semibold hover:bg-[var(--color-gold-400)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2"
    >
      {pending && <Loader2 className="w-4 h-4 animate-spin" />}
      {label}
    </button>
  );
}
