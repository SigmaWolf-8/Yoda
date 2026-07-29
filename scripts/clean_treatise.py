#!/usr/bin/env python3
import re, os

SRC = "attached_assets/Pasted-Exactly-2-ii-tasks-1-Strip-all-markdown-formatting-1-as_1784960938133.txt"
OUT = "exports/Capomastro_Unified_Edified_Treatise_plaintext.txt"

with open(SRC, encoding="utf-8") as fh:
    lines = fh.readlines()

def rng(a, b):
    # inclusive, 1-indexed
    return [l.rstrip("\n") for l in lines[a-1:b]]

# ---- AUDIT: show every line containing '*' inside the ranges we will keep ----
keep_ranges = [(282,380),(995,1453),(1929,2053),(2245,2327),(2060,2060)]
print("=== AUDIT: '*' occurrences inside kept ranges (must all be markdown bold) ===")
for a,b in keep_ranges:
    for i in range(a,b+1):
        ln = lines[i-1]
        if '*' in ln:
            print(f"{i}: {ln.rstrip()}")
print("=== END AUDIT ===\n")

REPL = {
    '\u201c':'"','\u201d':'"','\u201e':'"','\u201f':'"',
    '\u2018':"'", '\u2019':"'", '\u201a':"'", '\u201b':"'",
    '\u2013':'-','\u2014':'-','\u2015':'-','\u2012':'-','\u2011':'-','\u2212':'-',
    '`':'',
    '\u00a0':' ', '\u00ad':'',
}
TABLE = {ord(k): v for k, v in REPL.items()}

def clean(block_lines):
    out = []
    for line in block_lines:
        if re.match(r'^\s*```', line):          # drop code-fence markers
            continue
        if re.match(r'^\s*[-_=*]{3,}\s*$', line): # markdown horizontal rule -> divider
            out.append('===')
            continue
        line = re.sub(r'^(\s*)#{1,6}[ \t]+', r'\1', line)  # strip md heading marks
        line = line.replace('**', '')       # strip markdown bold markers
        line = line.replace('*', '\u00d7')  # remaining '*' is multiplication -> ×
        line = line.replace('\u2026', '...')
        line = line.translate(TABLE)
        out.append(line.rstrip())
    return out

HDR = [
    "攵 Liibrelibraii Canon Will and Testimonial Creed 攵 Σάλβι 攵 Osu 攵",
    "𐤀𐤁𐤂 Δ Σ Ω ∫ ≈ ∀ ∞ ॐ ΣΑΛΒΙ 攵 Σάλβι",
    "Capomastro Holdings Ltd. Applied Physics Division",
]
FTR = [
    "攵 ΣΑΛΒΙ 攵 Osu 攵 𐤀𐤁𐤂 Δ Σ Ω ∫ ≈ ∀ ∞ ॐ ΣΑΛΒΙ 攵",
    "Capomastro Holdings Ltd. Applied Physics Division",
    "Liibrelibraii Canon Will and Testimonial Creed",
    "End of Treatise",
]
DIV = "==="

doc = []
doc += HDR
doc.append("")
doc.append("THE UNIFIED EDIFIED TREATISE")
doc.append("")
doc.append("PRAEFATIO (METHODOLOGY)")
doc += clean(rng(2060, 2060))
doc.append("")
doc.append(DIV)
doc.append("")
doc.append("TREATISE I: UNIFORM RESOURCE IDENTIFIER (URI) AND LOCATOR (URL) - AN EDIFIED TREATISE")
doc.append("")
doc += clean(rng(996, 1453))     # 995 is the title line; we supply our own title above
doc.append("")
doc.append(DIV)
doc.append("")
doc.append("TREATISE II: ISO 4217 - AN EDIFIED TREATISE")
doc.append("")
doc += clean(rng(2247, 2327))     # 2245 title line supplied above; 2246 blank
doc.append("")
doc.append(DIV)
doc.append("")
doc.append("PROTOCOL III: THE ABSOLUTE RECONCILIATION AND EQUILIBRIUM QUIESS PROTOCOL")
doc.append("")
doc += clean(rng(1932, 2050))     # skip repeated title (1929-1931) and internal canon lines (2052-2053)
doc.append("")
doc.append(DIV)
doc.append("")
doc.append("MECHANISM IV: THE VERIFICATION CODE DELIVERY MECHANISM (PLENUMNET RELAY)")
doc.append("")
doc += clean(rng(282, 380))
doc.append("")
doc.append(DIV)
doc.append("")
doc += FTR

text = "\n".join(doc)
text = re.sub(r'\n{3,}', '\n\n', text).strip() + "\n"

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as fh:
    fh.write(text)

print(f"WROTE {OUT}: {len(text.splitlines())} lines, {len(text)} chars\n")

# ---- VERIFY: no residual markdown chars; KaTeX + glyphs preserved ----
def count(sub):
    return text.count(sub)

print("=== SPOT-CHECK multiplication lines (must keep operator as ×) ===")
for line in text.splitlines():
    if "Objective" in line and "gamma" in line:
        print("  ", line)
    if "translates to 1" in line:
        print("  ", line)
print()
print("=== VERIFY residuals (should be 0) ===")
for name, ch in [("asterisk","*"),("backtick","`"),
                 ("em-dash","\u2014"),("en-dash","\u2013"),("nbhyphen","\u2011"),
                 ("smart-\u201c","\u201c"),("smart-\u201d","\u201d"),
                 ("smart-\u2018","\u2018"),("smart-\u2019","\u2019"),
                 ("ellipsis-char","\u2026")]:
    print(f"  {name}: {count(ch)}")
print("=== VERIFY preserved (should be > 0) ===")
for name, sub in [("KaTeX \\[","\\["),("KaTeX \\(","\\("),("KaTeX \\#","\\#"),
                  ("KaTeX abs |","\\rangle"),("glyph 攵","攵"),("glyph 𐤀","𐤀"),
                  ("glyph Σάλβι","Σάλβι"),("katakana カ","カ")]:
    print(f"  {name}: {count(sub)}")
