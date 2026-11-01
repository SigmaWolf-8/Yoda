import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), token: 'account-A' as string | null }));
vi.mock('axios', () => ({ default: {
  create: () => ({ get: mocks.get, post: mocks.post }),
  isAxiosError: () => false,
} }));
vi.mock('../../api/client', () => ({
  apiClient: { defaults: { baseURL: '/api' } },
  getStoredToken: () => mocks.token,
}));
import { loadBrowserHistory, makeBrowserSubmission, saveBrowserRun } from '../browser-formula-history';
import { formulaRegistry, initialEvidence } from '../formula-evidence';

beforeEach(() => { mocks.token = 'account-A'; });
afterEach(() => { vi.clearAllMocks(); });

describe('private browser history transport', () => {
  it('requires credentials and never falls back to the anonymous owner', async () => {
    mocks.token = null;
    await expect(loadBrowserHistory(null)).rejects.toThrow('Sign in');
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it('uses the right API prefix, captured identity and cursor without caching', async () => {
    mocks.get.mockResolvedValue({ data: { runs: [], nextCursor: null } });
    expect(await loadBrowserHistory('account-A', '123')).toEqual({ runs: [], nextCursor: null });
    expect(mocks.get).toHaveBeenCalledWith('/formula-evidence/browser-runs', {
      headers: { Authorization: 'Bearer account-A' }, params: { before: '123' },
    });
  });
  it('refuses stale-account submissions before sending or exposing their responses', async () => {
    const claim = formulaRegistry[0];
    const submission = makeBrowserSubmission(claim, initialEvidence(claim.checks[0]));
    mocks.token = 'account-B';
    await expect(saveBrowserRun(submission, 'account-A')).rejects.toThrow('Account changed');
    expect(mocks.post).not.toHaveBeenCalled();
    mocks.token = 'account-A';
    mocks.get.mockImplementation(async () => {
      mocks.token = 'account-B';
      return { data: { runs: [{ private: 'A' }], nextCursor: null } };
    });
    await expect(loadBrowserHistory('account-A')).rejects.toThrow('Account changed');
  });
  it('captures immutable inputs and versions instead of referencing the current registry', () => {
    const claim = formulaRegistry[0];
    const record = { ...initialEvidence(claim.checks[0]), inputs: { samples: 2048 } };
    const first = makeBrowserSubmission(claim, record);
    record.inputs.samples = 4096;
    record.implementationVersion = 'changed/2';
    record.testVersion = 'changed-test/2';
    const second = makeBrowserSubmission(claim, record);
    expect(first.record.inputs.samples).toBe(2048);
    expect(first.record.implementationVersion).not.toBe(second.record.implementationVersion);
    expect(first.record.testVersion).not.toBe(second.record.testVersion);
    expect(first.submissionId).not.toBe(second.submissionId);
  });
  it('retries the same submission ID without changing failed results', async () => {
    const claim = formulaRegistry[0];
    const input = makeBrowserSubmission(claim, {
      ...initialEvidence(claim.checks[0]), status: 'failed', error: 'Execution failed',
    });
    mocks.post.mockRejectedValueOnce(new Error('Network down')).mockResolvedValueOnce({ data: { submission: input } });
    await expect(saveBrowserRun(input, 'account-A')).rejects.toThrow('Network down');
    await saveBrowserRun(input, 'account-A');
    expect(mocks.post.mock.calls[0][1]).toBe(mocks.post.mock.calls[1][1]);
    expect(mocks.post.mock.calls[1][1].record.status).toBe('failed');
  });
});
