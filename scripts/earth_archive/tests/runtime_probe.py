"""Run with the private interpreter; imports only, never acquire data."""
import ctypes
import json
from pathlib import Path
import sqlite3
import ssl
import sys

import acquire
import launch
import retention
import retention_store
import retention_ui
import viewer

private = Path(__file__).resolve().parent
assert Path(sys.executable).parent == private / "runtime-3.13.17"
assert sys.version_info[:3] == (3, 13, 17)
assert sys.flags.isolated == 1
ssl.create_default_context()
with sqlite3.connect(":memory:") as db:
    assert db.execute("select 27").fetchone()[0] == 27
kernel = ctypes.WinDLL("kernel32", use_last_error=True)
assert kernel.GetCurrentProcessId() > 0
for module in (acquire, launch, retention, retention_store, retention_ui, viewer):
    assert Path(module.__file__).resolve().parent == private
print(json.dumps({
    "executable": sys.executable,
    "version": sys.version,
    "isolated": sys.flags.isolated,
    "ssl": ssl.OPENSSL_VERSION,
    "sqlite": sqlite3.sqlite_version,
    "ctypes": True,
    "local_modules": True,
}))
