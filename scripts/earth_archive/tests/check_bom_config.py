"""Run the REAL client's config reader offline against PS5.1-generated JSON."""
import argparse
import json
from pathlib import Path
import socket
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import client

root = Path(sys.argv[1]).resolve()
assert (root.parent / "EARTH_INSTALLER_TEST_ONLY").is_file()
raw = (root / ".yoda-earth" / "config.json").read_bytes()
assert raw.startswith(b"\xef\xbb\xbf"), "PS5.1 must write a UTF-8 BOM"
config = json.loads(raw.decode("utf-8-sig"))
assert config["installation"] == "windows-ci-fixture"
args = argparse.Namespace(target=str(root), refresh=True, verify=False)

# A source regression cannot quietly start discovery, downloading or reporting.
def forbidden(*args, **kwargs):
    raise AssertionError("Network/acquisition is forbidden in the BOM test")


with (
    patch.object(socket.socket, "connect", forbidden),
    patch.object(client.urllib.request, "urlopen", forbidden),
    patch.object(client, "download", side_effect=forbidden),
    patch.object(client, "inventory") as inventory,
    patch.object(client, "sync_engine") as engine,
    patch.dict(client.os.environ, {}, clear=True),
):
    result = client.run(args)
    assert result == 2, f"Expected incomplete empty fixture, got {result}"
    inventory.assert_called_once()
    engine.assert_called_once()
    assert engine.call_args.args[2] == config["base"]
print("PASS: real client read the Windows UTF-8 BOM configuration offline")
