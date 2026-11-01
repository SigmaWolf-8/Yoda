"""Reproducible synthetic GLOBAL-sized review benchmark; never use a live archive.

Run: python scripts/earth_archive/benchmark_retention.py --tiles 26450
Creates real tiny/sparse fixture files under ignored generated-artifacts, removes
them on exit, and prints JSON metrics. No downloads, credentials or deletion calls.
"""
import argparse
import json
from pathlib import Path
import platform
import tempfile
import time

from client import database, lock
from retention import allocation, scan
from retention_store import PAGE_SIZE
from retention_ui import overview, inspection_page


def fixture(root, tiles):
    db = database(root)
    expected = {"references": tiles * 2, "files": 0, "missing": 0,
                "local_bytes": 0, "allocated_bytes": 0}
    for i in range(tiles):
        # Copernicus-shaped tile folders, native raster plus auxiliary metadata.
        tile = f"Copernicus_DSM_COG_10_N{i // 360:02}_00_E{i % 360:03}_00_DEM"
        for suffix in (".tif", ".xml"):
            key = f"{tile}/{tile}{suffix}"
            db.execute("""INSERT INTO objects(source,key,url,size,validator,active,state,sha256)
                VALUES('copernicus',?,?,999999999,'synthetic-etag',1,'verified',?)""",
                       (key, "https://synthetic.invalid/" + key, f"{i:064x}"))
            if suffix == ".tif" and i % 20 == 0:
                expected["missing"] += 1
                continue
            path = root / "data/copernicus" / key
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("wb") as stream:
                stream.write(b"x" * 256)
                # Logical raster bytes are large; physical fixture remains small.
                stream.truncate(24 * 1024 * 1024 + i if suffix == ".tif" else 2048)
            paths = [path]
            if suffix == ".xml" and i % 500 == 0:
                partial = path.with_name(path.name + ".part")
                partial.write_bytes(b"unfinished")
                paths.append(partial)
            for path in paths:
                info = path.stat()
                expected["files"] += 1
                expected["local_bytes"] += info.st_size
                allocated = allocation(path, info)
                if allocated is None or expected["allocated_bytes"] is None:
                    expected["allocated_bytes"] = None
                else:
                    expected["allocated_bytes"] += allocated
    db.commit()
    return db, expected


def benchmark(tiles):
    output = Path(__file__).resolve().parents[2] / "generated-artifacts"
    output.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="retention-benchmark-", dir=output) as directory:
        root = Path(directory)
        start = time.perf_counter()
        db, expected = fixture(root, tiles)
        setup = time.perf_counter() - start
        try:
            start = time.perf_counter()
            with lock(root), scan(root, db) as review:
                scan_seconds = time.perf_counter() - start
                group = review[0]
                actual = {key: len(group[key]) if key in ("references", "files") else group[key]
                          for key in expected}
                assert actual == expected, (actual, expected)
                start = time.perf_counter()
                summary = overview(review, "fixture-csrf", None, "fixture-review")
                summary_seconds = time.perf_counter() - start
                assert b"synthetic.invalid" not in summary and b"Copernicus_DSM" not in summary
                assert len(summary) < 10000, "Summary must not embed inventory details"
                timings, sizes = {}, {}
                for kind in ("references", "files"):
                    for label, number in (("first", 0), ("last", (len(group[kind]) - 1) // PAGE_SIZE)):
                        start = time.perf_counter()
                        body = inspection_page(review, "fixture-review", group["id"], kind, number)
                        timings[f"{kind}_{label}"] = time.perf_counter() - start
                        sizes[f"{kind}_{label}"] = len(body)
                        assert len(body) < 100000, "A detail page exceeded this fixture's bounded budget"
                # Walk all pages to prove complete, non-overlapping inspection.
                count = 0
                last_key = ""
                for number in range((expected["references"] + PAGE_SIZE - 1) // PAGE_SIZE):
                    rows, total = group["references"].page(number)
                    assert total == expected["references"] and len(rows) <= PAGE_SIZE
                    for row in rows:
                        assert row["key"] > last_key
                        last_key = row["key"]
                        count += 1
                assert count == expected["references"]
                store_bytes = (review.db.execute("PRAGMA page_count").fetchone()[0] *
                               review.db.execute("PRAGMA page_size").fetchone()[0])
                result = {"platform": platform.platform(), "python": platform.python_version(),
                          "tiles": tiles, **actual, "fixture_seconds": setup,
                          "scan_seconds": scan_seconds, "summary_render_seconds": summary_seconds,
                          "summary_html_bytes": len(summary), "detail_seconds": timings,
                          "detail_html_bytes": sizes, "snapshot_disk_bytes": store_bytes}
                try:
                    import resource
                    result["process_peak_rss_kib"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
                except ImportError:
                    result["process_peak_rss_kib"] = None
                return result
        finally:
            db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tiles", type=int, default=26450)
    args = parser.parse_args()
    if args.tiles < 1:
        parser.error("--tiles must be positive")
    print(json.dumps(benchmark(args.tiles), indent=2))
