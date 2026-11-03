"""Serve only explicitly staged fixture bytes, bound to an ephemeral loopback port."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
assert (root / "EARTH_INSTALLER_TEST_ONLY").is_file()
allowed = {"client.py", "acquire.py", "viewer.py", "retention.py", "retention_ui.py",
           "retention_store.py", "launch.py", "GUIDE.txt", "corrupt-runtime.zip"}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        prefix = "/api/earth-archive/files/"
        name = self.path.removeprefix(prefix)
        if not self.path.startswith(prefix) or name not in allowed:
            self.send_error(404)
            return
        data = (root / "served" / name).read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        self.send_error(405, "Reporting is forbidden in installer fixtures")

    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
(root / "port.txt").write_text(str(server.server_port), encoding="ascii")
server.serve_forever()
