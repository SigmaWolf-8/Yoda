import { describe, expect, it, vi } from 'vitest';
import {
  derivative, evidenceConclusion, executeCheck, executors, formulaRegistry,
  getEvidenceSnapshot, initialEvidence, isOddPolynomial, runFormulaCheck, subscribeEvidence,
  type Executor, type FormulaCheck,
} from '../formula-evidence';

const checks = formulaRegistry[0].checks;
const check = (id: string) => checks.find(c => c.id === id)!;
const context = { traceId: 'test-trace', executionLocation: 'Vitest / Node JavaScript' };
const run = (id: string) => executeCheck(check(id), executors[id], context);

describe('divergence-flux reproducible checks', () => {
  it('does not certify anything on registration', () => {
    for (const c of checks) {
      expect(initialEvidence(c)).toMatchObject({ status: 'not-run', observed: null, executedAt: null, traceId: null });
    }
  });
  it('executes polynomial differentiation rather than assuming a displayed derivative', async () => {
    expect(derivative([0, 0, 1])).toEqual([0, 2]);
    expect(derivative([5, 3, 0, 2])).toEqual([3, 0, 6]);
    expect(await run('symbolic-divergence')).toMatchObject({ status: 'passed', observed: { divergenceCoefficients: [0, 2] } });
  });
  it('executes the odd-density symmetry check for zero sphere flux', async () => {
    expect(await run('symbolic-flux')).toMatchObject({
      status: 'passed', observed: { fluxDensityCoefficients: [0, 0, 0, 1], oddUnderXReflection: true, globalFlux: 0 },
    });
    expect(isOddPolynomial([0, 0, 1])).toBe(false);
    expect(isOddPolynomial([1, 0, 0, 1])).toBe(false);
  });
  it('rejects symmetry reasoning if the actual field produces an even density', async () => {
    const c = check('symbolic-flux');
    const changed = { ...c, inputs: { ...c.inputs, fieldXCoefficients: [0, 1] } };
    expect(await executeCheck(changed, executors[c.id], context)).toMatchObject({ status: 'failed', observed: null });
  });
  it('computes the exact rational nonzero interior witness', async () => {
    const result = await run('local-counterexample');
    expect(result).toMatchObject({
      status: 'passed', observed: { insideUnitBall: true, divergenceNumerator: '1', divergenceDenominator: '1', identicallyZero: false },
    });
    expect(evidenceConclusion([result])).toContain('Disproved');
  });
  it('does not promote a zero sample to universal vanishing', async () => {
    const c = check('local-counterexample');
    const result = await executeCheck({ ...c, inputs: { ...c.inputs, xNumerator: '0' } }, executors[c.id], context);
    expect(result.status).toBe('failed');
    expect(evidenceConclusion([result])).toContain('Not established');
  });
  it('does not use an out-of-domain witness', async () => {
    const c = check('local-counterexample');
    expect((await executeCheck({ ...c, inputs: { ...c.inputs, xNumerator: '3' } }, executors[c.id], context)).status).toBe('failed');
  });
  it('measures quadrature and keeps its numerical tolerance explicit', async () => {
    const result = await run('numerical-flux');
    expect(result.status).toBe('passed');
    expect(Math.abs(result.observed!.globalFlux as number)).toBeLessThanOrEqual(1e-12);
    expect(result.inputs.samples).toBe(2048);
    expect(result.tolerance).toBe(1e-12);
    expect(evidenceConclusion([result])).toContain('Not established');
  });
  it('does not turn zero global flux into a pointwise statement', async () => {
    const flux = await run('symbolic-flux');
    expect(flux.status).toBe('passed');
    expect(evidenceConclusion([flux])).toContain('Not established');
    expect(evidenceConclusion([flux, await run('local-counterexample')])).toContain('Disproved');
  });
  it('records reproducible provenance independently for each executed check', async () => {
    for (const c of checks.filter(c => c.kind !== 'daemon-execution')) {
      const result = await run(c.id);
      expect(result).toMatchObject({ inputs: c.inputs, assumptions: c.assumptions, expected: c.expected, ...context });
      expect(result.executedAt).toMatch(/^\d{4}-/);
      expect(result.implementationVersion).toBe('formula-evidence/2');
      expect(result.testVersion).toBe('formula-evidence-contract/2');
    }
  });
});

describe('Compendium XOR reproducible checks', () => {
  const xorChecks = formulaRegistry.find(claim => claim.id === 'compendium-boolean-xor')!.checks;
  const xorCheck = (id: string) => xorChecks.find(c => c.id === id)!;
  const changedInput = (c: FormulaCheck, patch: FormulaCheck['inputs']) =>
    executeCheck({ ...c, inputs: { ...c.inputs, ...patch } }, executors[c.id], context);

  it('registers unique IDs and no pre-certified XOR evidence', () => {
    const ids = formulaRegistry.flatMap(claim => claim.checks.map(c => c.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of xorChecks) {
      expect(initialEvidence(c)).toMatchObject({ status: 'not-run', observed: null, executedAt: null, traceId: null });
      expect(c.tolerance).toBeNull();
    }
  });

  it('independently matches the Boolean definition on the complete finite domain', async () => {
    // Oracle is Boolean inequality, not the polynomial or modular algorithm.
    const pairs = [[false, false], [false, true], [true, false], [true, true]];
    const oracle = pairs.map(([x, y]) => Number(x !== y));
    for (const c of xorChecks) {
      expect(c.expected.outputs).toEqual(oracle);
      const result = await executeCheck(c, executors[c.id], context);
      expect(result).toMatchObject({
        status: 'passed', observed: { evaluatedPairs: 4, outputs: oracle },
        inputs: c.inputs, assumptions: c.assumptions, expected: c.expected,
        implementationVersion: 'formula-evidence/2', testVersion: 'formula-evidence-contract/2',
        ...context,
      });
      expect(result.executedAt).toMatch(/^\d{4}-/);
      expect(evidenceConclusion([result])).toContain('Not established');
    }
  });

  it('executes supplied coefficients and fails a wrong sign or missing interaction term', async () => {
    const c = xorCheck('xor-polynomial');
    for (const coefficients of [[0, 1, 1, 2], [0, 1, 1, 0], [1, 1, 1, -2]]) {
      const result = await changedInput(c, { coefficients });
      expect(result.status).toBe('failed');
      expect(result.observed).not.toBeNull();
      expect(result.observed!.outputs).not.toEqual(c.expected.outputs);
    }
  });

  it('rejects incomplete, duplicated, reordered and non-Boolean domains', async () => {
    const patches: FormulaCheck['inputs'][] = [
      { domain: 'R²' }, { xValues: [0, 0, 1] }, { yValues: [0, 1, 0, 1, 0] },
      { xValues: [0, 0, 0, 0] }, { yValues: [1, 0, 0, 1] },
      ...[-1, 2, 0.5, NaN, Infinity].map(value => ({ xValues: [0, 0, 1, value] })),
      { xValues: ['0', 0, 1, 1] as unknown as number[] },
      { yValues: [0, 1, 0, true] as unknown as number[] },
      { xValues: '0,0,1,1' }, { yValues: Array(4) as number[] },
    ];
    for (const c of xorChecks) {
      for (const patch of patches) {
        expect(await changedInput(c, patch)).toMatchObject({ status: 'failed', observed: null });
      }
    }
  });

  it('rejects malformed polynomial coefficients and unsafe outputs', async () => {
    const c = xorCheck('xor-polynomial');
    for (const coefficients of [
      [], [0, 1, -2], [0, 1, 1, -2, 0], [0, 1, 1, NaN],
      [0, 1, 1, Infinity], [0, 1, 1, -1.5], [0, 1, 1, Number.MAX_SAFE_INTEGER + 1],
      [Number.MAX_SAFE_INTEGER, 1, 1, -2], Array(4) as number[],
    ]) {
      expect(await changedInput(c, { coefficients })).toMatchObject({ status: 'failed', observed: null });
    }
    expect((await changedInput(c, { coefficientOrder: 'xy,y,x,1' })).status).toBe('failed');
  });

  it('rejects a different modulus rather than coercing it', async () => {
    const c = xorCheck('xor-parity');
    for (const modulus of [0, 1, 3, -2, 2.5, NaN, Infinity, '2']) {
      expect(await changedInput(c, { modulus })).toMatchObject({ status: 'failed', observed: null });
    }
  });

  it('does not read expected outputs as computation inputs or accept an incomplete observation', async () => {
    for (const c of xorChecks) {
      const corrupted = { ...c, expected: { evaluatedPairs: 4, outputs: [1, 1, 1, 1] } };
      expect(await executeCheck(corrupted, executors[c.id], context)).toMatchObject({
        status: 'failed', observed: { evaluatedPairs: 4, outputs: [0, 1, 1, 0] },
      });
      for (const outputs of [[0, 1, 1], [0, 1, 1, NaN], [0, 1, 1, 1e-15]]) {
        expect((await executeCheck(c, () => ({ evaluatedPairs: 4, outputs }), context)).status).toBe('failed');
      }
      expect((await executeCheck(c, () => ({ outputs: [0, 1, 1, 0] }), context)).status).toBe('failed');
      expect((await executeCheck(c, undefined, context)).status).toBe('unavailable');
    }
  });
});

describe('fail-closed evidence', () => {
  it('never marks commentary or displayed formulas passed, even with an attached executor', async () => {
    for (const kind of ['ai-commentary', 'displayed-formula'] as const) {
      const executor = vi.fn(() => ({ globalFlux: 0 }));
      expect((await executeCheck({ ...check('numerical-flux'), kind }, executor, context)).status).toBe('unavailable');
      expect(executor).not.toHaveBeenCalled();
    }
  });
  it('marks a missing computation unavailable, not passed', async () => {
    const result = await executeCheck(check('symbolic-divergence'), undefined, context);
    expect(result).toMatchObject({ status: 'unavailable', observed: null, executedAt: null });
  });
  it('reports no daemon execution when no adapter exists', async () => {
    expect(await run('daemon-flux')).toMatchObject({ status: 'unavailable', observed: null, executedAt: null });
  });
  it('records thrown and rejected computation failures', async () => {
    for (const executor of [() => { throw new Error('Computation failed'); }, async () => { throw new Error('Worker failed'); }]) {
      expect(await executeCheck(check('symbolic-divergence'), executor, context)).toMatchObject({ status: 'failed', observed: null });
    }
  });
  it('fails missing and incorrect observations, agreement, hashes, estimates and nonfinite values', async () => {
    for (const observed of [undefined, {}, { modelAgreement: true }, { requestHash: 'abc' }, { estimatedFlux: 0 }, { globalFlux: NaN }, { globalFlux: Infinity }, { globalFlux: 1e-4 }]) {
      const result = await executeCheck(check('numerical-flux'), (() => observed) as unknown as Executor, context);
      expect(result.status).toBe('failed');
    }
  });
  it('compares exact checks exactly and numerical checks within tolerance', async () => {
    const exact: FormulaCheck = { ...check('numerical-flux'), tolerance: null };
    expect((await executeCheck(exact, () => ({ globalFlux: 1e-14 }), context)).status).toBe('failed');
    expect((await executeCheck(check('numerical-flux'), () => ({ globalFlux: 1e-14 }), context)).status).toBe('passed');
  });
  it('requires provenance before calling a computation', async () => {
    const executor = vi.fn(() => ({ globalFlux: 0 }));
    expect((await executeCheck(check('numerical-flux'), executor, { ...context, traceId: '' })).status).toBe('failed');
    expect(executor).not.toHaveBeenCalled();
  });
  it('rejects unsupported domains and malformed numerical inputs', async () => {
    const c = check('numerical-flux');
    const patches: FormulaCheck['inputs'][] = [{ domain: 'cube' }, { samples: 0 }, { samples: NaN }, { samples: 1.5 }, { orientation: 'inward' }];
    for (const patch of patches) {
      expect((await executeCheck({ ...c, inputs: { ...c.inputs, ...patch } }, executors[c.id], context)).status).toBe('failed');
    }
  });
  it('shares only the check actually run and creates a fresh trace on rerun', async () => {
    const notify = vi.fn();
    const unsubscribe = subscribeEvidence(notify);
    await runFormulaCheck('symbolic-divergence');
    const first = getEvidenceSnapshot().find(r => r.id === 'symbolic-divergence')!;
    expect(first.status).toBe('passed');
    expect(getEvidenceSnapshot().find(r => r.id === 'symbolic-flux')!.status).toBe('not-run');
    await runFormulaCheck('symbolic-divergence');
    expect(getEvidenceSnapshot().find(r => r.id === first.id)!.traceId).not.toBe(first.traceId);
    expect(notify).toHaveBeenCalledTimes(4);
    unsubscribe();
  });
  it('does not retain a previous success when a new run cannot start', async () => {
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => { throw new Error('Trace unavailable'); });
    await runFormulaCheck('symbolic-divergence');
    expect(getEvidenceSnapshot().find(r => r.id === 'symbolic-divergence')).toMatchObject({ status: 'failed', observed: null, traceId: null });
  });
});
