/**
 * One-click auditor copies of the estate's books.
 *
 * Every button here is a plain link to a server route — no client-side
 * assembly, no second formatting pass. The document a recipient opens is the
 * one the backend rendered from the same computation this page displays, so
 * there is exactly one set of figures and one place they can be wrong.
 *
 * "Email copies" opens the operator's own mail client with the links already
 * written. That is deliberate: this estate has no outbound mail provider
 * configured, and a button that silently drops a statement into a void it can
 * neither confirm nor audit is worse than no button. The mail leaves from the
 * operator's own account, in their sent items, with their signature on it.
 */

import { Download, FileSpreadsheet, Mail, Printer, Table2 } from 'lucide-react';
import { Panel } from './ui';

const BASE = '/api/capomastro/export';

function origin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

function Action({
  href,
  icon: Icon,
  title,
  detail,
  newTab = false,
}: {
  href: string;
  icon: React.ElementType;
  title: string;
  detail: string;
  newTab?: boolean;
}) {
  return (
    <a
      href={href}
      {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="flex items-start gap-3 p-3 rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-tertiary)] hover:border-[var(--color-gold-400)]/40 transition-colors group"
    >
      <Icon className="w-4 h-4 mt-0.5 flex-shrink-0 text-[var(--color-gold-400)]" />
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-[var(--color-text-primary)]">
          {title}
        </span>
        <span className="block text-[11px] leading-snug text-[var(--color-text-muted)]">
          {detail}
        </span>
      </span>
    </a>
  );
}

export function ExportPanel({ asOfDate }: { asOfDate: string }) {
  const root = origin();
  const subject = `Financial statement package — as at ${asOfDate} (UNAUDITED)`;
  const body = [
    `Attached / linked below are accounting copies of the estate's books as at ${asOfDate}.`,
    '',
    `Statement package (print or save as PDF): ${root}${BASE}/statements.html`,
    `Statement package, working paper (CSV):   ${root}${BASE}/statements.csv`,
    `Trial balance (CSV):                      ${root}${BASE}/trial-balance.csv`,
    `Source workbook, all sheets (CSV):        ${root}${BASE}/ledger.csv`,
    '',
    'These statements are UNAUDITED. They are compiled from the records of the estate;',
    'no audit or review has been performed and no assurance is expressed. Each copy',
    'carries a SHA-256 digest of the computation it was rendered from — figures accrue',
    'against live published reference rates, so copies taken at different times will',
    'legitimately differ, and the digest is how two parties confirm they hold the same one.',
  ].join('\n');
  const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <Panel title="Send accounting copies" icon={Download}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Action
          href={`${BASE}/statements.html?print=1`}
          icon={Printer}
          title="Statement package — print / save as PDF"
          detail="Opens the paper-formatted package and the print dialogue. Choose “Save as PDF” to file it."
          newTab
        />
        <Action
          href={`${BASE}/statements.html`}
          icon={FileSpreadsheet}
          title="Statement package — read on screen"
          detail="Same document without the print prompt: position, operations, schedules, notes, reconciliations."
          newTab
        />
        <Action
          href={`${BASE}/statements.csv`}
          icon={Table2}
          title="Statement package — CSV working paper"
          detail="Every section as sectioned CSV, unrounded, for an auditor to tie out in Excel."
        />
        <Action
          href={`${BASE}/trial-balance.csv`}
          icon={Table2}
          title="Trial balance — CSV"
          detail="The debit/credit listing alone, with each account's source and statutory authority."
        />
        <Action
          href={`${BASE}/ledger.csv`}
          icon={Table2}
          title="Source workbook — CSV"
          detail="A lossless dump of every sheet of the GAAP ledger, in workbook order."
        />
        <Action
          href={mailto}
          icon={Mail}
          title="Email these copies"
          detail="Opens your mail client with the links and the unaudited notice already written."
        />
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
        Every copy is marked <span className="text-amber-400 font-semibold">UNAUDITED</span> and
        carries a Notice to Reader: these are compiled from the estate's own records, no audit or
        review has been performed, and no assurance is expressed. A practising CPA/CGA attaches
        their own report to this package — it is the working paper, not the opinion. Figures are
        recomputed at the moment of download against live reference rates, and each copy prints the
        SHA-256 digest of the computation behind it.
      </p>
    </Panel>
  );
}
