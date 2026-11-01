import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConservationLayout } from './ConservationLayout';
import { ConservationPage } from './ConservationPage';
import { useConservation, type ConservationResponse, type GateRecord } from './use-conservation';

vi.mock('./use-conservation', async importOriginal => ({
  ...await importOriginal<typeof import('./use-conservation')>(),
  useConservation: vi.fn(),
}));
const record: GateRecord = {
  id: 'a02e1b0e-9b99-43a7-b000-35fb645c0fc2', createdAt: '2026-05-01', hash: 'test-hash', previousHash: '',
  input: { kind: 'bridge', scope: 'Supplied §V valuation scenario — not an executed settlement', unit: 'USD',
    periodStart: '2026-05-01', periodEnd: '2026-05-01', evidence: 'Fixture evidence',
    note: 'modeled example not verified delivery', values: {} },
  result: { status: 'fail', classification: 'Fixture valuation shortfall', residual: '0.5',
    metrics: [], journal: [], globalBalanced: false, localClaim: 'unverified' },
};
const check = { status: 'pass' as const, residual: '0', source: 'fixture workbook', message: 'Finite check only' };
const snapshot: ConservationResponse = {
  asOf: 'fixture snapshot', ledger: check, reserve: check,
  chain: { valid: true, count: 1, errors: [], head: 'test-hash' }, records: [record],
  local: { status: 'unverified', message: 'unverified' },
  boundary: { status: 'unknown', message: 'unknown' }, notes: [],
};
function state(data: ConservationResponse | null, error: string | null = null) {
  vi.mocked(useConservation).mockReturnValue({ data, error, loading: !data, refresh: vi.fn() });
}
function banner() {
  return renderToStaticMarkup(<MemoryRouter><ConservationLayout /></MemoryRouter>);
}
afterEach(() => { vi.restoreAllMocks(); });

describe('conservation historical failure provenance', () => {
  it('links the stored failure and derives cause from its actual fields, independently of workbook passes', () => {
    state(snapshot);
    const html = banner();
    expect(html).toContain(`/capomastro/conservation#record-${record.id}`);
    expect(html).toContain('1 failed / 1 saved');
    expect(html).toContain(record.input.scope);
    expect(html).toContain('Fixture valuation shortfall');
    expect(html).toContain('0.5 USD');
    expect(html).toContain('not the live workbook or reserve status');
    expect(html.match(/gate-pass/g)?.length).toBe(3);
    state({ ...snapshot, records: [{ ...record, input: { ...record.input, unit: 'EUR' }, result: { ...record.result, residual: '7.31' } }] });
    expect(banner()).toContain('7.31 EUR');
  });

  it('shows the first failure with additional history link, and labels stale snapshots honestly', () => {
    state({ ...snapshot, records: [record, { ...record, id: 'second' }] }, 'network unavailable');
    const html = banner();
    expect(html).toContain('1 additional failed saved observation');
    expect(html).toContain('/capomastro/conservation#audit-history');
    expect(html).toContain('fail · stale snapshot');
    expect(html).toContain('2 failed / 2 saved (stale)');
    expect(html).toContain('Live status unavailable');
  });

  it('opens and scrolls a direct record hash after asynchronous history arrival, without scrolling on every refresh', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const scroll = vi.fn();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scroll, configurable: true });
    const page = () => <MemoryRouter initialEntries={[`/capomastro/conservation#record-${record.id}`]}>
      <Routes><Route element={<ConservationLayout />}><Route path="/capomastro/conservation" element={<ConservationPage />} /></Route></Routes>
    </MemoryRouter>;
    try {
      state(null);
      await act(async () => { root.render(page()); });
      expect(document.getElementById(`record-${record.id}`)).toBeNull();
      state(snapshot);
      await act(async () => { root.render(page()); });
      expect((document.getElementById(`record-${record.id}`) as HTMLDetailsElement).open).toBe(true);
      expect(scroll).toHaveBeenCalledTimes(1);
      state({ ...snapshot });
      await act(async () => { root.render(page()); });
      expect(scroll).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });
});
