"""Activate and run disposable Windows retention checks using your GitHub login.

Requires Python 3.10+. Installs GitHub CLI via winget on Windows if needed.
Never asks for a token, clones a repository, merges, or writes to main.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from urllib.parse import quote

REPO = "SigmaWolf-8/Yoda"
STAGED = ".github/earth-retention-windows.yml"
WORKFLOW = ".github/workflows/earth-retention-windows.yml"


def find_gh():
    executable = shutil.which("gh")
    if executable:
        return executable
    if os.name != "nt":
        raise RuntimeError("Install GitHub CLI from https://cli.github.com and retry.")
    candidates = [
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "GitHub CLI/gh.exe",
        Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "Programs/GitHub CLI/gh.exe",
    ]
    for path in candidates:
        if path.is_file():
            return str(path)
    winget = shutil.which("winget")
    if not winget:
        raise RuntimeError("Install GitHub CLI from https://cli.github.com and rerun this script.")
    print("Installing GitHub CLI through Windows Package Manager...", flush=True)
    subprocess.run(
        [winget, "install", "--id", "GitHub.cli", "--exact", "--source", "winget",
         "--accept-source-agreements", "--accept-package-agreements"],
        check=True,
    )
    for path in candidates:
        if path.is_file():
            return str(path)
    raise RuntimeError("GitHub CLI installed; reopen PowerShell and rerun this script.")


class GitHub:
    def __init__(self, executable):
        self.executable = executable

    def command(self, *args, capture=True, payload=None, check=True):
        return subprocess.run(
            [self.executable, *args], input=payload, text=True, encoding="utf-8",
            capture_output=capture, check=check,
        )

    def login(self):
        status = self.command("auth", "status", "--hostname", "github.com", check=False)
        print("Approve GitHub access in your browser if prompted. No token needs to be pasted here.",
              flush=True)
        if status.returncode:
            self.command("auth", "login", "--hostname", "github.com",
                         "--git-protocol", "https", "--web", "--scopes", "repo,workflow",
                         capture=False)
        else:
            # GitHub CLI's browser/device authorization adds the missing scope.
            self.command("auth", "refresh", "--hostname", "github.com",
                         "--scopes", "repo,workflow", capture=False)

    def api(self, endpoint, method="GET", body=None):
        args = ["api", "--hostname", "github.com", "--method", method,
                f"repos/{REPO}/{endpoint}"]
        if body is not None:
            args.extend(["--input", "-"])
        result = self.command(*args, payload=json.dumps(body) if body is not None else None)
        return json.loads(result.stdout)


def blob_at(github, tree_sha, path):
    parts = path.split("/")
    for index, part in enumerate(parts):
        tree = github.api(f"git/trees/{tree_sha}")
        entry = next((item for item in tree["tree"] if item["path"] == part), None)
        if entry is None:
            return None
        expected = "blob" if index == len(parts) - 1 else "tree"
        if entry["type"] != expected:
            raise RuntimeError(f"Unexpected Git object at {path}; nothing will be overwritten.")
        tree_sha = entry["sha"]
    return tree_sha


def activate(github, branch):
    if not branch.startswith("verify/") or ".." in branch:
        raise ValueError("Only a verify/ branch is allowed. This script never updates main.")
    ref_path = quote(branch, safe="/")
    head = github.api(f"git/ref/heads/{ref_path}")["object"]["sha"]
    base = github.api(f"git/commits/{head}")["tree"]["sha"]
    staged = blob_at(github, base, STAGED)
    installed = blob_at(github, base, WORKFLOW)
    if installed and not staged:
        print("Workflow is already active; checking the current commit's run.", flush=True)
        return head
    if not staged:
        raise RuntimeError("The staged workflow is missing. Check the verification branch.")
    if installed and installed != staged:
        raise RuntimeError("A different workflow already exists; refusing to overwrite it.")
    tree = github.api("git/trees", "POST", {
        "base_tree": base,
        "tree": [
            {"path": WORKFLOW, "mode": "100644", "type": "blob", "sha": staged},
            {"path": STAGED, "mode": "100644", "type": "blob", "sha": None},
        ],
    })
    commit = github.api("git/commits", "POST", {
        "message": "Activate native Windows retention verification",
        "tree": tree["sha"], "parents": [head],
    })
    # One atomic rename commit; a concurrent branch edit fails rather than
    # being overwritten. The push event starts the Windows job.
    github.api(f"git/refs/heads/{ref_path}", "PATCH", {"sha": commit["sha"], "force": False})
    return commit["sha"]


def await_run(github, branch, sha, timeout=1200):
    deadline = time.monotonic() + timeout
    run = None
    while time.monotonic() < deadline:
        if run is None:
            response = github.api(
                f"actions/runs?branch={quote(branch, safe='')}&head_sha={sha}&event=push&per_page=100"
            )
            run = next((r for r in response["workflow_runs"]
                        if r["head_sha"] == sha and r.get("path") == WORKFLOW), None)
        else:
            run = github.api(f"actions/runs/{run['id']}")
        if run:
            print(f"Windows tests: {run['status']} — {run['html_url']}", flush=True)
            if run["status"] == "completed":
                return run
        else:
            print("Waiting for GitHub to start the Windows job...", flush=True)
        time.sleep(10)
    raise RuntimeError(
        f"Timed out waiting for Windows tests. Check https://github.com/{REPO}/actions "
        "for disabled Actions, approval requirements or unavailable runners. No pass is claimed."
    )


def save_evidence(github, run, sha, output):
    output.mkdir(parents=True, exist_ok=False)
    (output / "run.json").write_text(json.dumps(run, indent=2), encoding="utf-8")
    downloaded = github.command(
        "run", "download", str(run["id"]), "--repo", REPO,
        "--name", "retention-windows-evidence", "--dir", str(output), check=False,
    )
    if run["conclusion"] != "success":
        logs = github.command("run", "view", str(run["id"]), "--repo", REPO,
                              "--log-failed", check=False)
        (output / "failed-job.log").write_text(logs.stdout + logs.stderr, encoding="utf-8")
    print(f"Results saved to: {output}", flush=True)
    if downloaded.returncode:
        raise RuntimeError(f"Evidence download failed: {downloaded.stderr.strip()}\n{run['html_url']}")
    report = json.loads((output / "retention-windows.json").read_text(encoding="utf-8"))
    if (run["conclusion"] != "success" or report.get("passed") is not True
            or report.get("native_windows") is not True or report.get("commit") != sha
            or report.get("tests_run", 0) < 6 or report.get("skipped")):
        raise RuntimeError(f"Windows verification did not pass. Keep the report and logs: {output}")
    print("PASS: native Windows tests and portable regressions succeeded.", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--branch", required=True, help="Existing verify/ branch to activate")
    args = parser.parse_args()
    # Reject unsafe destinations before installation, authorization or API calls.
    if not args.branch.startswith("verify/") or ".." in args.branch:
        parser.error("Only verify/ branches are allowed; main is never modified.")
    github = GitHub(find_gh())
    github.login()
    sha = activate(github, args.branch)
    print(f"Verification commit: {sha}. Nothing merged or deployed.", flush=True)
    run = await_run(github, args.branch, sha)
    output = Path.home() / "Downloads" / f"yoda-retention-{run['id']}-{time.time_ns()}"
    save_evidence(github, run, sha, output)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"STOPPED: {error}", file=sys.stderr)
        if isinstance(error, subprocess.CalledProcessError) and error.stderr:
            print(error.stderr.strip(), file=sys.stderr)
        sys.exit(1)
