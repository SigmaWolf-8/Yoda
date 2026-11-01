"""Exercise the real local HTTP forms using disposable archive fixtures."""
import http.client
from pathlib import Path
import re
import tempfile
import threading
import unittest
from urllib.parse import urlencode
from unittest.mock import patch

from client import database
from viewer import create_server


class RetentionHTTPTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        db = database(self.root)
        db.execute("""INSERT INTO objects(source,key,url,size,validator,active,state)
                      VALUES('gebco','gebco_2025/grid.nc','https://example.test/grid',5000,'v1',0,'verified')""")
        db.commit()
        db.close()
        self.file = self.root / "data/gebco/gebco_2025/grid.nc"
        self.file.parent.mkdir(parents=True)
        self.file.write_bytes(b"disposable test bytes")
        self.server = create_server(self.root, 0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.tmp.cleanup()

    def request(self, method, path, form=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        combined = {"Content-Type": "application/x-www-form-urlencoded", "Origin": self.base}
        combined.update(headers or {})
        connection.request(method, path, urlencode(form or {}, doseq=True) if form else None, combined)
        response = connection.getresponse()
        result = response.status, response.read().decode(), dict(response.getheaders())
        connection.close()
        return result

    def csrf(self):
        code, body, headers = self.request("GET", "/retention")
        self.assertEqual(code, 200)
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
        return re.search(r'name="csrf" value="([^"]+)"', body)[1]

    def proposal(self):
        csrf = self.csrf()
        code, body, _ = self.request("POST", "/retention/preview",
                                    {"csrf": csrf, "release": "native:gebco:gebco_2025"})
        self.assertEqual(code, 200)
        self.assertIn("No files have been deleted", body)
        self.assertIn("data/gebco/gebco_2025/grid.nc", body)
        return {"csrf": csrf, "proposal": re.search(r'name="proposal" value="([^"]+)"', body)[1]}

    def test_full_form_flow_confirmation_and_single_use(self):
        form = self.proposal()
        self.assertTrue(self.file.exists())
        code, _, _ = self.request("POST", "/retention/cleanup", form)
        self.assertEqual(code, 409)
        self.assertTrue(self.file.exists())
        form["confirmation"] = "DELETE"
        code, body, _ = self.request("POST", "/retention/cleanup", form)
        self.assertEqual(code, 200)
        self.assertIn("Removed 1 files", body)
        self.assertIn("21 bytes", body)
        self.assertFalse(self.file.exists())
        self.assertEqual(self.request("POST", "/retention/cleanup", form)[0], 409)

    def test_cross_origin_host_and_csrf_cannot_delete(self):
        form = {**self.proposal(), "confirmation": "DELETE"}
        for headers in ({"Origin": "https://example.test"},
                        {"Host": "rebound.example.test"}, {"Sec-Fetch-Site": "cross-site"}):
            self.assertEqual(self.request("POST", "/retention/cleanup", form, headers)[0], 403)
        self.assertEqual(self.request("POST", "/retention/cleanup", {**form, "csrf": "wrong"})[0], 403)
        self.assertTrue(self.file.exists())

    def test_get_cannot_delete_or_reveal_token_to_rebound_host(self):
        self.assertEqual(self.request("GET", "/retention/cleanup?confirmation=DELETE")[0], 404)
        self.assertEqual(self.request("GET", "/retention", headers={"Host": "rebound.test"})[0], 403)
        self.assertTrue(self.file.exists())

    def test_expired_proposal_requires_new_preview(self):
        form = {**self.proposal(), "confirmation": "DELETE"}
        with patch("viewer.time.monotonic", return_value=float("inf")):
            self.assertEqual(self.request("POST", "/retention/cleanup", form)[0], 409)
        self.assertTrue(self.file.exists())

    def test_stale_preview_and_forged_path_do_not_delete(self):
        form = {**self.proposal(), "confirmation": "DELETE", "path": ".yoda-earth/config.json"}
        self.file.write_bytes(b"changed after preview")
        # Even when length stays unchanged, filesystem identity invalidates the proposal.
        code, body, _ = self.request("POST", "/retention/cleanup", form)
        self.assertEqual(code, 409)
        self.assertIn("changed since preview", body)
        self.assertTrue(self.file.exists())

    def test_unknown_proposal_and_invalid_body_fail_closed(self):
        csrf = self.csrf()
        self.assertEqual(self.request("POST", "/retention/cleanup",
                         {"csrf": csrf, "proposal": "not-real", "confirmation": "DELETE"})[0], 409)
        self.assertEqual(self.request("POST", "/retention/preview",
                         {"csrf": csrf, "release": "private"},
                         {"Content-Type": "application/json"})[0], 409)
        self.assertTrue(self.file.exists())


if __name__ == "__main__":
    unittest.main()
