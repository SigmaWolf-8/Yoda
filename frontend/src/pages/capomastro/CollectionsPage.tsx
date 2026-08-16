/**
 * Collections — the estate's receivables, and the demands issued against them.
 *
 * Every figure on this page comes from `GET /api/capomastro/collections`, which
 * reads principal from the Balance Sheet and accrues interest live against the
 * published reference rate: the same computation the statements foot on. No
 * figure is re-derived here, and none passes through a JS `number`.
 *
 * A `null` amount is not zero. It means the backend withheld the figure because
 * a rate source could not be reached, and it renders as an explicit gap with
 * the reason attached.
 *
 * Invoice state is never cached client-side either — it is read from Stripe on
 * every load. When Stripe cannot be reached the invoice says so rather than
 * appearing unpaid.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
  CircleDollarSign,
  ExternalLink,
  FileText,
  Gavel,
  Loader2,
  RefreshCw,
  Send,
  ShieldAlert,
} from 'lucide-react';
import { usePageHeader } from '../../context/PageHeader';
import { BevelBox } from '../../components/ui/BevelBox';
import apiClient from '../../api/client';
import { Kpi, Panel } from './ui';
import { type Dec, exact, exactTo, money, rate, usd } from './money';

/**
 * Currencies Stripe carries with no minor unit — showing `¥1000.00` would
 * imply a precision the currency does not have. Mirrors the backend list.
 */
const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV',
  'XAF', 'XOF', 'XPF',
]);

/** A figure in a named currency, at that currency's own precision. */
function amt(currency: string, value: Dec): string {
  return ZERO_DECIMAL.has(currency) ? exact(value) : exactTo(value, 2);
}

// ── Types mirroring GET /api/capomastro/collections ──

interface DemandRecord {
  id: string;
  issuedAt: string;
  debtorEmail: string;
  debtorName: string | null;
  amount: Dec;
  outstandingAtIssue: Dec;
  memo: string | null;
  stripeInvoiceId: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  number: string | null;
  state: string;
  failureReason: string | null;
  invoiceStatus: string | null;
  amountPaid: Dec | null;
  amountDue: Dec | null;
  invoiceError: string | null;
  delivery: string | null;
  deliveryError: string | null;
}

interface Position {
  id: string;
  ledgerLine: string;
  obligor: string;
  instrument: string;
  authority: string;
  principal: Dec;
  rateIndex: string;
  allInPercent: Dec | null;
  dayCount: string;
  daysAccrued: number;
  accruedInterest: Dec | null;
  outstanding: Dec | null;
  status: string;
  note: string | null;
  basis: string;
  demandableNow: Dec;
  demands: DemandRecord[];
  demandedTotal: Dec;
  paidTotal: Dec;
}

/** An invoice standing on the Stripe account that this register did not raise. */
interface ExternalDemand {
  invoiceId: string;
  number: string | null;
  status: string;
  currency: string;
  amount: Dec;
  amountPaid: Dec;
  amountDue: Dec;
  created: string;
  dueDate: string | null;
  debtor: string | null;
  description: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
}

interface CurrencyTotal {
  currency: string;
  demanded: Dec;
  paid: Dec;
  outstanding: Dec;
  voided: Dec;
  count: number;
}

interface Register {
  asOf: string;
  basisDate: string;
  daysAccrued: number;
  stripeMode: string;
  stripeError: string | null;
  maxDemandUsd: Dec;
  positions: Position[];
  totals: {
    principal: Dec;
    outstanding: Dec | null;
    demanded: Dec;
    paid: Dec;
  };
  externalDemands: ExternalDemand[];
  externalTotals: CurrencyTotal[];
  externalError: string | null;
  externalComplete: boolean;
  notes: string[];
}

interface IssuedDemand {
  id: string;
  positionId: string;
  amount: Dec;
  stripeInvoiceId: string;
  number: string | null;
  hostedInvoiceUrl: string | null;
  invoiceStatus: string;
  delivery: 'sent' | 'not_confirmed';
  deliveryError: string | null;
  mode: string;
}

export function CollectionsPage() {
  const [data, setData] = useState<Register | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openFor, setOpenFor] = useState<string | null>(null);

  usePageHeader({
    icon: Gavel,
    title: 'Collections',
    subtitle: 'Receivables past due, and the demands standing against them',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<Register>('/capomastro/collections');
      setData(res.data);
    } catch (err) {
      setError(readError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          <Loader2 className="w-4 h-4 animate-spin" />
          Reading the receivable positions and their live accrual…
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        <BevelBox className="bg-[var(--color-surface-primary)] p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-bold text-[var(--color-text-primary)] mb-1">
                The collections register could not be read
              </div>
              <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">{error}</p>
            </div>
          </div>
        </BevelBox>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in space-y-6">
      {/* ── Which Stripe account this is ── */}
      <BevelBox
        className={`p-4 ${
          data.stripeMode === 'live'
            ? 'bg-[var(--color-surface-primary)]'
            : 'bg-amber-400/10'
        }`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <ShieldAlert
            className={`w-5 h-5 flex-shrink-0 ${
              data.stripeMode === 'live' ? 'text-emerald-400' : 'text-amber-400'
            }`}
          />
          <div className="text-xs text-[var(--color-text-muted)] leading-relaxed flex-1 min-w-[16rem]">
            {data.stripeError ? (
              <>
                Stripe could not be reached: {data.stripeError} — the positions below are still
                live, but no demand can be issued until the processor answers.
              </>
            ) : data.stripeMode === 'live' ? (
              <>
                Demands are issued against the <strong>live</strong> Stripe account. An invoice
                raised here is a real invoice, delivered to a real debtor.
              </>
            ) : (
              <>
                Stripe is answering in <strong>test</strong> mode. Invoices raised here are not
                real demands and cannot be paid — the live secret key must be set in this
                environment's secrets to collect for real.
              </>
            )}
          </div>
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 border border-[var(--color-border-default)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </BevelBox>

      {/* ── Totals ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi label="Principal receivable" value={usd(data.totals.principal, 0)} tone="gold" />
        <Kpi
          label="Outstanding with interest"
          value={money(data.totals.outstanding, 0)}
          sub={
            data.totals.outstanding
              ? `${data.daysAccrued} days accrued since ${data.basisDate}`
              : 'withheld — a rate source could not be reached'
          }
          tone={data.totals.outstanding ? 'default' : 'warn'}
        />
        <Kpi
          label="Demanded to date"
          value={usd(data.totals.demanded)}
          sub={
            data.externalError
              ? 'from this register — the wider account could not be read'
              : data.externalTotals.length > 0
                ? `from this register · ${data.externalTotals
                    .map((t) => `${t.currency} ${amt(t.currency, t.demanded)}`)
                    .join(' · ')} raised outside it`
                : 'from this register'
          }
          tone={data.externalTotals.length > 0 ? 'warn' : 'default'}
        />
        <Kpi
          label="Paid to date"
          value={usd(data.totals.paid)}
          tone={data.totals.paid === '0' ? 'bad' : 'good'}
          sub={data.totals.paid === '0' ? 'nothing has been settled' : undefined}
        />
      </div>

      {/* ── Demands the estate served outside this register ── */}
      {(data.externalDemands.length > 0 || data.externalError) && (
        <Panel title="Standing on the account, raised elsewhere" icon={ExternalLink}>
          {data.externalError ? (
            <p className="text-xs text-amber-400 leading-relaxed">
              The Stripe account could not be read: {data.externalError}. Demands raised outside
              this page are therefore <strong>unknown</strong>, not zero.
            </p>
          ) : (
            <>
              <p className="text-xs text-[var(--color-text-muted)] leading-relaxed mb-4">
                Invoices on the estate's Stripe account that this page did not issue — served from
                the dashboard or by earlier tooling. They are real demands and count as served, but
                they are not attributed to a ledger position, so they stay out of the USD totals
                above. Each currency is totalled on its own; nothing is converted.
              </p>

              {!data.externalComplete && (
                <p className="text-xs text-amber-400 leading-relaxed mb-4">
                  The account holds more invoices than this read walked. What follows is the most
                  recent 500 — the totals are a floor, not the whole account.
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                {data.externalTotals.map((t) => (
                  <BevelBox key={t.currency} className="bg-[var(--color-surface-secondary)] p-3">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                      {t.currency} demanded · {t.count} invoice{t.count === 1 ? '' : 's'}
                    </div>
                    <div className="text-lg font-bold tabular-nums text-[var(--color-text-primary)]">
                      {amt(t.currency, t.demanded)}
                    </div>
                    <div className="text-[11px] text-[var(--color-text-muted)] mt-1 tabular-nums">
                      unpaid {amt(t.currency, t.outstanding)} · settled {amt(t.currency, t.paid)}
                    </div>
                    {cmpDec(t.voided, '0') > 0 && (
                      <div className="text-[11px] text-[var(--color-text-muted)] tabular-nums">
                        withdrawn {amt(t.currency, t.voided)}
                      </div>
                    )}
                  </BevelBox>
                ))}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] border-b border-[var(--color-border-default)]">
                      <th className="text-left font-medium py-2 pr-3">Invoice</th>
                      <th className="text-left font-medium py-2 pr-3">Debtor</th>
                      <th className="text-right font-medium py-2 pr-3">Amount</th>
                      <th className="text-right font-medium py-2 pr-3">Unpaid</th>
                      <th className="text-left font-medium py-2 pr-3">Status</th>
                      <th className="text-left font-medium py-2 pr-3">Served</th>
                      <th className="text-left font-medium py-2">Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.externalDemands.map((d) => (
                      <tr
                        key={d.invoiceId}
                        className="border-b border-[var(--color-border-default)]/40 align-top"
                      >
                        <td className="py-2 pr-3 font-mono text-[11px] text-[var(--color-text-primary)]">
                          {d.number ?? d.invoiceId}
                          {d.description && (
                            <div className="text-[10px] text-[var(--color-text-muted)] font-sans max-w-md leading-snug mt-0.5">
                              {d.description}
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-[var(--color-text-muted)]">
                          {d.debtor ?? '—'}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-[var(--color-text-primary)]">
                          {d.currency} {amt(d.currency, d.amount)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-[var(--color-text-muted)]">
                          {amt(d.currency, d.amountDue)}
                        </td>
                        <td className="py-2 pr-3">
                          <span
                            className={
                              d.status === 'paid'
                                ? 'text-emerald-400'
                                : d.status === 'open'
                                  ? 'text-amber-400'
                                  : d.status === 'void'
                                    ? 'text-[var(--color-text-muted)] line-through'
                                    : 'text-[var(--color-text-muted)]'
                            }
                          >
                            {d.status}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-[var(--color-text-muted)] whitespace-nowrap">
                          {d.created ? d.created.slice(0, 10) : '—'}
                          {d.dueDate && (
                            <div className="text-[10px]">due {d.dueDate.slice(0, 10)}</div>
                          )}
                        </td>
                        <td className="py-2 whitespace-nowrap">
                          {d.hostedInvoiceUrl && (
                            <a
                              href={d.hostedInvoiceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[var(--color-gold-400)] hover:underline mr-2"
                            >
                              page
                            </a>
                          )}
                          {d.invoicePdf && (
                            <a
                              href={d.invoicePdf}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[var(--color-gold-400)] hover:underline"
                            >
                              pdf
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Panel>
      )}

      {/* ── Positions ── */}
      {data.positions.map((p) => (
        <PositionCard
          key={p.id}
          position={p}
          maxDemand={data.maxDemandUsd}
          canIssue={!data.stripeError}
          open={openFor === p.id}
          onToggle={() => setOpenFor(openFor === p.id ? null : p.id)}
          onIssued={() => void load()}
        />
      ))}

      {/* ── How this works ── */}
      <Panel title="How a demand is drawn" icon={FileText}>
        <ul className="space-y-2">
          {data.notes.map((note) => (
            <li key={note} className="text-xs text-[var(--color-text-muted)] leading-relaxed flex gap-2">
              <span className="text-[var(--color-gold-400)] flex-shrink-0">—</span>
              {note}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function PositionCard({
  position,
  maxDemand,
  canIssue,
  open,
  onToggle,
  onIssued,
}: {
  position: Position;
  maxDemand: Dec;
  canIssue: boolean;
  open: boolean;
  onToggle: () => void;
  onIssued: () => void;
}) {
  const p = position;
  const capped = p.outstanding !== null && cmpDec(p.outstanding, maxDemand) > 0;
  // An unpriced position is not demandable: the backend refuses it rather than
  // invoicing the principal alone, and the button must not imply otherwise.
  const priced = p.outstanding !== null;

  return (
    <Panel
      title={p.ledgerLine}
      icon={CircleDollarSign}
      action={
        <button
          onClick={onToggle}
          disabled={!canIssue || !priced}
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 bg-[var(--color-gold-400)]/15 text-[var(--color-gold-400)] hover:bg-[var(--color-gold-400)]/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title={
            !canIssue
              ? 'Stripe is not reachable'
              : !priced
                ? 'This position cannot be demanded until its interest can be priced'
                : undefined
          }
        >
          <Send className="w-3.5 h-3.5" />
          {open ? 'Close' : 'Issue demand'}
        </button>
      }
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Figure label="Principal" value={usd(p.principal, 0)} />
        <Figure
          label={`Interest — ${p.daysAccrued} days`}
          value={money(p.accruedInterest, 2)}
          warn={p.accruedInterest === null}
          sub={p.accruedInterest === null ? p.note ?? 'rate unavailable' : undefined}
        />
        <Figure
          label="Outstanding"
          value={money(p.outstanding, 2)}
          warn={p.outstanding === null}
          gold={p.outstanding !== null}
        />
        <Figure
          label="Rate applied"
          value={p.allInPercent ? rate(p.allInPercent) : '—'}
          sub={`${p.rateIndex} · ${p.dayCount}`}
        />
      </div>

      <div className="text-xs text-[var(--color-text-muted)] leading-relaxed mb-3">
        <span className="text-[var(--color-text-primary)] font-semibold">{p.obligor}</span> —{' '}
        {p.instrument}. {p.basis} Authority: {p.authority}.
      </div>

      {!priced && (
        <div className="flex items-start gap-2 mb-3 text-[11px] text-amber-400 leading-relaxed">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            No demand can be drawn against this position right now: {p.rateIndex} could not be
            reached, so the interest owed is unknown. The principal alone is not the sum owed, and
            an invoice for it would understate the claim.
          </span>
        </div>
      )}

      {capped && (
        <div className="flex items-start gap-2 mb-3 text-[11px] text-amber-400 leading-relaxed">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            This balance is larger than a single card rail can carry ({usd(maxDemand)} per
            invoice). Demands against it are payments on account — each invoice records the full
            sum it is drawn against, and several may run at once.
          </span>
        </div>
      )}

      {open && (
        <DemandForm
          position={p}
          maxDemand={maxDemand}
          onIssued={() => {
            onToggle();
            onIssued();
          }}
        />
      )}

      {p.demands.length > 0 && <DemandTable demands={p.demands} onChanged={onIssued} />}
    </Panel>
  );
}

function DemandForm({
  position,
  maxDemand,
  onIssued,
}: {
  position: Position;
  maxDemand: Dec;
  onIssued: () => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState(position.demandableNow);
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedDemand | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await apiClient.post<IssuedDemand>(
        `/capomastro/collections/${position.id}/demand`,
        {
          debtorEmail: email.trim(),
          debtorName: name.trim() || null,
          amount: amount.trim(),
          memo: memo.trim() || null,
        },
      );
      setIssued(res.data);
      // Give the operator a moment to see the invoice number before the card
      // collapses back into the register.
      setTimeout(onIssued, 2500);
    } catch (e) {
      setErr(readError(e));
    } finally {
      setBusy(false);
    }
  };

  if (issued) {
    return (
      <BevelBox className="bg-emerald-400/10 p-4 mb-4">
        <div className="text-xs text-[var(--color-text-primary)] leading-relaxed">
          Demand issued — invoice {issued.number ?? issued.stripeInvoiceId} for{' '}
          <strong>{usd(issued.amount)}</strong>, {issued.invoiceStatus}.{' '}
          {issued.delivery === 'sent' ? (
            <>Delivered to {email}.</>
          ) : (
            <span className="text-amber-400">
              The invoice is payable, but Stripe did not confirm emailing it
              {issued.deliveryError ? `: ${issued.deliveryError}` : ''}. Send the payment link
              yourself.
            </span>
          )}
          {issued.hostedInvoiceUrl && (
            <>
              {' '}
              <a
                href={issued.hostedInvoiceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--color-gold-400)] underline"
              >
                Open the payment page
              </a>
            </>
          )}
        </div>
      </BevelBox>
    );
  }

  return (
    <BevelBox className="bg-[var(--color-surface-secondary)] p-4 mb-4 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Debtor email — the invoice is delivered here">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="accounts@debtor.example"
            className="w-full bg-[var(--color-surface-primary)] border border-[var(--color-border-default)] px-3 py-2 text-xs text-[var(--color-text-primary)]"
          />
        </Field>
        <Field label="Debtor name (optional)">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={position.obligor}
            className="w-full bg-[var(--color-surface-primary)] border border-[var(--color-border-default)] px-3 py-2 text-xs text-[var(--color-text-primary)]"
          />
        </Field>
        <Field label={`Amount to call now — up to ${usd(maxDemand)} per invoice`}>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            className="w-full bg-[var(--color-surface-primary)] border border-[var(--color-border-default)] px-3 py-2 text-xs text-[var(--color-text-primary)] tabular-nums"
          />
        </Field>
        <Field label="Memo carried on the invoice (optional)">
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Called and unanswered — payable on receipt"
            className="w-full bg-[var(--color-surface-primary)] border border-[var(--color-border-default)] px-3 py-2 text-xs text-[var(--color-text-primary)]"
          />
        </Field>
      </div>

      {err && (
        <div className="flex items-start gap-2 text-[11px] text-red-400 leading-relaxed">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{err}</span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={() => void submit()}
          disabled={busy || !email.trim() || !amount.trim()}
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-4 py-2 bg-[var(--color-gold-400)]/20 text-[var(--color-gold-400)] hover:bg-[var(--color-gold-400)]/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Gavel className="w-3.5 h-3.5" />}
          {busy ? 'Raising the invoice…' : 'Issue formal demand'}
        </button>
        <span className="text-[10px] text-[var(--color-text-muted)]">
          Payable on receipt. Interest keeps accruing until settlement.
        </span>
      </div>
    </BevelBox>
  );
}

function DemandTable({ demands, onChanged }: { demands: DemandRecord[]; onChanged: () => void }) {
  const [voiding, setVoiding] = useState<string | null>(null);

  const withdraw = async (id: string) => {
    setVoiding(id);
    try {
      await apiClient.post(`/capomastro/collections/demands/${id}/void`);
      onChanged();
    } catch {
      onChanged();
    } finally {
      setVoiding(null);
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] border-b border-[var(--color-border-subtle)]">
            <th className="text-left py-2 pr-3 font-semibold">Issued</th>
            <th className="text-left py-2 pr-3 font-semibold">Debtor</th>
            <th className="text-right py-2 pr-3 font-semibold">Demanded</th>
            <th className="text-right py-2 pr-3 font-semibold">Paid</th>
            <th className="text-left py-2 pr-3 font-semibold">Status</th>
            <th className="text-right py-2 font-semibold">Invoice</th>
          </tr>
        </thead>
        <tbody>
          {demands.map((d) => (
            <tr key={d.id} className="border-b border-[var(--color-border-subtle)]">
              <td className="py-2 pr-3 text-[var(--color-text-muted)] whitespace-nowrap">
                {d.issuedAt.slice(0, 10)}
              </td>
              <td className="py-2 pr-3 text-[var(--color-text-primary)]">
                {d.debtorName ?? d.debtorEmail}
                {d.memo && (
                  <div className="text-[10px] text-[var(--color-text-muted)]">{d.memo}</div>
                )}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-[var(--color-text-primary)]">
                {usd(d.amount)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {d.amountPaid ? (
                  <span className="text-emerald-400">{usd(d.amountPaid)}</span>
                ) : (
                  <span className="text-[var(--color-text-muted)]">—</span>
                )}
              </td>
              <td className="py-2 pr-3">
                <StatusChip demand={d} />
                {d.delivery === 'not_confirmed' && (
                  <div className="text-[10px] text-amber-400" title={d.deliveryError ?? undefined}>
                    delivery unconfirmed
                  </div>
                )}
              </td>
              <td className="py-2 text-right whitespace-nowrap">
                {d.hostedInvoiceUrl && (
                  <a
                    href={d.hostedInvoiceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[var(--color-gold-400)] hover:underline mr-3"
                  >
                    {d.number ?? 'view'}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {d.invoicePdf && (
                  <a
                    href={d.invoicePdf}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] mr-3"
                  >
                    PDF
                    <ArrowUpRight className="w-3 h-3" />
                  </a>
                )}
                {d.invoiceStatus === 'open' && (
                  <button
                    onClick={() => void withdraw(d.id)}
                    disabled={voiding === d.id}
                    className="inline-flex items-center gap-1 text-[var(--color-text-muted)] hover:text-red-400 disabled:opacity-40"
                    title="Void this invoice in Stripe — it becomes unpayable"
                  >
                    <Ban className="w-3 h-3" />
                    Withdraw
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusChip({ demand }: { demand: DemandRecord }) {
  if (demand.state === 'failed') {
    return (
      <span className="text-red-400" title={demand.failureReason ?? undefined}>
        not issued
      </span>
    );
  }
  if (demand.state === 'pending') {
    return (
      <span
        className="text-amber-400"
        title={
          demand.failureReason ??
          'Stripe did not confirm this demand. Its amount stays reserved until the invoice is found or withdrawn.'
        }
      >
        awaiting confirmation
      </span>
    );
  }
  if (demand.invoiceError) {
    return (
      <span className="text-amber-400" title={demand.invoiceError}>
        Stripe unreachable
      </span>
    );
  }
  const status = demand.invoiceStatus ?? demand.state;
  const tone =
    status === 'paid'
      ? 'text-emerald-400'
      : status === 'open'
        ? 'text-amber-400'
        : status === 'void' || status === 'uncollectible'
          ? 'text-[var(--color-text-muted)]'
          : 'text-[var(--color-text-primary)]';
  return <span className={tone}>{status}</span>;
}

function Figure({
  label,
  value,
  sub,
  warn,
  gold,
}: {
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
  gold?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
        {label}
      </div>
      <div
        className={`text-sm font-bold tabular-nums ${
          warn
            ? 'text-amber-400'
            : gold
              ? 'text-[var(--color-gold-400)]'
              : 'text-[var(--color-text-primary)]'
        }`}
      >
        {value}
      </div>
      {sub && <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{sub}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

/**
 * Compare two exact decimal strings without turning either into a `number`.
 * Only used for presentation decisions — never for a figure that is displayed.
 */
function cmpDec(a: Dec, b: Dec): number {
  const norm = (v: string) => {
    const neg = v.startsWith('-');
    const [int = '0', frac = ''] = v.replace(/^[-+]/, '').split('.');
    return { neg, int: int.replace(/^0+(?=\d)/, ''), frac };
  };
  const x = norm(a);
  const y = norm(b);
  if (x.neg !== y.neg) return x.neg ? -1 : 1;
  const sign = x.neg ? -1 : 1;
  if (x.int.length !== y.int.length) return x.int.length > y.int.length ? sign : -sign;
  if (x.int !== y.int) return x.int > y.int ? sign : -sign;
  const width = Math.max(x.frac.length, y.frac.length);
  const xf = x.frac.padEnd(width, '0');
  const yf = y.frac.padEnd(width, '0');
  if (xf === yf) return 0;
  return xf > yf ? sign : -sign;
}

/** The backend's message, not a generic one — it names what to do next. */
function readError(err: unknown): string {
  const res = (err as { response?: { data?: { error?: string } } })?.response;
  if (res?.data?.error) return res.data.error;
  if (err instanceof Error) return err.message;
  return 'the request failed';
}
