"""Inert Windows runner payload. Never imports acquisition code or uses a network."""
import argparse
import ctypes
import json
import os
from pathlib import Path
import sys
import time
import uuid

parser = argparse.ArgumentParser()
parser.add_argument("--target", required=True)
parser.add_argument("--serve", action="store_true")
parser.add_argument("--verify", action="store_true")
args = parser.parse_args()
root = Path(args.target).resolve()
assert (root.parent / "EARTH_INSTALLER_TEST_ONLY").is_file()
assert root.name in ("archive target with spaces", "rejected target with spaces")
private = root / ".yoda-earth"
config = json.loads((private / "config.json").read_text(encoding="utf-8-sig"))
assert config["base"].startswith("http://127.0.0.1:")
assert config["installation"] == "windows-ci-fixture"
control = json.loads((root.parent / "control.json").read_text(encoding="utf-8-sig"))
token = os.environ.get("YODA_ARCHIVE_REPORT_TOKEN")
record = {
    "pid": os.getpid(),
    "executable": sys.executable,
    "isolated": sys.flags.isolated,
    "serve": args.serve,
    "verify": args.verify,
    "target": args.target,
    "token_ok": token == "earth-ci-dummy-not-a-credential" if not args.serve else token is None,
    "elevated": bool(ctypes.windll.shell32.IsUserAnAdmin()),
}
# Atomic evidence, with no credential value or source content in logs.
event = root.parent / "events" / f"{os.getpid()}-{uuid.uuid4().hex}.json"
pending = event.with_suffix(".tmp")
pending.write_text(json.dumps(record), encoding="utf-8")
pending.replace(event)
print("fixture stdout", flush=True)
print("fixture stderr (not a terminating PowerShell error)", file=sys.stderr, flush=True)
if control["hold"]:
    time.sleep(120)  # Hard bound even if Task Scheduler cleanup fails.
sys.exit(control["exit_code"])
