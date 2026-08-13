import { useEffect, useMemo, useState } from 'react';
import {
  Stamp,
  Github,
  Twitter,
  Mail,
  Link2,
  ExternalLink,
  X,
  ImageDown,
  Check,
} from 'lucide-react';
import { usePageHeader } from '../../context/PageHeader';
import { BevelBox } from '../../components/ui/BevelBox';
import { CopyDispatchButton } from '../../components/ui/CopyDispatchButton';
import { copyImage, inlineImage } from '../../lib/clipboard';
import { buildSealDispatch } from './dispatch';

/**
 * Visual identity and public presence: the heraldic marks, the archival
 * receipts, the media reel, and the outward-facing links.
 */

interface Mark {
  id: string;
  title: string;
  caption: string;
  src: string;
}

const MARKS: Mark[] = [
  {
    id: 'coat-of-arms',
    title: 'Coat of Arms — CH Salvi 1092/1295',
    caption: 'The house arms carried since 1092, reaffirmed 1295.',
    src: '/capomastro/brand/coat-of-arms.jpg',
  },
  {
    id: 'coat-of-arms-salvalaggio',
    title: 'Salvalaggio Arms',
    caption: 'The Salvalaggio line of the same house.',
    src: '/capomastro/brand/coat-of-arms-salvalaggio.jpg',
  },
  {
    id: 'bio-seal',
    title: 'TOL οἶδα Σάλβι — Bio Seal',
    caption: 'The personal seal used to close sealed records.',
    src: '/capomastro/brand/bio-seal.jpg',
  },
  {
    id: 'canon',
    title: 'Librelibraii Canon',
    caption: 'The canon plate governing proportion and rule.',
    src: '/capomastro/brand/librelibraii-canon.jpg',
  },
];

const RECEIPTS: Mark[] = [
  {
    id: 'archival-receipt',
    title: 'Archival Receipt & Recordio — Sealed Lattice',
    caption: 'Receipt of archival and permanent record of the sealed lattice.',
    src: '/capomastro/brand/archival-receipt-sealed-lattice.jpg',
  },
  {
    id: 'witnessed-receipt',
    title: 'Witnessed Archival Receipt & Record',
    caption: 'Witnessed and attested record of the sealed lattice.',
    src: '/capomastro/brand/witnessed-archival-receipt.jpg',
  },
  {
    id: 'chl-receipt',
    title: 'CHL Official Receipt — CAP AETURNUM',
    caption: 'Capomastro Holdings Ltd. official receipt of archival and permanent record.',
    src: '/capomastro/brand/chl-official-receipt-cap-aeturnum.jpg',
  },
];

const LINKS: { label: string; href: string; icon: React.ElementType; detail: string }[] = [
  {
    label: 'GitHub — SigmaWolf-8',
    href: 'https://github.com/SigmaWolf-8',
    icon: Github,
    detail: 'Source of record for the Salvi Framework and YODA.',
  },
  {
    label: 'Ternary',
    href: 'https://github.com/SigmaWolf-8/Ternary',
    icon: Github,
    detail: 'The ternary kernel and TL-DSA / TLSponge primitives.',
  },
  {
    label: 'x.com/capo_mastro',
    href: 'https://x.com/capo_mastro',
    icon: Twitter,
    detail: 'Public dispatches.',
  },
  {
    label: 'RSalvi@Salvigroup.com',
    href: 'mailto:RSalvi@Salvigroup.com',
    icon: Mail,
    detail: 'Direct correspondence.',
  },
];

function Plate({ mark, onOpen }: { mark: Mark; onOpen: (m: Mark) => void }) {
  return (
    <BevelBox
      onClick={() => onOpen(mark)}
      className="bg-[var(--color-surface-primary)] p-3 h-full hover:bg-[var(--color-gold-400)]/5 transition-colors"
    >
      <div className="aspect-square w-full overflow-hidden bg-black/40 mb-3">
        <img
          src={mark.src}
          alt={mark.title}
          loading="lazy"
          className="w-full h-full object-contain"
        />
      </div>
      <div className="text-xs font-bold text-[var(--color-text-primary)] leading-snug mb-1">
        {mark.title}
      </div>
      <div className="text-[11px] text-[var(--color-text-muted)] leading-relaxed">
        {mark.caption}
      </div>
    </BevelBox>
  );
}

export function SealPage() {
  const [lightbox, setLightbox] = useState<Mark | null>(null);
  const [inlined, setInlined] = useState<Record<string, string> | null>(null);
  const [plateCopied, setPlateCopied] = useState(false);

  usePageHeader({
    icon: Stamp,
    title: 'Seal & Presence',
    subtitle: 'Heraldic identity, archival receipts, and the public record',
  });

  /*
   * Re-encode the plates small, once, in the background.
   *
   * A pasted `<img>` pointing back at this server only renders for as long as
   * the recipient can reach it, which for most recipients is never — so the
   * marks travel inside the message instead. They are shrunk on the way in: the
   * originals total several megabytes, and a clipboard payload that size is
   * quietly dropped by some mail clients.
   */
  useEffect(() => {
    let cancelled = false;
    const plates = [...MARKS, ...RECEIPTS];

    Promise.all(plates.map((m) => inlineImage(m.src).then((uri) => [m.id, uri] as const)))
      .then((pairs) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const [id, uri] of pairs) if (uri) map[id] = uri;
        setInlined(map);
      })
      // A plate that will not re-encode is named in the copy but not pictured,
      // which is better than withholding the whole record.
      .catch(() => {
        if (!cancelled) setInlined({});
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const sendable = useMemo(() => {
    if (!inlined) return null;
    return buildSealDispatch(
      [
        { heading: 'Heraldry & canon', marks: MARKS },
        { heading: 'Archival receipts', marks: RECEIPTS },
      ],
      LINKS,
      window.location.origin,
      inlined,
      new Date(),
    );
  }, [inlined]);

  async function onCopyPlate(mark: Mark) {
    const ok = await copyImage(mark.src);
    if (!ok) {
      window.open(mark.src, '_blank', 'noopener');
      return;
    }
    setPlateCopied(true);
    window.setTimeout(() => setPlateCopied(false), 3000);
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in space-y-8">
      {/* ── Send the record ── */}
      <BevelBox className="bg-[var(--color-surface-primary)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-[var(--color-text-muted)] leading-relaxed max-w-2xl">
            Copy the whole seal record — the marks, the receipts and the public links — formatted
            and ready to paste into an email or a message. The plates travel inside the copy, so
            they still show for someone who cannot reach this server. To send a single plate on its
            own, open it and use <span className="text-[var(--color-text-primary)]">Copy image</span>.
          </p>
          <CopyDispatchButton
            build={() => sendable}
            label="Copy the seal record"
            preparingLabel="Preparing plates…"
            title="Copies the heraldry, receipts and links, with the marks embedded"
          />
        </div>
      </BevelBox>

      {/* ── Heraldry ── */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--color-text-primary)] mb-4">
          Heraldry & Canon
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {MARKS.map((m) => (
            <Plate key={m.id} mark={m} onOpen={setLightbox} />
          ))}
        </div>
      </section>

      {/* ── Receipts ── */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--color-text-primary)] mb-4">
          Archival Receipts
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {RECEIPTS.map((m) => (
            <Plate key={m.id} mark={m} onOpen={setLightbox} />
          ))}
        </div>
      </section>

      {/* ── Media ── */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--color-text-primary)] mb-4">
          Media
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <BevelBox className="bg-[var(--color-surface-primary)] p-3 lg:col-span-2">
            <video
              controls
              preload="metadata"
              poster="/capomastro/brand/coat-of-arms.jpg"
              className="w-full bg-black"
            >
              <source src="/capomastro/media/sovereign-reel-720p.mp4" type="video/mp4" />
              Your browser cannot play this video.
            </video>
            <div className="text-xs text-[var(--color-text-muted)] mt-2">Sovereign reel — 720p</div>
          </BevelBox>
          <BevelBox className="bg-[var(--color-surface-primary)] p-3">
            <div className="bg-white p-3">
              <img
                src="/capomastro/media/qr-code.png"
                alt="Capomastro QR code"
                loading="lazy"
                className="w-full h-auto object-contain"
              />
            </div>
            <div className="text-xs text-[var(--color-text-muted)] mt-2">Scan code</div>
          </BevelBox>
        </div>
      </section>

      {/* ── Public presence ── */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--color-text-primary)] mb-4">
          Public Presence
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {LINKS.map(({ label, href, icon: Icon, detail }) => (
            <a key={href} href={href} target="_blank" rel="noreferrer" className="block">
              <BevelBox className="bg-[var(--color-surface-primary)] p-4 h-full hover:bg-[var(--color-gold-400)]/5 transition-colors">
                <div className="flex items-start gap-3">
                  <Icon className="w-4 h-4 text-[var(--color-gold-400)] flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
                      {label}
                    </div>
                    <div className="text-xs text-[var(--color-text-muted)]">{detail}</div>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-[var(--color-text-muted)] flex-shrink-0 ml-auto" />
                </div>
              </BevelBox>
            </a>
          ))}
        </div>

        <a href="/capomastro/docs/link-in-bio.html" target="_blank" rel="noreferrer" className="block mt-4">
          <BevelBox className="bg-[var(--color-surface-primary)] p-4 hover:bg-[var(--color-gold-400)]/5 transition-colors">
            <div className="flex items-center gap-3">
              <Link2 className="w-4 h-4 text-[var(--color-gold-400)] flex-shrink-0" />
              <div>
                <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                  Link-in-bio page
                </div>
                <div className="text-xs text-[var(--color-text-muted)]">
                  The standalone public landing page, served as authored.
                </div>
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-[var(--color-text-muted)] ml-auto" />
            </div>
          </BevelBox>
        </a>
      </section>

      {/* ── Lightbox ── */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-6"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.title}
        >
          <div
            className="absolute top-5 right-5 flex items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => onCopyPlate(lightbox)}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 bg-white/10 text-white hover:bg-white/20 transition-colors"
              title="Put this plate on the clipboard so it can be pasted into a message"
            >
              {plateCopied ? <Check className="w-3.5 h-3.5" /> : <ImageDown className="w-3.5 h-3.5" />}
              {plateCopied ? 'Copied' : 'Copy image'}
            </button>
            <button
              type="button"
              onClick={() => setLightbox(null)}
              aria-label="Close"
              className="p-2 text-white/70 hover:text-white"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          <figure className="max-w-5xl max-h-full" onClick={(e) => e.stopPropagation()}>
            <img
              src={lightbox.src}
              alt={lightbox.title}
              className="max-h-[80vh] w-auto mx-auto object-contain"
            />
            <figcaption className="text-center text-xs text-white/70 mt-3">
              {lightbox.title} — {lightbox.caption}
            </figcaption>
          </figure>
        </div>
      )}
    </div>
  );
}
