# Windows installer release check

The scheduled actions now launch Python directly through `launch.py`, including
the real current-user DPAPI decryption path. The downloadable CMD opens the
interactive setup dialog; CI uses the same underlying installer without
`-Interactive` to avoid blocking on desktop prompts. GUI prompt interaction and
browser security prompts still need a Windows desktop smoke test.

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

The default `Both` mode runs the existing system-Python checks and then the
private-runtime checks in separate PowerShell processes. To run just the latter,
append `-RuntimeMode Private`. The parent's existing Python only hosts the
loopback HTTP fixture; it is **not** available to the private-mode installer.
`installer_child.ps1` gives that child only `$PSHOME` in PATH (not SystemRoot,
which can contain `py.exe`), removes PYTHONHOME/PYTHONPATH there, and asserts that
real `Get-Command` discovery resolves neither `python` nor `py`. It does not
modify machine/user PATH, remove Python, or mock command discovery.

Do not run with reporting credentials or on an acquisition workstation. No
administrator prompt, execution-policy change, bypass, Python package, or
production service is required. If organizational policy blocks scripts, the
check must fail; do not weaken policy to make it green. The cmd step invokes the
checked-in PowerShell script directly, avoiding the default Actions PowerShell
shell's policy-bypass flag.

The test records the host's actual Windows token elevation type. Standard users
and split-token administrators must produce non-administrator workers. If the
host is already an **unfiltered administrator** (TokenElevationTypeDefault with
administrator membership), Windows has no linked restricted token to select.
Only in that measured case may workers retain existing administrator membership.
The Limited task-principal, unchanged identity and unchanged policy assertions
still apply. Such a run proves no privilege gain and correct task configuration,
but does **not** certify standard-user desktop execution; the log says so.

## Isolation and evidence

- A GUID-named temporary directory contains spaces, an ownership marker, and all
  staged files. There is no use of the installer's default `C:\downloads` target.
- Only deployment placeholders and the two task-name literals are replaced in
  the successful installer template. For runtime corruption only, the pinned
  official URL is replaced with a loopback URL serving genuinely corrupted ZIP
  bytes; the expected hash and all installer logic remain unchanged.
  Unique task names prevent production tasks from being stopped or overwritten.
- A loopback-only HTTP server serves the seven packaged worker modules and the
  guide through an explicit allowlist. `client.py` is an
  explicitly inert fixture: no acquisition imports or network calls. It records
  arguments, whether a dummy token matched, and privilege level, then waits for
  at most 120 seconds or exits with a controlled native code.
- Hash mismatch is tested before a valid install. Valid downloaded files must
  match all pinned SHA-256 values; tampered bytes must not be promoted or run.
- Private mode downloads the pinned official CPython embeddable ZIP over HTTPS,
  independently verifies its SHA-256, corrupts a byte and checks rejection
  before extraction, task registration or worker execution. Rejected ZIP bytes
  must be removed; existing archive bytes must survive. The successful installer
  then downloads directly from the unchanged python.org URL.
- The actual private interpreter must be CPython 3.13.17 in isolated mode, create
  an SSL context, execute an in-memory SQLite query, call a Windows API through
  ctypes, and import the real local launcher/viewer/acquisition/retention modules.
  The probe loads an unchanged copy of the real client as a library in its own
  process, since viewer/retention import client helpers; scheduled workers keep
  the inert replacement. The probe never changes sys.path or the runtime's
  isolation file and forbids socket connections, HTTP requests and subprocesses
  through an audit hook. Imports do not invoke acquisition or start a server.
  Scheduled fixture events
  must report that same private executable; updater DPAPI and viewer isolation
  still run through the real `launch.py`.
- Repeat setup runs with Python still undiscoverable. All private-runtime file
  hashes and creation/modification timestamps must remain unchanged, no runtime
  download may occur, and both complete and partial archive sentinel files must
  survive. Replacement scheduled workers must use that same interpreter.
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

Each group prints a `PASS` line; failures throw and fail the job. Keep the run URL
and exact tested commit with release evidence. There is no
skip-on-missing-Windows-API path and no `continue-on-error`. Logs do not print
decrypted values. No secrets or repository write permissions are used.

Linux checks can verify the Python fixtures and existing unit tests, but **cannot
prove DPAPI, ACL or Task Scheduler behavior**. Only a completed Windows job is
that evidence. These files add that gate; a local Linux pass is not a Windows pass.

Passing these checks proves an **isolated test installation**, not a user's
archive reporting live, global data coverage, or standard-user desktop behavior
on a host whose token was already an unfiltered administrator.
