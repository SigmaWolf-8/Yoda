// ─────────────────────────────────────────────────────────────────────────────
// LIIBRELIBRAII CODEX
// The Gate parses the canon automatically. The source of truth is the in-app
// plaintext at src/data/liibrelibraii-canon.txt (the key never leaves its
// source). This component reads that text once, classifies each line
// (title / Latin heading / KaTeX equation / glyphic colophon / English body)
// and renders it. Equation lines written as $...$ are typeset with KaTeX.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo } from 'react';
import katex from 'katex';
// @ts-ignore side-effect stylesheet import handled by Vite
import 'katex/dist/katex.min.css';
import canonRaw from '../data/liibrelibraii-canon.txt?raw';

const C = {
  panel: 'rgba(14,11,7,0.94)',
  brass: '#C9A227',
  brassLight: '#E7C86A',
  parchment: '#EDE3C8',
  faint: 'rgba(237,227,200,0.66)',
  muted: 'rgba(237,227,200,0.42)',
  border: 'rgba(201,162,39,0.38)',
};

const fDisplay = { fontFamily: "'Cinzel', serif", letterSpacing: '0.16em' };
const fSerif = { fontFamily: "'Cormorant Garamond', serif" };
const fBody = { fontFamily: "'Jost', sans-serif" };

type Block =
  | { kind: 'title'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'eq'; tex: string }
  | { kind: 'glyph'; text: string }
  | { kind: 'body'; text: string };

function isHeading(line: string): boolean {
  const head = line.split(/[(:]/)[0].trim();
  if (head.length < 3) return false;
  return /^[A-ZÀ-Þ0-9][A-ZÀ-Þ0-9\s.]*$/.test(head) && /[A-ZÀ-Þ]/.test(head);
}

function isGlyphLine(line: string): boolean {
  return line.includes('攵') || line.includes('𐤀') || line.includes('ΣΑΛΒΙ');
}

function parseCanon(raw: string): Block[] {
  const blocks: Block[] = [];
  let seenTitle = false;
  for (const rawLine of raw.replace(/\r\n/g, '\n').split('\n')) {
    const t = rawLine.trim();
    if (!t) continue;
    if (t.length > 2 && t.startsWith('$') && t.endsWith('$')) {
      blocks.push({ kind: 'eq', tex: t.slice(1, -1).trim() });
      continue;
    }
    if (isGlyphLine(t)) {
      blocks.push({ kind: 'glyph', text: t });
      continue;
    }
    if (!seenTitle) {
      blocks.push({ kind: 'title', text: t });
      seenTitle = true;
      continue;
    }
    if (isHeading(t)) {
      blocks.push({ kind: 'heading', text: t });
      continue;
    }
    blocks.push({ kind: 'body', text: t });
  }
  return blocks;
}

function renderEquation(tex: string): string {
  try {
    return katex.renderToString(tex, {
      throwOnError: false,
      displayMode: true,
      output: 'html',
    });
  } catch {
    return tex;
  }
}

interface CanonCodexProps {
  open: boolean;
  onClose: () => void;
}

export function CanonCodex({ open, onClose }: CanonCodexProps) {
  const blocks = useMemo(() => parseCanon(canonRaw), []);

  return (
    <div
      aria-hidden={!open}
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        height: '100vh',
        width: 'min(560px, 94vw)',
        transform: open ? 'translateX(0)' : 'translateX(102%)',
        transition: 'transform 420ms cubic-bezier(0.22,0.61,0.36,1)',
        zIndex: 20,
        pointerEvents: open ? 'auto' : 'none',
        display: 'flex',
        flexDirection: 'column',
        background: C.panel,
        backdropFilter: 'blur(8px)',
        borderLeft: `1px solid ${C.border}`,
        boxShadow: '-30px 0 80px rgba(0,0,0,0.6)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '1rem 1.2rem',
          borderBottom: `1px solid ${C.border}`,
          flex: '0 0 auto',
        }}
      >
        <div>
          <div style={{ ...fDisplay, color: C.parchment, fontSize: '0.82rem', fontWeight: 600, textTransform: 'uppercase' }}>
            Liibrelibraii Codex
          </div>
          <div style={{ ...fBody, color: C.muted, fontSize: '0.6rem', letterSpacing: '0.22em', textTransform: 'uppercase', marginTop: '0.25rem' }}>
            Parsed automatically · θ-lock
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close codex"
          style={{
            ...fBody,
            background: 'transparent',
            border: `1px solid ${C.border}`,
            color: C.faint,
            fontSize: '0.7rem',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            padding: '0.3rem 0.6rem',
            cursor: 'pointer',
          }}
        >
          Close ✕
        </button>
      </div>

      {/* Scrollable canon */}
      <div style={{ overflowY: 'auto', padding: '1.2rem 1.4rem 2.4rem', flex: '1 1 auto' }}>
        {blocks.map((b, i) => {
          if (b.kind === 'title') {
            return (
              <h2 key={i} style={{ ...fDisplay, color: C.parchment, fontSize: '1.05rem', fontWeight: 700, margin: '0 0 1rem', lineHeight: 1.4 }}>
                {b.text}
              </h2>
            );
          }
          if (b.kind === 'heading') {
            return (
              <h3 key={i} style={{ ...fDisplay, color: C.brass, fontSize: '0.78rem', fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', margin: '1.6rem 0 0.6rem', borderTop: `1px solid ${C.border}`, paddingTop: '0.9rem' }}>
                {b.text}
              </h3>
            );
          }
          if (b.kind === 'eq') {
            return (
              <div
                key={i}
                style={{ color: C.brassLight, margin: '0.5rem 0', overflowX: 'auto', fontSize: '1.02rem' }}
                dangerouslySetInnerHTML={{ __html: renderEquation(b.tex) }}
              />
            );
          }
          if (b.kind === 'glyph') {
            return (
              <div key={i} style={{ fontFamily: 'ui-monospace, Menlo, monospace', color: C.brassLight, fontSize: '0.82rem', margin: '0.2rem 0', wordBreak: 'break-word' }}>
                {b.text}
              </div>
            );
          }
          return (
            <p key={i} style={{ ...fSerif, color: C.faint, fontSize: '1rem', lineHeight: 1.6, margin: '0 0 0.7rem' }}>
              {b.text}
            </p>
          );
        })}
      </div>
    </div>
  );
}
