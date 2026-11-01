/**
 * Executable evidence is intentionally separate from sealed source documents.
 * This is a small, auditable polynomial checker, not a general theorem prover.
 */
export const IMPLEMENTATION_VERSION = 'divergence-flux-polynomial/1';
export const TEST_VERSION = 'formula-evidence-contract/1';
export type EvidenceKind = 'displayed-formula' | 'ai-commentary' | 'deterministic-computation'
  | 'symbolic-reasoning' | 'numerical-check' | 'daemon-execution';
export type CheckStatus = 'not-run' | 'running' | 'passed' | 'failed' | 'unavailable';
export type Observation = Record<string, string | number | boolean | number[]>;
export interface FormulaCheck {
  id: string;
  title: string;
  kind: EvidenceKind;
  inputs: Readonly<Record<string, string | number | readonly number[]>>;
  assumptions: readonly string[];
  expected: Observation;
  tolerance: number | null;
  limitation: string;
}
export interface EvidenceRecord extends FormulaCheck {
  status: CheckStatus;
  observed: Observation | null;
  implementationVersion: string;
  testVersion: string;
  executionLocation: string;
  traceId: string | null;
  executedAt: string | null;
  error: string | null;
}
export interface FormulaClaim {
  id: string;
  title: string;
  formula: string;
  sources: readonly string[];
  assumptions: readonly string[];
  conclusion: string;
  checks: readonly FormulaCheck[];
}
const assumptions = [
  'F=(x²,0,0) is C¹ on a neighborhood of the closed unit ball in R³.',
  'The unit sphere is oriented by its outward unit normal n=(x,y,z).',
  'The divergence theorem relates the global flux to the volume integral, not pointwise divergence.',
] as const;
const inputs = { fieldXCoefficients: [0, 0, 1], fieldY: '0', fieldZ: '0', domain: 'x²+y²+z² ≤ 1', orientation: 'outward' } as const;
export const formulaRegistry: readonly FormulaClaim[] = [{
  id: 'divergence-flux-unit-ball',
  title: 'Divergence–flux gate: global cancellation is not local vanishing',
  formula: 'F=(x²,0,0); ∇·F=2x; ∯∂B F·n dS=0; ∇·F(1/2,0,0)=1',
  sources: ['Codex', 'Forge', 'Compendium'],
  assumptions,
  conclusion: 'Zero global flux does not imply divergence is identically zero. Finite numerical samples cannot prove a universal local statement.',
  checks: [
    {
      id: 'symbolic-divergence', title: 'Differentiate the polynomial field',
      kind: 'symbolic-reasoning', inputs, assumptions,
      expected: { divergenceCoefficients: [0, 2] }, tolerance: null,
      limitation: 'Exact coefficient differentiation for this polynomial only; not a general symbolic proof system.',
    },
    {
      id: 'symbolic-flux', title: 'Check odd flux density under sphere reflection',
      kind: 'symbolic-reasoning', inputs, assumptions,
      expected: { fluxDensityCoefficients: [0, 0, 0, 1], oddUnderXReflection: true, globalFlux: 0 }, tolerance: null,
      limitation: 'Uses the stated mathematical symmetry rule: reflection x↦−x preserves sphere area and reverses an odd integrand.',
    },
    {
      id: 'local-counterexample', title: 'Evaluate an exact interior counterexample',
      kind: 'deterministic-computation', inputs: { ...inputs, point: '(1/2,0,0)', xNumerator: '1', xDenominator: '2' }, assumptions,
      expected: { insideUnitBall: true, divergenceNumerator: '1', divergenceDenominator: '1', identicallyZero: false }, tolerance: null,
      limitation: 'One exact nonzero witness disproves universal vanishing. A finite list of zero samples could not prove it.',
    },
    {
      id: 'numerical-flux', title: 'Numerically integrate the sphere flux',
      kind: 'numerical-check', inputs: { ...inputs, samples: 2048, method: 'Midpoint rule: 2π ∫[-1,1] x³ dx, polar axis x' }, assumptions,
      expected: { globalFlux: 0 }, tolerance: 1e-12,
      limitation: 'Finite IEEE-754 quadrature is a numerical check of the global integral only, never a proof of pointwise divergence.',
    },
    {
      id: 'daemon-flux', title: 'Daemon execution of this check',
      kind: 'daemon-execution', inputs, assumptions, expected: { globalFlux: 0 }, tolerance: null,
      limitation: 'No daemon adapter is registered. Browser execution must not be relabeled as remote execution.',
    },
  ],
}];

// Ascending integer coefficients. The registry deliberately uses small exact integers.
export function derivative(coefficients: readonly number[]): number[] {
  if (!coefficients.length || coefficients.some(c => !Number.isSafeInteger(c))) throw new Error('Invalid exact polynomial');
  const result = coefficients.slice(1).map((c, i) => c * (i + 1));
  if (result.some(c => !Number.isSafeInteger(c))) throw new Error('Polynomial coefficient overflow');
  return result.length ? result : [0];
}
export function isOddPolynomial(coefficients: readonly number[]): boolean {
  return coefficients.every((c, i) => Number.isSafeInteger(c) && (i % 2 === 1 || c === 0));
}
function evaluateRational(coefficients: readonly number[], numerator: bigint, denominator: bigint): [bigint, bigint] {
  let n = 0n;
  let d = 1n;
  for (const c of [...coefficients].reverse()) {
    n = n * numerator + BigInt(c) * d * denominator;
    d *= denominator;
  }
  let a = n < 0n ? -n : n;
  let b = d;
  while (b !== 0n) [a, b] = [b, a % b];
  return [n / a, d / a];
}
export type Executor = (check: FormulaCheck) => Observation | Promise<Observation>;
function fieldFrom(check: FormulaCheck): readonly number[] {
  const field = check.inputs.fieldXCoefficients;
  if (!Array.isArray(field) || check.inputs.fieldY !== '0' || check.inputs.fieldZ !== '0'
    || check.inputs.domain !== inputs.domain || check.inputs.orientation !== 'outward') {
    throw new Error('Unsupported field, domain or orientation');
  }
  derivative(field);
  return field;
}
export const executors: Readonly<Record<string, Executor>> = {
  'symbolic-divergence': check => ({ divergenceCoefficients: derivative(fieldFrom(check)) }),
  'symbolic-flux': check => {
    const field = fieldFrom(check);
    const density = [0, ...field]; // On the unit sphere, F·n = x F_x.
    const odd = isOddPolynomial(density);
    if (!odd) throw new Error('Reflection rule does not establish zero flux');
    return { fluxDensityCoefficients: density, oddUnderXReflection: odd, globalFlux: 0 };
  },
  'local-counterexample': check => {
    const xN = BigInt(check.inputs.xNumerator as string);
    const xD = BigInt(check.inputs.xDenominator as string);
    if (xD <= 0n) throw new Error('Positive denominator required');
    const [n, d] = evaluateRational(derivative(fieldFrom(check)), xN, xD);
    const inside = xN * xN < xD * xD;
    if (!inside || n === 0n) throw new Error('No nonzero interior witness; universal vanishing cannot be decided from a zero sample');
    return { insideUnitBall: inside, divergenceNumerator: n.toString(), divergenceDenominator: d.toString(), identicallyZero: false };
  },
  'numerical-flux': check => {
    const field = fieldFrom(check);
    const samples = check.inputs.samples as number;
    if (!Number.isSafeInteger(samples) || samples < 1 || samples > 1_000_000) throw new Error('Invalid quadrature sample count');
    const dx = 2 / samples;
    let sum = 0;
    for (let i = 0; i < samples; i++) {
      const x = -1 + (i + 0.5) * dx;
      const fx = field.reduce((v, c, power) => v + c * x ** power, 0);
      sum += fx * x * dx * 2 * Math.PI;
    }
    return { globalFlux: sum };
  },
};

export function initialEvidence(check: FormulaCheck): EvidenceRecord {
  return { ...check, status: 'not-run', observed: null, implementationVersion: IMPLEMENTATION_VERSION,
    testVersion: TEST_VERSION, executionLocation: 'Not executed', traceId: null, executedAt: null, error: null };
}
function matches(expected: Observation, observed: Observation, tolerance: number | null): boolean {
  return Object.entries(expected).every(([key, value]) => {
    const actual = observed[key];
    if (typeof value === 'number') return typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - value) <= (tolerance ?? 0);
    if (Array.isArray(value)) return Array.isArray(actual) && value.length === actual.length && value.every((v, i) => v === actual[i]);
    return actual === value;
  });
}
export async function executeCheck(
  check: FormulaCheck,
  executor: Executor | undefined,
  context: { executionLocation: string; traceId: string },
): Promise<EvidenceRecord> {
  const base = { ...initialEvidence(check), ...context };
  if (check.kind === 'displayed-formula' || check.kind === 'ai-commentary') {
    return { ...base, status: 'unavailable', error: 'Displayed formulas and commentary cannot certify a computation' };
  }
  if (!context.traceId || !context.executionLocation) return { ...base, status: 'failed', error: 'Execution provenance is required' };
  if (!executor) return { ...base, status: 'unavailable', error: 'No computation registered; no result or proof is available' };
  const executedAt = new Date().toISOString();
  try {
    const observed = await executor(check);
    if (!observed || typeof observed !== 'object') throw new Error('Computation returned no observation');
    const passed = matches(check.expected, observed, check.tolerance);
    return { ...base, executedAt, observed, status: passed ? 'passed' : 'failed', error: passed ? null : 'Observed result does not match the expected result' };
  } catch (error) {
    return { ...base, executedAt, status: 'failed', error: error instanceof Error ? error.message : 'Computation failed' };
  }
}

/** No check in this registry is a proof that divergence vanishes universally. */
export function evidenceConclusion(evidence: readonly EvidenceRecord[]): string {
  const witness = evidence.find(record => record.id === 'local-counterexample' && record.status === 'passed'
    && record.observed?.identicallyZero === false);
  if (witness) return 'Disproved: divergence is not identically zero (exact nonzero interior witness).';
  return 'Not established: global flux, finite samples, AI agreement and request hashes cannot prove universal local vanishing.';
}

let records: readonly EvidenceRecord[] = formulaRegistry.flatMap(claim => claim.checks.map(initialEvidence));
const listeners = new Set<() => void>();
export const getEvidenceSnapshot = () => records;
export const subscribeEvidence = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function update(record: EvidenceRecord) {
  records = records.map(old => old.id === record.id ? record : old);
  listeners.forEach(listener => listener());
}
export async function runFormulaCheck(id: string): Promise<void> {
  const check = formulaRegistry.flatMap(claim => claim.checks).find(item => item.id === id);
  if (!check) throw new Error(`Unknown formula check: ${id}`);
  if (records.find(record => record.id === id)?.status === 'running') return;
  // A fresh run never inherits a previous success.
  update({ ...initialEvidence(check), status: 'running' });
  try {
    const traceId = crypto.randomUUID();
    update(await executeCheck(check, executors[id], { traceId, executionLocation: 'Browser / JavaScript (this tab); no daemon' }));
  } catch (error) {
    update({ ...initialEvidence(check), status: 'failed', error: error instanceof Error ? error.message : 'Could not start check' });
  }
}
