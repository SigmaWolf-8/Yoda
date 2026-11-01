# Retention review benchmark

Run from the repository root:

```sh
python scripts/earth_archive/benchmark_retention.py --tiles 1000
python scripts/earth_archive/benchmark_retention.py --tiles 26450
python -m unittest discover -s scripts/earth_archive -p 'test_*.py'
```

## Fixture and scope

The larger case models a global-sized Copernicus inventory: 26,450 synthetic
tile folders, each with a native raster reference and an auxiliary metadata
reference (52,900 references). These are synthetic names and data, not a claim
about today's exact upstream catalogue count or coverage. Every twentieth
raster is absent; every five-hundredth metadata file has a protected partial
download. Raster files are sparse, with approximately 24 MiB of logical
contents each; metadata files have 2,048 logical bytes. Catalogue sizes are
deliberately wrong, so accidentally using them fails the totals assertion.

The test creates real files and uses the real path safety checks, stat calls,
allocation measurements, SQLite inventory, disk-backed review, and HTML
renderers. It does not mock measurements or download a real archive. Temporary
fixtures are created under ignored `generated-artifacts/` and removed on exit.
The reference walk verifies all pages, in order, without omissions or repeats.
The benchmark asserts summary HTML under 10 KB and individual fixture detail
pages under 100 KB; every page is limited to 100 records.

## Observed results

Linux x86_64, Python 3.11.14, local Replit filesystem. These are single-run
measurements, not a Windows/NTFS performance guarantee. Setup precedes
measurement, so filesystem metadata can be warm. Times do not include network
latency or browser layout; HTML sizes are uncompressed.

| Metric | 1,000 tiles | 26,450 tiles |
| --- | ---: | ---: |
| Tracked references | 2,000 | 52,900 |
| Measured local files, including partials | 1,952 | 51,630 |
| Missing tracked files | 50 | 1,323 |
| Exact logical local bytes | 23,910,055,820 | 632,728,127,743 |
| Measured allocated bytes | 7,995,392 | 211,476,480 |
| Full measurement under acquisition lock | 0.278 s | 7.259 s |
| Summary rendering after measurement | 0.8 ms | 21.2 ms |
| Summary HTML | about 2.7 KB | about 2.7 KB |
| First / last reference page | 1.3 / 1.4 ms | 8.1 / 15.8 ms |
| First / last file page | 1.5 / 1.2 ms | 9.5 / 18.7 ms |
| Largest measured detail HTML | 57.0 KB | 57.0 KB |
| Temporary review database | 2,560,000 bytes | 67,743,744 bytes |
| Whole-process peak RSS, including fixture setup | 31,308 KiB | 32,836 KiB |

## Interpretation and safety

The initial scan still visits every tracked path and measures actual local
bytes. Its cost scales with inventory size and disk speed; it is **not**
replaced by catalogue estimates, cached old measurements, or a partial scan.
Subsequent inspection and return-to-summary links read the same immutable
snapshot without rescanning or holding the acquisition lock.

Reference/file/error details use a temporary SQLite store with a 2 MiB page
cache per review. The viewer retains at most four reviews, for ten minutes,
closing their stores on eviction or shutdown. First/previous/next/last links
expose every record, and expired/invalid pages fail explicitly. Disk usage
grows with inventory size instead of retaining all details in Python/browser
memory. SQLite temporary files use the operating system temporary directory;
that volume needs enough space for the review stores.

Preview and cleanup take fresh, locked scans. Their fingerprint streams every
reference, measurement, protection flag and error, including records the
operator never opened. Exact selected deletion lists remain server-owned;
only their presentation is paginated. Preview memory therefore still scales
with the number of eligible files explicitly selected for deletion, not with
every active global reference. Cleanup revalidates the full proposal and each
file's identity, preserving active releases, partials, links and unknown files.

The HTTP tests cover first/middle/final pages, totals, expired and evicted
snapshots, acquisition contention, source/Host protection, off-page inventory
and file changes, and confirmation across all pages of a 205-file proposal.
