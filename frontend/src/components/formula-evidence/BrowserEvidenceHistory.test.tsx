import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormulaEvidence } from '../FormulaEvidence';
import { getStoredToken, getStoredRefreshToken, storeTokens } from '../../api/client';
import { loadBrowserHistory, makeBrowserSubmission, saveBrowserRun } from '../../lib/browser-formula-history';
import type { BrowserHistoryPage, BrowserSubmission, SavedBrowserRun } from '../../lib/browser-formula-history';
import { formulaRegistry, initialEvidence, runFormulaCheck } from '../../lib/formula-evidence';

vi.mock('../../lib/browser-formula-history', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/browser-formula-history')>();
  return { ...actual, loadBrowserHistory: vi.fn(), saveBrowserRun: vi.fn(), makeBrowserSubmission: vi.fn(actual.makeBrowserSubmission) };
});
vi.mock('../../lib/formula-evidence', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/formula-evidence')>();
  return { ...actual, runFormulaCheck: vi.fn(actual.runFormulaCheck) };
});

function saved(submission: BrowserSubmission, id = submission.submissionId): SavedBrowserRun {
  return { id, cursor: id, receivedAt: '2026-07-12T11:12:13Z', provenance: 'client-submitted-unverified', daemonReceipt: false, schemaVersion: 1, submission };
}
function snapshot(id: string) {
  return saved(makeBrowserSubmission(formulaRegistry[0], {
    ...initialEvidence(formulaRegistry[0].checks[0]), status: 'passed', executedAt: '2026-07-11T10:00:00Z',
  }), id);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('browser evidence history flow', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    vi.mocked(loadBrowserHistory).mockResolvedValue({ runs: [], nextCursor: null });
    vi.mocked(saveBrowserRun).mockImplementation(async submission => saved(submission));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  function button(text: string) {
    const found = [...host.querySelectorAll('button')].find(item => item.textContent?.includes(text));
    if (!found) throw new Error(`Missing button: ${text}`);
    return found;
  }
  async function execute() {
    const target = [...host.querySelectorAll('button')].find(item => item.getAttribute('aria-label')?.includes('Differentiate the polynomial field'))!;
    await act(async () => target.click());
  }

  it('retries the same immutable submission without recalculating and retains previous unsaved attempts in export', async () => {
    localStorage.setItem('yoda_token', 'owner-a');
    vi.mocked(saveBrowserRun).mockRejectedValueOnce(new Error('Storage offline'));
    let exported: Blob | undefined;
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL(blob: Blob) { exported = blob; return 'blob:test'; }
      static revokeObjectURL() {}
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await act(async () => root.render(<FormulaEvidence />));
    await execute();
    expect(host.textContent).toContain('Calculation: passed');
    expect(host.textContent).toContain('Save failed · not confirmed saved');
    const first = vi.mocked(saveBrowserRun).mock.calls[0][0];
    await act(async () => button('Retry save').click());
    expect(vi.mocked(saveBrowserRun).mock.calls[1][0]).toBe(first);
    expect(vi.mocked(saveBrowserRun).mock.calls[1][1]).toBe('owner-a');
    expect(runFormulaCheck).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Storage: Saved');
    vi.mocked(saveBrowserRun).mockRejectedValue(new Error('Storage offline again'));
    await execute();
    await execute();
    await act(async () => button('Export current evidence').click());
    const text = await new Promise<string>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(exported!);
    });
    const payload = JSON.parse(text);
    expect(payload.attempts).toHaveLength(3);
    expect(payload.attempts.filter((item: { storage: string }) => item.storage === 'failed')).toHaveLength(2);
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('allows unsigned local calculation and clears attempts on account change rather than adopting them', async () => {
    await act(async () => root.render(<FormulaEvidence />));
    await execute();
    expect(host.textContent).toContain('Unsaved · no credential at execution');
    expect(host.querySelector('a[href="/login"]')).not.toBeNull();
    expect(saveBrowserRun).not.toHaveBeenCalled();
    localStorage.setItem('yoda_token', 'owner-b');
    await act(async () => window.dispatchEvent(new Event('yoda-auth-changed')));
    expect(host.textContent).not.toContain('Unsaved · no credential at execution');
    expect(saveBrowserRun).not.toHaveBeenCalled();
    await execute();
    expect(vi.mocked(saveBrowserRun).mock.calls[0][1]).toBe('owner-b');
  });

  it('ignores same-credential auth/storage notifications and reloads private history on actual remount', async () => {
    localStorage.setItem('yoda_token', 'owner-a');
    const run = snapshot('same-account-history');
    vi.mocked(loadBrowserHistory).mockResolvedValue({ runs: [run], nextCursor: null });
    await act(async () => root.render(<FormulaEvidence />));
    await execute();
    const loadCount = vi.mocked(loadBrowserHistory).mock.calls.length;
    await act(async () => {
      localStorage.setItem('unrelated-preference', 'compact');
      window.dispatchEvent(new Event('storage'));
      window.dispatchEvent(new Event('yoda-auth-changed'));
    });
    expect(host.textContent).toContain('Local attempts · 1 completed');
    expect(loadBrowserHistory).toHaveBeenCalledTimes(loadCount);
    await act(async () => root.render(<FormulaEvidence key="remounted" />));
    expect(loadBrowserHistory).toHaveBeenCalledTimes(loadCount + 1);
    expect(host.textContent).toContain('same-account-history');
    expect(host.textContent).toContain('Passed · expected result matched');
    expect(runFormulaCheck).toHaveBeenCalledTimes(1);
  });

  it('submits every terminal outcome including client-reported unavailable daemon evidence', async () => {
    localStorage.setItem('yoda_token', 'owner-a');
    await act(async () => root.render(<FormulaEvidence />));
    await act(async () => button('Run all checks').click());
    expect(saveBrowserRun).toHaveBeenCalledTimes(formulaRegistry.flatMap(claim => claim.checks).length);
    expect(vi.mocked(saveBrowserRun).mock.calls.map(([submission]) => submission.record.id).sort())
      .toEqual(formulaRegistry.flatMap(claim => claim.checks.map(check => check.id)).sort());
    const daemon = vi.mocked(saveBrowserRun).mock.calls.find(([submission]) => submission.record.kind === 'daemon-execution')![0];
    expect(daemon.record.status).toBe('unavailable');
    expect(daemon.record.observed).toBeNull();
    expect(host.textContent).toContain('client reported; no daemon receipt');
    vi.mocked(runFormulaCheck).mockResolvedValueOnce({
      ...initialEvidence(formulaRegistry[0].checks[0]), status: 'failed', error: 'Deliberate calculation failure',
    });
    await execute();
    expect(vi.mocked(saveBrowserRun).mock.calls.at(-1)![0].record.status).toBe('failed');
    expect(host.textContent).toContain('Calculation: failed');
    expect(host.textContent).toContain('Storage: Saved');
  });

  it('retains terminal payloads locally when submission preparation fails', async () => {
    localStorage.setItem('yoda_token', 'owner-a');
    vi.mocked(makeBrowserSubmission).mockImplementationOnce(() => { throw new Error('Crypto unavailable'); });
    await act(async () => root.render(<FormulaEvidence />));
    await execute();
    expect(saveBrowserRun).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Unsaved · submission could not be prepared');
    expect(host.textContent).toContain('Calculation completed (passed)');
    expect(host.textContent).toContain('Crypto unavailable');
    expect(host.textContent).toContain('Export this attempt before leaving');
  });

  it('discards late calculation, save and loaded-history responses across session generations', async () => {
    localStorage.setItem('yoda_token', 'owner-a');
    const page = deferred<BrowserHistoryPage>();
    const save = deferred<SavedBrowserRun>();
    vi.mocked(loadBrowserHistory).mockReturnValueOnce(page.promise);
    vi.mocked(saveBrowserRun).mockReturnValueOnce(save.promise);
    await act(async () => root.render(<FormulaEvidence />));
    const target = [...host.querySelectorAll('button')].find(item => item.getAttribute('aria-label')?.includes('Differentiate the polynomial field'))!;
    await act(async () => { target.click(); await Promise.resolve(); });
    const submission = vi.mocked(saveBrowserRun).mock.calls[0][0];
    localStorage.setItem('yoda_token', 'owner-b');
    await act(async () => window.dispatchEvent(new Event('storage')));
    await act(async () => { page.resolve({ runs: [snapshot('PRIVATE-OLD-LOAD')], nextCursor: null }); save.resolve(saved(submission, 'PRIVATE-OLD-SAVE')); });
    expect(host.textContent).not.toContain('PRIVATE-OLD');
    expect(host.textContent).not.toContain('Local attempts');
    const calculation = deferred<Awaited<ReturnType<typeof runFormulaCheck>>>();
    vi.mocked(runFormulaCheck).mockReturnValueOnce(calculation.promise);
    await act(async () => target.click());
    localStorage.setItem('yoda_token', 'owner-c');
    await act(async () => window.dispatchEvent(new Event('yoda-auth-changed')));
    await act(async () => calculation.resolve(submission.record));
    expect(saveBrowserRun).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain('Local attempts');
  });

  it.each([true, false])('replaces account history when remember-me changes from %s', async rememberedA => {
    storeTokens('owner-a', 'refresh-a', rememberedA);
    const accountBPage = deferred<BrowserHistoryPage>();
    vi.mocked(loadBrowserHistory)
      .mockResolvedValueOnce({ runs: [snapshot('PRIVATE-ACCOUNT-A')], nextCursor: null })
      .mockReturnValueOnce(accountBPage.promise);
    await act(async () => root.render(<FormulaEvidence />));
    expect(host.textContent).toContain('PRIVATE-ACCOUNT-A');

    await act(async () => storeTokens('owner-b', 'refresh-b', !rememberedA));
    // The old account must disappear immediately, before B's history arrives.
    expect(host.textContent).not.toContain('PRIVATE-ACCOUNT-A');
    expect(getStoredToken()).toBe('owner-b');
    expect(getStoredRefreshToken()).toBe('refresh-b');
    const oldStorage = rememberedA ? localStorage : sessionStorage;
    expect(oldStorage.getItem('yoda_token')).toBeNull();
    expect(oldStorage.getItem('yoda_refresh_token')).toBeNull();
    expect(loadBrowserHistory).toHaveBeenLastCalledWith('owner-b', undefined);

    await act(async () => accountBPage.resolve({ runs: [snapshot('PRIVATE-ACCOUNT-B')], nextCursor: null }));
    expect(host.textContent).toContain('PRIVATE-ACCOUNT-B');
    expect(host.textContent).not.toContain('PRIVATE-ACCOUNT-A');
    await execute();
    expect(saveBrowserRun).toHaveBeenLastCalledWith(expect.any(Object), 'owner-b');
  });

  it('does not leave a prior refresh credential alongside an opaque session', () => {
    storeTokens('owner-a', 'refresh-a', true);
    storeTokens('opaque-owner-b', undefined, false);
    expect(getStoredToken()).toBe('opaque-owner-b');
    expect(getStoredRefreshToken()).toBeNull();
    expect(localStorage.getItem('yoda_token')).toBeNull();
  });

  it('loads cursor pages, compares stored versions, and never seeds current checks with saved payloads', async () => {
    localStorage.setItem('yoda_token', 'owner-a');
    const old = snapshot('older-version');
    old.submission.record.implementationVersion = 'archived-implementation/0';
    const newer = snapshot('newer-version');
    vi.mocked(loadBrowserHistory).mockResolvedValueOnce({ runs: [newer], nextCursor: 'page-two' })
      .mockResolvedValueOnce({ runs: [old], nextCursor: null });
    await act(async () => root.render(<FormulaEvidence />));
    await act(async () => button('Load more saved runs').click());
    expect(loadBrowserHistory).toHaveBeenLastCalledWith('owner-a', 'page-two');
    const boxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    await act(async () => { boxes[0].click(); boxes[1].click(); });
    await act(async () => button('Compare two selected runs').click());
    const comparison = host.querySelector('[aria-label="Run comparison"]')!;
    expect(comparison.textContent).toContain('Implementation version · different');
    expect(comparison.textContent).toContain('Client executedAt');
    expect(comparison.textContent).toContain('Server receivedAt');
    expect(comparison.textContent).toContain('Complete immutable saved payload');
    expect(runFormulaCheck).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Historical success never certifies the current registry');
  });
});
