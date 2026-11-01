#!/usr/bin/env python3
"""Render a sealed PDF without changing its bytes or relying on browser plugins."""
import hashlib
import gzip
import json
from pathlib import Path
import pymupdf as fitz

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "frontend/public/capomastro/docs/golden-arc-182-manifold-corpus.pdf"
DEST = ROOT / "frontend/public/capomastro/rendered/golden-arc"

def main():
    original = SOURCE.read_bytes()
    DEST.mkdir(parents=True, exist_ok=True)
    pages = []
    with fitz.open(SOURCE) as document:
        for index, page in enumerate(document):
            filename = f"page-{index+1}.svg"
            svg = page.get_svg_image(text_as_path=True).encode()
            (DEST / (filename+".gz")).write_bytes(gzip.compress(svg,mtime=0))
            (DEST / filename).unlink(missing_ok=True)
            pages.append({"page":index+1,"file":filename,"width":page.rect.width,"height":page.rect.height,
                          "text":page.get_text()})
        preview = ROOT / "generated-artifacts/codex"
        preview.mkdir(parents=True, exist_ok=True)
        document[0].get_pixmap(matrix=fitz.Matrix(1,1)).save(preview / "first-page.png")
    (DEST / "manifest.json").write_text(json.dumps({
        "source":"/capomastro/docs/golden-arc-182-manifold-corpus.pdf",
        "source_sha256":hashlib.sha256(original).hexdigest(),
        "renderer":f"PyMuPDF {fitz.VersionBind}",
        "pages":pages,
        "note":"Vector page renders of the original PDF, not rewritten source text."
    },ensure_ascii=False))
    if SOURCE.read_bytes()!=original:
        raise RuntimeError("The sealed source changed")
    print(f"Rendered {len(pages)} pages; {sum(p.stat().st_size for p in DEST.iterdir())} output bytes; original unchanged.")

if __name__=="__main__":
    main()
