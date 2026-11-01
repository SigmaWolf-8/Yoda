import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import unittest
import zipfile

SCRIPT=Path(__file__).with_name("extract-folding-text.py")
spec=importlib.util.spec_from_file_location("folding_extract",SCRIPT)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ExtractionTests(unittest.TestCase):
    def test_utf8_and_utf16(self):
        for encoding in ("utf-8-sig","utf-16"):
            self.assertEqual(module.extract("txt","δ θ Capomastro".encode(encoding))["text"],"δ θ Capomastro")
    def test_html_scripts_never_become_text(self):
        result=module.extract("html",b"<p>Capomastro</p><script>alert('bad')</script><p>Salvi</p>")
        self.assertEqual(result["text"],"Capomastro\nSalvi")
    def test_docx_main_body(self):
        output=io.BytesIO()
        with zipfile.ZipFile(output,"w") as archive:
            archive.writestr("word/document.xml",'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Capomastro</w:t></w:r></w:p></w:body></w:document>')
        self.assertEqual(module.extract("docx",output.getvalue())["text"],"Capomastro")
    def test_text_limit_and_binary(self):
        for data in (b"a"*100001,b"a\0b",b""):
            with self.assertRaises(ValueError): module.extract("txt",data)
    def test_docx_entities_rejected(self):
        output=io.BytesIO()
        with zipfile.ZipFile(output,"w") as archive:
            archive.writestr("word/document.xml",'<!DOCTYPE foo [<!ENTITY x "bad">]><foo>&x;</foo>')
        with self.assertRaises(ValueError):module.extract("docx",output.getvalue())
    def test_pdf_actual_subprocess_with_limits(self):
        import pymupdf
        with pymupdf.open() as document:
            page=document.new_page()
            page.insert_text((72,72),"Capomastro Salvi")
            data=document.tobytes()
        result=subprocess.run([sys.executable,str(SCRIPT),"pdf"],input=data,capture_output=True,timeout=25)
        self.assertEqual(result.returncode,0,result.stdout)
        self.assertEqual(json.loads(result.stdout)["text"],"Capomastro Salvi")

if __name__=="__main__":
    unittest.main()
