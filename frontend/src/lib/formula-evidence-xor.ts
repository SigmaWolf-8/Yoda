import type { Executor, FormulaClaim, FormulaCheck } from './formula-evidence';

const assumptions = [
  'x and y are bits: each is exactly the integer 0 or 1; no coercion or rounding.',
  'XOR is true exactly when its two Boolean inputs differ.',
  'Rows are ordered (0,0), (0,1), (1,0), (1,1), covering the entire declared domain.',
  'Arithmetic is over the integers; modulo uses modulus 2.',
] as const;
const inputs = {
  domain: '{0,1}²',
  xValues: [0, 0, 1, 1],
  yValues: [0, 1, 0, 1],
} as const;
const limitation = 'Exhaustive only for the four Boolean pairs. Does not validate other gates, arbitrary real inputs, ledger neutrality, physical conservation, entropy claims or the sealed document as a whole.';

export const xorClaim: FormulaClaim = {
  id: 'compendium-boolean-xor',
  title: 'Compendium XOR: exhaustive Boolean-domain check',
  formula: 'x,y ∈ {0,1}: x ⊕ y = x + y − 2xy = (x + y) mod 2',
  sources: ['Compendium — unified-sovereign-compendium.html#prolegomena, XII, Aequationes Logicae, XOR equation'],
  assumptions,
  conclusion: 'The fixed Boolean truth table is the independent expectation. Each check must execute before it can pass; no surrounding document claims are certified.',
  checks: [
    {
      id: 'xor-polynomial', title: 'Evaluate the XOR polynomial for all four bit pairs',
      kind: 'deterministic-computation',
      inputs: { ...inputs, coefficientOrder: '1,x,y,xy', coefficients: [0, 1, 1, -2] },
      assumptions,
      expected: { evaluatedPairs: 4, outputs: [0, 1, 1, 0] },
      tolerance: null, limitation,
    },
    {
      id: 'xor-parity', title: 'Evaluate addition modulo 2 for all four bit pairs',
      kind: 'deterministic-computation', inputs: { ...inputs, modulus: 2 },
      assumptions,
      expected: { evaluatedPairs: 4, outputs: [0, 1, 1, 0] },
      tolerance: null, limitation,
    },
  ],
};

function bitPairs(check: FormulaCheck): [number, number][] {
  const { domain, xValues, yValues } = check.inputs;
  if (domain !== inputs.domain || !Array.isArray(xValues) || !Array.isArray(yValues)
    || xValues.length !== 4 || yValues.length !== 4) {
    throw new Error('Exactly four ordered Boolean pairs are required');
  }
  // Check coverage and ordering independently of the recorded expected outputs.
  return Array.from({ length: 4 }, (_, row) => {
    const x = xValues[row];
    const y = yValues[row];
    if ((x !== 0 && x !== 1) || (y !== 0 && y !== 1)) {
      throw new Error('Only integer bits 0 and 1 are supported');
    }
    if (x !== Math.floor(row / 2) || y !== row % 2) {
      throw new Error('Pairs must cover (0,0), (0,1), (1,0), (1,1) in that order');
    }
    return [x, y];
  });
}

export const xorExecutors: Readonly<Record<string, Executor>> = {
  'xor-polynomial': check => {
    const pairs = bitPairs(check);
    const coefficients = check.inputs.coefficients;
    if (check.inputs.coefficientOrder !== '1,x,y,xy' || !Array.isArray(coefficients)
      || coefficients.length !== 4
      || Array.from(coefficients).some(c => !Number.isSafeInteger(c))) {
      throw new Error('Four safe integer coefficients in order 1,x,y,xy are required');
    }
    // BigInt keeps intermediates exact even for deliberately corrupted coefficients.
    const [a, b, c, d] = coefficients.map(value => BigInt(value));
    const outputs = pairs.map(([x, y]) => {
      const value = a + b * BigInt(x) + c * BigInt(y) + d * BigInt(x) * BigInt(y);
      const result = Number(value);
      if (!Number.isSafeInteger(result)) throw new Error('Polynomial output exceeds safe integer range');
      return result;
    });
    return { evaluatedPairs: pairs.length, outputs };
  },
  'xor-parity': check => {
    const pairs = bitPairs(check);
    if (check.inputs.modulus !== 2) throw new Error('Boolean parity requires modulus 2');
    return { evaluatedPairs: pairs.length, outputs: pairs.map(([x, y]) => (x + y) % 2) };
  },
};
