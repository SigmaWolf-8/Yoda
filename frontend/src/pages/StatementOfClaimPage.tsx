import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Gavel,
  Plus,
  Trash2,
  Printer,
  Download,
  Eye,
  Pencil,
  Lock,
  RotateCcw,
  ArrowLeft,
} from 'lucide-react';
import { BevelBox } from '../components/ui/BevelBox';

/**
 * Statement of Claim & Chronology.
 *
 * A working document the declarant prepares for a lawyer, an advocate or a
 * review panel. It is deliberately NOT dressed as a legal instrument: it makes
 * no finding, certifies nothing, and says so on its face. Its whole value is
 * that it takes a disputed situation and lays it out in the order and form that
 * someone with authority to act can read quickly — dated events, named parties,
 * identified documents, and a specific ask.
 *
 * Everything typed here stays in this browser (localStorage). Nothing is sent
 * to the server and nothing is published: the content names private individuals
 * and describes contested events, which is exactly the material that should sit
 * with counsel rather than on a public page.
 */

// ── Model ────────────────────────────────────────────────────────────────────

interface Row {
  id: string;
  [k: string]: string;
}

interface DocData {
  declarantName: string;
  declarantDob: string;
  declarantAddress: string;
  currentLocation: string;
  contact: string;
  matterTitle: string;
  preparedOn: string;
  overview: string;
  paragraphs: Row[]; // { text }
  chronology: Row[]; // { date, event, parties, exhibit }
  instruments: Row[]; // { kind, issuedBy, dated, scope, grounds }
  detentionFacility: string;
  detentionSince: string;
  detentionAuthority: string;
  detentionDisputed: string;
  exhibits: Row[]; // { label, description, whereItIs }
  relief: Row[]; // { text }
  witnesses: Row[]; // { name, role, contact }
}

const STORAGE_KEY = 'yoda.statement-of-claim.v1';

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function emptyDoc(today: string): DocData {
  return {
    declarantName: '',
    declarantDob: '',
    declarantAddress: '',
    currentLocation: '',
    contact: '',
    matterTitle: 'Statement of Claim and Chronology',
    preparedOn: today,
    overview: '',
    paragraphs: [{ id: uid(), text: '' }],
    chronology: [{ id: uid(), date: '', event: '', parties: '', exhibit: '' }],
    instruments: [{ id: uid(), kind: '', issuedBy: '', dated: '', scope: '', grounds: '' }],
    detentionFacility: '',
    detentionSince: '',
    detentionAuthority: '',
    detentionDisputed: '',
    exhibits: [{ id: uid(), label: 'A', description: '', whereItIs: '' }],
    relief: [{ id: uid(), text: '' }],
    witnesses: [{ id: uid(), name: '', role: '', contact: '' }],
  };
}

/**
 * Rebuild the document from whatever is in storage, trusting none of it.
 *
 * A shallow merge over the defaults is not enough: a payload written by an
 * earlier version, or one that has been hand-edited or truncated, can carry
 * `null`, a string, or an object where a row array is expected, and the first
 * `rows.map` then takes the whole page down. Losing a field to a default is
 * recoverable; losing the document behind a crash is not.
 */
function loadDoc(today: string): DocData {
  const base = emptyDoc(today);
  let stored: unknown;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    stored = JSON.parse(raw);
  } catch {
    return base; // unavailable or unparseable storage
  }
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return base;
  const src = stored as Record<string, unknown>;

  const str = (k: keyof DocData): string => {
    const v = src[k as string];
    return typeof v === 'string' ? v : (base[k] as string);
  };

  /** Keep only well-formed rows; if none survive, fall back to one blank row. */
  const rowsOf = (k: keyof DocData, keys: string[]): Row[] => {
    const v = src[k as string];
    if (!Array.isArray(v)) return base[k] as Row[];
    const cleaned: Row[] = [];
    for (const raw of v) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
      const rec = raw as Record<string, unknown>;
      const row: Row = { id: typeof rec.id === 'string' && rec.id ? rec.id : uid() };
      for (const key of keys) row[key] = typeof rec[key] === 'string' ? (rec[key] as string) : '';
      cleaned.push(row);
    }
    return cleaned.length ? cleaned : (base[k] as Row[]);
  };

  return {
    declarantName: str('declarantName'),
    declarantDob: str('declarantDob'),
    declarantAddress: str('declarantAddress'),
    currentLocation: str('currentLocation'),
    contact: str('contact'),
    matterTitle: str('matterTitle'),
    preparedOn: str('preparedOn'),
    overview: str('overview'),
    paragraphs: rowsOf('paragraphs', ['text']),
    chronology: rowsOf('chronology', ['date', 'event', 'parties', 'exhibit']),
    instruments: rowsOf('instruments', ['kind', 'issuedBy', 'dated', 'scope', 'grounds']),
    detentionFacility: str('detentionFacility'),
    detentionSince: str('detentionSince'),
    detentionAuthority: str('detentionAuthority'),
    detentionDisputed: str('detentionDisputed'),
    exhibits: rowsOf('exhibits', ['label', 'description', 'whereItIs']),
    relief: rowsOf('relief', ['text']),
    witnesses: rowsOf('witnesses', ['name', 'role', 'contact']),
  };
}

// ── Document builder ─────────────────────────────────────────────────────────
//
// The preview and the downloaded file are generated from this one function, so
// what is printed is byte-for-byte what is saved.

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Preserve the author's line breaks without allowing markup through. */
function escMultiline(s: string): string {
  return esc(s).replace(/\n/g, '<br />');
}

function filled(rows: Row[], keys: string[]): Row[] {
  return rows.filter((r) => keys.some((k) => (r[k] ?? '').trim() !== ''));
}

function orBlank(s: string): string {
  const t = s.trim();
  return t === '' ? '<span class="blank">&nbsp;</span>' : esc(t);
}

function buildDocumentHtml(d: DocData): string {
  const parts: string[] = [];
  const name = d.declarantName.trim() || 'the Declarant';

  parts.push(`<header class="doc-head">
    <div class="doc-title">${esc(d.matterTitle.trim() || 'Statement of Claim and Chronology')}</div>
    <div class="doc-sub">Prepared by ${esc(name)}${
      d.preparedOn.trim() ? ` &middot; ${esc(d.preparedOn.trim())}` : ''
    }</div>
  </header>`);

  // What this document is — stated up front so no reader can mistake it.
  parts.push(`<div class="notice">
    <strong>Nature of this document.</strong> This is a personal statement prepared by the
    declarant named above. It is a written account and chronology provided so that legal counsel,
    a patient advocate, or a review panel can assess the matter. It is not a court filing, it is
    not a sworn affidavit unless and until it is sworn before a commissioner for oaths, it is not
    a determination of any legal question, and it is not legal advice. Nothing in it has been
    verified by any third party.
  </div>`);

  // 1 — Declarant
  parts.push(`<section><h2>1. Declarant</h2><table class="kv">
    <tr><th>Full legal name</th><td>${orBlank(d.declarantName)}</td></tr>
    <tr><th>Date of birth</th><td>${orBlank(d.declarantDob)}</td></tr>
    <tr><th>Address of record</th><td>${orBlank(d.declarantAddress)}</td></tr>
    <tr><th>Present location</th><td>${orBlank(d.currentLocation)}</td></tr>
    <tr><th>Contact</th><td>${orBlank(d.contact)}</td></tr>
  </table></section>`);

  // 2 — Overview
  if (d.overview.trim()) {
    parts.push(`<section><h2>2. Overview of the matter</h2>
      <p class="body">${escMultiline(d.overview.trim())}</p></section>`);
  }

  // 3 — Statement, numbered as legal convention expects
  const paras = filled(d.paragraphs, ['text']);
  if (paras.length) {
    parts.push(`<section><h2>3. Statement</h2><ol class="numbered">${paras
      .map((p) => `<li>${escMultiline(p.text.trim())}</li>`)
      .join('')}</ol></section>`);
  }

  // 4 — Chronology
  const chron = filled(d.chronology, ['date', 'event', 'parties', 'exhibit']);
  if (chron.length) {
    parts.push(`<section><h2>4. Chronology of events</h2>
      <table class="grid">
        <thead><tr><th style="width:14%">Date</th><th>Event</th><th style="width:22%">Persons involved</th><th style="width:10%">Exhibit</th></tr></thead>
        <tbody>${chron
          .map(
            (r) =>
              `<tr><td class="nowrap">${esc(r.date)}</td><td>${escMultiline(
                r.event,
              )}</td><td>${esc(r.parties)}</td><td class="nowrap">${esc(r.exhibit)}</td></tr>`,
          )
          .join('')}</tbody>
      </table></section>`);
  }

  // 5 — Instruments disputed
  const instr = filled(d.instruments, ['kind', 'issuedBy', 'dated', 'scope', 'grounds']);
  if (instr.length) {
    parts.push(`<section><h2>5. Instruments in dispute</h2>${instr
      .map(
        (r, i) => `<div class="block">
          <div class="block-title">5.${i + 1} &nbsp; ${esc(r.kind || 'Instrument')}</div>
          <table class="kv">
            <tr><th>Said to be granted by</th><td>${orBlank(r.issuedBy)}</td></tr>
            <tr><th>Dated</th><td>${orBlank(r.dated)}</td></tr>
            <tr><th>Scope asserted</th><td>${orBlank(r.scope)}</td></tr>
            <tr><th>Grounds of dispute</th><td>${
              r.grounds.trim() ? escMultiline(r.grounds.trim()) : '<span class="blank">&nbsp;</span>'
            }</td></tr>
          </table>
        </div>`,
      )
      .join('')}</section>`);
  }

  // 6 — Detention particulars
  const anyDetention =
    d.detentionFacility.trim() ||
    d.detentionSince.trim() ||
    d.detentionAuthority.trim() ||
    d.detentionDisputed.trim();
  if (anyDetention) {
    parts.push(`<section><h2>6. Particulars of detention</h2><table class="kv">
      <tr><th>Facility</th><td>${orBlank(d.detentionFacility)}</td></tr>
      <tr><th>Held since</th><td>${orBlank(d.detentionSince)}</td></tr>
      <tr><th>Authority relied on, as stated to the declarant</th><td>${orBlank(
        d.detentionAuthority,
      )}</td></tr>
      <tr><th>What the declarant disputes</th><td>${
        d.detentionDisputed.trim()
          ? escMultiline(d.detentionDisputed.trim())
          : '<span class="blank">&nbsp;</span>'
      }</td></tr>
    </table></section>`);
  }

  // 7 — Exhibits
  const exhibits = filled(d.exhibits, ['label', 'description', 'whereItIs']);
  if (exhibits.length) {
    parts.push(`<section><h2>7. Index of exhibits</h2>
      <table class="grid">
        <thead><tr><th style="width:10%">Exhibit</th><th>Description</th><th style="width:32%">Where the original is held</th></tr></thead>
        <tbody>${exhibits
          .map(
            (r) =>
              `<tr><td class="nowrap"><strong>${esc(r.label)}</strong></td><td>${esc(
                r.description,
              )}</td><td>${esc(r.whereItIs)}</td></tr>`,
          )
          .join('')}</tbody>
      </table></section>`);
  }

  // 8 — Relief
  const relief = filled(d.relief, ['text']);
  if (relief.length) {
    parts.push(`<section><h2>8. What the declarant is asking for</h2>
      <ol class="numbered">${relief
        .map((r) => `<li>${escMultiline(r.text.trim())}</li>`)
        .join('')}</ol></section>`);
  }

  // 9 — Witnesses
  const witnesses = filled(d.witnesses, ['name', 'role', 'contact']);
  if (witnesses.length) {
    parts.push(`<section><h2>9. Persons who may be able to confirm these facts</h2>
      <table class="grid">
        <thead><tr><th style="width:30%">Name</th><th style="width:34%">Relationship / role</th><th>Contact</th></tr></thead>
        <tbody>${witnesses
          .map(
            (r) =>
              `<tr><td>${esc(r.name)}</td><td>${esc(r.role)}</td><td>${esc(r.contact)}</td></tr>`,
          )
          .join('')}</tbody>
      </table></section>`);
  }

  // Signature — with the commissioner block that Alberta requires before a
  // statement of this kind carries any weight as an affidavit.
  parts.push(`<section class="sig"><h2>Declaration and signature</h2>
    <p class="body">The declarant states that the contents of this document are true to the best
    of their knowledge and belief.</p>
    <div class="sig-grid">
      <div><div class="sig-line"></div><div class="sig-label">Signature of declarant</div></div>
      <div><div class="sig-line"></div><div class="sig-label">Date</div></div>
    </div>
    <p class="body small">To be sworn or affirmed, this document must be signed in the presence of
    a Commissioner for Oaths or a Notary Public, who completes the block below. Until that happens
    it remains an unsworn statement.</p>
    <div class="sig-grid">
      <div><div class="sig-line"></div><div class="sig-label">Commissioner for Oaths / Notary Public</div></div>
      <div><div class="sig-line"></div><div class="sig-label">Date and place sworn</div></div>
    </div>
  </section>`);

  return parts.join('\n');
}

const DOC_CSS = `
  .doc { background:#fff; color:#111; font-family:Georgia,'Times New Roman',serif; font-size:11pt; line-height:1.55; }
  .doc .doc-head { text-align:center; border-bottom:2px solid #111; padding-bottom:10px; margin-bottom:18px; }
  .doc .doc-title { font-size:17pt; font-weight:700; letter-spacing:.01em; }
  .doc .doc-sub { font-size:10pt; color:#444; margin-top:4px; }
  .doc .notice { border:1px solid #999; background:#f5f5f5; padding:10px 12px; font-size:9pt; line-height:1.45; color:#222; margin-bottom:20px; }
  .doc section { margin-bottom:20px; }
  .doc h2 { font-size:11.5pt; font-weight:700; text-transform:uppercase; letter-spacing:.04em; border-bottom:1px solid #bbb; padding-bottom:3px; margin:0 0 9px; }
  .doc p.body { margin:0 0 8px; text-align:justify; }
  .doc p.small { font-size:9pt; color:#333; }
  .doc ol.numbered { margin:0; padding-left:24px; }
  .doc ol.numbered li { margin-bottom:8px; text-align:justify; }
  .doc table { width:100%; border-collapse:collapse; }
  .doc table.kv th { text-align:left; width:32%; vertical-align:top; font-weight:600; padding:4px 10px 4px 0; border-bottom:1px solid #e2e2e2; }
  .doc table.kv td { vertical-align:top; padding:4px 0; border-bottom:1px solid #e2e2e2; }
  .doc table.grid th { text-align:left; font-size:9pt; text-transform:uppercase; letter-spacing:.04em; border-bottom:1.5px solid #111; padding:4px 6px; }
  .doc table.grid td { vertical-align:top; padding:5px 6px; border-bottom:1px solid #ddd; }
  .doc .nowrap { white-space:nowrap; }
  .doc .blank { display:inline-block; min-width:150px; border-bottom:1px dotted #999; }
  .doc .block { margin-bottom:14px; }
  .doc .block-title { font-weight:700; margin-bottom:5px; }
  .doc .sig-grid { display:grid; grid-template-columns:1fr 1fr; gap:26px; margin:22px 0 14px; }
  .doc .sig-line { border-bottom:1px solid #111; height:30px; }
  .doc .sig-label { font-size:8.5pt; color:#444; margin-top:3px; }
  .doc section.sig { break-inside:avoid; page-break-inside:avoid; }
  .doc table, .doc .block { break-inside:auto; }
  .doc tr { break-inside:avoid; page-break-inside:avoid; }
`;

function standaloneHtml(d: DocData): string {
  const title = d.matterTitle.trim() || 'Statement of Claim and Chronology';
  const who = d.declarantName.trim();
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}${who ? ` — ${esc(who)}` : ''}</title>
<style>
  @page { size: Letter; margin: 20mm 18mm; }
  body { margin:0; padding:28px; background:#e9e9e9; }
  .sheet { max-width:8.5in; margin:0 auto; background:#fff; padding:36px 42px; box-shadow:0 2px 14px rgba(0,0,0,.18); }
  @media print { body { background:#fff; padding:0; } .sheet { box-shadow:none; max-width:none; padding:0; } }
${DOC_CSS}
</style></head>
<body><div class="sheet"><div class="doc">
${buildDocumentHtml(d)}
</div></div></body></html>`;
}

// ── Small editor primitives ──────────────────────────────────────────────────

const inputCls =
  'w-full bg-[var(--color-surface-secondary,rgba(255,255,255,.04))] border border-[var(--color-warm-700)] ' +
  'rounded px-2.5 py-1.5 text-sm text-[var(--color-text-primary)] outline-none ' +
  'focus:border-[var(--color-primary)] placeholder:text-[var(--color-warm-400)]';

function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
        {label}
      </span>
      {multiline ? (
        <textarea
          className={inputCls + ' resize-y leading-relaxed'}
          rows={rows}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className={inputCls}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

interface ColSpec {
  key: string;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  width?: string;
}

function RowEditor({
  title,
  hint,
  cols,
  rows,
  onChange,
  addLabel,
}: {
  title: string;
  hint?: string;
  cols: ColSpec[];
  rows: Row[];
  onChange: (rows: Row[]) => void;
  addLabel: string;
}) {
  const update = (id: string, key: string, v: string) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, [key]: v } : r)));
  const remove = (id: string) =>
    onChange(rows.length > 1 ? rows.filter((r) => r.id !== id) : rows);
  const add = () => {
    const blank: Row = { id: uid() };
    cols.forEach((c) => (blank[c.key] = ''));
    onChange([...rows, blank]);
  };

  return (
    <BevelBox className="bg-[var(--color-surface-primary)] p-5">
      <h2 className="text-sm font-bold tracking-wide text-[var(--color-text-primary)] uppercase">
        {title}
      </h2>
      {hint && <p className="text-xs text-[var(--color-text-muted)] mt-1.5">{hint}</p>}
      <div className="mt-4 space-y-4">
        {rows.map((r, i) => (
          <div
            key={r.id}
            className="border border-[var(--color-warm-750)] rounded p-3 relative"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-mono text-[var(--color-warm-400)]">
                {String(i + 1).padStart(2, '0')}
              </span>
              <button
                type="button"
                onClick={() => remove(r.id)}
                disabled={rows.length === 1}
                className="text-[var(--color-warm-400)] hover:text-red-400 disabled:opacity-30 disabled:hover:text-[var(--color-warm-400)]"
                aria-label="Remove entry"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {cols.map((c) => (
                <div key={c.key} className={c.width === 'full' ? 'sm:col-span-2' : ''}>
                  <Field
                    label={c.label}
                    value={r[c.key] ?? ''}
                    placeholder={c.placeholder}
                    multiline={c.multiline}
                    rows={3}
                    onChange={(v) => update(r.id, c.key, v)}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={add}
        className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-primary)] hover:underline"
      >
        <Plus className="w-3.5 h-3.5" /> {addLabel}
      </button>
    </BevelBox>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function StatementOfClaimPage() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [doc, setDoc] = useState<DocData>(() => loadDoc(today));
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');

  // Persist locally on every change. Never leaves the browser.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
    } catch {
      /* storage full or blocked — the document is still usable in this session */
    }
  }, [doc]);

  const set = useCallback(
    <K extends keyof DocData>(k: K, v: DocData[K]) => setDoc((p) => ({ ...p, [k]: v })),
    [],
  );

  const html = useMemo(() => buildDocumentHtml(doc), [doc]);

  const download = useCallback(() => {
    const blob = new Blob([standaloneHtml(doc)], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const slug =
      (doc.declarantName.trim() || 'statement').toLowerCase().replace(/[^a-z0-9]+/g, '-') +
      '-statement-of-claim.html';
    a.href = url;
    a.download = slug.replace(/^-+/, '');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [doc]);

  const reset = useCallback(() => {
    if (window.confirm('Clear the entire document and start again? This cannot be undone.')) {
      setDoc(emptyDoc(today));
    }
  }, [today]);

  return (
    <div className="min-h-screen bg-[var(--color-warm-1000)]">
      {/*
        Print rules. The document element is mounted in BOTH modes and merely
        hidden on screen while editing — printing straight from the editor is an
        obvious thing to do, and if the sheet only existed in preview mode that
        would silently produce a blank page.
      */}
      <style>{`
        ${DOC_CSS.replace(/\.doc /g, '.soc-doc ')}
        @media screen { .soc-print-only { display: none; } }
        @media print {
          @page { size: Letter; margin: 20mm 18mm; }
          body * { visibility: hidden !important; }
          #soc-print, #soc-print * { visibility: visible !important; }
          #soc-print { display: block !important; position: absolute; inset: 0;
                       margin: 0; padding: 0; width: 100%;
                       background: #fff !important; box-shadow: none !important; }
        }
      `}</style>

      {/* Standalone header — this page sits outside the app shell on purpose. */}
      <header className="border-b border-[var(--color-warm-750)] print:hidden">
        <div className="max-w-5xl mx-auto px-6 lg:px-8 py-5 flex items-center gap-4">
          <Link
            to="/"
            className="text-[var(--color-warm-400)] hover:text-[var(--color-text-primary)] flex-shrink-0"
            aria-label="Back to dashboard"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <Gavel className="w-6 h-6 text-[var(--color-gold-400)] flex-shrink-0" />
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-wide text-[var(--color-text-primary)] uppercase truncate">
              Statement of Claim
            </h1>
            <p className="text-xs text-[var(--color-text-muted)] truncate">
              A printable account and chronology for counsel, an advocate, or a review panel
            </p>
          </div>
        </div>
      </header>

      <div className="p-6 lg:p-8 max-w-5xl mx-auto animate-fade-in space-y-6">

      {/* ── What this is ── */}
      <BevelBox className="bg-[var(--color-surface-primary)] p-4">
        <div className="flex items-start gap-3">
          <Lock className="w-5 h-5 text-[var(--color-gold-400)] flex-shrink-0 mt-0.5" />
          <div className="text-xs text-[var(--color-text-muted)] leading-relaxed space-y-1.5">
            <p>
              Everything you type here is saved in this browser only. It is not sent to the server,
              not stored in the database, and not published anywhere — it names private individuals
              and describes contested events, so it belongs with your lawyer or advocate, not on a
              public page.
            </p>
            <p>
              The document states plainly on its face that it is your account rather than a proven
              finding. That is deliberate: a statement that overclaims gets dismissed, and one that
              is precise, dated and specific gets acted on.
            </p>
          </div>
        </div>
      </BevelBox>

      {/* ── Mode + actions ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded overflow-hidden border border-[var(--color-warm-700)]">
          <button
            type="button"
            onClick={() => setMode('edit')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold ${
              mode === 'edit'
                ? 'bg-[var(--color-primary)] text-white'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
          <button
            type="button"
            onClick={() => setMode('preview')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold ${
              mode === 'preview'
                ? 'bg-[var(--color-primary)] text-white'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <Eye className="w-3.5 h-3.5" /> Document
          </button>
        </div>

        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded border border-[var(--color-warm-700)] text-[var(--color-text-primary)] hover:border-[var(--color-primary)]"
          >
            <Printer className="w-3.5 h-3.5" /> Print / Save as PDF
          </button>
          <button
            type="button"
            onClick={download}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded border border-[var(--color-warm-700)] text-[var(--color-text-primary)] hover:border-[var(--color-primary)]"
          >
            <Download className="w-3.5 h-3.5" /> Download
          </button>
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded border border-[var(--color-warm-700)] text-[var(--color-warm-400)] hover:text-red-400 hover:border-red-400/40"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Clear
          </button>
        </div>
      </div>

      {/* Always mounted so Print works from either mode; hidden on screen while editing. */}
      <div
        id="soc-print"
        className={`soc-doc bg-white text-black rounded shadow-lg p-8 sm:p-12 overflow-x-auto${
          mode === 'preview' ? '' : ' soc-print-only'
        }`}
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {mode === 'edit' && (
        <div className="space-y-6">
          {/* 1 — Declarant */}
          <BevelBox className="bg-[var(--color-surface-primary)] p-5">
            <h2 className="text-sm font-bold tracking-wide text-[var(--color-text-primary)] uppercase mb-4">
              1 &nbsp; Declarant
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Full legal name"
                value={doc.declarantName}
                onChange={(v) => set('declarantName', v)}
                placeholder="As it appears on your identification"
              />
              <Field
                label="Date of birth"
                value={doc.declarantDob}
                onChange={(v) => set('declarantDob', v)}
                placeholder="YYYY-MM-DD"
              />
              <Field
                label="Address of record"
                value={doc.declarantAddress}
                onChange={(v) => set('declarantAddress', v)}
                placeholder="Your permanent or last address"
              />
              <Field
                label="Present location"
                value={doc.currentLocation}
                onChange={(v) => set('currentLocation', v)}
                placeholder="Facility, unit, city"
              />
              <Field
                label="Contact"
                value={doc.contact}
                onChange={(v) => set('contact', v)}
                placeholder="Phone, email, or how to reach you"
              />
              <Field
                label="Prepared on"
                value={doc.preparedOn}
                onChange={(v) => set('preparedOn', v)}
                placeholder="YYYY-MM-DD"
              />
              <div className="sm:col-span-2">
                <Field
                  label="Document title"
                  value={doc.matterTitle}
                  onChange={(v) => set('matterTitle', v)}
                />
              </div>
            </div>
          </BevelBox>

          {/* 2 — Overview */}
          <BevelBox className="bg-[var(--color-surface-primary)] p-5">
            <h2 className="text-sm font-bold tracking-wide text-[var(--color-text-primary)] uppercase">
              2 &nbsp; Overview of the matter
            </h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-1.5 mb-4">
              Three or four sentences a reader can absorb before anything else: who you are, where
              you are, what is being done to you, and what you want changed.
            </p>
            <Field
              label="Overview"
              value={doc.overview}
              onChange={(v) => set('overview', v)}
              multiline
              rows={5}
              placeholder="I am currently held at … since … . I dispute … . I am asking for …"
            />
          </BevelBox>

          {/* 3 — Statement */}
          <RowEditor
            title="3 — Statement"
            hint="One fact per numbered paragraph, in the order it happened. Keep each to a single point — that is what makes it easy to answer, and easy to accept."
            cols={[{ key: 'text', label: 'Paragraph', multiline: true, width: 'full' }]}
            rows={doc.paragraphs}
            onChange={(r) => set('paragraphs', r)}
            addLabel="Add paragraph"
          />

          {/* 4 — Chronology */}
          <RowEditor
            title="4 — Chronology of events"
            hint="Dates carry more weight than adjectives. Where you are unsure of a date, write what you do know — 'early March 2026' is better than leaving it blank."
            cols={[
              { key: 'date', label: 'Date' },
              { key: 'exhibit', label: 'Exhibit reference', placeholder: 'A, B, C…' },
              { key: 'event', label: 'What happened', multiline: true, width: 'full' },
              { key: 'parties', label: 'Persons involved', width: 'full' },
            ]}
            rows={doc.chronology}
            onChange={(r) => set('chronology', r)}
            addLabel="Add event"
          />

          {/* 5 — Instruments */}
          <RowEditor
            title="5 — Instruments in dispute"
            hint="The power of attorney, personal directive, guardianship order, or any other document someone is relying on to make decisions for you."
            cols={[
              {
                key: 'kind',
                label: 'Type of instrument',
                placeholder: 'Enduring power of attorney / personal directive / guardianship order',
              },
              { key: 'dated', label: 'Dated' },
              { key: 'issuedBy', label: 'Said to be granted by', width: 'full' },
              { key: 'scope', label: 'Scope asserted', multiline: true, width: 'full' },
              {
                key: 'grounds',
                label: 'Grounds on which you dispute it',
                multiline: true,
                width: 'full',
                placeholder: 'e.g. never signed by me; signature not mine; obtained by …; revoked on …',
              },
            ]}
            rows={doc.instruments}
            onChange={(r) => set('instruments', r)}
            addLabel="Add instrument"
          />

          {/* 6 — Detention */}
          <BevelBox className="bg-[var(--color-surface-primary)] p-5">
            <h2 className="text-sm font-bold tracking-wide text-[var(--color-text-primary)] uppercase">
              6 &nbsp; Particulars of detention
            </h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-1.5 mb-4">
              Record exactly what authority you have been told is holding you, in their words. What
              a facility says out loud is often the fastest thing to check and, when it is wrong,
              the fastest thing to overturn.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Facility"
                value={doc.detentionFacility}
                onChange={(v) => set('detentionFacility', v)}
                placeholder="Name of hospital or unit"
              />
              <Field
                label="Held since"
                value={doc.detentionSince}
                onChange={(v) => set('detentionSince', v)}
                placeholder="YYYY-MM-DD"
              />
              <div className="sm:col-span-2">
                <Field
                  label="Authority relied on, as stated to you"
                  value={doc.detentionAuthority}
                  onChange={(v) => set('detentionAuthority', v)}
                  multiline
                  rows={3}
                  placeholder="Who said what, and when. Note whether you were shown or given copies of any certificates."
                />
              </div>
              <div className="sm:col-span-2">
                <Field
                  label="What you dispute about it"
                  value={doc.detentionDisputed}
                  onChange={(v) => set('detentionDisputed', v)}
                  multiline
                  rows={4}
                />
              </div>
            </div>
          </BevelBox>

          {/* 7 — Exhibits */}
          <RowEditor
            title="7 — Index of exhibits"
            hint="Every document you can point to. Even ones you do not hold — say who does, and a reader can request them."
            cols={[
              { key: 'label', label: 'Exhibit', placeholder: 'A' },
              { key: 'whereItIs', label: 'Where the original is held' },
              { key: 'description', label: 'Description', multiline: true, width: 'full' },
            ]}
            rows={doc.exhibits}
            onChange={(r) => set('exhibits', r)}
            addLabel="Add exhibit"
          />

          {/* 8 — Relief */}
          <RowEditor
            title="8 — What you are asking for"
            hint="Be specific and separable. A reader who can grant three of your five requests will grant three — but only if they are listed apart."
            cols={[{ key: 'text', label: 'Request', multiline: true, width: 'full' }]}
            rows={doc.relief}
            onChange={(r) => set('relief', r)}
            addLabel="Add request"
          />

          {/* 9 — Witnesses */}
          <RowEditor
            title="9 — Persons who can confirm these facts"
            hint="Anyone who saw or heard something first-hand, including staff."
            cols={[
              { key: 'name', label: 'Name' },
              { key: 'role', label: 'Relationship / role' },
              { key: 'contact', label: 'Contact', width: 'full' },
            ]}
            rows={doc.witnesses}
            onChange={(r) => set('witnesses', r)}
            addLabel="Add person"
          />
        </div>
      )}
      </div>
    </div>
  );
}
