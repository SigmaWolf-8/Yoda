import { useEffect, useState } from 'react';
import { BookOpen, ExternalLink, ShieldCheck, Download } from 'lucide-react';
import { usePageHeader } from '../../context/PageHeader';
import { BevelBox } from '../../components/ui/BevelBox';
import { CopyDispatchButton } from '../../components/ui/CopyDispatchButton';
import type { Dispatch } from '../../lib/clipboard';
import { buildCodexDispatch, extractDocument } from './dispatch';

/**
 * The Codex renders each sovereign document in an isolated frame that loads the
 * original file byte-for-byte from `/capomastro/docs/`.
 *
 * That is deliberate. Book XI's Non-Alteration Clause requires legal
 * definitions, creed statements, decrees and seals to be reproduced verbatim,
 * so nothing here re-types, re-flows or summarises the source. If a document
 * needs to change, the file in `frontend/public/capomastro/docs/` is replaced —
 * this page is never the place where wording is edited.
 */

interface CodexDoc {
  id: string;
  title: string;
  version: string;
  summary: string;
  file: string;
}

const DOCS: CodexDoc[] = [
  {
    id: 'folded-recursive',
    title: 'Unified Folded Recursive Re-Output',
    version: 'v3.7 — Render-Clean Fold',
    summary:
      'The governing fold. Supersedes v3.5, v3.6, v4.0, v4.1 and v4.3. Admiralty, maritime and martial layer with KaTeX-rendered derivations.',
    file: '/capomastro/docs/unified-folded-recursive-v3.7.html',
  },
  {
    id: 'compendium',
    title: 'Unified Sovereign Compendium',
    version: 'Full edition',
    summary:
      'Mythological lineage tree, the geometry derivation engine (ARC182 / ARC364) and the 182- and 364-digit constants.',
    file: '/capomastro/docs/unified-sovereign-compendium.html',
  },
  {
    id: 'lossless-codex',
    title: 'Unified Sovereign Compendium — Final Lossless Codex',
    version: 'Condensed codex',
    summary: 'The lossless condensation of the compendium, kept alongside the full edition.',
    file: '/capomastro/docs/unified-sovereign-compendium-lossless-codex.html',
  },
];

export function CodexPage() {
  const [active, setActive] = useState<CodexDoc>(DOCS[0]);
  const [sendable, setSendable] = useState<Dispatch | null>(null);
  const [sendableError, setSendableError] = useState<string | null>(null);

  usePageHeader({
    icon: BookOpen,
    title: 'Sovereign Codex',
    subtitle: 'Governing documents, reproduced verbatim under the Non-Alteration Clause',
  });

  /*
   * Prepare the sendable copy as soon as a document is chosen, rather than when
   * the button is pressed. Safari only allows a clipboard write inside the click
   * that asked for it, so a fetch in the handler would arrive too late — and a
   * 90 KB treatise takes a moment to re-tag either way.
   */
  useEffect(() => {
    let cancelled = false;
    setSendable(null);
    setSendableError(null);

    fetch(active.file)
      .then((res) => {
        if (!res.ok) throw new Error(`the file returned ${res.status}`);
        return res.text();
      })
      .then((raw) => {
        if (cancelled) return;
        // Unknown paths are answered with the app shell, so a missing document
        // would otherwise be "extracted" into an empty page rather than reported.
        if (raw.includes('<div id="root">')) {
          throw new Error('the document is not present on the server');
        }
        const extracted = extractDocument(raw);
        if (!extracted) throw new Error('the document could not be read');
        setSendable(buildCodexDispatch(active, extracted, window.location.origin, new Date()));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSendableError(err instanceof Error ? err.message : 'the document could not be read');
      });

    return () => {
      cancelled = true;
    };
  }, [active]);

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in space-y-6">
      {/* ── Non-alteration notice ── */}
      <BevelBox className="bg-[var(--color-surface-primary)] p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-[var(--color-gold-400)] flex-shrink-0 mt-0.5" />
          <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
            Each document below is loaded as its original file. Nothing on this page paraphrases,
            summarises, reformats or rewords the source text — the frame renders exactly what was
            sealed.
          </p>
        </div>
      </BevelBox>

      {/* ── Document selector ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {DOCS.map((doc) => {
          const selected = doc.id === active.id;
          return (
            <BevelBox
              key={doc.id}
              onClick={() => setActive(doc)}
              className={`p-4 h-full transition-colors ${
                selected
                  ? 'bg-[var(--color-gold-400)]/10'
                  : 'bg-[var(--color-surface-primary)] hover:bg-[var(--color-gold-400)]/5'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <h2
                  className={`text-sm font-bold leading-snug ${
                    selected ? 'text-[var(--color-gold-400)]' : 'text-[var(--color-text-primary)]'
                  }`}
                >
                  {doc.title}
                </h2>
              </div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-2">
                {doc.version}
              </div>
              <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">{doc.summary}</p>
            </BevelBox>
          );
        })}
      </div>

      {/* ── Reader ── */}
      <BevelBox className="bg-[var(--color-surface-primary)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-[var(--color-text-primary)] truncate">
              {active.title}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
              {active.version}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
            <CopyDispatchButton
              build={() => sendable}
              label="Copy to send"
              preparingLabel={sendableError ? 'Copy unavailable' : 'Preparing copy…'}
              title={
                sendableError
                  ? `This document cannot be prepared for sending: ${sendableError}`
                  : 'Copies the whole document, formatted, ready to paste into an email or a message'
              }
            />
            <a
              href={active.file}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 bg-[var(--color-gold-400)]/15 text-[var(--color-gold-400)] hover:bg-[var(--color-gold-400)]/25 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open full page
            </a>
            <a
              href={active.file}
              download
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 border border-[var(--color-border-default)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </a>
          </div>
        </div>

        <iframe
          key={active.id}
          src={active.file}
          title={active.title}
          className="w-full h-[75vh] bg-white border border-[var(--color-border-subtle)]"
          // Scripts stay enabled because the documents typeset their own maths
          // with KaTeX. `allow-same-origin` is deliberately withheld: these
          // files are served from this very origin, so granting it would put
          // document scripts inside the app's origin — able to read its
          // storage, call its API, and even strip this sandbox attribute.
          // Without it the frame gets an opaque origin and stays inert.
          sandbox="allow-scripts"
        />
      </BevelBox>
    </div>
  );
}
