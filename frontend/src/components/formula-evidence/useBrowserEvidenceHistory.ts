import { useCallback, useEffect, useRef, useState } from 'react';
import { getStoredToken } from '../../api/client';
import { browserHistoryError, loadBrowserHistory, makeBrowserSubmission, saveBrowserRun } from '../../lib/browser-formula-history';
import type { BrowserSubmission, SavedBrowserRun } from '../../lib/browser-formula-history';
import { formulaRegistry, runFormulaCheck, synchronizeEvidenceIdentity } from '../../lib/formula-evidence';

export interface LocalAttempt {
  submission: BrowserSubmission;
  storage: 'saving' | 'saved' | 'failed' | 'unsigned' | 'unprepared';
  error?: string;
  saved?: SavedBrowserRun;
}

/** Private view-local state: no query cache, credentials in refs only. */
export function useBrowserEvidenceHistory() {
  const [attempts, setAttempts] = useState<LocalAttempt[]>([]);
  const attemptsRef = useRef<LocalAttempt[]>([]);
  const [runs, setRuns] = useState<SavedBrowserRun[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(() => !!getStoredToken());
  const [session, setSession] = useState(0);
  const identity = useRef({ credential: getStoredToken(), generation: 0 });
  const mounted = useRef(false);
  const request = useRef(0);
  const failedBefore = useRef<string | undefined>(undefined);
  const saves = useRef(new Set<string>());
  const localSequence = useRef(0);

  const valid = useCallback((credential: string | null, generation: number) =>
    mounted.current && identity.current.generation === generation
      && identity.current.credential === credential && getStoredToken() === credential, []);

  const updateAttempts = useCallback((transform: (old: LocalAttempt[]) => LocalAttempt[]) => {
    attemptsRef.current = transform(attemptsRef.current);
    setAttempts(attemptsRef.current);
  }, []);

  const load = useCallback(async (before?: string) => {
    const { credential, generation } = identity.current;
    if (!credential) return;
    const sequence = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const page = await loadBrowserHistory(credential, before);
      if (!valid(credential, generation) || sequence !== request.current) return;
      setRuns(old => {
        const combined = before ? [...old, ...page.runs] : page.runs;
        return combined.filter((run, index) => combined.findIndex(other => other.id === run.id) === index);
      });
      setNextCursor(page.nextCursor);
    } catch (cause) {
      if (valid(credential, generation) && sequence === request.current) {
        failedBefore.current = before;
        setError(browserHistoryError(cause));
      }
    } finally {
      if (valid(credential, generation) && sequence === request.current) setLoading(false);
    }
  }, [valid]);

  useEffect(() => {
    mounted.current = true;
    function reset() {
      const credential = getStoredToken();
      if (credential === identity.current.credential) return;
      synchronizeEvidenceIdentity(credential);
      identity.current = { credential, generation: identity.current.generation + 1 };
      ++request.current;
      saves.current.clear();
      attemptsRef.current = [];
      setAttempts([]);
      setRuns([]);
      setNextCursor(null);
      setError(null);
      failedBefore.current = undefined;
      setLoading(false);
      setSignedIn(!!identity.current.credential);
      setSession(value => value + 1);
      void load();
    }
    identity.current = { credential: getStoredToken(), generation: identity.current.generation + 1 };
    synchronizeEvidenceIdentity(identity.current.credential);
    setSignedIn(!!identity.current.credential);
    void load();
    window.addEventListener('yoda-auth-changed', reset);
    window.addEventListener('storage', reset);
    return () => {
      mounted.current = false;
      ++identity.current.generation;
      window.removeEventListener('yoda-auth-changed', reset);
      window.removeEventListener('storage', reset);
    };
  }, [load]);

  useEffect(() => {
    const message = 'Unsaved formula attempts are not durable. Export current evidence JSON before leaving. Failed saves and pending saves will be lost.';
    function warn(event: BeforeUnloadEvent) {
      if (!attemptsRef.current.some(attempt => attempt.storage !== 'saved')) return;
      event.preventDefault();
      event.returnValue = message;
    }
    function navigate(event: MouseEvent) {
      if (!attemptsRef.current.some(attempt => attempt.storage !== 'saved')) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!anchor || anchor.getAttribute('href')?.startsWith('#') || anchor.hasAttribute('download')) return;
      if (!window.confirm(message + ' Leave anyway?')) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', navigate, true);
    return () => {
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('click', navigate, true);
    };
  }, []);

  const persist = useCallback(async (submission: BrowserSubmission, credential: string, generation: number) => {
    const id = submission.submissionId;
    if (!valid(credential, generation) || saves.current.has(id)) return;
    saves.current.add(id);
    updateAttempts(old => old.map(attempt => attempt.submission.submissionId === id ? { ...attempt, storage: 'saving', error: undefined } : attempt));
    try {
      const saved = await saveBrowserRun(submission, credential);
      if (!valid(credential, generation)) return;
      updateAttempts(old => old.map(attempt => attempt.submission.submissionId === id ? { ...attempt, storage: 'saved', saved } : attempt));
      setRuns(old => [saved, ...old.filter(run => run.id !== saved.id)]);
    } catch (cause) {
      if (valid(credential, generation)) updateAttempts(old => old.map(attempt => attempt.submission.submissionId === id ? { ...attempt, storage: 'failed', error: browserHistoryError(cause) } : attempt));
    } finally {
      if (valid(credential, generation)) saves.current.delete(id);
    }
  }, [updateAttempts, valid]);

  const execute = useCallback(async (id: string) => {
    // Capture the identity BEFORE calculation; never adopt a later account.
    const credential = getStoredToken();
    const generation = identity.current.generation;
    const claim = formulaRegistry.find(item => item.checks.some(check => check.id === id));
    const record = await runFormulaCheck(id);
    if (!record || !claim || !valid(credential, generation)) return;
    let submission: BrowserSubmission;
    try {
      submission = makeBrowserSubmission(claim, record);
    } catch (cause) {
      // Local export envelope only, never submitted or offered for storage retry.
      // Keep the complete terminal record even if crypto/structuredClone is absent.
      const local = {
        submissionId: `local-unprepared-${generation}-${++localSequence.current}`,
        claim: { id: claim.id, title: claim.title, formula: claim.formula, sources: claim.sources },
        record,
      };
      updateAttempts(old => [...old, { submission: local, storage: 'unprepared',
        error: `Calculation completed (${record.status}), but submission preparation failed: ${browserHistoryError(cause)}. Not saved. Export this attempt before leaving.` }]);
      return;
    }
    updateAttempts(old => [...old, { submission, storage: credential ? 'saving' : 'unsigned' }]);
    if (credential) await persist(submission, credential, generation);
  }, [persist, updateAttempts, valid]);

  const retry = useCallback((submissionId: string) => {
    const attempt = attemptsRef.current.find(item => item.submission.submissionId === submissionId);
    const { credential, generation } = identity.current;
    if (attempt?.storage === 'failed' && credential) void persist(attempt.submission, credential, generation);
  }, [persist]);

  return { attempts, runs, nextCursor, loading, error, signedIn, session, execute, retry,
    refresh: () => load(), loadMore: () => nextCursor ? load(nextCursor) : Promise.resolve(),
    retryLoad: () => load(failedBefore.current),
    getAttempts: () => attemptsRef.current };
}
