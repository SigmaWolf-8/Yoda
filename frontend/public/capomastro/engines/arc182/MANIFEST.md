# Isopsephy Engine + Earth Globe — Package Manifest

**Owner:** R. Salvalaggio (Σάλβιος) | Capomastro Holdings | Applied Physics Division
**Purpose:** Self-contained isopsephy (Milesian gematria) engine with sovereign-canvas WGS84 Earth globe.
**Latest version:** v0.0.20 (Vietnamese-aware, glyph audit, values audited)

## Primary deliverable
- `isopsephy_amd_v0_0_20.html` — the AMD (Arc182 Markdown Document). Opens in any browser; recomputes
  every Milesian isopsephy value in-browser (rejection-based §0 assertions), renders the sovereign-canvas
  WGS84 globe (ellipsoid + Natural Earth coastlines + ETOPO relief shader + azimuthal-equidistant mode +
  graticule). Zero external dependencies.
- `names99_glyph_engine_globe.html` — the 99-names glyph engine variant with globe map.

## /engine — source
- `isopsephy_engine_v0_0_20.py` — canonical engine. Usage: `python isopsephy_engine.py <source.txt> <out_dir>`
- `formulario.txt` — the source corpus (input to the engine).

## /globe_data — sovereign globe glyph assets (no CDN, all local)
- `coast_glyph.txt` — Natural Earth coastlines
- `borders_glyph.txt` — national borders
- `elev_glyph.txt` — ETOPO elevation/relief field
- `land_glyph.txt`, `lakes_glyph.txt`, `mtn_glyph.txt` — land polygons, lakes, mountains

## /outputs — generated reports
- `isopsephy_amd.md` — the AMD in Markdown
- `formulario_isopsephy_amd.md` — corpus-specific AMD
- `names99_*.{md,csv}` — 99-names registers (all-registers, equivalence, nine-registers, six-register,
  Phoenician, Abjad) in Markdown + CSV

## /skill — packaged skill
- `isopsephy-engine-skill-v0_0_20.zip` — the isopsephy-engine skill bundle (SKILL.md + scripts)

## /audits — verification renders
- `globe_audit.png`, `globe_solid_audit.png` — globe render audits
- `names99_globe_map.png` — 99-names globe
- `arc182_geometry.png`, `vesica_153.png`, `dr_distribution.png` — framework geometry audits

## Conventions (carried from the framework / Repunit Ramp monograph)
- Bijective base-b, zero-free; keystone b=3 selected by C(b)/P(b) divisibility.
- Milesian values audited; Vietnamese đ premap fix applied.
- Sovereign: zero external dependencies, pure Canvas 2D.

Così sia.
