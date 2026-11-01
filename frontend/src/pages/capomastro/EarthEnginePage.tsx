import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, ExternalLink, Globe2, RotateCcw } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { usePageHeader } from '../../context/PageHeader';
import { BevelBox } from '../../components/ui/BevelBox';
import { FormulaEvidencePanel } from '../../components/formula-evidence/FormulaEvidencePanel';
import { EarthArchivePanel } from '../../components/earth-archive/EarthArchivePanel';

const ROOT = '/capomastro/engines/arc182/';
const INSTRUMENTS = [
  { id: 'names99', title: '99 names · Earth globe', file: 'names99_glyph_engine_globe.html', description: 'The complete 99-names glyph instrument and Canvas 2D Earth model, with a labeled accessibility adapter.' },
  { id: 'isopsephy', title: 'Isopsephy · full corpus', file: 'isopsephy_amd_v0_0_20.html', description: 'The complete v0.0.20 interactive corpus, calculators, assertions and Earth renderer, with a labeled accessibility adapter.' },
] as const;

interface PackageProvenance {
  schema: number;
  artifact: string;
  tier: string;
  archiveSha256: string;
  files: { path: string; bytes: number; sha256: string }[];
  blocks: { id: string; bytes: number; sha256: string }[];
  provenance: {
    basemap: string;
    relief: string;
    heightDatum: string;
    ellipsoid: string;
    missingTier2: string[];
    limits: string;
  };
}

function PackageEvidence() {
  const provenance = useQuery({
    queryKey: ['arc182-package-provenance'],
    queryFn: async () => {
      const response = await fetch(`${ROOT}provenance.json`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Provenance request returned ${response.status}`);
      const data = await response.json() as PackageProvenance;
      if (!Array.isArray(data.files) || !Array.isArray(data.blocks) || !data.provenance) {
        throw new Error('The provenance file does not have the expected package structure.');
      }
      return data;
    },
    retry: false,
  });
  const data = provenance.data;
  return <BevelBox className="bg-[var(--color-surface-primary)] p-4 sm:p-6">
    <div className="flex flex-wrap justify-between items-center gap-3">
      <h2 className="text-base font-bold">Package provenance & source record</h2>
      <a href={`${ROOT}provenance.json`} download className="earth-instrument-action"><Download size={14} />Provenance JSON</a>
    </div>
    <p className="text-xs text-[var(--color-text-muted)] leading-relaxed mt-2">The following metadata is read from the supplied package, not an independent accuracy audit. Hashes record byte identity only; they are not survey certification or evidence that the live files were rehashed in this browser.</p>
    {provenance.isLoading && <div role="status" aria-label="Loading package provenance" className="h-24 mt-4 bg-[var(--color-surface-secondary)]" />}
    {provenance.isError && <div role="alert" className="mt-4 text-sm">
      <p>Provenance could not be loaded: {provenance.error.message}</p>
      <button type="button" onClick={() => void provenance.refetch()} className="earth-instrument-action mt-2">Retry provenance</button>
    </div>}
    {data && <>
      <dl className="mt-5 grid grid-cols-1 gap-4 text-xs leading-relaxed">
        <div><dt className="text-[var(--color-gold-400)]">Artifact / schema {data.schema}</dt><dd>{data.artifact} · {data.tier}</dd></div>
        <div><dt className="text-[var(--color-gold-400)]">Supplied archive SHA-256</dt><dd className="font-mono break-all">{data.archiveSha256}</dd></div>
        <div><dt className="text-[var(--color-gold-400)]">Basemap</dt><dd>{data.provenance.basemap}</dd></div>
        <div><dt className="text-[var(--color-gold-400)]">Relief</dt><dd>{data.provenance.relief}</dd></div>
        <div><dt className="text-[var(--color-gold-400)]">Height datum</dt><dd>{data.provenance.heightDatum}</dd></div>
        <div><dt className="text-[var(--color-gold-400)]">Ellipsoid precision</dt><dd>{data.provenance.ellipsoid}</dd></div>
        <div><dt className="text-[var(--color-gold-400)]">Absent Tier 2 inputs</dt><dd>{data.provenance.missingTier2.join('; ')}</dd></div>
        <div><dt className="text-[var(--color-gold-400)]">Limits</dt><dd>{data.provenance.limits}</dd></div>
      </dl>
      <details className="mt-5 border-t border-[var(--color-border-subtle)] pt-4">
        <summary className="cursor-pointer text-sm font-semibold">File inventory · source, data, outputs & audits ({data.files.length})</summary>
        <ul className="mt-3 space-y-3">
          {data.files.map(file => <li key={file.path} className="min-w-0 border-b border-[var(--color-border-subtle)] pb-3 text-xs">
            <a href={`${ROOT}${file.path}`} download className="text-[var(--color-gold-400)] underline break-all">{file.path}</a>
            <span className="block text-[var(--color-text-muted)] mt-1">{file.bytes.toLocaleString()} bytes</span>
            <code className="block break-all mt-1">{file.sha256}</code>
          </li>)}
        </ul>
      </details>
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-semibold">Embedded block hashes ({data.blocks.length})</summary>
        <ul className="mt-3 space-y-3 text-xs">{data.blocks.map(block => <li key={block.id}>
          <span>{block.id} · {block.bytes.toLocaleString()} bytes</span><code className="block break-all mt-1">{block.sha256}</code>
        </li>)}</ul>
      </details>
    </>}
  </BevelBox>;
}

export function EarthEnginePage() {
  const [searchParams] = useSearchParams();
  const archiveView = searchParams.get('view') === 'archive';
  const [activeId, setActiveId] = useState<string>(INSTRUMENTS[0].id);
  const [view, setView] = useState<'globe' | 'document'>('globe');
  const [frameState, setFrameState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [revision, setRevision] = useState(0);
  const active = INSTRUMENTS.find(instrument => instrument.id === activeId) ?? INSTRUMENTS[0];
  usePageHeader({
    icon: Globe2,
    title: archiveView ? 'Windows global archive' : 'Earth & Isopsephy instruments',
    subtitle: archiveView ? 'GLOBAL native-resolution acquisition · client-reported status · explicit scope' : 'Original interactive instruments · package provenance · finite formula evidence',
  });
  function reload() {
    setFrameState('loading');
    setRevision(value => value + 1);
  }
  if (archiveView) {
    return <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 text-[var(--color-text-primary)]">
      <Link to="/capomastro/earth-engine" className="earth-instrument-action">Back to instruments</Link>
      <EarthArchivePanel />
    </div>;
  }
  return <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 text-[var(--color-text-primary)]">
    <BevelBox className="bg-[var(--color-surface-primary)] p-4 sm:p-6">
      <div className="text-[10px] uppercase tracking-widest text-[var(--color-gold-400)] mb-2">Original instruments / explicit limits</div>
      <h1 className="text-xl sm:text-2xl font-bold">The supplied engines, with accessible controls.</h1>
      <p className="text-sm leading-relaxed text-[var(--color-text-muted)] mt-3">The frames load clearly labeled derivative HTML instruments with a keyboard, touch and reduced-motion adapter. The Canvas 2D Earth renderer and full corpus remain—not a mock globe. Original supplied files are unchanged and remain available through the original-document links and downloads. Switching instruments, views or reloading resets the document’s unsaved controls.</p>
      <div className="flex flex-wrap gap-2 mt-4">
        <a className="earth-instrument-action" href={`${ROOT}complete-package.zip`} download><Download size={14} />Download full package</a>
        <a className="earth-instrument-action" href={`${ROOT}engine/isopsephy_engine_v0_0_20.py`} download><Download size={14} />Canonical Python source</a>
        <a className="earth-instrument-action" href={`${ROOT}MANIFEST.md`} target="_blank" rel="noreferrer"><ExternalLink size={14} />Manifest</a>
        <a className="earth-instrument-action" href={`${ROOT}specification.txt`} target="_blank" rel="noreferrer">Specification</a>
        <Link to="/capomastro/codex" className="earth-instrument-action">Return to Codex</Link>
      </div>
    </BevelBox>
    <aside aria-label="Cartographic accuracy limitations" className="border border-[var(--color-gold-400)]/40 bg-[var(--color-gold-400)]/5 p-4 sm:p-5 space-y-2 text-xs leading-relaxed">
      <h2 className="font-bold text-sm text-[var(--color-gold-400)]">Tier 1 cartographic visualization only · Tier 2 inputs missing</h2>
      <p>No geoid grid, 30 m DEM, authoritative high-resolution coastline, or per-layer uncertainty and benchmark evidence is supplied. No survey accuracy, certification, or observed-height validation is claimed.</p>
      <p>The supplied semi-minor axis b = 6,356,752 m is truncated, approximately 0.314245 m below the full WGS84 derived value. Source heights are described relative to sea level; without a declared geoid transformation, they must not be treated as ellipsoidal heights.</p>
      <p>Natural Earth 110m and a coarse ETOPO 180×360 grid are supplier declarations. The package does not establish a precise upstream release, extraction date, or resampling chain. The originals remain unchanged, including their own wording.</p>
    </aside>
    <section aria-labelledby="earth-instrument-title" className="min-w-0">
      <div className="flex flex-col sm:flex-row gap-2 mb-4" aria-label="Choose the full instrument">
        {INSTRUMENTS.map(instrument => <button type="button" key={instrument.id} aria-pressed={active.id === instrument.id}
          className={`earth-instrument-action flex-1 ${active.id === instrument.id ? '!border-[var(--color-gold-400)] !bg-[var(--color-gold-400)]/10' : ''}`}
          onClick={() => { if (instrument.id !== activeId) { setFrameState('loading'); setActiveId(instrument.id); } }}>
          {instrument.title}
        </button>)}
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-4" role="group" aria-label="Choose instrument starting view">
        <span className="text-xs text-[var(--color-text-muted)] mr-1">Starting view</span>
        {([{ id: 'globe', label: 'Earth · jump to globe' }, { id: 'document', label: 'Full document · from top' }] as const).map(choice =>
          <button type="button" key={choice.id} aria-pressed={view === choice.id}
            className={`earth-instrument-action ${view === choice.id ? '!border-[var(--color-gold-400)] !bg-[var(--color-gold-400)]/10' : ''}`}
            onClick={() => { if (view !== choice.id) { setFrameState('loading'); setView(choice.id); } }}>
            {choice.label}
          </button>)}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div><h2 id="earth-instrument-title" className="text-base font-bold">{active.title}</h2><p className="text-xs text-[var(--color-text-muted)] mt-1">{active.description}</p></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={reload} className="earth-instrument-action"><RotateCcw size={14} />Reload instrument</button>
          <Link to="/capomastro/earth-engine?view=archive" className="earth-instrument-action">Windows archive setup</Link>
          <a className="earth-instrument-action" href={`${ROOT}${active.file}`} target="_blank" rel="noreferrer"><ExternalLink size={14} />Open original full document</a>
          <a className="earth-instrument-action" href={`${ROOT}${active.file}`} download><Download size={14} />HTML source</a>
        </div>
      </div>
      <p className="text-xs text-[var(--color-gold-400)] mb-3">Accessibility derivative: keyboard / touch / reduced-motion adapter. Original source downloads and new-tab links above remain unmodified. Earth view opens directly at #cv_globe.</p>
      <p role="status" className="text-xs text-[var(--color-text-muted)] mb-3">
        {frameState === 'loading' ? 'Loading adapted full document… If it remains blank, reload or open the original full document.' :
          frameState === 'error' ? 'The document could not load. Retry with Reload instrument, or open the original full document.' :
            'Frame document loaded. This is not a validation of its calculations; inspect the instrument itself and the separate evidence records below.'}
      </p>
      {frameState === 'loading' && <div aria-hidden="true" className="h-2 mb-2 bg-[var(--color-gold-400)]/15" />}
      <iframe
        key={`${active.id}-${view}-${revision}`}
        src={`${ROOT}accessible-${active.file}${view === 'globe' ? '#cv_globe' : ''}`}
        title={`Accessibility-adapted full instrument: ${active.title} · ${view === 'globe' ? 'Earth view' : 'document from top'}`}
        sandbox="allow-scripts allow-downloads"
        className="w-full h-[78dvh] min-h-[520px] border border-[var(--color-border-default)] bg-[var(--color-surface-primary)]"
        onLoad={() => setFrameState('loaded')}
        onError={() => setFrameState('error')}
      />
      <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed mt-2">Isolation: scripts and downloads are allowed; same-origin access is withheld. In-frame computations do not access the app’s credentials or become saved deterministic server evidence automatically. The new-tab link opens the unframed supplied file.</p>
    </section>
    <PackageEvidence />
    <FormulaEvidencePanel />
  </div>;
}
