# Formula evidence registry

The application attaches supplemental evidence outside the sealed Codex,
Compendium, and Forge content. Registered claims are the divergence–flux
counterexample on the unit ball and the Compendium's Boolean XOR identity.
Registration does not certify other claims in those documents. All sealed
source files remain unchanged.

## Reproduce

In any of the three pages, open **Formula evidence** and run an individual check
or all registered checks. Current results remain local to the tab. Each completed
attempt is also submitted to **private browser run history** when signed in.
Saved history survives closing the browser and is loaded independently of the
current registry: an old success is never assigned to a newly loaded check.
Compare two saved runs to inspect their original inputs, implementation and test
versions, results, assumptions, limitations and errors. More history is available
through cursor pagination. History exports cover the loaded records only.

Saving and calculation are separate operations. A passed calculation is not
necessarily saved. Failed requests are shown as unconfirmed/unsaved, with a retry
that reuses the same submission ID rather than rerunning the calculation. Export
unsaved attempts before leaving the view or reloading. Checks and current JSON
export remain available without signing in; private history does not use the
app's anonymous sovereign-account fallback.

Trace and submission IDs identify attempts, not cryptographic attestations or
proofs. All browser records (including their version and location claims) are
**client-submitted, unverified evidence**, never trusted daemon receipts. The
server's receipt timestamp records when it stored a report, not when a computation
ran. Source claim snapshots are supplemental reference metadata; no sealed source
document is edited.

Run the same implementations and their negative tests from the repository:

```sh
cd frontend
npm test -- src/lib/__tests__/formula-evidence.test.ts
npm test -- src/lib/__tests__/browser-formula-history.test.ts src/components/formula-evidence/BrowserEvidenceHistory.test.tsx
```

The source registry and divergence executors live in `src/lib/formula-evidence.ts`;
the XOR claim and executors live in `src/lib/formula-evidence-xor.ts`.
Implementation and test contract versions are included in each record; bump them
when changing algorithms, inputs, or acceptance criteria. No model, network
service, daemon, timing estimate, or hash is used to compute these results.

Backend storage tests use an isolated temporary PostgreSQL schema and remove it
after the test. They require the development `DATABASE_URL` and verify owner
isolation, immutable snapshots across version changes, failure/unavailable
records, retry conflicts, database append-only enforcement and pagination:

```sh
cargo test -p yoda-api --test browser_formula_history
```

## Browser history API and storage

`POST /api/formula-evidence/browser-runs` accepts a 64 KiB maximum JSON body:
`{ submissionId, claim: { id, title, formula, sources }, record: EvidenceRecord }`.
Only terminal statuses (`passed`, `failed`, `unavailable`) are accepted. Unknown
top-level ownership/provenance fields are rejected. A browser cannot submit a
passed daemon-execution, commentary or displayed-formula record. This structural
validation does **not** verify the truth of an observation.

`GET /api/formula-evidence/browser-runs?before=<cursor>` returns
`{ runs, nextCursor }`, up to 50 records per page, ordered by server insertion
sequence. Both routes require a validated bearer session/token or API key and
current organization membership. Reads and writes are scoped to both user and
organization, not merely organization; anonymous owner fallback is not allowed.
Responses are private/no-store.

The server wraps the unchanged submission in server-generated ID, receipt time,
schema version, and `provenance: "client-submitted-unverified"`,
`daemonReceipt: false`. The separate `browser_formula_runs` table prevents mixing
these reports with the existing server-calculation history. The database rejects
UPDATE, DELETE and TRUNCATE. Reposting identical content with the same submission
ID is idempotent; changing content under that ID returns 409. New attempts use new
IDs even when check IDs and inputs are identical.

This change does not alter the existing server-generated `/formula-evidence/runs`
flow or claim that its authentication/storage contract matches browser history.

## Divergence–flux mathematical scope

For F=(x²,0,0), coefficient differentiation gives div F=2x. On the
unit sphere the outward normal is (x,y,z), hence F·n=x³. The executable
symbolic check verifies that this polynomial is odd in x; the stated symmetry
rule then gives zero global flux because reflection preserves surface area.
This is a limited polynomial/symmetry argument, not a general theorem prover.

Exact rational evaluation at (1/2,0,0), strictly inside the ball, gives
div F=1. This disproves universal local vanishing, despite zero global flux.
The numerical check separately evaluates the midpoint rule for
2π∫[-1,1]x³dx using 2048 samples and absolute tolerance 1e-12. It measures
only that finite approximation. No finite collection of zero samples proves
that divergence vanishes everywhere.

## Boolean XOR mathematical scope

**Source:** `frontend/public/capomastro/docs/unified-sovereign-compendium.html`,
anchor `#prolegomena`, section XII, “Aequationes Logicae”, the **XOR** equation:
`x ⊕ y = x + y − 2xy`, implying `x ⊕ y ≡ x + y (mod 2)`.
This claim is selected because its explicitly binary domain is finite and can
be exhausted, unlike a general continuous or physical assertion. The same
supplement is visible in Codex, Forge and Compendium; this attribution is to
the Compendium equation, not a claim that each source contains that equation.

### Inputs, assumptions and independent expectations

The domain is exactly `{0,1}²`, with numeric integer bits (not strings,
booleans or rounded real values). The ordered input arrays are
`xValues=[0,0,1,1]`, `yValues=[0,1,0,1]`. Both checks reject missing,
duplicated or reordered rows; a subset is not exhaustive evidence.

The independent oracle is the Boolean definition: exclusive OR is true
exactly when the two inputs differ. The expected outputs are written down
before execution, not generated by either arithmetic implementation:

| x | y | Expected XOR bit |
|---|---|------------------|
| 0 | 0 | 0 |
| 0 | 1 | 1 |
| 1 | 0 | 1 |
| 1 | 1 | 0 |

Both observations must contain `evaluatedPairs: 4` and
`outputs: [0,1,1,0]`. Comparison is exact, with no numerical tolerance.

### Executable algorithms and acceptance

- **xor-polynomial:** read coefficients `[0,1,1,-2]` in order `1,x,y,xy`;
  evaluate `a + bx + cy + dxy` for each validated pair with BigInt integer
  arithmetic. Require safe integer coefficients and outputs, then serialize
  outputs as numbers. The executor reads the recorded coefficients, never
  the expected result.
- **xor-parity:** require modulus exactly `2`, add each validated pair and
  compute its integer remainder. These nonnegative sums are at most `2`, so
  JavaScript remainder coincides with mathematical modulo and is exact.

Neither check is initially passed. Only execution followed by comparison
against the independent expectation produces passed status, separately for
each check, with inputs, assumptions, versions, location, timestamp and trace.
Implementation version is `formula-evidence/2`; test contract is
`formula-evidence-contract/2`.

Negative tests reject non-bits, nonfinite/fractional values, coercible strings
and booleans, incomplete/duplicate/reordered domains, sparse arrays, wrong
coefficient counts/order, unsafe arithmetic, and unsupported moduli.
Changing the interaction coefficient's sign or removing it produces an
observed mismatch, not a pass. Tampering with expected outputs also fails:
the algorithm continues to produce its own result. Truncated/nonfinite or
slightly wrong observations fail exact comparison. A missing executor is
recorded as unavailable, never passed.

**Limitations:** exhaustive coverage establishes agreement for this four-case
Boolean domain only. It says nothing about arbitrary real inputs, other
logical gates, the surrounding “net balance is strictly null” statement,
ledger neutrality, physical conservation, entropy, legal status or the
document as a whole. It does not affect the separate divergence–flux conclusion.
These are local deterministic computations, not daemon or server executions.
The browser registry and its unverified saved history remain separate from
the server-calculated formula panel.

## Evidence boundaries

Displayed formulas and AI commentary are not execution evidence. Symbolic
reasoning, deterministic evaluation, and finite numerical checks have distinct
scope. Daemon execution is unavailable until a real adapter exists; a local
result cannot stand in for it. “Passed” applies only to a specific executed
check and its recorded expectation, not to the document as a whole.
