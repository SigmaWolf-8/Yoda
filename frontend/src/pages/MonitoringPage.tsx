import { useRef, useState } from 'react';
import { Settings as SettingsIcon, ChevronDown, ChevronUp } from 'lucide-react';
import { HEADER_H } from '../components/layout/AppShell';
import { DaemonsSettings } from '../components/settings/DaemonsSettings';

export function MonitoringPage() {
  const [showConfig, setShowConfig] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleDaemonsSaved = () => {
    // [TASK-27] Tell the embedded Array3 monitor to re-fetch
    // /api/settings/engines/daemons and rebuild its node grid in place.
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'a3m:reload-daemon-settings' },
      '*',
    );
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: `calc(100vh - ${HEADER_H}px)`,
        background: '#000',
        overflow: 'hidden',
      }}
    >
      <iframe
        ref={iframeRef}
        src="/array3-monitor.html"
        title="Array3 Monitor"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          border: 'none',
          background: '#000',
          display: 'block',
        }}
      />

      {/* Floating Daemon Settings panel — collapsed by default so the
          monitor remains the focus.  Edits PUT /api/settings/engines
          and take effect on the monitor's next reload. */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          width: showConfig ? 'min(420px, 92vw)' : 'auto',
          maxHeight: `calc(100vh - ${HEADER_H + 32}px)`,
          overflowY: 'auto',
          zIndex: 50,
        }}
      >
        <button
          type="button"
          onClick={() => setShowConfig((v) => !v)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-surface-primary)]/90 backdrop-blur border border-[var(--color-border-default)] text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)] transition-colors shadow-lg"
          title="Configure Array3 daemon host & ports"
        >
          <SettingsIcon className="w-4 h-4" />
          <span>Daemon settings</span>
          {showConfig ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showConfig && (
          <div className="mt-2">
            <DaemonsSettings onSaved={handleDaemonsSaved} />
          </div>
        )}
      </div>
    </div>
  );
}
