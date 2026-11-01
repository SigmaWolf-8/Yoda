# Retention verification (not installer verification)

Run on native Windows with Python 3.12+ and an NTFS `%TEMP%` volume:

```powershell
python scripts/earth_archive/verify_retention_windows.py --report generated-artifacts/retention-windows.json
python -m unittest discover -s scripts/earth_archive -p "test_retention.py" -v
```

No third-party Python packages, administrator rights, installer, service,
network downloads, API credentials, or operator archive are needed. Do not pass
an archive location: the runner has no archive argument. Every test creates its
own `TemporaryDirectory`, a fresh inventory, and fixture files. Even the
"outside archive" junction/hard-link targets are inside that disposable sandbox.
Handles, junctions, database connections and temporary trees are cleaned up on
failures as well as successes.

The dedicated `Earth retention on native Windows` CI job uses Windows Server
2022, independently of installer coverage. It fails on unsupported volumes,
missing NTFS capabilities, fixture setup errors, zero tests, or any skipped
native check. The JSON artifact records the platform, Python version, CI commit,
test identities, failures/skips, and allocation/deletion measurements. A green
Linux run with Windows tests skipped is **not** native evidence.

## What the native checks prove

- `FSCTL_SET_SPARSE` and `FSCTL_SET_COMPRESSION` create real, nonempty files
  whose allocation is smaller than their logical length. Attributes and actual
  savings are asserted, not assumed from a filename.
- `GetFileInformationByHandleEx(FileCompressionInfo)` supplies a handle-based
  allocation oracle, independent of retention's path-based
  `GetCompressedFileSizeW`. Preview and successful deletion totals are compared
  with the actual fixture lengths and native measurements. Ordinary files use
  `FileStandardInfo.AllocationSize`; an unaligned, nonresident fixture checks
  that cluster allocation is reported instead of logical length. (Microsoft
  documents that `GetCompressedFileSizeW` returns logical length for ordinary
  non-sparse, uncompressed files.)
- Real directory junctions in both native release paths and nested engines
  exclude unsafe groups without touching their targets. Unresolved active
  references disable unrelated cleanup too.
- Real NTFS hard links inside/outside the managed root survive; link counts,
  file identities and byte hashes are checked.
- A `CreateFileW` handle without `FILE_SHARE_DELETE` forces a real sharing
  violation. Both partial success and all-locked attempts report only actual
  successful deletions, retain failed inventory entries, and permit a fresh
  preview/retry after releasing the handle.
- Case-only catalogue aliases of active and retired files are exercised on a
  genuinely case-insensitive directory. Ambiguous aliases are protected, not
  double-counted as proposed savings (even within a single release).
- Active sparse/compressed native files, the selected engine, unknown native
  data, resumable downloads and private configuration survive byte-for-byte.

Allocated bytes removed are **not** asserted equal to volume free-space change.
Other activity, delayed frees, filesystem metadata and snapshots make that
volume-wide value nondeterministic; it remains a separate observed result.

Portable regression checks:

```sh
python -m unittest discover -s scripts/earth_archive -p 'test_retention*.py' -v
```

On non-Windows hosts, native cases explicitly skip in general discovery; the
strict runner instead exits nonzero and writes a failed evidence report.
