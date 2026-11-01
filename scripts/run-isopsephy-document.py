#!/usr/bin/env python3
"""Bounded adapter around the supplied canonical engine; no rewritten algorithms."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import runpy
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / "frontend/public/capomastro/engines/arc182/engine/isopsephy_engine_v0_0_20.py"

def exact_json(value):
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, int):
        return str(value)
    if isinstance(value, dict):
        return {str(k): exact_json(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [exact_json(v) for v in value]
    return value

def main():
    text = sys.stdin.read(8193)
    if not text.strip() or len(text.encode()) > 8192:
        raise ValueError("Provide between 1 and 8192 UTF-8 bytes")
    # The canonical top-level assertions execute when this module loads.
    with contextlib.redirect_stdout(io.StringIO()):
        engine = runpy.run_path(str(ENGINE), run_name="canonical_isopsephy")
        tokens = engine["ingest"](text)
        if not tokens or len(tokens) > 1000 or len(set(w.lower() for w in tokens)) > 256:
            raise ValueError("Use 1–1000 recognized words with at most 256 distinct tokens")
        with tempfile.TemporaryDirectory(prefix="arc182-") as directory:
            source = Path(directory) / "document.txt"
            source.write_text(text)
            _, words, ledger = engine["analyze"](str(source))
            # No absent English gloss is invented; canonical fallback is retained.
            engine["attach_gloss"](ledger, {})
            report = Path(engine["emit_html"](ledger, words, "Operator document", directory)).read_text()
    payload = {
        "source_sha256": hashlib.sha256(ENGINE.read_bytes() + Path(__file__).read_bytes()).hexdigest(),
        "canonical_sha256": hashlib.sha256(ENGINE.read_bytes()).hexdigest(),
        "report_html": report,
        "result": {
            "status": "pass", "method": "Supplied canonical Python ingest → transliterate → analyze → emit_html; module assertions executed",
            "scope": "This source document under the supplied engine mappings. No AI call, translation service, survey or transaction.",
            "outputs": {"word_count": str(len(words)), "distinct_words": str(len(ledger)), "ledger": exact_json(ledger),
                        "canonical_source": "/capomastro/engines/arc182/engine/isopsephy_engine_v0_0_20.py"},
            "checks": [{"name": "Canonical module assertions completed", "passed": True, "actual": "completed without AssertionError", "expected": "completed without AssertionError"}],
            "limitations": [
                "The canonical tokenizer retains Latin/Greek word sequences of at least two characters; punctuation, digits and unsupported scripts are not analyzed.",
                "No external English gloss was supplied. English-register fallback retains the original token; it is not a translation.",
                "The generated report recomputes its own browser assertions; those are not claimed to have run by this server record.",
                "A completed computation does not validate symbolic interpretations, Earth observations, legal claims or every Codex formula."
            ]
        }
    }
    print(json.dumps(payload, ensure_ascii=False))

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": f"{type(error).__name__}: {error}"}, ensure_ascii=False))
        raise SystemExit(1)
