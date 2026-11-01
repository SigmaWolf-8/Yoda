"""Real Windows/NTFS integration tests, never operator archives or mocks.

Portable discovery skips this class on non-Windows hosts. The dedicated runner
rejects non-Windows hosts and any skipped test rather than reporting a false pass.
"""
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from client import database, get, put
from retention import checked_path, cleanup, preview, scan

if os.name == "nt":
    from windows_retention_fixtures import allocated, compressed, handle, require_ntfs, sparse


@unittest.skipUnless(os.name == "nt", "Requires native Windows and NTFS")
class WindowsRetentionTests(unittest.TestCase):
    def setUp(self):
        self.observations = {}
        temporary = tempfile.TemporaryDirectory(prefix="yoda-retention-test-")
        self.addCleanup(temporary.cleanup)
        self.sandbox = Path(temporary.name)
        require_ntfs(self.sandbox)
        self.root = self.sandbox / "archive"
        self.root.mkdir()
        self.db = database(self.root)
        self.addCleanup(self.db.close)
        self.old = "native:gebco:Retired"

    def file(self, relative, content=b"disposable fixture"):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def reference(self, key, active=0):
        self.db.execute(
            """INSERT INTO objects(source,key,url,size,validator,epoch,active,state,sha256)
               VALUES('gebco',?,'https://example.test/fixture',999999999,'v1','fixture',
                      ?,'verified','fixture-hash')""",
            (key, active),
        )
        self.db.commit()

    def native(self, name, release="Retired", active=0):
        key = release + "/" + name
        self.reference(key, active)
        return self.file("data/gebco/" + key)

    def state(self, path):
        key = path.relative_to(self.root / "data" / "gebco").as_posix()
        return tuple(self.db.execute(
            "SELECT state,sha256 FROM objects WHERE source='gebco' AND key=?", (key,)
        ).fetchone())

    def snapshot(self, paths):
        return {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}

    def assert_preserved(self, snapshot):
        self.assertEqual(self.snapshot(snapshot), snapshot)

    def assert_result(self, result, removed, sizes, allocations):
        self.assertEqual(result["removed_files"], len(removed))
        self.assertEqual(result["removed_bytes"], sum(sizes[p] for p in removed))
        self.assertEqual(result["reclaimed_allocated_bytes"], sum(allocations[p] for p in removed))
        for path in removed:
            self.assertFalse(path.exists(), str(path))
            self.assertEqual(self.state(path), ("removed", None))
        self.assertIsInstance(result["free_space_delta_bytes"], int)
        self.assertEqual(get(self.db, "last_cleanup"), result)

    def test_sparse_and_compressed_savings_match_native_allocation(self):
        paths = [self.native("sparse.nc"), self.native("compressed.nc"), self.native("normal.nc")]
        sparse(paths[0])
        compressed(paths[1])
        # Large enough not to be an NTFS resident file.
        paths[2].write_bytes(os.urandom(128 * 1024 + 1))
        sizes = {p: p.stat().st_size for p in paths}
        allocations = {p: allocated(p) for p in paths}
        self.observations["files"] = [
            {"name": p.name, "logical_bytes": sizes[p], "allocated_bytes": allocations[p],
             "attributes": p.stat().st_file_attributes}
            for p in paths
        ]
        for path in paths[:2]:
            self.assertGreater(allocations[path], 0)
            self.assertLess(allocations[path], sizes[path] // 2)
        self.assertFalse(paths[2].stat().st_file_attributes & (0x200 | 0x800))
        self.assertGreater(allocations[paths[2]], sizes[paths[2]],
                           "An unaligned ordinary NTFS file uses whole allocation units")

        active_sparse = self.native("active-sparse.nc", "Active", 1)
        active_compressed = self.native("active-compressed.nc", "Active", 1)
        sparse(active_sparse)
        compressed(active_compressed)
        protected = [
            active_sparse, active_compressed,
            self.file("data/gebco/Retired/sparse.nc.part"),
            self.file("data/gebco/Retired/sparse.nc.part.json"),
            self.file("data/gebco/Retired/unknown.nc"),
            self.file(".yoda-earth/config.json"),
            self.file(".yoda-earth/report-token.dpapi"),
            self.file("engines/" + "b" * 64 + "/main.html"),
        ]
        put(self.db, "engine", {"sha256": "b" * 64})
        snapshot = self.snapshot(paths + protected)
        proposal = preview(self.root, self.db, [self.old])
        self.assertEqual(proposal["bytes"], sum(sizes.values()))
        self.assertEqual(proposal["allocated_bytes"], sum(allocations.values()))
        for item in proposal["files"]:
            self.assertEqual(item["allocated_bytes"], allocations[self.root / item["path"]])
        self.assert_preserved(snapshot)  # Preview must be non-destructive.
        result = cleanup(self.root, self.db, proposal, "DELETE")
        self.observations["cleanup"] = result
        self.assertEqual(result["errors"], [])
        self.assert_result(result, paths, sizes, allocations)
        self.assert_preserved({p: snapshot[p] for p in protected})
        self.assertEqual(self.state(active_sparse), ("verified", "fixture-hash"))
        self.assertEqual(self.state(active_compressed), ("verified", "fixture-hash"))

    def test_locked_deletion_reports_only_success_and_can_retry(self):
        locked = self.native("a-locked.nc")
        unlocked = self.native("z-unlocked.nc")
        sparse(locked)
        compressed(unlocked)
        sizes = {p: p.stat().st_size for p in (locked, unlocked)}
        allocations = {p: allocated(p) for p in (locked, unlocked)}
        snapshot = self.snapshot([locked])
        # Read/write sharing allows scanning, but no FILE_SHARE_DELETE.
        with handle(locked, share_delete=False):
            proposal = preview(self.root, self.db, [self.old])
            result = cleanup(self.root, self.db, proposal, "DELETE")
            self.observations["partial_failure"] = result
            self.assert_result(result, [unlocked], sizes, allocations)
            self.assertEqual(len(result["errors"]), 1)
            self.assertEqual(result["errors"][0]["path"], locked.relative_to(self.root).as_posix())
            self.assertIn("WinError 32", result["errors"][0]["error"])
            self.assert_preserved(snapshot)
            self.assertEqual(self.state(locked), ("verified", "fixture-hash"))
            # All remaining candidates locked: zero successes and zero savings.
            proposal = preview(self.root, self.db, [self.old])
            result = cleanup(self.root, self.db, proposal, "DELETE")
            self.observations["all_locked"] = result
            self.assert_result(result, [], sizes, allocations)
            self.assertEqual(len(result["errors"]), 1)
        proposal = preview(self.root, self.db, [self.old])
        result = cleanup(self.root, self.db, proposal, "DELETE")
        self.observations["retry"] = result
        self.assertEqual(result["errors"], [])
        self.assert_result(result, [locked], sizes, allocations)

    def junction(self, link, target):
        link.parent.mkdir(parents=True, exist_ok=True)
        # cmd's mklink needs no symlink privilege for directory junctions.
        result = subprocess.run(
            ["cmd.exe", "/d", "/c", "mklink", "/J", str(link), str(target)],
            capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.addCleanup(link.rmdir)  # Remove the link, never recurse into target.
        self.assertTrue(link.lstat().st_file_attributes & 0x400)

    def test_native_junction_and_engine_junction_never_followed(self):
        outside = self.sandbox / "outside-archive"
        outside.mkdir()
        target = outside / "grid.nc"
        target.write_bytes(b"must survive outside managed root")
        native_link = self.root / "data/gebco/Retired"
        self.junction(native_link, outside)
        self.reference("Retired/grid.nc")
        digest = "a" * 64
        package = self.file(f"engines/{digest}/package.bin")
        self.junction(self.root / f"engines/{digest}/nested", outside)
        snapshot = self.snapshot([target, package])
        groups = {g["id"]: g for g in scan(self.root, self.db)}
        for identity in (self.old, "engine:" + digest):
            self.assertTrue(groups[identity]["errors"])
            self.assertEqual(groups[identity]["candidates"], [])
            with self.assertRaises(ValueError):
                preview(self.root, self.db, [identity])
        with self.assertRaisesRegex(ValueError, "reparse"):
            checked_path(self.root, "data/gebco/Retired/grid.nc")
        # Safe, unrelated deletion must not traverse either junction.
        safe = self.native("safe.nc", "Safe")
        result = cleanup(self.root, self.db, preview(self.root, self.db, ["native:gebco:Safe"]), "DELETE")
        self.assertEqual(result["removed_files"], 1)
        self.assertFalse(safe.exists())
        self.assert_preserved(snapshot)
        self.assertTrue(native_link.is_dir())
        # An unresolved active reference blocks ALL cleanup, not only its group.
        safe = self.native("another.nc", "Safe")
        self.db.execute("UPDATE objects SET active=1 WHERE key='Retired/grid.nc'")
        self.db.commit()
        with self.assertRaisesRegex(ValueError, "active reference"):
            preview(self.root, self.db, ["native:gebco:Safe"])
        self.assertTrue(safe.exists())
        self.assert_preserved(snapshot)

    def test_hard_links_inside_and_outside_archive_are_protected(self):
        linked = self.native("linked.nc")
        sparse(linked)
        outside = self.sandbox / "outside-reference.nc"
        active = self.root / "data/gebco/Active/shared.nc"
        active.parent.mkdir(parents=True)
        os.link(linked, outside)
        os.link(linked, active)
        self.reference("Active/shared.nc", 1)
        self.assertEqual(linked.stat().st_nlink, 3)
        self.assertTrue(linked.samefile(active))
        self.assertTrue(linked.samefile(outside))
        safe = self.native("safe.nc")
        snapshot = self.snapshot([linked, outside, active])
        proposal = preview(self.root, self.db, [self.old])
        self.assertEqual([f["path"] for f in proposal["files"]], [safe.relative_to(self.root).as_posix()])
        sizes, allocations = {safe: safe.stat().st_size}, {safe: allocated(safe)}
        result = cleanup(self.root, self.db, proposal, "DELETE")
        self.assertEqual(result["errors"], [])
        self.assert_result(result, [safe], sizes, allocations)
        self.assert_preserved(snapshot)
        self.assertEqual(self.state(linked), ("verified", "fixture-hash"))
        self.assertEqual(self.state(active), ("verified", "fixture-hash"))
        self.assertEqual(linked.stat().st_nlink, 3)
        # Protection is also required when every catalogue reference is retired.
        self.db.execute("UPDATE objects SET active=0")
        self.db.commit()
        for identity in (self.old, "native:gebco:Active"):
            with self.assertRaises(ValueError):
                preview(self.root, self.db, [identity])

    def test_case_alias_of_active_release_is_protected(self):
        path = self.native("Grid.nc", "MixedCase", 1)
        alias = self.root / "data/gebco/mixedcase/grid.NC"
        self.assertTrue(alias.samefile(path), "Fixtures must use a case-insensitive directory")
        self.assertEqual(path.stat().st_nlink, 1)
        self.reference("mixedcase/grid.NC", 0)
        snapshot = self.snapshot([path, alias])
        with self.assertRaises(ValueError):
            preview(self.root, self.db, ["native:gebco:mixedcase"])
        safe = self.native("safe.nc")
        result = cleanup(self.root, self.db, preview(self.root, self.db, [self.old]), "DELETE")
        self.assertEqual(result["removed_files"], 1)
        self.assertFalse(safe.exists())
        self.assert_preserved(snapshot)
        self.assertEqual(self.state(path), ("verified", "fixture-hash"))
        self.assertEqual(self.state(alias), ("verified", "fixture-hash"))

    def test_retired_case_aliases_are_not_double_counted_as_savings(self):
        for alias_key in ("retired/grid.NC", "Retired/grid.NC"):
            with self.subTest(alias=alias_key):
                path = self.native("Grid.nc")
                alias = self.root / "data/gebco" / alias_key
                self.assertTrue(path.samefile(alias))
                self.assertEqual(path.stat().st_nlink, 1)
                self.reference(alias_key)
                safe = self.native("safe.nc")
                snapshot = self.snapshot([path, alias])
                proposal = preview(self.root, self.db, [self.old])
                self.assertEqual([f["path"] for f in proposal["files"]],
                                 [safe.relative_to(self.root).as_posix()])
                sizes, allocations = {safe: safe.stat().st_size}, {safe: allocated(safe)}
                result = cleanup(self.root, self.db, proposal, "DELETE")
                self.assertEqual(result["errors"], [])
                self.assert_result(result, [safe], sizes, allocations)
                self.assert_preserved(snapshot)
                self.assertEqual(self.state(path), ("verified", "fixture-hash"))
                self.assertEqual(self.state(alias), ("verified", "fixture-hash"))
                self.db.execute("DELETE FROM objects")
                self.db.commit()
                path.unlink()


if __name__ == "__main__":
    unittest.main()
