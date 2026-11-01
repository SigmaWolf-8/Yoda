# Windows installer release check

The **Earth archive Windows installer / Windows PowerShell 5.1 installer** check
in `.github/workflows/earth-archive-windows.yml` runs independently of the
Salvi/Rust workflows on `windows-2022`. It runs for archive-related pull requests,
pushes to `main`, and manual dispatches. Require a green run for the release
commit before distributing an updated installer. This does not claim that an
archive has downloaded or that the live reporting service works.

## Run locally

Use a **disposable Windows VM**, Python 3.11+, and Windows PowerShell 5.1:

```powershell
powershell.exe -NoProfile -NonInteractive -File .\scripts\earth_archive\tests\windows-installer.ps1
```

Do not run with reporting credentials or on an acquisition workstation. No
administrator prompt, execution-policy change, bypass, Python package, or
production service is required. If organizational policy blocks scripts, the
check must fail; do not weaken policy to make it green. The custom Actions shell
intentionally avoids the default Actions PowerShell shell's policy-bypass flag.

## Isolation and evidence

- A GUID-named temporary directory contains spaces, an ownership marker, and all
  staged files. There is no use of the installer's default `C:\downloads` target.
- Only deployment placeholders and the two task-name literals are replaced in
  the installer template. All installer and generated runner logic stays intact.
  Unique task names prevent production tasks from being stopped or overwritten.
- A loopback-only HTTP server serves six allowlisted files, including both
  retention modules. `client.py` is an
  explicitly inert fixture: no acquisition imports or network calls. It records
  arguments, whether a dummy token matched, and privilege level, then waits for
  at most 120 seconds or exits with a controlled native code.
- Hash mismatch is tested before a valid install. Valid downloaded files must
  match all pinned SHA-256 values; tampered bytes must not be promoted or run.
- Real Windows APIs check current-user DPAPI encryption/decryption, restricted
  directory and inherited file ACLs, limited interactive task principals,
  registration, start, stop, rerun while running, and native result propagation
  into both PowerShell and Task Scheduler.
- The actual Python client's `run` function reads the PS5.1-written BOM config in
  an empty fixture, with inventory and engine synchronization mocked and socket
  connections, downloads, and HTTP requests forbidden. It must return incomplete,
  never archive-complete.
- Existing partial data must survive reinstall. The runner must pass `-Verify`,
  retain native stderr in its log, propagate both zero and nonzero exit codes,
  and remove the decrypted token from its own PowerShell environment.
- Cleanup runs in `finally`, unregistering only exact GUID task names whose
  actions refer to the fixture runner. Only the marker-owned fixture directory
  is deleted; unexpected junctions/symlinks fail closed. Policies and caller
  privilege are compared before and after. Hosted-VM disposal is the final
  containment if a process is killed before cleanup can run.

Each group prints a `PASS` line; failures throw and fail the job. There is no
skip-on-missing-Windows-API path and no `continue-on-error`. Logs do not print
decrypted values. No secrets or repository write permissions are used.

Linux checks can verify the Python fixtures and existing unit tests, but **cannot
prove DPAPI, ACL or Task Scheduler behavior**. Only a completed Windows job is
that evidence. These files add that gate; a local Linux pass is not a Windows pass.
