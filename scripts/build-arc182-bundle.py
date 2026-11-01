#!/usr/bin/env python3
"""Package the user-supplied engine verbatim; inventory bytes, not accuracy claims."""
import hashlib
import json
import shutil
import zipfile
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "attached_assets/isopsephy_engine_globe_package_v0_0_20_1793496691345.zip"
SPEC = ROOT / "attached_assets/Pasted--Specification-Arc182-Earth-Reconstruction-Engine-Docum_1793497307460.txt"
DEST = ROOT / "frontend/public/capomastro/engines/arc182"

class Blocks(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.current = None
        self.blocks = {}
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script" and attrs.get("type") == "text/plain":
            self.current = attrs.get("id", "unnamed")
            self.blocks[self.current] = ""
    def handle_data(self, data):
        if self.current is not None:
            self.blocks[self.current] += data
    def handle_endtag(self, tag):
        if tag == "script":
            self.current = None

def digest(data):
    return hashlib.sha256(data).hexdigest()

def main():
    DEST.mkdir(parents=True, exist_ok=True)
    files = []
    with zipfile.ZipFile(ARCHIVE) as archive:
        if sum(info.file_size for info in archive.infolist()) > 20_000_000:
            raise ValueError("Unexpected package size")
        for info in archive.infolist():
            path = PurePosixPath(info.filename)
            if path.is_absolute() or ".." in path.parts or path.parts[0] != "isopsephy_package":
                raise ValueError("Unsafe package path")
            if info.is_dir():
                continue
            relative = Path(*path.parts[1:])
            data = archive.read(info)
            output = DEST / relative
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(data)
            files.append({"path": relative.as_posix(), "bytes": len(data), "sha256": digest(data)})
    shutil.copyfile(ARCHIVE, DEST / "complete-package.zip")
    shutil.copyfile(SPEC, DEST / "specification.txt")
    adapter = (ROOT / "scripts/arc182-accessibility.js").read_text()
    adapted = []
    for original in ("names99_glyph_engine_globe.html", "isopsephy_amd_v0_0_20.html"):
        html = (DEST / original).read_text()
        derived = html.replace("</body>", f"<script>\n{adapter}\n</script>\n</body>")
        name = "accessible-" + original
        (DEST / name).write_text(derived)
        adapted.append({"path":name,"sha256":digest(derived.encode()),"original":original,
                        "changes":"Keyboard/touch controls, canvas description and reduced-motion adapter; original arithmetic and datasets unchanged"})
    blocks = Blocks()
    blocks.feed((DEST / "names99_glyph_engine_globe.html").read_text())
    manifest = {
        "schema": 1, "artifact": "Arc182 Earth / Isopsephy supplied package",
        "tier": "Tier 1 visual/cartographic; Tier 2 inputs absent",
        "archiveSha256": digest(ARCHIVE.read_bytes()),
        "files": files,
        "adaptedViews": adapted,
        "blocks": [{"id": key, "bytes": len(value.encode()), "sha256": digest(value.encode())}
                   for key, value in blocks.blocks.items()],
        "provenance": {
            "basemap": "Supplier-declared Natural Earth 110m; release and extraction date not pinned in package",
            "relief": "Supplier-declared ETOPO 180×360 coarse grid; upstream version and resampling chain not independently established",
            "heightDatum": "Source says metres relative to sea level. Without a declared geoid transformation, do not relabel these values as ellipsoidal heights.",
            "ellipsoid": "Supplied renderer uses b/a = 6356.752/6378.137; b=6356752 m is ~0.314245 m below the full WGS84 derived value. Not millimetre-accurate.",
            "missingTier2": ["geoid grid", "30 m DEM", "authoritative high-resolution coastline", "per-layer uncertainty and benchmark evidence"],
            "limits": "File/block hashes establish byte identity only. They do not verify source accuracy, upstream licensing, standards compliance or survey certification.",
        },
    }
    (DEST / "provenance.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print(f"Packaged {len(files)} original files and {len(blocks.blocks)} text blocks without editing originals.")

if __name__ == "__main__":
    main()
