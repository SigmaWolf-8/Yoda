"""Build a labeled derivative; never edit the sealed source."""
from pathlib import Path
import hashlib
import json

root=Path(__file__).resolve().parents[1]
source=root/"frontend/public/capomastro/docs/salvi-isopsephy-engine-v0.0.20.html"
target=root/"frontend/public/capomastro/adapters"
original=source.read_bytes()
text=original.decode("utf-8")
injection='\n<!-- Functional derivative: input/output adapter; original downloadable source unchanged. -->\n<script src="/capomastro/adapters/folding-lab.js"></script>\n'
if "</body>" not in text:
    raise SystemExit("Source document has no closing body")
target.mkdir(parents=True,exist_ok=True)
(target/"salvi-isopsephy-functional.html").write_text(text.replace("</body>",injection+"</body>",1),encoding="utf-8")
(target/"folding-provenance.json").write_text(json.dumps({
    "source":"/capomastro/docs/salvi-isopsephy-engine-v0.0.20.html",
    "source_sha256":hashlib.sha256(original).hexdigest(),
    "adapter_sha256":hashlib.sha256((target/"folding-lab.js").read_bytes()).hexdigest(),
    "changes":"Document/text input, safe text rendering, bounded symbolic calculations; not a physical Unity proof."
},indent=2)+"\n")
assert source.read_bytes()==original
