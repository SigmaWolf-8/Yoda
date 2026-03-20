import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Copy,
  Download,
  Check,
  Loader2,
  AlertTriangle,
  Terminal,
  Wifi,
  WifiOff,
  HardDriveDownload,
} from 'lucide-react';
import { GGUF_INFO } from './EngineSlot';
import {
  makeBashInstallScript,
  makePsInstallScript,
  makeBashReconnectScript,
  makePsReconnectScript,
  triggerDownload,
} from './installScripts';

// ── Types ──────────────────────────────────────────────────────────────────────

type OS = 'bash' | 'powershell';

type PollingState =
  | { phase: 'idle' }
  | { phase: 'waiting' }
  | { phase: 'connected'; address: string }
  | { phase: 'timeout' }
  | { phase: 'error'; message: string };

interface Props {
  modelName: string;
  port?: number;
  onClose: () => void;
  mode?: 'install' | 'connect';
  isDownloaded?: boolean;
  onMarkDownloaded?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ModelInstallModal({ modelName, port = 8080, onClose, mode = 'connect', isDownloaded = false, onMarkDownloaded }: Props) {
  const crsUrl   = (import.meta.env.VITE_CRS_URL as string | undefined) ?? '';
  const ggufInfo = GGUF_INFO[modelName];
  const ggufRepo = ggufInfo?.repo ?? '';
  const ggufFile = ggufInfo?.file ?? '';

  const [sessionToken] = useState<string>(() => crypto.randomUUID());
  const [os, setOs] = useState<OS>(() =>
    /Win/i.test(navigator.userAgent) ? 'powershell' : 'bash',
  );
  const [copied, setCopied] = useState(false);
  const [polling, setPolling] = useState<PollingState>({ phase: 'idle' });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCount = useRef(0);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const isConnect = mode === 'connect';

  const bashScript = isConnect
    ? makeBashReconnectScript(modelName, ggufFile, port, sessionToken, crsUrl)
    : makeBashInstallScript(modelName, ggufRepo, ggufFile, port, sessionToken, crsUrl);
  const psScript = isConnect
    ? makePsReconnectScript(modelName, ggufFile, port, sessionToken, crsUrl)
    : makePsInstallScript(modelName, ggufRepo, ggufFile, port, sessionToken, crsUrl);
  const script = os === 'bash' ? bashScript : psScript;
  const fileName = os === 'bash'
    ? (isConnect ? 'yoda-reconnect.sh' : 'yoda-setup.sh')
    : (isConnect ? 'yoda-reconnect.ps1' : 'yoda-setup.ps1');
  const mime = os === 'bash' ? 'text/x-shellscript' : 'text/plain';

  const startPolling = useCallback(() => {
    if (!crsUrl) return;
    setPolling({ phase: 'waiting' });
    pollCount.current = 0;

    pollRef.current = setInterval(async () => {
      pollCount.current += 1;
      if (pollCount.current > 200) {
        clearInterval(pollRef.current!);
        setPolling({ phase: 'timeout' });
        return;
      }
      try {
        const res = await fetch(`${crsUrl}/api/yoda/crs/session/${sessionToken}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: { status: string; address?: string } = await res.json();
        if (data.status === 'registered' && data.address) {
          clearInterval(pollRef.current!);
          setPolling({ phase: 'connected', address: data.address });
        }
      } catch (e) {
        clearInterval(pollRef.current!);
        setPolling({ phase: 'error', message: String(e) });
      }
    }, 3000);
  }, [crsUrl, sessionToken]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;

    const FOCUSABLE = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');

    const getFocusable = () =>
      Array.from(modalRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);

    const firstFocusable = getFocusable()[0];
    firstFocusable?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const focusable = getFocusable();
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      if (pollRef.current) clearInterval(pollRef.current);
      previousFocusRef.current?.focus();
    };
  }, [onClose]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    startPolling();
  };

  const handleDownload = () => {
    triggerDownload(script, fileName, mime);
    startPolling();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={isConnect ? `Reconnect ${modelName} to PlenumNET` : `Install ${modelName}`}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div ref={modalRef} className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[var(--color-surface-primary)] border border-[var(--color-border-default)] shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-500/15">
              <Terminal className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
                Reconnect to PlenumNET — {modelName}
              </h2>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                Re-run the tunnel script on your machine to restore the connection
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors text-[var(--color-text-muted)]"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 flex-1">

          {/* CRS URL warning */}
          {!crsUrl && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>
                <strong>CRS URL not configured.</strong> The generated script will only work when YODA is deployed.
                Set the <code className="bg-amber-500/20 px-1 rounded">VITE_CRS_URL</code> environment variable to your deployed domain.
              </span>
            </div>
          )}

          {/* OS tabs */}
          <div className="flex gap-1 p-1 rounded-lg bg-[var(--color-surface-secondary)] w-fit">
            {(['bash', 'powershell'] as OS[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setOs(tab)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  os === tab
                    ? 'bg-[var(--color-surface-primary)] text-[var(--color-text-primary)] shadow-sm'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                }`}
              >
                {tab === 'bash' ? 'macOS / Linux' : 'Windows'}
              </button>
            ))}
          </div>

          {/* Script block */}
          <div className="relative">
            <pre className="w-full h-64 overflow-auto p-3 rounded-xl bg-[var(--color-navy-950)] border border-[var(--color-border-subtle)] text-[10px] text-[var(--color-text-secondary)] font-mono leading-relaxed whitespace-pre select-all">
              {script}
            </pre>
          </div>

          {/* Copy / Download */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-gold-500)] text-[var(--color-navy-950)] text-xs font-semibold hover:bg-[var(--color-gold-400)] transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied!' : 'Copy script'}
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-surface-tertiary)] text-[var(--color-text-secondary)] text-xs font-medium hover:bg-[var(--color-surface-hover)] transition-colors border border-[var(--color-border-default)]"
            >
              <Download className="w-3.5 h-3.5" />
              Download {fileName}
            </button>
          </div>

          {/* Polling state */}
          {polling.phase !== 'idle' && (
            <div className={`flex items-start gap-3 p-3.5 rounded-xl border text-xs ${
              polling.phase === 'waiting'
                ? 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                : polling.phase === 'connected'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-red-500/10 border-red-500/30 text-red-300'
            }`}>
              {polling.phase === 'waiting' && (
                <>
                  <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin mt-0.5" />
                  <div>
                    <p className="font-medium">Waiting for your server to connect…</p>
                    <p className="mt-0.5 opacity-75">Run the script on your server, then come back here.</p>
                  </div>
                </>
              )}
              {polling.phase === 'connected' && (
                <>
                  <Wifi className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">
                      Connected — registered as <code className="bg-emerald-500/20 px-1 rounded">{polling.address}</code>
                    </p>
                    <p className="mt-0.5 opacity-75">
                      Tunnel is live. Set this engine's Endpoint in YODA Settings to{' '}
                      <code className="bg-emerald-500/20 px-1 rounded">http://localhost:{port}</code>.
                    </p>
                  </div>
                </>
              )}
              {polling.phase === 'timeout' && (
                <>
                  <WifiOff className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">No connection after 10 minutes.</p>
                    <p className="mt-0.5 opacity-75">Re-run the script and try again. Make sure it completed without errors.</p>
                  </div>
                </>
              )}
              {polling.phase === 'error' && (
                <>
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Connection check failed</p>
                    <p className="mt-0.5 opacity-75">{polling.message}</p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* What this script does */}
          <div className="p-3 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-subtle)] space-y-1.5">
            <p className="text-[10px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">What the script does</p>
            <ol className="text-xs text-[var(--color-text-muted)] space-y-1 list-decimal list-inside leading-relaxed">
              <li>Checks that llama-server and the model file are already present</li>
              <li>Restarts <code className="bg-[var(--color-surface-primary)] px-1 rounded">llama-server</code> on port <code className="bg-[var(--color-surface-primary)] px-1 rounded">{port}</code></li>
              <li>Re-registers with YODA CRS and restarts the PlenumNET tunnel daemon</li>
            </ol>
          </div>

          {/* Mark as installed */}
          {onMarkDownloaded && (
            <div className="flex items-center gap-3 pt-1 border-t border-[var(--color-border-subtle)]">
              {isDownloaded ? (
                <>
                  <HardDriveDownload className="w-4 h-4 flex-shrink-0 text-emerald-400" />
                  <span className="text-xs text-emerald-400 flex-1">Marked as installed on this machine</span>
                </>
              ) : (
                <>
                  <HardDriveDownload className="w-4 h-4 flex-shrink-0 text-[var(--color-text-muted)]" />
                  <span className="text-xs text-[var(--color-text-muted)] flex-1">Already ran the Install script and the model is on disk?</span>
                  <button
                    onClick={onMarkDownloaded}
                    className="px-3 py-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/8 text-emerald-400 text-xs font-medium hover:bg-emerald-500/15 hover:border-emerald-500/70 transition-colors flex-shrink-0"
                  >
                    Mark as installed
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
