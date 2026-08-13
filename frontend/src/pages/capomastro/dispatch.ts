/**
 * Turning a screen into something you can send.
 *
 * Each builder here produces one {@link Dispatch}: a rich flavour for mail
 * clients and a plain flavour for message apps. Both are generated from the
 * same values in the same pass, so a recipient reading the SMS and a recipient
 * reading the email are never looking at different figures.
 *
 * Two rules govern all of it.
 *
 * Money is never re-derived. Every figure is formatted by `./money` from the
 * exact decimal strings the ledger already holds — this module does no
 * arithmetic, so a copy cannot disagree with the page it was copied from.
 *
 * Sealed text is never re-worded. The Codex builder carries the document across
 * verbatim: it strips scripts and styling and re-tags the markup for mail, but
 * it never summarises, reflows or paraphrases, and it names the canonical file
 * so a reader can always go back to the sealed original.
 */

import type { Dispatch } from '../../lib/clipboard';
import { type Dec, exact, exactTo, percent, usd } from './money';

// ── Ledger payload shapes (shared with SovereignLedgerPage) ──

export interface Segment {
  label: string;
  value: Dec;
  share: Dec;
}

export interface CrossLeg {
  leg: string;
  description: string;
  asset: Dec;
  reserve: Dec;
  weight: Dec;
  weightedRatio: Dec;
}

export interface Generation {
  generation: string;
  epoch: string;
  offspring: number;
  nodeId: string;
}

export interface RevenueResponse {
  entity: string;
  version: string;
  accrualGroundState: { grossRevenue: Dec; costOfGoodsSold: Dec; note: string };
  kpis: {
    totalAssets: Dec;
    totalLiabilities: Dec;
    totalEquity: Dec;
    balanced: boolean;
    goldFairMarketValue: Dec;
    goldCarryingValue: Dec;
    unrecordedReserveBuffer: Dec;
    xCross: Dec;
  };
  segmentMix: Segment[];
  crossBalance: { legs: CrossLeg[]; xCross: Dec; equilateral: boolean };
  goldAssay: {
    barsCounted: Dec;
    nominalMassPerBarKg: Dec;
    netGoldMassKg: Dec;
    finePurity: Dec;
    fineGoldMassKg: Dec;
    troyOunceFactor: Dec;
    fineGoldOunces: Dec;
    lbmaSpotUsdPerOz: Dec;
    fairMarketValueUsd: Dec;
    carryingValueUsd: Dec;
    unrecordedReserveBufferUsd: Dec;
  };
  descendantRegister: {
    generations: Generation[];
    totalActiveNodes: number;
    totalRegisteredDescendants: number;
    digitalRoot: number;
    harmonic: boolean;
  };
}

export interface MeasurementField {
  key: string;
  value: string;
  unit: string;
}

export interface SealedMeasurement {
  file: string;
  record: string;
  version: string;
  schema: string;
  fields: MeasurementField[];
  pif127: string | null;
}

// ── Shared formatting ──

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const SERIF = "Georgia,'Times New Roman',serif";

const S = {
  root: `font-family:${SERIF};color:#14110e;font-size:14px;line-height:1.55;max-width:720px`,
  h1: 'margin:0;font-size:19px;font-weight:bold;letter-spacing:.02em;color:#0a2540',
  sub: 'margin:2px 0 0;font-size:12px;color:#5a5348',
  h2: 'margin:22px 0 8px;font-size:13px;font-weight:bold;text-transform:uppercase;letter-spacing:.08em;color:#0a2540;border-bottom:1px solid #c8bfae;padding-bottom:3px',
  p: 'margin:8px 0;font-size:14px;line-height:1.55',
  table: 'border-collapse:collapse;width:100%;font-size:13px;margin:6px 0',
  th: 'border-bottom:1px solid #0a2540;padding:5px 8px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#4a443b',
  td: 'border-bottom:1px solid #e2dcd0;padding:5px 8px;vertical-align:top',
  num: 'border-bottom:1px solid #e2dcd0;padding:5px 8px;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums',
  foot: 'margin-top:20px;border-top:2px solid #0a2540;padding-top:8px;font-size:11px;line-height:1.5;color:#5a5348',
};

/** Frame a body in the house style. A fragment, not a document — mail clients paste fragments. */
function frame(title: string, subtitle: string, body: string, footer: string): string {
  return [
    `<div style="${S.root}">`,
    `<div style="border-bottom:3px double #0a2540;padding-bottom:8px">`,
    `<p style="${S.h1}">${esc(title)}</p>`,
    `<p style="${S.sub}">${esc(subtitle)}</p>`,
    `</div>`,
    body,
    `<div style="${S.foot}">${footer}</div>`,
    `</div>`,
  ].join('');
}

const RULE = '─'.repeat(46);

function heading(text: string): string {
  return `\n${text.toUpperCase()}\n${RULE}\n`;
}

/** Two-column "label … value" list, aligned for a monospaced or plain reader. */
function pairsText(rows: [string, string][]): string {
  const width = Math.min(28, Math.max(...rows.map(([k]) => k.length)));
  return rows.map(([k, v]) => `  ${k.padEnd(width)}  ${v}`).join('\n');
}

function pairsHtml(rows: [string, string][]): string {
  return [
    `<table style="${S.table}">`,
    ...rows.map(
      ([k, v]) =>
        `<tr><td style="${S.td}">${esc(k)}</td><td style="${S.num}">${esc(v)}</td></tr>`,
    ),
    `</table>`,
  ].join('');
}

function tableHtml(headers: string[], rows: string[][], numeric: boolean[]): string {
  return [
    `<table style="${S.table}">`,
    `<tr>${headers
      .map((h, i) => `<th style="${S.th}${numeric[i] ? ';text-align:right' : ''}">${esc(h)}</th>`)
      .join('')}</tr>`,
    ...rows.map(
      (r) =>
        `<tr>${r
          .map((c, i) => `<td style="${numeric[i] ? S.num : S.td}">${esc(c)}</td>`)
          .join('')}</tr>`,
    ),
    `</table>`,
  ].join('');
}

/** Column-aligned plain-text table. Kept narrow so it survives a phone screen. */
function tableText(headers: string[], rows: string[][], numeric: boolean[]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  );
  const line = (cells: string[]) =>
    '  ' +
    cells
      .map((c, i) => (numeric[i] ? c.padStart(widths[i]) : c.padEnd(widths[i])))
      .join('  ')
      .trimEnd();
  return [
    line(headers),
    '  ' + widths.map((w) => '─'.repeat(w)).join('  '),
    ...rows.map(line),
  ].join('\n');
}

function stamp(now: Date): string {
  return now.toLocaleString('en-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── The Ledger ──

const UNAUDITED_TEXT =
  'UNAUDITED. Compiled from the records of the estate. No audit or review has been ' +
  'performed and no assurance is expressed. Figures accrue against live published ' +
  'reference rates, so copies taken at different times will legitimately differ.';

export function buildLedgerDispatch(
  data: RevenueResponse,
  measurements: SealedMeasurement[],
  now: Date,
): Dispatch {
  const { kpis, goldAssay, crossBalance, descendantRegister, accrualGroundState } = data;
  const asAt = stamp(now);

  const position: [string, string][] = [
    ['Total assets (Σ Aₙ)', `$${exact(kpis.totalAssets)}`],
    ['Total liabilities (Σ Lₘ)', `$${exact(kpis.totalLiabilities)}`],
    ['Sovereign equity', `$${exact(kpis.totalEquity)}`],
    [
      'Balance sheet check',
      kpis.balanced ? 'ΣA = ΣL + ΣE — balanced' : 'Does not reconcile',
    ],
    [
      'Cross-balance X_cross',
      `${exactTo(kpis.xCross, 4)}${crossBalance.equilateral ? ' — equilateral' : ' — not equilateral'}`,
    ],
  ];

  const accrual: [string, string][] = [
    ['Gross revenue', `$${exact(accrualGroundState.grossRevenue)}`],
    ['Cost of goods sold', `$${exact(accrualGroundState.costOfGoodsSold)}`],
  ];

  const mixRows = data.segmentMix.map((s) => [s.label, usd(s.value, 3), `${percent(s.share)} %`]);

  const assay: [string, string][] = [
    ['Bars counted', exact(goldAssay.barsCounted)],
    ['Nominal mass / bar', `${goldAssay.nominalMassPerBarKg} kg`],
    ['Net gold mass', `${exact(goldAssay.netGoldMassKg)} kg`],
    ['Fine purity (assay)', `${percent(goldAssay.finePurity)} %`],
    ['Fine gold mass', `${exact(goldAssay.fineGoldMassKg)} kg`],
    ['Fine gold ounces', `${exact(goldAssay.fineGoldOunces)} troy oz`],
    ['LBMA PM fix', `$${exact(goldAssay.lbmaSpotUsdPerOz)} / troy oz`],
    ['Fair market value', `$${exact(goldAssay.fairMarketValueUsd)}`],
    ['Carrying value', `$${exact(goldAssay.carryingValueUsd)}`],
    ['Unrecorded reserve buffer', `$${exact(goldAssay.unrecordedReserveBufferUsd)}`],
  ];

  const legRows = crossBalance.legs.map((l) => [
    l.leg,
    usd(l.asset, 3),
    usd(l.reserve, 3),
    exactTo(l.weight, 2),
    exactTo(l.weightedRatio, 4),
  ]);

  const register: [string, string][] = [
    ['Total active nodes (Σ gᵢ)', String(descendantRegister.totalActiveNodes)],
    [
      'Registered descendants',
      descendantRegister.totalRegisteredDescendants.toLocaleString('en-US'),
    ],
    ['Digital root', String(descendantRegister.digitalRoot)],
    [
      'Harmonic balance',
      descendantRegister.harmonic
        ? 'S_genealogy ≡ 0 (mod 9) — harmonic'
        : 'S_genealogy ≢ 0 (mod 9)',
    ],
  ];

  const sealedRows = measurements.map((m) => {
    const balanced = m.fields.find((f) => f.key === 'gaap_balanced')?.value === 'true';
    return [m.record, `${m.version} · ${m.schema}`, balanced ? 'GAAP BALANCED' : 'UNBALANCED'];
  });

  const html = frame(
    data.entity,
    `Sovereign Ledger — ${data.version} · as at ${asAt}`,
    [
      `<p style="${S.h2}">Statement of position</p>`,
      pairsHtml(position),
      `<p style="${S.h2}">Accrual ground state</p>`,
      pairsHtml(accrual),
      `<p style="${S.p}"><em>${esc(accrualGroundState.note)}</em></p>`,
      `<p style="${S.h2}">Reserve composition</p>`,
      tableHtml(['Segment', 'Value', 'Share'], mixRows, [false, true, true]),
      `<p style="${S.h2}">Gold assay — WP-2026-AU-820-GOLD</p>`,
      pairsHtml(assay),
      `<p style="${S.h2}">Weighted quadrilateral cross-balance (X_cross)</p>`,
      tableHtml(
        ['Leg', 'Asset Aᵢ', 'Reserve Bᵢ', 'Weight wᵢ', 'wᵢ · Aᵢ/Bᵢ'],
        legRows,
        [false, true, true, true, true],
      ),
      `<p style="${S.p}"><strong>Total X_cross: ${esc(exactTo(crossBalance.xCross, 4))}</strong></p>`,
      `<p style="${S.h2}">Descendant register 81 — modulo 9 harmonic balance</p>`,
      pairsHtml(register),
      sealedRows.length
        ? `<p style="${S.h2}">Sealed token measurements (.fcx)</p>` +
          tableHtml(['Record', 'Version / schema', 'State'], sealedRows, [false, false, false])
        : '',
    ].join(''),
    esc(UNAUDITED_TEXT),
  );

  const text = [
    data.entity.toUpperCase(),
    `Sovereign Ledger — ${data.version}`,
    `As at ${asAt}`,
    '',
    heading('Statement of position'),
    pairsText(position),
    heading('Accrual ground state'),
    pairsText(accrual),
    `\n  ${accrualGroundState.note}`,
    heading('Reserve composition'),
    tableText(['Segment', 'Value', 'Share'], mixRows, [false, true, true]),
    heading('Gold assay — WP-2026-AU-820-GOLD'),
    pairsText(assay),
    heading('Weighted quadrilateral cross-balance'),
    tableText(
      ['Leg', 'Asset', 'Reserve', 'Weight', 'w·A/B'],
      legRows,
      [false, true, true, true, true],
    ),
    `\n  Total X_cross: ${exactTo(crossBalance.xCross, 4)}`,
    heading('Descendant register 81'),
    pairsText(register),
    sealedRows.length
      ? heading('Sealed token measurements (.fcx)') +
        sealedRows.map(([r, v, s]) => `  • ${r}\n    ${v} — ${s}`).join('\n')
      : '',
    '',
    RULE,
    UNAUDITED_TEXT,
  ].join('\n');

  return { html, text };
}

// ── The Seals ──

export interface SealMark {
  id: string;
  title: string;
  caption: string;
  src: string;
}

export interface SealLink {
  label: string;
  href: string;
  detail: string;
}

/**
 * Total characters of embedded image data allowed in one copy.
 *
 * Capping each plate's dimensions bounds nothing on its own — detail, not size,
 * decides how a JPEG compresses. Mail clients and the clipboard itself start
 * refusing or truncating payloads in the low megabytes, and a copy that is
 * silently truncated is worse than one that is honestly short, so the plates
 * are embedded in order until the budget is spent and the rest are linked.
 */
const INLINE_BUDGET = 700_000;

export function buildSealDispatch(
  groups: { heading: string; marks: SealMark[] }[],
  links: SealLink[],
  origin: string,
  /** id → data URI. Plates without an entry are named and linked, not pictured. */
  inlined: Record<string, string>,
  now: Date,
): Dispatch {
  const linkInBio = `${origin}/capomastro/docs/link-in-bio.html`;

  const embedded: Record<string, string> = {};
  const linkedOnly: SealMark[] = [];
  let spent = 0;
  for (const group of groups) {
    for (const mark of group.marks) {
      const uri = inlined[mark.id];
      if (uri && spent + uri.length <= INLINE_BUDGET) {
        embedded[mark.id] = uri;
        spent += uri.length;
      } else {
        linkedOnly.push(mark);
      }
    }
  }

  const plateHtml = (m: SealMark) => {
    const img = embedded[m.id]
      ? `<img src="${embedded[m.id]}" alt="${esc(m.title)}" width="220" style="display:block;border:1px solid #c8bfae;margin-bottom:6px" />`
      : `<div style="font-size:12px"><a href="${esc(origin + m.src)}" style="color:#0a2540">View this plate</a></div>`;
    return [
      `<div style="margin:0 0 16px">`,
      img,
      `<div style="font-size:13px;font-weight:bold;color:#0a2540">${esc(m.title)}</div>`,
      `<div style="font-size:12px;color:#5a5348">${esc(m.caption)}</div>`,
      `</div>`,
    ].join('');
  };

  const html = frame(
    'Capomastro — Seal & Presence',
    `Heraldic identity, archival receipts and the public record · ${stamp(now)}`,
    [
      ...groups.map((g) =>
        [`<p style="${S.h2}">${esc(g.heading)}</p>`, ...g.marks.map(plateHtml)].join(''),
      ),
      `<p style="${S.h2}">Public presence</p>`,
      `<table style="${S.table}">`,
      ...links.map(
        (l) =>
          `<tr><td style="${S.td}"><a href="${esc(l.href)}" style="color:#0a2540">${esc(l.label)}</a><div style="font-size:12px;color:#5a5348">${esc(l.detail)}</div></td></tr>`,
      ),
      `<tr><td style="${S.td}"><a href="${esc(linkInBio)}" style="color:#0a2540">Link-in-bio page</a><div style="font-size:12px;color:#5a5348">The standalone public landing page, served as authored.</div></td></tr>`,
      `</table>`,
    ].join(''),
    'The marks above are reproductions of the sealed plates, carried inline so they ' +
      'travel with this message. The archival receipts are records of deposit, not ' +
      'certificates of title.' +
      (linkedOnly.length
        ? ` ${linkedOnly.length} plate${linkedOnly.length === 1 ? ' is' : 's are'} linked ` +
          'rather than embedded, to keep this copy small enough to send: ' +
          linkedOnly.map((m) => esc(m.title)).join('; ') +
          '.'
        : ''),
  );

  const text = [
    'CAPOMASTRO — SEAL & PRESENCE',
    `Heraldic identity, archival receipts and the public record`,
    stamp(now),
    ...groups.flatMap((g) => [
      heading(g.heading),
      g.marks.map((m) => `  • ${m.title}\n    ${m.caption}`).join('\n'),
    ]),
    heading('Public presence'),
    links.map((l) => `  • ${l.label}\n    ${l.detail}\n    ${l.href}`).join('\n'),
    `  • Link-in-bio page\n    ${linkInBio}`,
    '',
    RULE,
    'The archival receipts are records of deposit, not certificates of title.',
  ].join('\n');

  return { html, text };
}

// ── The Codex ──

/** Elements that carry no readable content, or that must never reach a mail client. */
const DROP =
  'script,style,link,meta,noscript,iframe,object,embed,svg,canvas,form,input,button,template';

const TAG_STYLE: Record<string, string> = {
  H1: 'font-size:19px;color:#0a2540;margin:20px 0 8px',
  H2: 'font-size:16px;color:#0a2540;border-bottom:1px solid #0a2540;padding-bottom:3px;margin:22px 0 8px',
  H3: 'font-size:14px;color:#0a2540;margin:16px 0 6px',
  H4: 'font-size:13px;color:#0a2540;margin:14px 0 6px',
  P: 'margin:8px 0;font-size:14px;line-height:1.55',
  UL: 'margin:8px 0 8px 18px;padding:0',
  OL: 'margin:8px 0 8px 18px;padding:0',
  LI: 'margin:3px 0;font-size:14px;line-height:1.5',
  TABLE: 'border-collapse:collapse;width:100%;font-size:13px;margin:10px 0',
  TH: 'border:1px solid #c8bfae;padding:5px 8px;text-align:left;background:#f3efe6',
  TD: 'border:1px solid #d9d2c4;padding:5px 8px;vertical-align:top',
  BLOCKQUOTE: 'margin:10px 0;padding:6px 12px;border-left:3px solid #0a2540;color:#3a352d',
  PRE: 'margin:10px 0;padding:8px 10px;background:#f3efe6;font-family:Menlo,Consolas,monospace;font-size:12px;white-space:pre-wrap',
  CODE: 'font-family:Menlo,Consolas,monospace;font-size:12px',
  HR: 'border:0;border-top:1px solid #c8bfae;margin:14px 0',
};

const FORMULA_STYLE =
  'background:#f0f4f8;border-left:4px solid #0a2540;padding:8px 10px;margin:8px 0;' +
  'font-family:Menlo,Consolas,monospace;font-size:12.5px;white-space:pre-wrap;overflow-wrap:anywhere';

function serialiseText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\s+/g, ' ');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const el = node as Element;
  const kids = Array.from(el.childNodes);
  const inner = () => kids.map(serialiseText).join('');

  switch (el.tagName) {
    case 'BR':
      return '\n';
    case 'HR':
      return `\n${RULE}\n`;
    case 'TR':
      return (
        Array.from(el.children)
          .map((c) => serialiseText(c).trim())
          .filter(Boolean)
          .join('  |  ') + '\n'
      );
    case 'LI':
      return `  • ${inner().trim()}\n`;
    // Underlined, never re-cased: changing a heading's capitalisation would be
    // altering the sealed wording, which the Non-Alteration Clause forbids.
    case 'H1':
    case 'H2': {
      const t = inner().trim();
      return t ? `\n\n${t}\n${'─'.repeat(Math.min(46, t.length))}\n` : '';
    }
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6': {
      const t = inner().trim();
      return t ? `\n\n${t}\n` : '';
    }
    case 'PRE': {
      const t = (el.textContent ?? '').trim();
      return t ? `\n${t}\n` : '';
    }
    case 'TABLE':
      return `\n${inner()}\n`;
    case 'P':
    case 'DIV':
    case 'SECTION':
    case 'ARTICLE':
    case 'BLOCKQUOTE':
    case 'FIGCAPTION': {
      const t = inner().trim();
      return t ? `\n${t}\n` : '';
    }
    default:
      return inner();
  }
}

/**
 * Carry a sealed document into mail-safe markup without changing a word.
 *
 * Attributes are dropped wholesale rather than filtered: the source documents
 * style themselves with a stylesheet a mail client will not receive, and an
 * inherited `class` or an `onload` would be at best inert and at worst live in
 * the recipient's reader. Only `href` survives, and only for real links.
 */
export function extractDocument(rawHtml: string): { html: string; text: string } | null {
  try {
    const parsed = new DOMParser().parseFromString(rawHtml, 'text/html');
    parsed.querySelectorAll(DROP).forEach((n) => n.remove());

    parsed.body.querySelectorAll('*').forEach((el) => {
      const isFormula = el.classList.contains('formula');
      const href = el.tagName === 'A' ? el.getAttribute('href') : null;
      const colspan = el.getAttribute('colspan');
      const rowspan = el.getAttribute('rowspan');

      for (const attr of Array.from(el.attributes)) el.removeAttribute(attr.name);

      if (href && /^(https?:|mailto:|#)/i.test(href.trim())) el.setAttribute('href', href);
      if (colspan) el.setAttribute('colspan', colspan);
      if (rowspan) el.setAttribute('rowspan', rowspan);

      const style = isFormula ? FORMULA_STYLE : TAG_STYLE[el.tagName];
      if (style) el.setAttribute('style', style);
    });

    const html = parsed.body.innerHTML.trim();
    const text = serialiseText(parsed.body)
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return html ? { html, text } : null;
  } catch {
    return null;
  }
}

/**
 * The wording of a sealed document is never touched. What the two flavours can
 * honestly promise about it differs, so each says so in its own terms rather
 * than sharing one claim that is only true of the richer of the two:
 *
 * - the HTML flavour carries the document's own markup, with the screen
 *   stylesheet swapped for inline styling a mail client will actually apply;
 * - the plain flavour is a text rendering, because a message app has no
 *   headings, tables or rules to render into.
 *
 * Nothing app-authored — a catalogue summary, a gloss, an ordering — is placed
 * inside the reproduction. The wrapper names the document and links the
 * canonical file, and everything between the rules is the document itself.
 */
export function buildCodexDispatch(
  doc: { title: string; version: string; file: string },
  extracted: { html: string; text: string },
  origin: string,
  now: Date,
): Dispatch {
  const source = `${origin}${doc.file}`;

  const htmlNotice =
    'The document above is reproduced under the Non-Alteration Clause: its own ' +
    'headings, tables and derivations, unchanged in wording and order, with the ' +
    'screen stylesheet replaced by inline styling an email client can read. ' +
    'Mathematics the original typesets on screen appears here in its source notation. ' +
    'Where this copy and the sealed file differ in appearance, the file governs.';

  const textNotice =
    'The document above is a plain-text rendering of the sealed original, produced ' +
    'under the Non-Alteration Clause: nothing is summarised, reordered or re-worded, ' +
    'but headings, tables and typeset mathematics are laid out in text because a ' +
    'message carries no formatting. The sealed file governs.';

  const html = frame(
    doc.title,
    `${doc.version} · Sovereign Codex · copied ${stamp(now)}`,
    `<hr style="${TAG_STYLE.HR}" />${extracted.html}<hr style="${TAG_STYLE.HR}" />`,
    `${esc(htmlNotice)}<br /><span style="color:#0a2540">Source: ${esc(source)}</span>`,
  );

  const text = [
    doc.title,
    `${doc.version} — Sovereign Codex`,
    `Copied ${stamp(now)}`,
    RULE,
    '',
    extracted.text,
    '',
    RULE,
    textNotice,
    `Source: ${source}`,
  ].join('\n');

  return { html, text };
}
