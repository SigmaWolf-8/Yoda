import axios from 'axios';
import { apiClient, getStoredToken } from '../api/client';
import type { EvidenceRecord, FormulaClaim } from './formula-evidence';

export interface BrowserSubmission {
  submissionId: string;
  claim: Pick<FormulaClaim, 'id' | 'title' | 'formula' | 'sources'>;
  record: EvidenceRecord;
}
export interface SavedBrowserRun {
  id: string;
  cursor: string;
  receivedAt: string;
  provenance: 'client-submitted-unverified';
  daemonReceipt: false;
  schemaVersion: 1;
  submission: BrowserSubmission;
}
export interface BrowserHistoryPage {
  runs: SavedBrowserRun[];
  nextCursor: string | null;
}

/** This client never redirects or refreshes silently: the identity that started
 * the operation must remain the identity that saves/displays it. */
const client = axios.create({ baseURL: apiClient.defaults.baseURL, timeout: 30_000 });
export function requireHistoryCredential(credential: string | null): string {
  if (!credential) throw new Error('Sign in to save or read private history. Local checks and JSON export remain available.');
  if (credential !== getStoredToken()) throw new Error('Account changed. History operation discarded; refresh for this account.');
  return credential;
}
export function makeBrowserSubmission(claim: FormulaClaim, record: EvidenceRecord): BrowserSubmission {
  return structuredClone({
    submissionId: crypto.randomUUID(),
    claim: { id: claim.id, title: claim.title, formula: claim.formula, sources: claim.sources },
    record,
  });
}
export async function saveBrowserRun(submission: BrowserSubmission, credential: string | null): Promise<SavedBrowserRun> {
  const token = requireHistoryCredential(credential);
  const { data } = await client.post<SavedBrowserRun>('/formula-evidence/browser-runs', submission, {
    headers: { Authorization: `Bearer ${token}` },
  });
  requireHistoryCredential(credential);
  return data;
}
export async function loadBrowserHistory(credential: string | null, before?: string): Promise<BrowserHistoryPage> {
  const token = requireHistoryCredential(credential);
  const { data } = await client.get<BrowserHistoryPage>('/formula-evidence/browser-runs', {
    headers: { Authorization: `Bearer ${token}` }, params: before ? { before } : undefined,
  });
  requireHistoryCredential(credential);
  return data;
}
export function browserHistoryError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 401) return 'Sign-in expired or missing. Sign in again to access private history; this run is not confirmed saved.';
    if (error.response?.status === 403) return 'This account no longer has access to its organization.';
    if (error.response?.status === 404) return 'History storage is not available on this server yet.';
    if (typeof error.response?.data?.error === 'string') return error.response.data.error;
  }
  return error instanceof Error ? error.message : 'History request failed. Retry or export unsaved evidence before leaving.';
}
