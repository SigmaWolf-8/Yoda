/**
 * Live financial statements for the sovereign estate.
 *
 * Everything on this page is computed at the moment of the request by
 * `GET /api/capomastro/statements`: obligations accrue against live published
 * reference rates, the trial balance is re-footed, and the bullion is marked
 * against live spot. Nothing here is a stored figure except the workbook
 * positions the computation starts from.
 *
 * Figures arrive as exact decimal strings and are formatted by `./money`
 * without ever becoming a JS `number`. A `null` figure is not zero — it means
 * the backend withheld it because a rate source could not be reached, and it
 * renders as an explicit gap with the reason attached rather than a plausible
 * number.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  BookOpenCheck,
  CircleSlash,
  Coins,
  FileSpreadsheet,
  Landmark,
  Percent,
  RefreshCw,
  Scale,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { usePageHeader } from '../../context/PageHeader';
import { BevelBox } from '../../components/ui/BevelBox';
import apiClient from '../../api/client';
import { Kpi, Panel } from './ui';
import { type Dec, exactTo, money, percent, rate, usd } from './money';

// ── Types mirroring GET /api/capomastro/statements ──

interface RateQuote {
  id: string;
  label: string;
  percent: Dec | null;
  effectiveDate: string | null;
  publisher: string;
  url: string;
  status: 'live' | 'unavailable';
  error: string | null;
}

interface GoldQuote {
  usdPerTroyOunce: Dec | null;
  observedAt: string | null;
  publisher: string;
  url: string;
  status: 'live' | 'unavailable';
  error: string | null;
}

interface Account {
  code: string;
  account: string;
  classification: 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense';
  debit: Dec | null;
  credit: Dec | null;
  source: string;
  authority: string | null;
}

interface StatementLine {
  label: string;
  amount: Dec;
  note: string | null;
  origin: 'workbook' | 'computed';
}

interface Obligation {
  id: string;
  ledgerLine: string;
  creditor: string;
  instrument: string;
  authority: string;
  principal: Dec;
  /** Null when the estate supplied no rate basis. Nothing is imputed. */
  rateIndex: string | null;
  indexPercent: Dec | null;
  spreadBps: Dec | null;
  allInPercent: Dec | null;
  dayCount: string | null;
  daysAccrued: number;
  accruedInterest: Dec | null;
  totalOwed: Dec | null;
  callBasis: string;
  callNoticeDays: number;
  callableNow: Dec | null;
  status: 'accruing' | 'rate_unavailable' | 'basis_not_supplied';
  note: string | null;
  basis: string;
}

interface NonInterestBearing {
  ledgerLine: string;
  principal: Dec;
  reason: string;
  declaredBy: string;
}

interface EarningAsset {
  id: string;
  ledgerLine: string;
  obligor: string;
  instrument: string;
  authority: string;
  principal: Dec;
  rateIndex: string;
  indexPercent: Dec | null;
  spreadBps: Dec;
  allInPercent: Dec | null;
  dayCount: string;
  daysAccrued: number;
  accruedIncome: Dec | null;
  status: string;
  note: string | null;
  basis: string;
}

interface Check {
  id: string;
  description: string;
  expected: string;
  actual: string;
  pass: boolean;
}

interface Statements {
  entity: string;
  version: string;
  source: string;
  asOf: string;
  asOfDate: string;
  basisDate: string;
  daysElapsed: number;
  rates: {
    fetchedAt: string;
    fromCache: boolean;
    cacheTtlSeconds: number;
    quotes: RateQuote[];
    gold: GoldQuote;
    status: 'live' | 'degraded' | 'unavailable';
  };
  trialBalance: {
    accounts: Account[];
    /** Withheld (null) when any live accrual is missing — see the backend. */
    totalDebits: Dec | null;
    totalCredits: Dec | null;
    balanced: boolean | null;
    incompleteReason: string | null;
  };
  balanceSheet: {
    currentAssets: StatementLine[];
    totalCurrentAssets: Dec | null;
    nonCurrentAssets: StatementLine[];
    totalNonCurrentAssets: Dec;
    totalAssets: Dec | null;
    liabilities: StatementLine[];
    totalLiabilities: Dec | null;
    equity: StatementLine[];
    totalEquity: Dec | null;
    totalLiabilitiesAndEquity: Dec | null;
    balanced: boolean | null;
  };
  incomeStatement: {
    periodFrom: string;
    periodTo: string;
    revenue: StatementLine[];
    grossRevenue: Dec;
    costOfGoodsSold: Dec;
    grossProfit: Dec;
    operatingExpenses: StatementLine[];
    totalOperatingExpenses: Dec;
    ebitda: Dec;
    depreciationAmortization: Dec;
    ebit: Dec;
    interestExpense: Dec | null;
    interestIncome: Dec | null;
    netInterest: Dec | null;
    earningsBeforeTax: Dec | null;
    incomeTaxExpense: Dec;
    netIncome: Dec | null;
    withheldReason: string | null;
  };
  incomeSchedule: {
    basisDate: string;
    asOfDate: string;
    assets: EarningAsset[];
    totalPrincipal: Dec;
    totalAccruedIncome: Dec | null;
    nonEarningAssets: string[];
    orphanTerms: string[];
  };
  debtSchedule: {
    basisDate: string;
    asOfDate: string;
    obligations: Obligation[];
    totalPrincipal: Dec;
    nonInterestBearing: NonInterestBearing[];
    totalNonInterestBearing: Dec;
    totalAccruedInterest: Dec | null;
    totalOwed: Dec | null;
    callOwedImmediately: Dec | null;
    callOwedOnNotice: Dec | null;
    unmodelledLiabilities: string[];
    orphanTerms: string[];
    complete: boolean;
    incompleteReason: string | null;
  };
  goldRevaluation: {
    fineGoldOunces: Dec;
    recordedPriceUsdPerOz: Dec;
    recordedFairMarketValue: Dec;
    carryingValue: Dec;
    livePriceUsdPerOz: Dec | null;
    liveFairMarketValue: Dec | null;
    revaluationSurplus: Dec | null;
    movementSinceRecordedFix: Dec | null;
    priceMovePercent: Dec | null;
    treatment: string;
    status: 'live' | 'unavailable';
    error: string | null;
  };
  checks: Check[];
  methodology: string[];
}

/**
 * Structural guard. The page renders financial statements, so it refuses to
 * display a payload whose statement blocks are absent rather than filling the
 * gaps with `undefined` and printing dashes where money should be.
 */
function isStatements(v: unknown): v is Statements {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Partial<Statements>;
  return (
    typeof s.asOf === 'string' &&
    typeof s.basisDate === 'string' &&
    !!s.trialBalance &&
    Array.isArray(s.trialBalance.accounts) &&
    !!s.balanceSheet &&
    !!s.incomeStatement &&
    !!s.debtSchedule &&
    Array.isArray(s.debtSchedule.obligations) &&
    !!s.incomeSchedule &&
    Array.isArray(s.incomeSchedule.assets) &&
    !!s.rates &&
    Array.isArray(s.rates.quotes) &&
    Array.isArray(s.checks)
  );
}

// ── Small pieces ──

/** A figure the backend withheld, shown as an explicit gap. */
function Withheld({ reason }: { reason?: string | null }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-amber-400/80"
      title={reason ?? 'Withheld — a required input was unavailable'}
    >
      <CircleSlash className="w-3 h-3" />
      <span className="text-xs">withheld</span>
    </span>
  );
}

function Money({ value, dp = 2 }: { value: Dec | null; dp?: number }) {
  if (value == null) return <Withheld />;
  return <span className="tabular-nums">{money(value, dp)}</span>;
}

function Th({ children, right = false }: { children: ReactNode; right?: boolean }) {
  return (
    <th
      className={`px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold ${
        right ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  right = false,
  className = '',
  colSpan,
}: {
  children: ReactNode;
  right?: boolean;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={`px-3 py-2 ${right ? 'text-right tabular-nums' : ''} ${className}`}
    >
      {children}
    </td>
  );
}

/**
 * Tri-state: `null` means the assertion could not be evaluated because a
 * figure was withheld. That is deliberately not shown as green — nobody
 * checked — but it is also not a failure, so it gets its own colour.
 */
function StatusPill({
  ok,
  good,
  bad,
  withheld = 'Not reconciled',
}: {
  ok: boolean | null;
  good: string;
  bad: string;
  withheld?: string;
}) {
  if (ok === null) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/10 text-amber-400">
        <CircleSlash className="w-3.5 h-3.5" />
        {withheld}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold ${
        ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
      }`}
    >
      {ok ? <BadgeCheck className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
      {ok ? good : bad}
    </span>
  );
}

/** A two-column statement section: labelled lines then a bold total. */
function LineSection({
  heading,
  lines,
  total,
  totalLabel,
}: {
  heading: string;
  lines: StatementLine[];
  total: Dec | null;
  totalLabel: string;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="text-[10px] uppercase tracking-wider text-[var(--color-gold-400)]/70 font-semibold mb-1.5">
        {heading}
      </div>
      <table className="w-full text-sm">
        <tbody>
          {lines.map((l) => (
            <tr key={l.label} className="border-b border-[var(--color-border-subtle)]/40">
              <Td>
                <span className="text-[var(--color-text-secondary)]">{l.label}</span>
                {l.origin === 'computed' && (
                  <span className="ml-2 px-1.5 py-0.5 rounded bg-[var(--color-gold-400)]/10 text-[var(--color-gold-400)] text-[9px] uppercase tracking-wide align-middle">
                    live
                  </span>
                )}
                {l.note && (
                  <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5 leading-snug">
                    {l.note}
                  </div>
                )}
              </Td>
              <Td right>
                <span className="text-[var(--color-text-primary)]">{money(l.amount)}</span>
              </Td>
            </tr>
          ))}
          <tr>
            <Td className="font-semibold text-[var(--color-text-primary)]">{totalLabel}</Td>
            <Td right className="font-semibold text-[var(--color-text-primary)]">
              <Money value={total} />
            </Td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── Page ──

export function StatementsPage() {
  const [data, setData] = useState<Statements | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  usePageHeader({
    icon: FileSpreadsheet,
    title: 'Live Statements',
    subtitle:
      'Trial balance, balance sheet, income statement and debt call — computed on request against live reference rates',
  });

  const load = useCallback(async (force: boolean) => {
    if (force) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      // apiClient's baseURL is already '/api'.
      const res = await apiClient.get<unknown>(
        `/capomastro/statements${force ? '?refresh=1' : ''}`,
      );
      if (!isStatements(res.data)) {
        throw new Error(
          'The statements endpoint returned a payload without the expected statement blocks.',
        );
      }
      setData(res.data);
    } catch (e) {
      const detail =
        (e as { response?: { data?: { message?: string; error?: string } } })?.response?.data
          ?.message ??
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        (e as Error).message;
      setError(detail || 'Statements could not be computed.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  if (loading) {
    return (
      <div className="p-6 text-sm text-[var(--color-text-muted)]">
        Computing statements against live reference rates…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <BevelBox className="bg-[var(--color-surface-primary)] p-5 border border-red-500/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-[var(--color-text-primary)] mb-1">
                Statements unavailable
              </div>
              <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">{error}</p>
              <button
                type="button"
                onClick={() => void load(false)}
                className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs bg-[var(--color-surface-secondary)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-tertiary)]"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retry
              </button>
            </div>
          </div>
        </BevelBox>
      </div>
    );
  }

  const {
    rates,
    trialBalance,
    balanceSheet,
    incomeStatement,
    debtSchedule,
    incomeSchedule,
    goldRevaluation,
  } = data;
  const failures = data.checks.filter((c) => !c.pass);

  return (
    <div className="p-6 space-y-5">
      {/* Provenance and as-of */}
      <BevelBox className="bg-[var(--color-surface-primary)] p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
          <div>
            <span className="text-[var(--color-text-muted)]">Entity </span>
            <span className="text-[var(--color-text-primary)] font-semibold">{data.entity}</span>
          </div>
          <div>
            <span className="text-[var(--color-text-muted)]">Basis </span>
            <span className="text-[var(--color-text-primary)]">{data.basisDate}</span>
          </div>
          <div>
            <span className="text-[var(--color-text-muted)]">As of </span>
            <span className="text-[var(--color-text-primary)]">{data.asOfDate}</span>
            <span className="text-[var(--color-text-muted)]"> ({data.daysElapsed} days elapsed)</span>
          </div>
          <div>
            <span className="text-[var(--color-text-muted)]">Computed </span>
            <span className="text-[var(--color-text-primary)]">{data.asOf}</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <StatusPill
              ok={failures.length === 0}
              good="All reconciliations pass"
              bad={`${failures.length} reconciliation${failures.length === 1 ? '' : 's'} failed`}
            />
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs bg-[var(--color-surface-secondary)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-tertiary)] disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Re-polling rates…' : 'Recompute now'}
            </button>
          </div>
        </div>
      </BevelBox>

      {/* Headline figures */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi
          label="Total assets"
          value={balanceSheet.totalAssets ? usd(balanceSheet.totalAssets) : 'withheld'}
          sub={
            balanceSheet.totalAssets
              ? money(balanceSheet.totalAssets)
              : (debtSchedule.incompleteReason ?? 'See Reconciliations')
          }
        />
        <Kpi
          label="Total liabilities"
          value={
            balanceSheet.totalLiabilities ? usd(balanceSheet.totalLiabilities) : 'withheld'
          }
          sub={
            balanceSheet.totalLiabilities
              ? 'Including interest accrued to today'
              : (debtSchedule.incompleteReason ?? 'See Reconciliations')
          }
          tone="warn"
        />
        <Kpi
          label="Debt callable now"
          value={debtSchedule.callOwedImmediately ? usd(debtSchedule.callOwedImmediately) : '—'}
          sub={
            debtSchedule.obligations.length === 0
              ? 'No interest-bearing debt declared'
              : debtSchedule.callOwedImmediately
                ? 'Demandable without notice'
                : (debtSchedule.incompleteReason ?? 'Withheld')
          }
          tone={debtSchedule.obligations.length === 0 ? 'default' : 'bad'}
        />
        <Kpi
          label="Net income (loss) PTD"
          value={incomeStatement.netIncome ? usd(incomeStatement.netIncome) : '—'}
          sub={`${incomeStatement.periodFrom} → ${incomeStatement.periodTo}`}
          tone={incomeStatement.netIncome?.startsWith('-') ? 'bad' : 'good'}
        />
      </div>

      {/* Reconciliation failures, if any */}
      {failures.length > 0 && (
        <BevelBox className="bg-[var(--color-surface-primary)] p-4 border border-red-500/30">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">
              Reconciliation failures
            </span>
          </div>
          <ul className="text-xs space-y-1.5">
            {failures.map((c) => (
              <li key={c.id} className="text-[var(--color-text-secondary)]">
                <span className="font-mono text-red-400">{c.id}</span> — {c.description}. Expected{' '}
                <span className="tabular-nums text-[var(--color-text-primary)]">{c.expected}</span>,
                got <span className="tabular-nums text-red-400">{c.actual}</span>.
              </li>
            ))}
          </ul>
        </BevelBox>
      )}

      {/* Live reference rates */}
      <Panel
        title="Live reference rates"
        icon={Percent}
        action={
          <span className="text-[10px] text-[var(--color-text-muted)]">
            {rates.fromCache ? 'cached' : 'fresh'} · polled {rates.fetchedAt} · TTL{' '}
            {rates.cacheTtlSeconds}s
          </span>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
          {rates.quotes.map((q) => (
            <div
              key={q.id}
              className={`p-3 rounded border ${
                q.status === 'live'
                  ? 'border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)]/40'
                  : 'border-red-500/40 bg-red-500/5'
              }`}
            >
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-mono">
                {q.id}
              </div>
              <div className="text-xl font-bold tabular-nums text-[var(--color-text-primary)]">
                {q.percent ? rate(q.percent) : <span className="text-red-400 text-sm">n/a</span>}
              </div>
              <div className="text-[10px] text-[var(--color-text-muted)] leading-snug mt-1">
                {q.label}
              </div>
              <div className="text-[10px] text-[var(--color-text-muted)] mt-1">
                {q.effectiveDate ? `eff. ${q.effectiveDate}` : ''}
              </div>
              <div className="text-[9px] text-[var(--color-text-muted)]/70 mt-1 leading-snug">
                {q.publisher}
              </div>
              {q.error && (
                <div className="text-[10px] text-red-400 mt-1.5 leading-snug break-words">
                  {q.error}
                </div>
              )}
            </div>
          ))}
          <div
            className={`p-3 rounded border ${
              goldRevaluation.status === 'live'
                ? 'border-[var(--color-gold-400)]/30 bg-[var(--color-gold-400)]/5'
                : 'border-red-500/40 bg-red-500/5'
            }`}
          >
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-mono">
              XAU/USD
            </div>
            <div className="text-xl font-bold tabular-nums text-[var(--color-gold-400)]">
              {goldRevaluation.livePriceUsdPerOz ? (
                money(goldRevaluation.livePriceUsdPerOz)
              ) : (
                <span className="text-red-400 text-sm">n/a</span>
              )}
            </div>
            <div className="text-[10px] text-[var(--color-text-muted)] leading-snug mt-1">
              Gold spot, USD per troy ounce
            </div>
            <div className="text-[9px] text-[var(--color-text-muted)]/70 mt-1 leading-snug">
              {rates.gold.publisher}
            </div>
            {rates.gold.error && (
              <div className="text-[10px] text-red-400 mt-1.5 leading-snug break-words">
                {rates.gold.error}
              </div>
            )}
          </div>
        </div>
      </Panel>

      {/* Debt call schedule */}
      <Panel title="Debt schedule & call owed" icon={Landmark}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
          <div className="p-3 rounded bg-[var(--color-surface-secondary)]/40">
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
              Principal outstanding
            </div>
            <div className="text-lg font-bold tabular-nums text-[var(--color-text-primary)]">
              {money(debtSchedule.totalPrincipal)}
            </div>
          </div>
          <div className="p-3 rounded bg-[var(--color-surface-secondary)]/40">
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
              Interest accrued ({data.daysElapsed}d)
            </div>
            <div className="text-lg font-bold tabular-nums text-amber-400">
              <Money value={debtSchedule.totalAccruedInterest} />
            </div>
          </div>
          <div className="p-3 rounded bg-red-500/5 border border-red-500/20">
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
              Callable immediately
            </div>
            <div className="text-lg font-bold tabular-nums text-red-400">
              <Money value={debtSchedule.callOwedImmediately} />
            </div>
          </div>
          <div className="p-3 rounded bg-[var(--color-surface-secondary)]/40">
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
              Callable on notice
            </div>
            <div className="text-lg font-bold tabular-nums text-[var(--color-text-primary)]">
              <Money value={debtSchedule.callOwedOnNotice} />
            </div>
          </div>
        </div>

        {debtSchedule.obligations.length === 0 ? (
          <div className="p-4 rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)]/40 text-sm text-[var(--color-text-secondary)] leading-relaxed">
            No interest-bearing obligations are declared, so nothing accrues and there is no
            interest expense. Every balance-sheet liability is accounted for below as
            non-interest-bearing. Nothing here is inferred — a liability only accrues once terms
            are declared for it, and one that is neither priced nor declared is reported as
            unmodelled rather than assumed free.
          </div>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1000px]">
            <thead className="border-b border-[var(--color-border-subtle)]">
              <tr>
                <Th>Obligation</Th>
                <Th right>Principal</Th>
                <Th>Index</Th>
                <Th right>All-in rate</Th>
                <Th>Day count</Th>
                <Th right>Days</Th>
                <Th right>Accrued interest</Th>
                <Th right>Total owed</Th>
                <Th>Call</Th>
                <Th right>Callable now</Th>
              </tr>
            </thead>
            <tbody>
              {debtSchedule.obligations.map((o) => (
                <tr
                  key={o.id}
                  className="border-b border-[var(--color-border-subtle)]/40 align-top"
                >
                  <Td>
                    <div className="text-[var(--color-text-primary)]">{o.ledgerLine}</div>
                    <div className="text-[10px] text-[var(--color-text-muted)] font-mono">
                      {o.id}
                    </div>
                    <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5 leading-snug max-w-[280px]">
                      {o.creditor} · {o.instrument}
                    </div>
                    <div className="text-[10px] text-[var(--color-text-muted)]/70 mt-0.5 leading-snug max-w-[280px]">
                      {o.authority}
                    </div>
                  </Td>
                  <Td right>{money(o.principal)}</Td>
                  <Td>
                    {o.rateIndex ? (
                      <>
                        <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">
                          {o.rateIndex}
                        </span>
                        <div className="text-[10px] text-[var(--color-text-muted)]">
                          {o.indexPercent ? rate(o.indexPercent) : 'n/a'}{' '}
                          {o.spreadBps &&
                            o.spreadBps !== '0' &&
                            `${o.spreadBps.startsWith('-') ? '' : '+'}${o.spreadBps} bp`}
                        </div>
                      </>
                    ) : (
                      <span className="font-mono text-[11px] text-amber-400">
                        not supplied
                      </span>
                    )}
                  </Td>
                  <Td right>
                    {o.allInPercent ? (
                      <span className="text-[var(--color-text-primary)]">{rate(o.allInPercent, 4)}</span>
                    ) : (
                      <Withheld reason={o.note} />
                    )}
                  </Td>
                  <Td>
                    <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">
                      {o.dayCount ?? '—'}
                    </span>
                  </Td>
                  <Td right>{o.daysAccrued}</Td>
                  <Td right className="text-amber-400">
                    <Money value={o.accruedInterest} />
                  </Td>
                  <Td right className="text-[var(--color-text-primary)] font-semibold">
                    <Money value={o.totalOwed} />
                  </Td>
                  <Td>
                    <span className="text-[11px] text-[var(--color-text-secondary)]">
                      {o.callBasis}
                    </span>
                    <div className="text-[10px] text-[var(--color-text-muted)]">
                      {o.callNoticeDays === 0 ? 'no notice' : `${o.callNoticeDays}d notice`}
                    </div>
                  </Td>
                  <Td right className={o.callableNow ? 'text-red-400 font-semibold' : ''}>
                    {o.callableNow ? money(o.callableNow) : '—'}
                  </Td>
                </tr>
              ))}
              <tr className="font-semibold text-[var(--color-text-primary)]">
                <Td>Total</Td>
                <Td right>{money(debtSchedule.totalPrincipal)}</Td>
                <Td colSpan={4}>{''}</Td>
                <Td right className="text-amber-400">
                  <Money value={debtSchedule.totalAccruedInterest} />
                </Td>
                <Td right>
                  <Money value={debtSchedule.totalOwed} />
                </Td>
                <Td>{''}</Td>
                <Td right className="text-red-400">
                  <Money value={debtSchedule.callOwedImmediately} />
                </Td>
              </tr>
            </tbody>
          </table>
        </div>
        )}

        {debtSchedule.nonInterestBearing.length > 0 && (
          <div className="mt-4">
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-gold-400)]/70 font-semibold mb-1.5">
              Declared non-interest-bearing
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--color-border-subtle)]">
                  <tr>
                    <Th>Liability</Th>
                    <Th right>Carrying amount</Th>
                    <Th>Reason no interest accrues</Th>
                    <Th>Declared by</Th>
                  </tr>
                </thead>
                <tbody>
                  {debtSchedule.nonInterestBearing.map((n) => (
                    <tr
                      key={n.ledgerLine}
                      className="border-b border-[var(--color-border-subtle)]/40 align-top"
                    >
                      <Td>
                        <span className="text-[var(--color-text-primary)]">{n.ledgerLine}</span>
                      </Td>
                      <Td right>{money(n.principal)}</Td>
                      <Td>
                        <span className="text-[11px] text-[var(--color-text-muted)] leading-snug block max-w-[520px]">
                          {n.reason}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-[11px] text-[var(--color-text-secondary)]">
                          {n.declaredBy}
                        </span>
                      </Td>
                    </tr>
                  ))}
                  <tr className="font-semibold text-[var(--color-text-primary)]">
                    <Td>Total</Td>
                    <Td right>{money(debtSchedule.totalNonInterestBearing)}</Td>
                    <Td colSpan={2}>{''}</Td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {debtSchedule.obligations.some((o) => o.note) && (
          <ul className="mt-3 space-y-1">
            {debtSchedule.obligations
              .filter((o) => o.note)
              .map((o) => (
                <li key={o.id} className="text-[11px] text-amber-400/90 leading-snug">
                  <span className="font-mono">{o.id}</span>: {o.note}
                </li>
              ))}
          </ul>
        )}

        {debtSchedule.unmodelledLiabilities.length > 0 && (
          <div className="mt-3 text-[11px] text-amber-400 leading-snug">
            Liabilities with no declared terms (excluded from the accrual, not assumed
            interest-free): {debtSchedule.unmodelledLiabilities.join(', ')}
          </div>
        )}
        {debtSchedule.orphanTerms.length > 0 && (
          <div className="mt-2 text-[11px] text-amber-400 leading-snug">
            Declared terms with no matching balance-sheet line:{' '}
            {debtSchedule.orphanTerms.join('; ')}
          </div>
        )}
        <p className="mt-3 text-[11px] text-[var(--color-text-muted)] leading-relaxed">
          Principal is read from the Balance Sheet, never from the terms file. Interest accrues from{' '}
          {debtSchedule.basisDate} to {debtSchedule.asOfDate} on each obligation's stated day-count
          convention against the live index above.
        </p>
      </Panel>

      {/* The other side of the accrual */}
      <Panel title="Interest-earning assets" icon={TrendingUp}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="border-b border-[var(--color-border-subtle)]">
              <tr>
                <Th>Asset</Th>
                <Th>Instrument</Th>
                <Th>Index</Th>
                <Th right>All-in rate</Th>
                <Th>Day count</Th>
                <Th right>Carrying amount</Th>
                <Th right>Days</Th>
                <Th right>Interest earned</Th>
              </tr>
            </thead>
            <tbody>
              {incomeSchedule.assets.map((a) => (
                <tr
                  key={a.id}
                  className="border-b border-[var(--color-border-subtle)]/40 align-top"
                >
                  <Td>
                    <span className="text-[var(--color-text-primary)]">{a.ledgerLine}</span>
                    <div className="text-[10px] text-[var(--color-text-muted)] leading-snug max-w-[300px]">
                      {a.obligor}
                    </div>
                  </Td>
                  <Td>
                    <span className="text-[11px] text-[var(--color-text-secondary)]">
                      {a.instrument}
                    </span>
                  </Td>
                  <Td>
                    <span className="font-mono text-[11px]">{a.rateIndex}</span>
                    {a.indexPercent && (
                      <span className="ml-1.5 text-[10px] text-[var(--color-text-muted)]">
                        {percent(a.indexPercent)}
                      </span>
                    )}
                  </Td>
                  <Td right>
                    {a.allInPercent ? (
                      <span className="text-[var(--color-gold-400)]">{rate(a.allInPercent)}</span>
                    ) : (
                      <Withheld reason={a.note ?? 'rate unavailable'} />
                    )}
                  </Td>
                  <Td>
                    <span className="text-[11px]">{a.dayCount}</span>
                  </Td>
                  <Td right>{money(a.principal)}</Td>
                  <Td right>{a.daysAccrued}</Td>
                  <Td right className="text-emerald-400">
                    <Money value={a.accruedIncome} />
                  </Td>
                </tr>
              ))}
              <tr className="font-semibold text-[var(--color-text-primary)]">
                <Td colSpan={5}>Total</Td>
                <Td right>{money(incomeSchedule.totalPrincipal)}</Td>
                <Td right>{''}</Td>
                <Td right className="text-emerald-400">
                  <Money value={incomeSchedule.totalAccruedIncome} />
                </Td>
              </tr>
            </tbody>
          </table>
        </div>

        {incomeSchedule.nonEarningAssets.length > 0 && (
          <div className="mt-3 text-[11px] text-[var(--color-text-muted)] leading-snug">
            Assets earning no interest (no rate declared, so none is imputed):{' '}
            {incomeSchedule.nonEarningAssets.join(', ')}
          </div>
        )}
        {incomeSchedule.orphanTerms.length > 0 && (
          <div className="mt-2 text-[11px] text-amber-400 leading-snug">
            {incomeSchedule.orphanTerms.join('; ')}
          </div>
        )}
        <p className="mt-3 text-[11px] text-[var(--color-text-muted)] leading-relaxed">
          Carrying amounts are read from the Balance Sheet, never from the terms file. These accrue
          on the same dates and the same divide-last arithmetic as the obligations they fund, so a
          matched position nets to its spread rather than to a manufactured loss.
        </p>
      </Panel>

      {/* Balance sheet and income statement side by side */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Panel
          title="Statement of financial position"
          icon={Scale}
          action={
            <StatusPill ok={balanceSheet.balanced} good="A = L + E" bad="Out of balance" />
          }
        >
          <LineSection
            heading="Current assets"
            lines={balanceSheet.currentAssets}
            total={balanceSheet.totalCurrentAssets}
            totalLabel="Total current assets"
          />
          <LineSection
            heading="Non-current & reserve assets"
            lines={balanceSheet.nonCurrentAssets}
            total={balanceSheet.totalNonCurrentAssets}
            totalLabel="Total non-current assets"
          />
          <div className="flex justify-between py-2 border-y-2 border-[var(--color-gold-400)]/30 text-sm font-bold text-[var(--color-text-primary)] mb-4">
            <span>TOTAL ASSETS</span>
            <span className="tabular-nums">
              <Money value={balanceSheet.totalAssets} />
            </span>
          </div>
          <LineSection
            heading="Liabilities"
            lines={balanceSheet.liabilities}
            total={balanceSheet.totalLiabilities}
            totalLabel="Total liabilities"
          />
          <LineSection
            heading="Equity"
            lines={balanceSheet.equity}
            total={balanceSheet.totalEquity}
            totalLabel="Total equity"
          />
          <div className="flex justify-between py-2 border-y-2 border-[var(--color-gold-400)]/30 text-sm font-bold text-[var(--color-text-primary)]">
            <span>TOTAL LIABILITIES & EQUITY</span>
            <span className="tabular-nums">
              <Money value={balanceSheet.totalLiabilitiesAndEquity} />
            </span>
          </div>
        </Panel>

        <Panel title="Statement of comprehensive income" icon={TrendingDown}>
          <div className="text-[10px] text-[var(--color-text-muted)] mb-3">
            For the period {incomeStatement.periodFrom} → {incomeStatement.periodTo}
          </div>
          <table className="w-full text-sm">
            <tbody>
              {incomeStatement.revenue.map((l) => (
                <tr key={l.label} className="border-b border-[var(--color-border-subtle)]/40">
                  <Td>
                    <span className="text-[var(--color-text-secondary)]">{l.label}</span>
                    {l.note && (
                      <div className="text-[10px] text-[var(--color-text-muted)] leading-snug">
                        {l.note}
                      </div>
                    )}
                  </Td>
                  <Td right>{money(l.amount)}</Td>
                </tr>
              ))}
              <tr className="border-b border-[var(--color-border-subtle)]/40">
                <Td className="text-[var(--color-text-secondary)]">Cost of goods sold</Td>
                <Td right>{money(incomeStatement.costOfGoodsSold)}</Td>
              </tr>
              <tr className="border-b border-[var(--color-border-subtle)]">
                <Td className="font-semibold text-[var(--color-text-primary)]">Gross profit</Td>
                <Td right className="font-semibold text-[var(--color-text-primary)]">
                  {money(incomeStatement.grossProfit)}
                </Td>
              </tr>
              {incomeStatement.operatingExpenses.map((l) => (
                <tr key={l.label} className="border-b border-[var(--color-border-subtle)]/40">
                  <Td>
                    <span className="text-[var(--color-text-secondary)]">{l.label}</span>
                    {l.note && (
                      <div className="text-[10px] text-[var(--color-text-muted)] leading-snug">
                        {l.note}
                      </div>
                    )}
                  </Td>
                  <Td right>{money(l.amount)}</Td>
                </tr>
              ))}
              <tr className="border-b border-[var(--color-border-subtle)]">
                <Td className="font-semibold text-[var(--color-text-primary)]">
                  Total operating expenses
                </Td>
                <Td right className="font-semibold text-[var(--color-text-primary)]">
                  {money(incomeStatement.totalOperatingExpenses)}
                </Td>
              </tr>
              <tr className="border-b border-[var(--color-border-subtle)]/40">
                <Td className="font-semibold text-[var(--color-text-primary)]">EBITDA</Td>
                <Td right className="font-semibold text-[var(--color-text-primary)]">
                  {money(incomeStatement.ebitda)}
                </Td>
              </tr>
              <tr className="border-b border-[var(--color-border-subtle)]/40">
                <Td className="text-[var(--color-text-secondary)]">
                  Depreciation &amp; amortisation
                </Td>
                <Td right>{money(incomeStatement.depreciationAmortization)}</Td>
              </tr>
              <tr className="border-b border-[var(--color-border-subtle)]">
                <Td className="font-semibold text-[var(--color-text-primary)]">EBIT</Td>
                <Td right className="font-semibold text-[var(--color-text-primary)]">
                  {money(incomeStatement.ebit)}
                </Td>
              </tr>
              <tr className="border-b border-[var(--color-border-subtle)]/40 bg-[var(--color-gold-400)]/5">
                <Td>
                  <span className="text-[var(--color-text-secondary)]">Interest expense</span>
                  <span className="ml-2 px-1.5 py-0.5 rounded bg-[var(--color-gold-400)]/10 text-[var(--color-gold-400)] text-[9px] uppercase tracking-wide align-middle">
                    live
                  </span>
                  <div className="text-[10px] text-[var(--color-text-muted)] leading-snug">
                    Accrued on declared debt terms against live reference rates
                  </div>
                </Td>
                <Td right className="text-amber-400 font-semibold">
                  <Money value={incomeStatement.interestExpense} />
                </Td>
              </tr>
              <tr className="border-b border-[var(--color-border-subtle)]/40 bg-[var(--color-gold-400)]/5">
                <Td>
                  <span className="text-[var(--color-text-secondary)]">Interest income</span>
                  <span className="ml-2 px-1.5 py-0.5 rounded bg-[var(--color-gold-400)]/10 text-[var(--color-gold-400)] text-[9px] uppercase tracking-wide align-middle">
                    live
                  </span>
                  <div className="text-[10px] text-[var(--color-text-muted)] leading-snug">
                    Earned on the reserves and instruments funding those obligations
                  </div>
                </Td>
                <Td right className="text-emerald-400 font-semibold">
                  <Money value={incomeStatement.interestIncome} />
                </Td>
              </tr>
              <tr className="border-b border-[var(--color-border-subtle)]/40">
                <Td className="font-semibold text-[var(--color-text-primary)]">
                  Net interest
                  <div className="text-[10px] font-normal text-[var(--color-text-muted)] leading-snug">
                    Income less expense
                  </div>
                </Td>
                <Td
                  right
                  className={`font-semibold ${
                    incomeStatement.netInterest?.startsWith('-')
                      ? 'text-red-400'
                      : 'text-emerald-400'
                  }`}
                >
                  <Money value={incomeStatement.netInterest} />
                </Td>
              </tr>
              <tr className="border-b border-[var(--color-border-subtle)]/40">
                <Td className="text-[var(--color-text-secondary)]">Earnings before tax</Td>
                <Td right>
                  <Money value={incomeStatement.earningsBeforeTax} />
                </Td>
              </tr>
              <tr className="border-b border-[var(--color-border-subtle)]/40">
                <Td className="text-[var(--color-text-secondary)]">Income tax expense</Td>
                <Td right>{money(incomeStatement.incomeTaxExpense)}</Td>
              </tr>
              <tr>
                <Td className="font-bold text-[var(--color-text-primary)]">NET INCOME (LOSS)</Td>
                <Td
                  right
                  className={`font-bold ${
                    incomeStatement.netIncome?.startsWith('-')
                      ? 'text-red-400'
                      : 'text-emerald-400'
                  }`}
                >
                  <Money value={incomeStatement.netIncome} />
                </Td>
              </tr>
            </tbody>
          </table>
          {incomeStatement.withheldReason && (
            <p className="mt-3 text-[11px] text-amber-400 leading-snug">
              Earnings figures withheld: {incomeStatement.withheldReason}
            </p>
          )}
        </Panel>
      </div>

      {/* Gold revaluation memo */}
      <Panel title="Bullion revaluation (memo disclosure)" icon={Coins}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 mb-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
              Fine gold
            </div>
            <div className="text-sm tabular-nums text-[var(--color-text-primary)]">
              {exactTo(goldRevaluation.fineGoldOunces, 2)} oz
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
              Recorded fix
            </div>
            <div className="text-sm tabular-nums text-[var(--color-text-primary)]">
              {money(goldRevaluation.recordedPriceUsdPerOz)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
              Live spot
            </div>
            <div className="text-sm tabular-nums text-[var(--color-gold-400)]">
              <Money value={goldRevaluation.livePriceUsdPerOz} />
              {goldRevaluation.priceMovePercent && (
                <span className="ml-1.5 text-[10px] text-emerald-400">
                  {goldRevaluation.priceMovePercent.startsWith('-') ? '' : '+'}
                  {exactTo(goldRevaluation.priceMovePercent, 2)}%
                </span>
              )}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
              Live fair value
            </div>
            <div className="text-sm tabular-nums text-[var(--color-text-primary)]">
              <Money value={goldRevaluation.liveFairMarketValue} />
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
              Unrecorded surplus
            </div>
            <div className="text-sm tabular-nums text-emerald-400">
              <Money value={goldRevaluation.revaluationSurplus} />
            </div>
          </div>
        </div>
        <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed">
          {goldRevaluation.treatment}
        </p>
        {goldRevaluation.error && (
          <p className="mt-2 text-[11px] text-red-400 leading-snug">{goldRevaluation.error}</p>
        )}
      </Panel>

      {/* The auditor's listing */}
      <Panel
        title="Trial balance — auditor's listing"
        icon={BookOpenCheck}
        action={
          <StatusPill ok={trialBalance.balanced} good="Debits = credits" bad="Does not foot" />
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="border-b border-[var(--color-border-subtle)]">
              <tr>
                <Th>Code</Th>
                <Th>Account</Th>
                <Th>Class</Th>
                <Th>Source</Th>
                <Th>Authority / basis</Th>
                <Th right>Debit</Th>
                <Th right>Credit</Th>
              </tr>
            </thead>
            <tbody>
              {trialBalance.accounts.map((a) => (
                <tr
                  key={`${a.code}-${a.account}`}
                  className="border-b border-[var(--color-border-subtle)]/40 align-top"
                >
                  <Td>
                    <span className="font-mono text-[11px] text-[var(--color-gold-400)]">
                      {a.code}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-[var(--color-text-primary)]">{a.account}</span>
                  </Td>
                  <Td>
                    <span className="text-[11px] text-[var(--color-text-secondary)]">
                      {a.classification}
                    </span>
                  </Td>
                  <Td>
                    <span
                      className={`text-[10px] ${
                        a.source.startsWith('Computed')
                          ? 'text-[var(--color-gold-400)]'
                          : 'text-[var(--color-text-muted)]'
                      }`}
                    >
                      {a.source}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-[10px] text-[var(--color-text-muted)] leading-snug block max-w-[340px]">
                      {a.authority ?? '—'}
                    </span>
                  </Td>
                  <Td right>{a.debit ? money(a.debit) : ''}</Td>
                  <Td right>{a.credit ? money(a.credit) : ''}</Td>
                </tr>
              ))}
              <tr className="font-bold text-[var(--color-text-primary)] border-t-2 border-[var(--color-gold-400)]/30">
                <Td>{''}</Td>
                <Td>TOTALS</Td>
                <Td>{''}</Td>
                <Td>{''}</Td>
                <Td>{''}</Td>
                <Td right>
                  <Money value={trialBalance.totalDebits} />
                </Td>
                <Td right>
                  <Money value={trialBalance.totalCredits} />
                </Td>
              </tr>
            </tbody>
          </table>
        </div>
        {trialBalance.incompleteReason && (
          <p className="mt-3 text-[11px] text-amber-400 leading-snug">
            Foot is over an incomplete set: {trialBalance.incompleteReason}
          </p>
        )}
      </Panel>

      {/* Reconciliation detail */}
      <Panel title="Reconciliations" icon={BadgeCheck}>
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--color-border-subtle)]">
            <tr>
              <Th>Check</Th>
              <Th>Assertion</Th>
              <Th right>Expected</Th>
              <Th right>Actual</Th>
              <Th right>Result</Th>
            </tr>
          </thead>
          <tbody>
            {data.checks.map((c) => (
              <tr key={c.id} className="border-b border-[var(--color-border-subtle)]/40">
                <Td>
                  <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">
                    {c.id}
                  </span>
                </Td>
                <Td>
                  <span className="text-[var(--color-text-secondary)] text-[13px]">
                    {c.description}
                  </span>
                </Td>
                <Td right>
                  <span className="text-[11px] text-[var(--color-text-muted)]">{c.expected}</span>
                </Td>
                <Td right>
                  <span className="text-[11px] text-[var(--color-text-muted)]">{c.actual}</span>
                </Td>
                <Td right>
                  <span
                    className={`text-[11px] font-semibold ${
                      c.pass ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {c.pass ? 'PASS' : 'FAIL'}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {/* Methodology */}
      <Panel title="Basis of preparation" icon={FileSpreadsheet}>
        <ul className="space-y-2">
          {data.methodology.map((m) => (
            <li
              key={m}
              className="text-[12px] text-[var(--color-text-secondary)] leading-relaxed pl-4 relative before:content-['—'] before:absolute before:left-0 before:text-[var(--color-text-muted)]"
            >
              {m}
            </li>
          ))}
        </ul>
        <div className="mt-3 text-[10px] text-[var(--color-text-muted)]">
          Source workbook: {data.source} · {data.version}
        </div>
      </Panel>
    </div>
  );
}
