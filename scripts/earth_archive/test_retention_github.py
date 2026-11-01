"""Offline checks for the GitHub handoff; not evidence of native Windows behavior."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock

from run_retention_github import STAGED, WORKFLOW, activate, save_evidence


class GitHubHandoffTests(unittest.TestCase):
    def github(self, installed=None, staged="workflow-blob"):
        github = Mock()
        def api(path, method="GET", body=None):
            if path.startswith("git/ref/heads/"):
                return {"object": {"sha": "head"}}
            if path == "git/commits/head":
                return {"tree": {"sha": "root-tree"}}
            if path == "git/trees/root-tree":
                return {"tree": [{"path": ".github", "type": "tree", "sha": "github-tree"}]}
            if path == "git/trees/github-tree":
                entries = [{"path": "workflows", "type": "tree", "sha": "workflow-tree"}]
                if staged:
                    entries.append({"path": STAGED.split("/")[-1], "type": "blob", "sha": staged})
                return {"tree": entries}
            if path == "git/trees/workflow-tree":
                return {"tree": ([{"path": WORKFLOW.split("/")[-1], "type": "blob",
                                  "sha": installed}] if installed else [])}
            if path == "git/trees" and method == "POST":
                return {"sha": "new-tree"}
            if path == "git/commits" and method == "POST":
                return {"sha": "new-commit"}
            if path == "git/refs/heads/verify/fixture" and method == "PATCH":
                return {}
            raise AssertionError((path, method, body))
        github.api.side_effect = api
        return github

    def test_main_rejected_before_any_api_call(self):
        github = Mock()
        with self.assertRaises(ValueError):
            activate(github, "main")
        github.api.assert_not_called()

    def test_one_atomic_non_force_activation(self):
        github = self.github()
        self.assertEqual(activate(github, "verify/fixture"), "new-commit")
        writes = [c.args for c in github.api.call_args_list if len(c.args) > 1]
        self.assertEqual([w[1] for w in writes], ["POST", "POST", "PATCH"])
        self.assertEqual(writes[0][2]["base_tree"], "root-tree")
        self.assertEqual(writes[0][2]["tree"], [
            {"path": WORKFLOW, "mode": "100644", "type": "blob", "sha": "workflow-blob"},
            {"path": STAGED, "mode": "100644", "type": "blob", "sha": None},
        ])
        self.assertEqual(writes[-1], ("git/refs/heads/verify/fixture", "PATCH",
                                     {"sha": "new-commit", "force": False}))

    def test_already_active_is_read_only(self):
        github = self.github(installed="workflow-blob", staged=None)
        self.assertEqual(activate(github, "verify/fixture"), "head")
        self.assertTrue(all(len(c.args) == 1 for c in github.api.call_args_list))

    def test_conflicting_workflow_never_overwritten(self):
        github = self.github(installed="different-blob")
        with self.assertRaisesRegex(RuntimeError, "refusing"):
            activate(github, "verify/fixture")
        self.assertTrue(all(len(c.args) == 1 for c in github.api.call_args_list))

    def test_evidence_requires_native_pass_and_exact_commit(self):
        run = {"id": 123, "conclusion": "success", "html_url": "https://example.test/run"}
        base = {"native_windows": True, "passed": True, "tests_run": 6,
                "commit": "expected", "skipped": []}
        for changes, passes in [({}, True), ({"commit": "other"}, False),
                                ({"native_windows": False}, False),
                                ({"skipped": ["test"]}, False),
                                ({"passed": False}, False), ({"tests_run": 0}, False)]:
            with self.subTest(changes=changes), tempfile.TemporaryDirectory() as temp:
                output = Path(temp) / "report"
                github = Mock()
                def download(*args, **kwargs):
                    (output / "retention-windows.json").write_text(json.dumps(base | changes))
                    return subprocess.CompletedProcess([], 0, "", "")
                github.command.side_effect = download
                if passes:
                    save_evidence(github, run, "expected", output)
                else:
                    with self.assertRaisesRegex(RuntimeError, "did not pass"):
                        save_evidence(github, run, "expected", output)


if __name__ == "__main__":
    unittest.main()
