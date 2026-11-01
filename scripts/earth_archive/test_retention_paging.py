"""Bounded review coverage, snapshot consistency and off-page deletion safety."""
import html
import json
import re
from urllib.parse import urlencode
from unittest.mock import patch

from client import database, lock
from retention import scan, preview, cleanup
from retention_store import PAGE_SIZE, Rows
import test_retention_http


class RetentionPagingTests(test_retention_http.RetentionHTTPTests):
    # Inherit the HTTP harness and its safety tests too.
    def add_inventory(self, count=205):
        db = database(self.root)
        for i in range(count):
            key = f"tiles/tile-{i:05}.tif"
            db.execute("""INSERT INTO objects(source,key,url,size,validator,active,state,sha256)
                VALUES('copernicus',?,'https://example.test/source',999999,'v1',1,'verified',?)""",
                       (key, f"{i:064x}"))
            path = self.root / "data/copernicus" / key
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"native")
        db.commit()
        db.close()

    def review(self):
        code, body, _ = self.request("GET", "/retention")
        self.assertEqual(code, 200)
        token = re.search(r'review=([^&"]+)', body)[1]
        return token, body

    def inspect(self, token, kind="references", number=0, **kwargs):
        return self.request("GET", "/retention/inspect?" + urlencode(
            {"review": token, "release": "native:copernicus:copernicus",
             "kind": kind, "page": number}), **kwargs)

    def test_summary_is_small_and_all_details_are_reachable(self):
        self.add_inventory()
        token, body = self.review()
        self.assertLess(len(body.encode()), 12000)
        self.assertIn("205 recorded references", body)
        self.assertIn("1,230 bytes", body)
        self.assertNotIn("tile-00000", body)
        self.assertNotIn("example.test/source", body)
        seen = []
        for number, size in ((0, PAGE_SIZE), (1, PAGE_SIZE), (2, 5)):
            code, body, _ = self.inspect(token, number=number)
            self.assertEqual(code, 200)
            rows = json.loads(html.unescape(re.search(r"<pre>(.*?)</pre>", body, re.S)[1]))
            self.assertEqual(len(rows), size)
            seen.extend(r["key"] for r in rows)
        self.assertEqual(len(set(seen)), 205)
        self.assertEqual(seen, sorted(seen))
        self.assertEqual(self.inspect(token, number=3)[0], 409)
        self.assertEqual(self.inspect(token, number=-1)[0], 409)
        self.assertEqual(self.inspect(token, number="bad")[0], 409)
        code, body, _ = self.inspect(token, kind="files", number=2)
        self.assertEqual(code, 200)
        rows = json.loads(html.unescape(re.search(r"<pre>(.*?)</pre>", body, re.S)[1]))
        self.assertEqual(len(rows), 5)
        self.assertIn("tile-00204.tif", body)

    def test_snapshot_navigation_never_rescans_or_drifts(self):
        self.add_inventory()
        token, _ = self.review()
        db = database(self.root)
        db.execute("DELETE FROM objects WHERE source='copernicus'")
        db.commit()
        db.close()
        with patch("viewer.scan", side_effect=AssertionError("Unexpected rescan")), lock(self.root):
            code, body, _ = self.inspect(token, number=2)
            self.assertEqual(code, 200)
            self.assertIn("tile-00204.tif", body)
            self.assertEqual(self.request("GET", "/retention?review=" + token)[0], 200)
        with lock(self.root):
            self.assertEqual(self.request("GET", "/retention")[0], 409)

    def test_expired_evicted_and_cross_origin_details_fail_closed(self):
        self.add_inventory(1)
        token, _ = self.review()
        for _ in range(4):
            latest, _ = self.review()
        self.assertEqual(self.inspect(token)[0], 409)
        self.assertEqual(self.inspect(latest, headers={"Host": "rebound.test"})[0], 403)
        with patch("viewer.time.monotonic", return_value=float("inf")):
            self.assertEqual(self.inspect(latest)[0], 409)

    def test_off_page_reference_change_invalidates_exact_deletion_list(self):
        self.add_inventory()
        form = {**self.proposal(), "confirmation": "DELETE"}
        db = database(self.root)
        db.execute("UPDATE objects SET validator='changed' WHERE key='tiles/tile-00204.tif'")
        db.commit()
        db.close()
        code, body, _ = self.request("POST", "/retention/cleanup", form)
        self.assertEqual(code, 409)
        self.assertIn("changed since preview", body)
        self.assertTrue(self.file.exists())

    def test_proposal_paging_and_confirmation_cover_every_file(self):
        self.add_inventory()
        db = database(self.root)
        db.execute("UPDATE objects SET active=0 WHERE source='copernicus'")
        db.commit()
        db.close()
        csrf = self.csrf()
        code, body, _ = self.request("POST", "/retention/preview",
            {"csrf": csrf, "release": "native:copernicus:copernicus"})
        self.assertEqual(code, 200)
        self.assertIn("all 205 files", body)
        self.assertEqual(body.count("<li>"), 100)
        token = re.search(r'name="proposal" value="([^"]+)"', body)[1]
        code, body, _ = self.request("GET", f"/retention/proposal?proposal={token}&page=2")
        self.assertEqual(code, 200)
        self.assertEqual(body.count("<li>"), 5)
        self.assertIn("tile-00204.tif", body)
        form = {"csrf": csrf, "proposal": token, "confirmation": "DELETE",
                "path": str(self.file), "page": 2}
        code, body, _ = self.request("POST", "/retention/cleanup", form)
        self.assertEqual(code, 200)
        self.assertIn("Removed 205 files", body)
        self.assertFalse(any((self.root / "data/copernicus").rglob("*.tif")))
        self.assertTrue(self.file.exists())
        self.assertEqual(self.request("GET", f"/retention/proposal?proposal={token}")[0], 409)

    def test_streaming_totals_and_all_errors_are_preserved(self):
        self.add_inventory()
        db = database(self.root)
        # Unsafe paths must remain visible, not be discarded by a page cap.
        db.execute("UPDATE objects SET key='../' || key WHERE source='copernicus'")
        db.commit()
        with scan(self.root, db) as review:
            group = review.groups["native:copernicus:copernicus"]
            self.assertIsInstance(group["references"], Rows)
            # Main file plus each of its three unsafe partial paths.
            self.assertEqual(len(group["errors"]), 820)
            self.assertEqual(len(group["errors"].page(8)[0]), 20)
            self.assertEqual(group["local_bytes"], 0)
            self.assertFalse(group["candidates"])
        with self.assertRaisesRegex(ValueError, "active reference"):
            preview(self.root, db, ["native:gebco:gebco_2025"])
        db.close()

    def test_measurements_beyond_first_page_invalidate_cleanup(self):
        self.add_inventory()
        db = database(self.root)
        proposal = preview(self.root, db, ["native:gebco:gebco_2025"])
        (self.root / "data/copernicus/tiles/tile-00204.tif").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "changed since preview"):
            cleanup(self.root, db, proposal, "DELETE")
        self.assertTrue(self.file.exists())
        db.close()
