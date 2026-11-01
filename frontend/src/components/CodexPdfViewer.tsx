import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw } from 'lucide-react';
import './CodexPdfViewer.css';

interface RenderedPage {
  page: number;
  file: string;
  width: number;
  height: number;
  text?: string;
}

interface RenderedManifest {
  source: string;
  source_sha256: string;
  renderer: string;
  pages: RenderedPage[];
  note?: string;
}

interface CodexPdfViewerProps {
  src: string;
  title: string;
  manifestUrl: string;
}

/** A vector page reader; the source PDF is never rewritten or reflowed. */
export function CodexPdfViewer({ src, title, manifestUrl }: CodexPdfViewerProps) {
  // A changed source remounts the reader, resets page/zoom and aborts its request.
  return <PdfReader key={`${src}:${manifestUrl}`} title={title} manifestUrl={manifestUrl} />;
}

function PdfReader({ title, manifestUrl }: Omit<CodexPdfViewerProps, 'src'>) {
  const [manifest, setManifest] = useState<RenderedManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [index, setIndex] = useState(0);
  const [jump, setJump] = useState('1');
  const [zoom, setZoom] = useState<number | null>(null);
  const [imageRevision, setImageRevision] = useState(0);
  const [imageState, setImageState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [stageWidth, setStageWidth] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const page = manifest?.pages[index];

  useEffect(() => {
    const controller = new AbortController();
    setManifest(null);
    setError(null);
    fetch(manifestUrl, { signal: controller.signal, credentials: 'include' })
      .then(async response => {
        if (!response.ok) throw new Error(`Page manifest returned HTTP ${response.status}.`);
        const data = await response.json() as RenderedManifest;
        if (!Array.isArray(data.pages) || !data.pages.length || !data.pages.every(item =>
          Number.isInteger(item.page) && typeof item.file === 'string' &&
          /^page-\d+\.svg$/.test(item.file) &&
          Number.isFinite(item.width) && item.width > 0 &&
          Number.isFinite(item.height) && item.height > 0
        )) throw new Error('The page manifest is missing valid vector pages.');
        if (!controller.signal.aborted) setManifest(data);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The page manifest could not be read.');
      });
    return () => controller.abort();
  }, [manifestUrl, revision]);

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const style = getComputedStyle(element);
      setStageWidth(Math.max(1, element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [manifest]);

  function navigate(next: number) {
    if (!manifest) return;
    const bounded = Math.min(manifest.pages.length - 1, Math.max(0, next));
    setJump(String(bounded + 1));
    if (bounded === index) return;
    setImageState('loading');
    setIndex(bounded);
    stage.current?.scrollTo(0, 0);
  }

  function adjustZoom(delta: number) {
    const fitted = page && stageWidth ? stageWidth / page.width : 1;
    setZoom(Math.min(3, Math.max(.25, Math.round(((zoom ?? fitted) + delta) * 100) / 100)));
  }

  const buttonClass = 'codex-pdf-button';
  const pageUrl = page ? new URL(page.file, new URL(manifestUrl, window.location.href)).href : '';
  const fitScale = page && stageWidth ? stageWidth / page.width : 1;

  return <section className="codex-pdf-viewer" aria-label={`${title} vector page reader`}>
    <p className="codex-pdf-caption">Vector rendering from the original PDF. Page layout is preserved; this is not HTML reflow. The unchanged PDF remains available through Open full page and Download above.</p>
    {error ? <div role="alert" className="codex-pdf-state">
      <p>Vector pages could not be loaded. {error}</p>
      <button type="button" className={buttonClass} onClick={() => setRevision(value => value + 1)}><RotateCcw size={14} aria-hidden="true" />Retry page manifest</button>
    </div> : !manifest ? <div className="codex-pdf-state" role="status">
      Loading vector page manifest…
      <div className="codex-pdf-skeleton" aria-hidden="true" />
    </div> : <>
      <div className="codex-pdf-toolbar" aria-label="Document controls">
        <div className="codex-pdf-controls">
          <button type="button" className={buttonClass} disabled={index === 0} onClick={() => navigate(index - 1)} aria-label="Previous page"><ChevronLeft size={16} aria-hidden="true" />Previous</button>
          <form className="codex-pdf-controls" onSubmit={event => {
            event.preventDefault();
            const value = Number(jump);
            if (Number.isInteger(value) && value >= 1 && value <= manifest.pages.length) navigate(value - 1);
          }}>
            <label htmlFor="codex-pdf-page">Page</label>
            <input id="codex-pdf-page" className="codex-pdf-input" type="number" min={1} max={manifest.pages.length} required value={jump} onChange={event => setJump(event.target.value)} />
            <span>of {manifest.pages.length}</span>
            <button type="submit" className={buttonClass}>Go</button>
          </form>
          <button type="button" className={buttonClass} disabled={index === manifest.pages.length - 1} onClick={() => navigate(index + 1)} aria-label="Next page">Next<ChevronRight size={16} aria-hidden="true" /></button>
        </div>
        <div className="codex-pdf-controls" role="group" aria-label="Page zoom">
          <button type="button" className={buttonClass} disabled={zoom !== null && zoom <= .25} onClick={() => adjustZoom(-.25)} aria-label="Zoom out"><Minus size={16} aria-hidden="true" /></button>
          <span aria-live="polite">{zoom === null ? 'Fit width' : `${Math.round(zoom * 100)}%`}</span>
          <button type="button" className={buttonClass} disabled={zoom !== null && zoom >= 3} onClick={() => adjustZoom(.25)} aria-label="Zoom in"><Plus size={16} aria-hidden="true" /></button>
          <button type="button" className={buttonClass} onClick={() => setZoom(null)} aria-pressed={zoom === null}>Fit width</button>
        </div>
      </div>
      <p role="status" aria-live="polite" className="codex-pdf-caption">Page {index + 1} of {manifest.pages.length}{imageState === 'loading' ? ' · Loading vector page…' : imageState === 'error' ? ' · Page image unavailable' : ' · Vector page loaded'}</p>
      <div className="codex-pdf-stage" ref={stage} tabIndex={0} aria-label="Scrollable document page" aria-busy={imageState === 'loading'}>
        {page && <div className="codex-pdf-sheet" style={{ width: zoom === null ? '100%' : `${page.width * zoom}px`, aspectRatio: `${page.width} / ${page.height}` }}>
          {imageState === 'loading' && <div className="codex-pdf-page-loading" aria-hidden="true">Loading page {index + 1}…<div className="codex-pdf-skeleton" /></div>}
          {imageState === 'error' ? <div role="alert" className="codex-pdf-state">
            <p>Page {index + 1} could not load. Retry this page, or use the original PDF links above.</p>
            <button type="button" className={buttonClass} onClick={() => { setImageState('loading'); setImageRevision(value => value + 1); }}><RotateCcw size={14} aria-hidden="true" />Retry page</button>
          </div> : <img
            key={`${pageUrl}:${imageRevision}`}
            src={`${pageUrl}${imageRevision ? `?retry=${imageRevision}` : ''}`}
            alt={`${title}, page ${index + 1}. Optional extracted page text follows the viewer.`}
            width={page.width}
            height={page.height}
            onLoad={() => setImageState('ready')}
            onError={() => setImageState('error')}
            style={{ visibility: imageState === 'ready' ? 'visible' : 'hidden' }}
          />}
        </div>}
      </div>
      {page && <details key={index} className="codex-pdf-text">
        <summary>Extracted page text · page {index + 1}</summary>
        <p className="codex-pdf-caption">Optional accessibility aid only. Extraction may not preserve reading order, mathematical notation or diagrams; the vector page remains the visual reference.</p>
        <pre>{typeof page.text === 'string' && page.text.trim() ? page.text : 'No extracted text is available for this page.'}</pre>
      </details>}
      <details className="codex-pdf-provenance">
        <summary>Rendering source record</summary>
        <p>Source: {manifest.source}</p>
        <p>Renderer: {manifest.renderer}</p>
        <p>Source SHA-256 (manifest record, not independently verified in this browser): {manifest.source_sha256}</p>
        {manifest.note && <p>{manifest.note}</p>}
        <p>Fit-width scale: {Math.round(fitScale * 100)}%.</p>
      </details>
    </>}
  </section>;
}
