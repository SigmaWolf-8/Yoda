"""Retention tests use temporary fixture files, never the operator's archive."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from client import database, get, inventory, lock, put, sync_engine
from retention import cleanup, preview, scan


class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.db = database(self.root)
        self.old = "native:gebco:gebco_2025"
        self.current = "native:gebco:gebco_2026"

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def file(self, name, content=b"local bytes"):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def native(self, release="2025", name="grid.nc", active=0):
        key = f"gebco_{release}/{name}"
        self.db.execute("""INSERT INTO objects(source,key,url,size,validator,epoch,active,state,sha256)
                           VALUES('gebco',?,'https://example.test/grid',999999,'v1','old',?,'verified','hash')""",
                        (key, active))
        self.db.commit()
        return self.file("data/gebco/" + key)

    def engine(self, digit, selected=False):
        digest = digit * 64
        self.file(f"engines/{digest}.zip", b"package")
        self.file(f"engines/{digest}/isopsephy_package/main.html", b"engine")
        if selected:
            put(self.db, "engine", {"sha256": digest})
        return "engine:" + digest

    def test_dry_run_measures_local_bytes_and_references_without_deleting(self):
        old = self.native()
        active = self.native("2026", active=1)
        partial = self.file("data/gebco/gebco_2025/grid.nc.part", b"partial")
        meta = self.file("data/gebco/gebco_2025/grid.nc.part.json", b"resume metadata")
        private = self.file(".yoda-earth/config.json", b"private configuration")
        before = list(self.db.execute("SELECT * FROM objects"))
        report = scan(self.root, self.db)
        retired = next(g for g in report if g["id"] == self.old)
        self.assertEqual(retired["state"], "retired")
        self.assertEqual(retired["local_bytes"], old.stat().st_size + partial.stat().st_size + meta.stat().st_size)
        self.assertEqual(retired["references"][0]["url"], "https://example.test/grid")
        proposal = preview(self.root, self.db, [self.old])
        self.assertEqual(proposal["bytes"], len(b"local bytes"))
        self.assertEqual(len(proposal["files"]), 1)
        self.assertEqual(list(self.db.execute("SELECT * FROM objects")), before)
        self.assertTrue(all(p.exists() for p in (old, active, partial, meta, private)))

    def test_cleanup_only_retired_objects_and_unselected_engines(self):
        old = self.native()
        active = self.native("2026", active=1)
        unselected = self.engine("a")
        selected = self.engine("b", True)
        partial = self.file("engines/" + "a" * 64 + "/unfinished.part", b"resume")
        native_partial = self.file("data/gebco/gebco_2025/grid.nc.part")
        private = self.file(".yoda-earth/report-token.dpapi", b"fixture only")
        unknown = self.file("data/gebco/gebco_2025/unknown.nc")
        proposal = preview(self.root, self.db, [self.old, unselected])
        with self.assertRaises(ValueError):
            cleanup(self.root, self.db, proposal, "")
        self.assertTrue(old.exists())
        result = cleanup(self.root, self.db, proposal, "DELETE")
        self.assertEqual(result["removed_bytes"], len(b"local bytespackageengine"))
        self.assertEqual(result["removed_files"], 3)
        self.assertEqual(result["errors"], [])
        self.assertEqual(result["reclaimed_allocated_bytes"], proposal["allocated_bytes"])
        self.assertFalse(old.exists())
        self.assertTrue(all(p.exists() for p in (active, partial, native_partial, private, unknown)))
        self.assertEqual(get(self.db, "engine")["sha256"], selected.split(":")[1])
        self.assertTrue((self.root / "engines" / ("b" * 64 + ".zip")).exists())
        self.assertEqual(self.db.execute("SELECT state FROM objects WHERE active=0").fetchone()[0], "removed")
        self.assertEqual(get(self.db, "last_cleanup"), result)

    def test_active_and_mixed_releases_and_selected_engines_are_rejected(self):
        self.native(active=1)
        self.native(name="other.nc", active=0)
        selected = self.engine("b", True)
        for identity in (self.old, selected, "native:unknown:private"):
            with self.assertRaises(ValueError):
                preview(self.root, self.db, [identity])

    def test_missing_files_are_not_catalogue_savings(self):
        self.native().unlink()
        group = scan(self.root, self.db)[0]
        self.assertEqual(group["local_bytes"], 0)
        self.assertEqual(group["missing"], 1)
        with self.assertRaises(ValueError):
            preview(self.root, self.db, [self.old])

    def test_stale_proposal_on_file_change(self):
        path = self.native()
        proposal = preview(self.root, self.db, [self.old])
        path.write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "changed"):
            cleanup(self.root, self.db, proposal, "DELETE")
        self.assertTrue(path.exists())

    def test_stale_proposal_on_reactivation(self):
        path = self.native()
        proposal = preview(self.root, self.db, [self.old])
        self.db.execute("UPDATE objects SET active=1")
        self.db.commit()
        with self.assertRaises(ValueError):
            cleanup(self.root, self.db, proposal, "DELETE")
        self.assertTrue(path.exists())

    def test_engine_selection_change_invalidates_proposal(self):
        identity = self.engine("a")
        proposal = preview(self.root, self.db, [identity])
        put(self.db, "engine", {"sha256": "a" * 64})
        with self.assertRaises(ValueError):
            cleanup(self.root, self.db, proposal, "DELETE")
        self.assertTrue((self.root / "engines" / ("a" * 64 + ".zip")).exists())

    def test_partial_deletion_failure_reports_only_actual_results(self):
        one = self.native(name="one.nc")
        two = self.native(name="two.nc")
        proposal = preview(self.root, self.db, [self.old])
        unlink = Path.unlink

        def selective(path, *args, **kwargs):
            if path == two:
                raise PermissionError("Fixture file in use")
            return unlink(path, *args, **kwargs)

        with patch.object(Path, "unlink", selective):
            result = cleanup(self.root, self.db, proposal, "DELETE")
        self.assertEqual(result["removed_files"], 1)
        self.assertEqual(result["removed_bytes"], len(b"local bytes"))
        self.assertEqual(len(result["errors"]), 1)
        self.assertFalse(one.exists())
        self.assertTrue(two.exists())

    def test_empty_engine_folders_removed_but_no_unknown_or_partial_files(self):
        identity = self.engine("a")
        proposal = preview(self.root, self.db, [identity])
        result = cleanup(self.root, self.db, proposal, "DELETE")
        self.assertFalse((self.root / "engines" / ("a" * 64)).exists())
        self.assertEqual(result["removed_empty_directories"], 2)

    def test_incomplete_retained_engine_is_not_selected(self):
        from test_acquire import Response
        digest = "a" * 64
        self.file(f"engines/{digest}/unfinished.part")
        manifest = {"archiveSha256": digest, "files": [{"path": "main.html", "sha256": "b" * 64}]}
        with patch("client.open_url", return_value=Response(json.dumps(manifest).encode())):
            with self.assertRaisesRegex(ValueError, "incomplete"):
                sync_engine(self.root, self.db, "https://example.test")
        self.assertIsNone(get(self.db, "engine"))

    def test_worker_lock_blocks_scan_and_cleanup(self):
        path = self.native()
        proposal = preview(self.root, self.db, [self.old])
        with lock(self.root):
            with self.assertRaises(OSError):
                preview(self.root, self.db, [self.old])
            with self.assertRaises(OSError):
                cleanup(self.root, self.db, proposal, "DELETE")
        self.assertTrue(path.exists())

    def test_links_and_unsafe_paths_are_excluded(self):
        path = self.native()
        outside = self.file("outside.nc")
        path.unlink()
        try:
            path.symlink_to(outside)
        except OSError:
            self.skipTest("Symlink permission is not available")
        self.assertTrue(scan(self.root, self.db)[0]["errors"])
        with self.assertRaises(ValueError):
            preview(self.root, self.db, [self.old])
        self.db.execute("UPDATE objects SET key='../.yoda-earth/config.json'")
        self.db.commit()
        self.assertTrue(scan(self.root, self.db)[0]["errors"])
        self.assertTrue(outside.exists())

    def test_hardlinks_are_protected_and_not_counted_as_savings(self):
        path = self.native()
        os.link(path, self.root / "other-reference")
        with self.assertRaises(ValueError):
            preview(self.root, self.db, [self.old])
        self.assertTrue(path.exists())

    def test_engine_junction_flag_is_rejected_without_following(self):
        # Windows reparse-point attribute, exercised without requiring Windows.
        from retention import checked_path
        real = Path.lstat

        def reparse(path):
            info = real(path)
            if path.name == "engines":
                from types import SimpleNamespace
                return SimpleNamespace(st_mode=info.st_mode, st_file_attributes=0x400)
            return info

        self.engine("a")
        with patch.object(Path, "lstat", reparse), self.assertRaises(ValueError):
            checked_path(self.root, "engines/" + "a" * 64)

    def test_daily_inventory_retires_but_does_not_delete(self):
        old = self.native(active=1)
        item = {"source": "gebco", "key": "gebco_2026/grid.nc", "url": "https://example.test/grid",
                "size": 100, "validator": "v2", "md5": None}
        with patch("client.gebco", return_value=iter([item])), \
             patch("client.copernicus", return_value=iter([])), \
             patch("client.egm2008", return_value=iter([])):
            inventory(self.db, lambda *args: None)
        self.assertTrue(old.exists())
        self.assertEqual(self.db.execute("SELECT active FROM objects WHERE key LIKE 'gebco_2025/%'").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
