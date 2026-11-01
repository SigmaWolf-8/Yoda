"""Strict native retention gate, separate from installer setup verification."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import sys
import unittest


class EvidenceResult(unittest.TextTestResult):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.cases = []

    def stopTest(self, test):
        super().stopTest(test)
        self.cases.append({
            "test": test.id(),
            "observations": getattr(test, "observations", {}),
        })


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True,
                        help="JSON evidence output (not an archive path)")
    args = parser.parse_args()
    report = {
        "at": datetime.now(timezone.utc).isoformat(),
        "platform": platform.platform(),
        "python": platform.python_version(),
        "commit": os.environ.get("GITHUB_SHA"),
        "native_windows": os.name == "nt",
        "passed": False,
    }
    if os.name != "nt":
        report["error"] = "Native Windows/NTFS required; Linux skips are not verification."
        print(report["error"], file=sys.stderr)
    else:
        suite = unittest.defaultTestLoader.discover(
            str(Path(__file__).resolve().parent), pattern="test_retention_windows.py",
        )
        result = unittest.TextTestRunner(verbosity=2, resultclass=EvidenceResult).run(suite)
        report.update({
            "tests_run": result.testsRun,
            "cases": result.cases,
            "failures": [(t.id(), message) for t, message in result.failures],
            "errors": [(t.id(), message) for t, message in result.errors],
            "skipped": [(t.id(), reason) for t, reason in result.skipped],
            "passed": result.wasSuccessful() and result.testsRun > 0 and not result.skipped,
        })
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
