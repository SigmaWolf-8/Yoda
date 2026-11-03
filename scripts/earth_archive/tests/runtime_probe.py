"""Run with the private interpreter; imports only, never acquire data."""
import ctypes
import importlib.util
import json
from pathlib import Path
import sqlite3
import ssl
import sys

# Viewer/retention import the client's library functions. The scheduled client
# remains inert; load an unchanged copy of the real client in THIS probe only.
# No sys.path changes: all other imports must resolve through the embedded _pth.
private = Path(__file__).resolve().parent


def no_external_work(event, args):
    if event in ("socket.connect", "urllib.Request", "subprocess.Popen"):
        raise AssertionError("Runtime import probe must not acquire, report or spawn")


sys.addaudithook(no_external_work)
spec = importlib.util.spec_from_file_location("client", private / "_real_client_probe.py")
client = importlib.util.module_from_spec(spec)
sys.modules["client"] = client
spec.loader.exec_module(client)

import acquire
import launch
import retention
import retention_store
import retention_ui
import viewer

assert Path(sys.executable).parent == private / "runtime-3.13.17"
assert sys.version_info[:3] == (3, 13, 17)
assert sys.flags.isolated == 1
ssl.create_default_context()
with sqlite3.connect(":memory:") as db:
    assert db.execute("select 27").fetchone()[0] == 27
kernel = ctypes.WinDLL("kernel32", use_last_error=True)
assert kernel.GetCurrentProcessId() > 0
for module in (client, acquire, launch, retention, retention_store, retention_ui, viewer):
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
