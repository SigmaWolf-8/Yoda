#!/usr/bin/env python3
"""Byte identity and real canonical-engine regression checks (stdlib only)."""
import hashlib
import json
from pathlib import Path
import subprocess
import unittest
import zipfile
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "frontend/public/capomastro/engines/arc182"

class Resources(HTMLParser):
    def __init__(self):
        super().__init__()
        self.external = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        value = attrs.get("src") if tag in ("script","img","iframe","audio","video") else attrs.get("href") if tag=="link" else None
        if value and not value.startswith("data:"):
            self.external.append(value)

class BundleTests(unittest.TestCase):
    def test_all_original_files_remain_byte_identical(self):
        manifest = json.loads((DEST / "provenance.json").read_text())
        with zipfile.ZipFile(DEST / "complete-package.zip") as archive:
            for entry in manifest["files"]:
                data = (DEST / entry["path"]).read_bytes()
                self.assertEqual(data, archive.read("isopsephy_package/" + entry["path"]))
                self.assertEqual(hashlib.sha256(data).hexdigest(), entry["sha256"])
        self.assertEqual(len(manifest["files"]),29)

    def test_supplied_standalone_variant_matches_package(self):
        self.assertEqual((DEST / "names99_glyph_engine_globe.html").read_bytes(),
                         (ROOT / "attached_assets/names99_glyph_engine_globe_1793496691344.html").read_bytes())

    def test_instruments_have_no_external_resource_tags(self):
        for name in ("names99_glyph_engine_globe.html","isopsephy_amd_v0_0_20.html"):
            parser = Resources()
            parser.feed((DEST / name).read_text())
            self.assertEqual(parser.external,[])
            adapted = (DEST / ("accessible-"+name)).read_text()
            self.assertIn("prefers-reduced-motion", adapted)
            self.assertIn("ArrowLeft", adapted)

    def test_canonical_pipeline_and_generated_report(self):
        process = subprocess.run(["python3",str(ROOT / "scripts/run-isopsephy-document.py")],
                                 input="Capomastro Salvalaggio",text=True,capture_output=True,timeout=20,check=True)
        data = json.loads(process.stdout)
        ledger = data["result"]["outputs"]["ledger"]
        self.assertEqual([(r["word"],r["value"],r["dr"]) for r in ledger],
                         [("Capomastro","882","9"),("Salvalaggio","351","9")])
        self.assertIn('id="cv_globe"',data["report_html"])
        self.assertIn('id="elev"',data["report_html"])
        self.assertIn("Capomastro|Capomastro",data["report_html"])

    def test_unrecognized_or_oversized_input_is_rejected(self):
        for source in ("12345 !!!!","a"*9000):
            process = subprocess.run(["python3",str(ROOT / "scripts/run-isopsephy-document.py")],
                                     input=source,text=True,capture_output=True,timeout=20)
            self.assertNotEqual(process.returncode,0)
            self.assertIn("error",json.loads(process.stdout))

if __name__ == "__main__":
    unittest.main()
