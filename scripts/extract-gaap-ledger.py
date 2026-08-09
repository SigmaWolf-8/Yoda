#!/usr/bin/env python3
"""Extract the Capomastro Unified GAAP Ledger workbook into lossless JSON.

The workbook ships with formula cells whose cached values were stripped, so
every derived figure here is recomputed from the input cells rather than read
back from Excel.

All money and all derived quantities are computed with `decimal.Decimal` and
emitted as canonical decimal *strings*. Nothing monetary is ever put through a
binary float: `float` cannot represent most decimal fractions exactly, so a
round trip through it would silently perturb published figures. Counts and
booleans stay as JSON numbers/bools.

Source of truth:

    attached_assets/capomastro-gaap-ledger_(2)_1786254978509.xlsx

Output:

    data/capomastro/gaap-ledger.json

Run this again if the workbook is replaced:

    python3 scripts/extract-gaap-ledger.py
"""

from __future__ import annotations

import html
import json
import re
import sys
import zipfile
from decimal import Decimal, getcontext
from pathlib import Path

# Wide enough that the only inexact step (a division) carries far more
# significant digits than any figure we publish.
getcontext().prec = 60

# Ratios are irrational in general, so they are published at a fixed scale
# rather than pretending to be exact.
RATIO_SCALE = Decimal("0.000000000001")  # 12 dp
# Tolerance for "is this ratio equal to one", well inside RATIO_SCALE.
RATIO_EPSILON = Decimal("0.0000000001")

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "attached_assets" / "capomastro-gaap-ledger_(2)_1786254978509.xlsx"
OUT = ROOT / "data" / "capomastro" / "gaap-ledger.json"

CELL_RE = re.compile(r"<c\b[^>]*?r=\"([A-Z]+)(\d+)\"([^>]*)>(.*?)</c>", re.S)
ROW_RE = re.compile(r"<row\b[^>]*?r=\"(\d+)\"[^>]*>(.*?)</row>", re.S)
TEXT_RE = re.compile(r"<t[^>]*>(.*?)</t>", re.S)
VAL_RE = re.compile(r"<v>(.*?)</v>", re.S)
SHEET_RE = re.compile(r"<sheet\b[^>]*?name=\"([^\"]+)\"[^>]*?r:id=\"(rId\d+)\"", re.S)
REL_TAG_RE = re.compile(r"<Relationship\b([^>]*)/?>", re.S)
ATTR_RE = re.compile(r"(\w+)=\"([^\"]*)\"")


def read_rels(xml: str) -> dict[str, str]:
    """Map relationship Id -> Target, tolerant of attribute ordering."""
    rels: dict[str, str] = {}
    for attrs in REL_TAG_RE.findall(xml):
        attr = dict(ATTR_RE.findall(attrs))
        if "Id" in attr and "Target" in attr:
            rels[attr["Id"]] = attr["Target"]
    return rels


def dec_str(value: Decimal) -> str:
    """Canonical plain-decimal rendering — never scientific notation."""
    return format(value.normalize(), "f")


class DecimalEncoder(json.JSONEncoder):
    """Emit Decimal as an exact decimal string rather than a lossy float."""

    def default(self, o):  # noqa: D102
        if isinstance(o, Decimal):
            return dec_str(o)
        return super().default(o)


def clean(text: str) -> str:
    """Unescape XML entities and normalise whitespace, preserving the wording."""
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(html.unescape(text))
    return text.strip()


def read_sheet(zf: zipfile.ZipFile, path: str) -> list[list]:
    xml = zf.read(path).decode("utf-8")
    rows: list[list] = []
    for _row_no, body in ROW_RE.findall(xml):
        cells: list = []
        for _col, _r, attrs, cell_body in CELL_RE.findall(body):
            texts = TEXT_RE.findall(cell_body)
            if texts:
                cells.append(clean("".join(texts)))
                continue
            vals = VAL_RE.findall(cell_body)
            if vals and 't="s"' not in attrs:
                raw = clean(vals[0])
                try:
                    num = Decimal(raw)
                except ArithmeticError:
                    cells.append(raw)
                else:
                    # Whole numbers stay JSON numbers; anything with a
                    # fractional part is carried as an exact Decimal.
                    cells.append(int(num) if num == num.to_integral_value() else num)
            elif vals:
                cells.append(clean(vals[0]))
            else:
                cells.append("")
        while cells and cells[-1] == "":
            cells.pop()
        rows.append(cells)
    while rows and not rows[-1]:
        rows.pop()
    return rows


def find_row(rows: list[list], needle: str) -> list | None:
    needle = needle.lower()
    for row in rows:
        if row and isinstance(row[0], str) and needle in row[0].strip().lower():
            return row
    return None


def numeric(row: list | None) -> Decimal:
    """First numeric cell after the label, as an exact Decimal."""
    if not row:
        return Decimal(0)
    for cell in row[1:]:
        if isinstance(cell, Decimal):
            return cell
        if isinstance(cell, int) and not isinstance(cell, bool):
            return Decimal(cell)
    return Decimal(0)


def cell_decimal(row: list, index: int) -> Decimal:
    """Exact Decimal at `index`, or zero when absent/non-numeric."""
    if len(row) <= index:
        return Decimal(0)
    cell = row[index]
    if isinstance(cell, Decimal):
        return cell
    if isinstance(cell, int) and not isinstance(cell, bool):
        return Decimal(cell)
    return Decimal(0)


def build_summary(sheets: dict[str, list[list]]) -> dict:
    bs = sheets["Balance Sheet"]
    inc = sheets["Income Statement"]
    gold = sheets["Gold Assay & Valuation"]
    reg = sheets["Descendant Register 81"]
    xb = sheets["Cross-Balance Matrix"]

    current = [
        ("Cash & Cash Equivalents", numeric(find_row(bs, "Cash & Cash Equivalents"))),
        ("Stablecoin Reserve Liquidity", numeric(find_row(bs, "Stablecoin Reserve Liquidity"))),
        ("Short-Term Commercial Instruments", numeric(find_row(bs, "Short-Term Commercial Instruments"))),
    ]
    noncurrent = [
        ("Monetary Gold Reserves", numeric(find_row(bs, "Monetary Gold Reserves"))),
        ("Real Property & Land Estate Holdings", numeric(find_row(bs, "Real Property & Land Estate"))),
        ("Photonic & Agni Lattice Assets", numeric(find_row(bs, "Photonic & Agni Lattice"))),
    ]
    liabilities = [
        ("Stablecoin Backing Obligations", numeric(find_row(bs, "Stablecoin Backing Obligations"))),
        ("Fiat Matching Deposit Reserves", numeric(find_row(bs, "Fiat Matching Deposit Reserves"))),
        ("Active Damage Offset & Restorative Provision", numeric(find_row(bs, "Active Damage Offset"))),
    ]
    equity = [
        ("Sovereign Capital Reserve", numeric(find_row(bs, "Sovereign Capital Reserve"))),
        ("Retained Equilibrium Earnings", numeric(find_row(bs, "Retained Equilibrium Earnings"))),
    ]

    total_current = sum((v for _, v in current), Decimal(0))
    total_noncurrent = sum((v for _, v in noncurrent), Decimal(0))
    total_assets = total_current + total_noncurrent
    total_liabilities = sum((v for _, v in liabilities), Decimal(0))
    total_equity = sum((v for _, v in equity), Decimal(0))

    # Reserve-asset composition. Computed here, with the same exact arithmetic
    # as every other figure, so the API layer never has to do money maths.
    segment_mix = sorted(
        (
            {
                "label": label,
                "value": value,
                "share": (value / total_assets).quantize(RATIO_SCALE)
                if total_assets
                else Decimal(0),
            }
            for label, value in current + noncurrent
            if value > 0
        ),
        key=lambda s: s["value"],
        reverse=True,
    )

    bars = numeric(find_row(gold, "Total Gold Bars Counted"))
    mass_per_bar = numeric(find_row(gold, "Nominal Mass per Bar"))
    purity = numeric(find_row(gold, "Fine Gold Purity"))
    troy_factor = numeric(find_row(gold, "Troy Ounce Conversion Factor"))
    spot = numeric(find_row(gold, "LBMA PM Gold Fix Price"))
    carrying = numeric(find_row(gold, "Conservative Stated Carrying Value"))
    net_mass = bars * mass_per_bar
    fine_mass = net_mass * purity
    fine_ounces = fine_mass * troy_factor
    fair_value = fine_ounces * spot

    generations = []
    for row in reg:
        if row and isinstance(row[0], str) and row[0].strip().lower().startswith("generation "):
            label = row[0].strip()
            if label.lower() == "generation":
                continue
            epoch = row[1] if len(row) > 1 else ""
            count = int(cell_decimal(row, 2))
            node = row[3] if len(row) > 3 else ""
            generations.append({"generation": label, "epoch": epoch, "offspring": count, "nodeId": node})
    total_nodes = sum(g["offspring"] for g in generations)

    # A head count, not money — an int is the right type here. Cells are only
    # ever int or Decimal after `read_sheet`; there are no floats to guard against.
    descendants_row = find_row(reg, "Total Registered Descendants")
    descendants = int(numeric(descendants_row))

    def digital_root(n: int) -> int:
        return 0 if n == 0 else 1 + (n - 1) % 9

    legs = []
    for row in xb:
        if row and isinstance(row[0], str) and row[0].strip().lower().startswith("leg "):
            asset = cell_decimal(row, 2)
            reserve = cell_decimal(row, 3)
            weight = cell_decimal(row, 4)
            # The only division in the pipeline; carried at 60 significant
            # digits and published at a declared scale.
            ratio = (asset / reserve) if reserve else Decimal(0)
            legs.append(
                {
                    "leg": row[0].strip(),
                    "description": row[1] if len(row) > 1 else "",
                    "asset": asset,
                    "reserve": reserve,
                    "weight": weight,
                    "weightedRatio": (weight * ratio).quantize(RATIO_SCALE),
                }
            )
    x_cross = sum((leg["weightedRatio"] for leg in legs), Decimal(0))

    return {
        "balanceSheet": {
            "currentAssets": [{"label": k, "value": v} for k, v in current],
            "nonCurrentAssets": [{"label": k, "value": v} for k, v in noncurrent],
            "liabilities": [{"label": k, "value": v} for k, v in liabilities],
            "equity": [{"label": k, "value": v} for k, v in equity],
            "totalCurrentAssets": total_current,
            "totalNonCurrentAssets": total_noncurrent,
            "totalAssets": total_assets,
            "totalLiabilities": total_liabilities,
            "totalEquity": total_equity,
            "totalLiabilitiesAndEquity": total_liabilities + total_equity,
            # Exact: every input and every total above is a Decimal sum.
            "balanced": total_assets == total_liabilities + total_equity,
        },
        "segmentMix": segment_mix,
        "incomeStatement": {
            "grossRevenue": numeric(find_row(inc, "Gross Revenue")),
            "costOfGoodsSold": numeric(find_row(inc, "Cost of Goods Sold")),
            "lines": [
                {
                    "label": row[0].strip(),
                    "amount": cell_decimal(row, 1),
                    "basis": row[2] if len(row) > 2 else "",
                }
                for row in inc
                if row
                and isinstance(row[0], str)
                and len(row) > 1
                and isinstance(row[1], (int, Decimal))
                and not isinstance(row[1], bool)
            ],
        },
        "goldAssay": {
            "barsCounted": bars,
            "nominalMassPerBarKg": mass_per_bar,
            "netGoldMassKg": net_mass,
            "finePurity": purity,
            "fineGoldMassKg": fine_mass,
            "troyOunceFactor": troy_factor,
            "fineGoldOunces": fine_ounces,
            "lbmaSpotUsdPerOz": spot,
            "fairMarketValueUsd": fair_value,
            "carryingValueUsd": carrying,
            # Exact: bars, mass, purity and spot are all multiplied, never divided.
            "unrecordedReserveBufferUsd": fair_value - carrying,
        },
        "descendantRegister": {
            "generations": generations,
            "totalActiveNodes": total_nodes,
            "totalRegisteredDescendants": descendants,
            "digitalRoot": digital_root(descendants),
            "harmonic": descendants % 9 == 0,
        },
        "crossBalance": {
            "legs": legs,
            "xCross": x_cross,
            "equilateral": abs(x_cross - Decimal(1)) < RATIO_EPSILON,
        },
    }


def main() -> int:
    if not SRC.exists():
        print(f"source workbook missing: {SRC}", file=sys.stderr)
        return 1

    with zipfile.ZipFile(SRC) as zf:
        workbook = zf.read("xl/workbook.xml").decode("utf-8")
        rels = read_rels(zf.read("xl/_rels/workbook.xml.rels").decode("utf-8"))
        ordered: list[tuple[str, str]] = []
        for name, rid in SHEET_RE.findall(workbook):
            target = rels[rid].lstrip("/")
            if not target.startswith("xl/"):
                target = "xl/" + target
            ordered.append((html.unescape(name), target))
        sheets = {name: read_sheet(zf, target) for name, target in ordered}

    toc = sheets["Table of Contents"]
    header = [row[0] for row in toc[:4] if row and isinstance(row[0], str) and row[0]]

    document = {
        "source": SRC.name,
        "entity": header[0] if header else "CAPOMASTRO HOLDINGS LTD.",
        "division": header[1] if len(header) > 1 else "",
        "version": header[2] if len(header) > 2 else "",
        "sheetOrder": [name for name, _ in ordered],
        "sheets": {
            name: {"rows": rows}
            for name, rows in sheets.items()
        },
        "summary": build_summary(sheets),
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(document, indent=2, ensure_ascii=False, cls=DecimalEncoder) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes)")
    s = document["summary"]
    print("  total assets      :", dec_str(s["balanceSheet"]["totalAssets"]))
    print("  liabilities+equity:", dec_str(s["balanceSheet"]["totalLiabilitiesAndEquity"]))
    print("  balanced          :", s["balanceSheet"]["balanced"])
    print("  fine gold oz      :", dec_str(s["goldAssay"]["fineGoldOunces"]))
    print("  fair market value :", dec_str(s["goldAssay"]["fairMarketValueUsd"]))
    print("  X_cross           :", dec_str(s["crossBalance"]["xCross"]))
    print("  descendants       :", s["descendantRegister"]["totalRegisteredDescendants"],
          "root", s["descendantRegister"]["digitalRoot"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
