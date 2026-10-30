import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import apiClient from '../../api/client';

export type GateKind = 'boundary' | 'bridge' | 'reserve' | 'writeOff';
export type GateStatus = 'pass' | 'fail' | 'unknown' | 'unverified';
export interface GateInput {
  kind: GateKind;
  scope: string;
  unit: string;
  periodStart: string;
  periodEnd: string;
  evidence: string;
  note: string;
  values: Record<string, string>;
}
export interface GateResult {
  status: 'pass' | 'fail';
  classification: string;
  residual: string;
  metrics: Array<{ label: string; value: string; unit: string }>;
  journal: Array<{ account: string; debit: string; credit: string }>;
  globalBalanced: boolean | null;
  localClaim: string;
}
export interface GateRecord {
  id: string;
  createdAt: string;
  previousHash: string;
  hash: string;
  input: GateInput;
  result: GateResult;
}
export interface GateChain { valid: boolean; count: number; errors: string[]; head: string | null }
export interface ConservationResponse {
  asOf: string;
  ledger: { status: 'pass' | 'fail' | 'unknown'; residual: string | null; source: string; message: string };
  reserve: ConservationResponse['ledger'];
  chain: GateChain;
  records: GateRecord[];
  local: { status: 'unverified'; message: string };
  boundary: { status: 'unknown'; message: string };
  notes: string[];
}
export const conservationPath = '/capomastro/conservation';
export const correctionPath = '/capomastro/codex?doc=divergence-flux-gate';
const options = { withCredentials: true };

export function gateError(error: unknown): string {
  if (axios.isAxiosError<{ error?: string }>(error)) return error.response?.data?.error || error.message;
  return error instanceof Error ? error.message : 'The conservation service did not respond.';
}
export function assertChain(value: unknown): asserts value is GateChain {
  const c = value as GateChain | null;
  if (!c || typeof c.valid !== 'boolean' || typeof c.count !== 'number' || !Array.isArray(c.errors) || !(c.head === null || typeof c.head === 'string')) {
    throw new Error('Unexpected chain response. Verification is unavailable.');
  }
}
export function assertResult(value: unknown): asserts value is GateResult {
  const r = value as GateResult | null;
  if (!r || !['pass', 'fail'].includes(r.status) || typeof r.residual !== 'string' ||
    typeof r.classification !== 'string' || typeof r.localClaim !== 'string' ||
    !(r.globalBalanced === null || typeof r.globalBalanced === 'boolean') ||
    !Array.isArray(r.metrics) || !r.metrics.every(m => typeof m.label === 'string' && typeof m.value === 'string' && typeof m.unit === 'string') ||
    !Array.isArray(r.journal) || !r.journal.every(j => typeof j.account === 'string' && typeof j.debit === 'string' && typeof j.credit === 'string')) {
    throw new Error('Unexpected computation response. No result can be relied upon.');
  }
}
export async function evaluateGate(input: GateInput) {
  const { data } = await apiClient.post<unknown>(`${conservationPath}/evaluate`, input, options);
  assertResult(data);
  return data;
}
export async function verifyGate() {
  const { data } = await apiClient.post<unknown>(`${conservationPath}/verify`, {}, options);
  assertChain(data);
  return data;
}
export async function saveGate(requestId: string, input: GateInput) {
  const { data } = await apiClient.post<GateRecord>(`${conservationPath}/records`, { requestId, input }, options);
  if (!data || typeof data.id !== 'string' || typeof data.hash !== 'string' || !data.input) throw new Error('Unexpected saved record response. Retry with the same input and request key.');
  assertResult(data.result);
  return data;
}

export function useConservation() {
  const [data, setData] = useState<ConservationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    try {
      const response = await apiClient.get<ConservationResponse>(conservationPath, { ...options, signal: current.signal });
      const body = response.data;
      if (!body || typeof body !== 'object' || typeof body.asOf !== 'string' || !Array.isArray(body.records) || !Array.isArray(body.notes) || !body.local || !body.boundary) throw new Error('Unexpected conservation response. The backend may not be ready.');
      assertChain(body.chain);
      for (const check of [body.ledger, body.reserve]) {
        if (!check || !['pass', 'fail', 'unknown'].includes(check.status) || typeof check.source !== 'string' || typeof check.message !== 'string' || !(check.residual === null || typeof check.residual === 'string')) throw new Error('Unexpected workbook check response.');
      }
      for (const record of body.records) {
        if (!record || typeof record.hash !== 'string' || typeof record.id !== 'string' || !record.input || !record.input.values) throw new Error('Unexpected audit history response.');
        assertResult(record.result);
      }
      if (!current.signal.aborted) { setData(body); setError(null); }
    } catch (err) {
      if (!current.signal.aborted) setError(gateError(err));
    } finally {
      if (!current.signal.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 30_000);
    return () => { window.clearInterval(timer); controller.current?.abort(); };
  }, [refresh]);
  return { data, error, loading, refresh };
}
