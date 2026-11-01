# Formula evidence registry

The application attaches supplemental evidence outside the sealed Codex,
Compendium, and Forge content. The initial registered claim is the divergence–flux
counterexample on the unit ball. Registration does not certify other claims in
those documents.

## Reproduce

In any of the three pages, open **Formula evidence** and run an individual check
or all registered checks. Evidence is shared across navigation in the current
tab only, resets on reload, and can be exported as JSON. Export before reloading
if a record is needed. Trace IDs identify runs; they are not cryptographic
attestations or proofs. A browser can be modified by its operator, so exports
are not trusted remote execution receipts.

Run the same implementations and their negative tests from the repository:

```sh
cd frontend
npm test -- src/lib/__tests__/formula-evidence.test.ts
```

The source registry and executors live in `src/lib/formula-evidence.ts`.
Implementation and test contract versions are included in each record; bump them
when changing algorithms, inputs, or acceptance criteria. No model, network
service, daemon, timing estimate, or hash is used to compute these results.

## Mathematical scope

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

Displayed formulas and AI commentary are not execution evidence. Symbolic
reasoning, deterministic evaluation, and finite numerical checks have distinct
scope. Daemon execution is unavailable until a real adapter exists; a local
result cannot stand in for it. “Passed” applies only to a specific executed
check and its recorded expectation, not to the document as a whole.
