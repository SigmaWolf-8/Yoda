"""Packaging/launcher regression checks; fixture workers never acquire Earth data."""
import importlib.util
import ast
import json
import os
import re
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).parent
spec=importlib.util.spec_from_file_location("earth_launch",ROOT/"launch.py")
launch=importlib.util.module_from_spec(spec)
spec.loader.exec_module(launch)

class SetupTests(unittest.TestCase):
    def test_windows_fixture_includes_every_distributed_worker(self):
        api=(ROOT.parent.parent/"crates/yoda-api/src/earth_archive.rs").read_text()
        workers=set(re.findall(r'\("([^"]+\.py)",include_str!',api))
        self.assertTrue(workers)
        fixture=(ROOT/"tests/windows-installer.ps1").read_text()
        lists=[set(re.findall(r"'([^']+)'",group)) for group in
               re.findall(r"foreach \(\$Name in @\(([^)]+)\)\)",fixture)]
        self.assertTrue(any(workers.issubset(names) for names in lists),
                        "Windows source-hash fixture is missing a distributed worker")
        server=ast.parse((ROOT/"tests/fixture_server.py").read_text())
        allowed=next(node.value for node in server.body if isinstance(node,ast.Assign)
                     and any(isinstance(target,ast.Name) and target.id=="allowed"
                             for target in node.targets))
        self.assertTrue(workers.issubset(ast.literal_eval(allowed)),
                        "Windows HTTP fixture must serve every distributed worker")
        for name in workers:
            self.assertTrue((ROOT/name).is_file())
    def test_cmd_payload_roundtrip_and_command_limits(self):
        source=(ROOT/"install.ps1").read_text().replace("@@TOKEN@@","isolated-test-value")
        encoded=source.encode().hex()
        payload="\n".join("::YODA:"+encoded[i:i+120] for i in range(0,len(encoded),120))
        package=(ROOT/"setup.cmd").read_text().replace("@@PAYLOAD@@",payload).replace("\n","\r\n")
        lines=package.splitlines()
        recovered=bytes.fromhex("".join(line[7:] for line in lines if line.startswith("::YODA:"))).decode()
        self.assertEqual(recovered,source)
        self.assertTrue(all(len(line)<8191 for line in lines))
        self.assertIn("-Interactive",package)
        self.assertLess(package.index("exit /b 0"),package.index("::YODA:"+encoded[:120]))
        self.assertNotIn("-ExecutionPolicy",package)
        self.assertNotIn("Set-ExecutionPolicy",source)
    def test_all_worker_downloads_validate_before_existing_tasks_stop(self):
        source=(ROOT/"install.ps1").read_text()
        self.assertLess(source.index("SHA-256 mismatch"),source.index("Stop-ScheduledTask"))
        self.assertIn("-Execute $Python",source)
        self.assertIn("runtime-3.13.17",source)
        self.assertIn("Get-FileHash -Algorithm SHA256 $RuntimeZip",source)
        self.assertLess(source.index("Python runtime integrity check failed"),
                        source.index("Expand-Archive"))
        self.assertIn("import sys, ssl, sqlite3, ctypes",source)
    def test_private_runtime_test_tracks_the_production_pin(self):
        source=(ROOT/"install.ps1").read_text()
        version=re.search(r"runtime-(\d+\.\d+\.\d+)",source).group(1)
        self.assertIn(f"https://www.python.org/ftp/python/{version}/python-{version}-embed-amd64.zip",source)
        probe=(ROOT/"tests/runtime_probe.py").read_text()
        self.assertIn(f'runtime-{version}',probe)
        self.assertIn(str(tuple(map(int,version.split(".")))),probe)
        self.assertRegex(source,r"RuntimeZip\)\.Hash\.ToLowerInvariant\(\) -ne '[a-f0-9]{64}'")
    def test_windows_ci_always_exercises_private_runtime_without_discovery_mocks(self):
        fixture=(ROOT/"tests/windows-installer.ps1").read_text()
        child=(ROOT/"tests/installer_child.ps1").read_text()
        self.assertIn("$RuntimeMode = 'Both'",fixture)
        self.assertIn("@('System','Private')",fixture)
        self.assertIn("$env:PATH = $PSHOME",child)
        self.assertIn("@('python','py')",child)
        self.assertIn("Get-Command $Name -CommandType Application",child)
        for script in (fixture,child):
            self.assertNotRegex(script,r"(?i)function\s+(Get-Command|Invoke-WebRequest)")
        self.assertNotRegex(child,r"(?i)Set-ExecutionPolicy|-ExecutionPolicy")
        self.assertIn('$Rendered.Replace($RuntimeUrl, "$Base/api/earth-archive/files/corrupt-runtime.zip")',fixture)
        self.assertIn('Runtime-Fingerprint',fixture)
    def run_fixture(self,serve):
        with tempfile.TemporaryDirectory(prefix="earth setup space ") as folder:
            private=Path(folder)
            (private/"config.json").write_text(json.dumps({"target":folder}),encoding="utf-8-sig")
            (private/"client.py").write_text(
                "import os,sys,json\nprint(json.dumps({'token_present':bool(os.environ.get('YODA_ARCHIVE_REPORT_TOKEN')),'serve':'--serve' in sys.argv,'target':sys.argv[sys.argv.index('--target')+1]}))\nsys.exit(23)\n")
            original=os.environ.get("YODA_ARCHIVE_REPORT_TOKEN")
            with patch.object(launch,"__file__",str(private/"launch.py")),patch.object(launch,"reporting_token",return_value="test-only-not-a-credential") as decrypt,patch.object(launch.sys,"argv",["launch.py"]+(["--serve"] if serve else [])):
                self.assertEqual(launch.main(),23)
            record=json.loads((private/"runner.log").read_text())
            self.assertEqual(record,{"token_present":not serve,"serve":serve,"target":folder})
            self.assertEqual(decrypt.call_count,0 if serve else 1)
            self.assertEqual(os.environ.get("YODA_ARCHIVE_REPORT_TOKEN"),original)
    def test_update_launcher_propagates_exit_and_private_environment(self):
        self.run_fixture(False)
    def test_viewer_does_not_unlock_or_receive_reporting_credential(self):
        self.run_fixture(True)

if __name__=="__main__":
    unittest.main()
