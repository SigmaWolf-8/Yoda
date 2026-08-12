import { useEffect, useMemo, useState } from 'react';
import {
  Scale,
  TrendingUp,
  Coins,
  GitBranch,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { usePageHeader } from '../../context/PageHeader';
import { BevelBox } from '../../components/ui/BevelBox';
import apiClient from '../../api/client';
import { ExportPanel } from './ExportPanel';
import { Kpi, Panel } from './ui';
import {
  type Dec,
  exact,
  exactTo,
  forGeometry,
  group,
  percent,
  splitDec,
  usd,
} from './money';

// ── Types mirroring GET /api/capomastro/revenue ──
//
// Money and every derived quantity arrive as canonical decimal *strings* and
// are formatted by `./money` without ever becoming a JS `number`. `Dec` marks
// those fields so the distinction from a genuine count is visible at the type
// level.

interface Segment {
  label: string;
  value: Dec;
  share: Dec;
}

interface CrossLeg {
  leg: string;
  description: string;
  asset: Dec;
  reserve: Dec;
  weight: Dec;
  weightedRatio: Dec;
}

interface Generation {
  generation: string;
  epoch: string;
  offspring: number;
  nodeId: string;
}

interface RevenueResponse {
  entity: string;
  version: string;
  accrualGroundState: { grossRevenue: Dec; costOfGoodsSold: Dec; note: string };
  kpis: {
    totalAssets: Dec;
    totalLiabilities: Dec;
    totalEquity: Dec;
    balanced: boolean;
    goldFairMarketValue: Dec;
    goldCarryingValue: Dec;
    unrecordedReserveBuffer: Dec;
    xCross: Dec;
  };
  segmentMix: Segment[];
  crossBalance: { legs: CrossLeg[]; xCross: Dec; equilateral: boolean };
  goldAssay: {
    barsCounted: Dec;
    nominalMassPerBarKg: Dec;
    netGoldMassKg: Dec;
    finePurity: Dec;
    fineGoldMassKg: Dec;
    troyOunceFactor: Dec;
    fineGoldOunces: Dec;
    lbmaSpotUsdPerOz: Dec;
    fairMarketValueUsd: Dec;
    carryingValueUsd: Dec;
    unrecordedReserveBufferUsd: Dec;
  };
  descendantRegister: {
    generations: Generation[];
    totalActiveNodes: number;
    totalRegisteredDescendants: number;
    digitalRoot: number;
    harmonic: boolean;
  };
}

interface MeasurementField {
  key: string;
  value: string;
  unit: string;
}

interface SealedMeasurement {
  file: string;
  record: string;
  version: string;
  schema: string;
  fields: MeasurementField[];
  pif127: string | null;
}

// ── Response validation ──
//
// The API and the SPA share an origin, and the SPA fallback answers unknown
// paths with 200 text/html. A stale cache or a half-restarted backend can
// therefore hand us an HTML string where JSON was expected. Check the shape
// before trusting it, so the page reports a clear failure instead of throwing
// deep inside a render.

function isRevenueResponse(value: unknown): value is RevenueResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const cross = v.crossBalance as { legs?: unknown } | null;
  const register = v.descendantRegister as { generations?: unknown } | null;
  return (
    typeof v.kpis === 'object' &&
    v.kpis !== null &&
    Array.isArray(v.segmentMix) &&
    typeof v.goldAssay === 'object' &&
    v.goldAssay !== null &&
    typeof cross === 'object' &&
    cross !== null &&
    Array.isArray(cross.legs) &&
    typeof register === 'object' &&
    register !== null &&
    Array.isArray(register.generations) &&
    typeof v.accrualGroundState === 'object' &&
    v.accrualGroundState !== null
  );
}

// ── Formatting ──

const GOLD = '#E4C97A';
const SLICE_COLORS = ['#E4C97A', '#C9A227', '#4A9EF5', '#8C6F2E', '#6FA8DC', '#B08D57'];

// ── Page ──

export function SovereignLedgerPage() {
  const [data, setData] = useState<RevenueResponse | null>(null);
  const [measurements, setMeasurements] = useState<SealedMeasurement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  usePageHeader({
    icon: Scale,
    title: 'Sovereign Ledger',
    subtitle:
      'Capomastro Holdings Ltd. — Unified GAAP Ledger, gold assay, cross-balance matrix and sealed token measurements',
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      // apiClient's baseURL is already '/api'.
      apiClient.get<unknown>('/capomastro/revenue'),
      apiClient.get<unknown>('/capomastro/measurements'),
    ])
      .then(([revenue, sealed]) => {
        if (cancelled) return;
        if (!isRevenueResponse(revenue.data)) {
          throw new Error(
            'the ledger endpoint returned an unexpected payload — the backend may still be starting',
          );
        }
        setData(revenue.data);

        const sealedBody = sealed.data as { measurements?: unknown } | null;
        setMeasurements(
          Array.isArray(sealedBody?.measurements)
            ? (sealedBody.measurements as SealedMeasurement[])
            : [],
        );
      })
      .catch((err) => {
        if (cancelled) return;
        const detail =
          err?.response?.data?.error ?? err?.message ?? 'the ledger service did not respond';
        setError(`Could not load the sovereign ledger: ${detail}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const mixChart = useMemo(
    () =>
      (data?.segmentMix ?? []).map((s) => ({
        name: s.label,
        // Slice geometry only; the label beside it is the exact string.
        value: forGeometry(s.value),
        exactValue: s.value,
        share: s.share,
      })),
    [data],
  );

  const lineageChart = useMemo(
    () =>
      (data?.descendantRegister.generations ?? []).map((g) => ({
        name: g.generation.replace('Generation ', 'G'),
        offspring: g.offspring,
        epoch: g.epoch,
      })),
    [data],
  );

  if (loading) {
    return (
      <div className="p-6 lg:p-8 text-sm text-[var(--color-text-muted)] animate-pulse">
        Reading the sealed ledger…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 lg:p-8 max-w-2xl">
        <BevelBox className="bg-[var(--color-surface-primary)] p-5 border border-amber-500/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-[var(--color-text-primary)] mb-1">
                Ledger unavailable
              </div>
              <p className="text-sm text-[var(--color-text-muted)] mb-3">{error}</p>
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 bg-[var(--color-gold-400)]/15 text-[var(--color-gold-400)] hover:bg-[var(--color-gold-400)]/25 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry
              </button>
            </div>
          </div>
        </BevelBox>
      </div>
    );
  }

  const { kpis, goldAssay, crossBalance, descendantRegister, accrualGroundState } = data;

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in space-y-6">
      {/* ── Provenance strip ── */}
      <BevelBox className="bg-[var(--color-surface-primary)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-[var(--color-text-primary)]">{data.entity}</div>
            <div className="text-xs text-[var(--color-text-muted)]">{data.version}</div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <ShieldCheck
              className={`w-4 h-4 ${kpis.balanced ? 'text-emerald-400' : 'text-amber-400'}`}
            />
            <span className={kpis.balanced ? 'text-emerald-400' : 'text-amber-400'}>
              {kpis.balanced
                ? 'Balance sheet integrity check: ΣA = ΣL + ΣE'
                : 'Balance sheet does not reconcile'}
            </span>
          </div>
        </div>
      </BevelBox>

      {/* ── KPI row ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi
          label="Total Assets (Σ Aₙ)"
          value={usd(kpis.totalAssets, 3)}
          sub={`$${exact(kpis.totalAssets)}`}
          tone="gold"
        />
        <Kpi
          label="Total Liabilities (Σ Lₘ)"
          value={usd(kpis.totalLiabilities, 3)}
          sub={`$${exact(kpis.totalLiabilities)}`}
        />
        <Kpi
          label="Sovereign Equity"
          value={usd(kpis.totalEquity, 3)}
          sub={`$${exact(kpis.totalEquity)}`}
        />
        <Kpi
          label="Cross-Balance X_cross"
          value={exactTo(kpis.xCross, 4)}
          sub={crossBalance.equilateral ? 'Equilateral — quadrants aligned' : 'Not equilateral'}
          tone={crossBalance.equilateral ? 'good' : 'warn'}
        />
      </div>

      {/* ── Accrual ground state ── */}
      <Panel title="Accrual Ground State" icon={TrendingUp}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)]">
              Gross Revenue
            </div>
            <div className="text-xl font-bold tabular-nums text-[var(--color-text-primary)]">
              ${exact(accrualGroundState.grossRevenue)}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)]">
              Cost of Goods Sold
            </div>
            <div className="text-xl font-bold tabular-nums text-[var(--color-text-primary)]">
              ${exact(accrualGroundState.costOfGoodsSold)}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)]">
              Basis
            </div>
            <div className="text-xs text-[var(--color-text-muted)] leading-relaxed">
              {accrualGroundState.note}
            </div>
          </div>
        </div>
        <p className="text-xs text-[var(--color-text-muted)] mt-4 leading-relaxed border-t border-[var(--color-border-subtle)] pt-3">
          The estate runs a deliberate zero-revenue / zero-expense model, so the composition below
          is the reserve-asset mix that backs it — not sales. Every figure is read from the
          workbook; nothing on this page is estimated.
        </p>
      </Panel>

      {/* ── Composition ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Reserve Composition" icon={Coins}>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={mixChart}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="45%"
                  outerRadius="78%"
                  paddingAngle={2}
                  stroke="rgba(0,0,0,0.35)"
                >
                  {mixChart.map((_, i) => (
                    <Cell key={i} fill={SLICE_COLORS[i % SLICE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: '#0F0C0A',
                    border: '1px solid #3a3229',
                    fontSize: 12,
                  }}
                  formatter={(_value: any, name: any) => {
                    const row = mixChart.find((r) => r.name === name);
                    return [row ? usd(row.exactValue, 3) : '—', name];
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-3 space-y-1.5">
            {data.segmentMix.map((s, i) => (
              <li key={s.label} className="flex items-center justify-between gap-3 text-xs">
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2.5 h-2.5 flex-shrink-0"
                    style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }}
                  />
                  <span className="truncate text-[var(--color-text-muted)]">{s.label}</span>
                </span>
                <span className="tabular-nums text-[var(--color-text-primary)] flex-shrink-0">
                  {usd(s.value, 2)} · {percent(s.share)}%
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Gold Assay — WP-2026-AU-820-GOLD" icon={Coins}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
            {[
              ['Bars counted', exact(goldAssay.barsCounted)],
              ['Nominal mass / bar', `${goldAssay.nominalMassPerBarKg} kg`],
              ['Net gold mass', `${exact(goldAssay.netGoldMassKg)} kg`],
              ['Fine purity (assay)', `${percent(goldAssay.finePurity)} %`],
              ['Fine gold mass', `${exact(goldAssay.fineGoldMassKg)} kg`],
              ['Fine gold ounces', `${exact(goldAssay.fineGoldOunces)} troy oz`],
              ['LBMA PM fix', `$${exact(goldAssay.lbmaSpotUsdPerOz)} / troy oz`],
              ['Fair market value', usd(goldAssay.fairMarketValueUsd, 4)],
              ['Carrying value', usd(goldAssay.carryingValueUsd, 4)],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-[var(--color-text-muted)] uppercase tracking-wider text-[10px]">
                  {k}
                </dt>
                <dd className="tabular-nums text-[var(--color-text-primary)] mt-0.5">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 pt-3 border-t border-[var(--color-border-subtle)]">
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
              Unrecorded reserve buffer (conservatism variance)
            </div>
            <div className="text-lg font-bold tabular-nums text-[var(--color-gold-400)]">
              ${exact(goldAssay.unrecordedReserveBufferUsd)}
            </div>
          </div>
        </Panel>
      </div>

      {/* ── Cross-balance matrix ── */}
      <Panel title="Weighted Quadrilateral Cross-Balance Matrix (X_cross)" icon={Scale}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[var(--color-text-muted)] uppercase tracking-wider text-[10px] border-b border-[var(--color-border-subtle)]">
                <th className="py-2 pr-3 font-semibold">Leg</th>
                <th className="py-2 pr-3 font-semibold">Description</th>
                <th className="py-2 pr-3 font-semibold text-right">Asset Aᵢ</th>
                <th className="py-2 pr-3 font-semibold text-right">Reserve Bᵢ</th>
                <th className="py-2 pr-3 font-semibold text-right">Weight wᵢ</th>
                <th className="py-2 font-semibold text-right">wᵢ · Aᵢ/Bᵢ</th>
              </tr>
            </thead>
            <tbody>
              {crossBalance.legs.map((leg) => (
                <tr key={leg.leg} className="border-b border-[var(--color-border-subtle)]/50">
                  <td className="py-2 pr-3 whitespace-nowrap text-[var(--color-gold-400)] font-semibold">
                    {leg.leg}
                  </td>
                  <td className="py-2 pr-3 text-[var(--color-text-muted)]">{leg.description}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{usd(leg.asset, 3)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{usd(leg.reserve, 3)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{exactTo(leg.weight, 2)}</td>
                  <td className="py-2 text-right tabular-nums text-[var(--color-text-primary)]">
                    {exactTo(leg.weightedRatio, 4)}
                  </td>
                </tr>
              ))}
              <tr>
                <td colSpan={5} className="py-2.5 pr-3 text-right font-semibold uppercase tracking-wider text-[10px] text-[var(--color-text-muted)]">
                  Total quadrilateral X_cross
                </td>
                <td className="py-2.5 text-right tabular-nums font-bold text-[var(--color-gold-400)]">
                  {exactTo(crossBalance.xCross, 4)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ── Descendant register ── */}
      <Panel title="Descendant Register 81 — Modulo 9 Harmonic Balance" icon={GitBranch}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={lineageChart} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(228,201,122,0.12)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9b9083' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#9b9083' }} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: 'rgba(228,201,122,0.08)' }}
                  contentStyle={{ background: '#0F0C0A', border: '1px solid #3a3229', fontSize: 12 }}
                  labelFormatter={(label: any) => {
                    const row = lineageChart.find((r) => r.name === label);
                    return row ? `${label} — ${row.epoch}` : label;
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="offspring" name="Direct offspring" fill={GOLD} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-3 text-xs">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                Total active nodes (Σ gᵢ)
              </div>
              <div className="text-xl font-bold tabular-nums text-[var(--color-text-primary)]">
                {descendantRegister.totalActiveNodes}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                Total registered descendants
              </div>
              <div className="text-xl font-bold tabular-nums text-[var(--color-gold-400)]">
                {descendantRegister.totalRegisteredDescendants.toLocaleString('en-US')}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                Digital root
              </div>
              <div className="text-xl font-bold tabular-nums text-[var(--color-text-primary)]">
                {descendantRegister.digitalRoot}
              </div>
            </div>
            <div
              className={`text-xs font-semibold ${descendantRegister.harmonic ? 'text-emerald-400' : 'text-amber-400'}`}
            >
              {descendantRegister.harmonic
                ? 'S_genealogy ≡ 0 (mod 9) — HARMONIC'
                : 'S_genealogy ≢ 0 (mod 9)'}
            </div>
          </div>
        </div>
      </Panel>

      {/* ── Sealed measurements ── */}
      <Panel title="Sealed Token Measurements (.fcx)" icon={ShieldCheck}>
        {measurements.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)]">
            No sealed measurement records are present on disk.
          </p>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            {measurements.map((m, idx) => {
              const balanced = m.fields.find((f) => f.key === 'gaap_balanced')?.value === 'true';
              return (
                <div
                  key={`${m.file}-${idx}`}
                  className="border border-[var(--color-border-subtle)] p-4"
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[var(--color-gold-400)] truncate">
                        {m.record}
                      </div>
                      <div className="text-[10px] text-[var(--color-text-muted)]">
                        {m.version} · {m.schema}
                      </div>
                    </div>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 flex-shrink-0 ${
                        balanced
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : 'bg-amber-500/15 text-amber-400'
                      }`}
                    >
                      {balanced ? 'GAAP BALANCED' : 'UNBALANCED'}
                    </span>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                    {m.fields.map((f) => (
                      <div key={f.key} className="flex items-baseline justify-between gap-2">
                        <dt className="text-[var(--color-text-muted)] font-mono truncate">
                          {f.key}
                        </dt>
                        <dd className="tabular-nums text-[var(--color-text-primary)] font-mono text-right truncate">
                          {f.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {m.pif127 && (
                    <div className="mt-3 pt-2 border-t border-[var(--color-border-subtle)]">
                      <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                        PIF-127
                      </span>
                      <div className="font-mono text-[11px] text-[var(--color-text-primary)] break-all">
                        {m.pif127}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* ── Auditor copies ── */}
      <ExportPanel asOfDate={new Date().toISOString().slice(0, 10)} />
    </div>
  );
}
