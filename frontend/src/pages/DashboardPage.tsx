import { useState, useRef, useEffect } from 'react';
import { LayoutDashboard, Settings, Download, Copy, Check } from 'lucide-react';
import { usePageHeader } from '../context/PageHeader';
import { useVideoPlay } from '../context/VideoPlay';

const SIDEBAR_PLAY_OFFSET_MS = 800;
const INSTALL_CMD = `bash <(curl -fsSL ${window.location.origin}/install-local.sh)`;

const STEPS = [
  { n: '1', label: 'Install Rust',       cmd: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh" },
  { n: '2', label: 'Build frontend',     cmd: 'cd frontend && npm install && npm run build && cd ..' },
  { n: '3', label: 'Build & run',        cmd: 'cargo build --bin yoda-api && BIND_PORT=3000 ./target/debug/yoda-api' },
];

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1800); })}
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: ok ? '#8BA633' : '#6B655E', display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}
    >
      {ok ? <Check style={{ width: 12, height: 12 }} /> : <Copy style={{ width: 12, height: 12 }} />}
    </button>
  );
}

function InstallDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Install Locally"
        style={{
          background: open ? 'rgba(74,158,245,0.12)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${open ? 'rgba(74,158,245,0.35)' : '#272220'}`,
          borderRadius: 7,
          cursor: 'pointer',
          padding: '6px 8px',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          color: open ? '#4A9EF5' : '#6B655E',
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => { if (!open) { e.currentTarget.style.borderColor = 'rgba(74,158,245,0.25)'; e.currentTarget.style.color = '#998F82'; } }}
        onMouseLeave={e => { if (!open) { e.currentTarget.style.borderColor = '#272220'; e.currentTarget.style.color = '#6B655E'; } }}
      >
        <Settings style={{ width: 14, height: 14 }} />
        <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.12em' }}>local install</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          width: 480,
          background: '#181411',
          border: '1px solid #2E2A26',
          borderRadius: 10,
          boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
          zIndex: 200,
          overflow: 'hidden',
        }}>
          {/* header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #272220' }}>
            <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: '#6B655E', letterSpacing: '0.22em', textTransform: 'uppercase' }}>Install Locally</span>
            <a
              href="/install-local.sh"
              download="install-local.sh"
              onClick={() => setOpen(false)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#4A9EF5', textDecoration: 'none', padding: '3px 8px', borderRadius: 5, background: 'rgba(74,158,245,0.08)', border: '1px solid rgba(74,158,245,0.2)' }}
            >
              <Download style={{ width: 11, height: 11 }} />
              .sh
            </a>
          </div>

          {/* one-liner */}
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #272220' }}>
            <p style={{ fontSize: 10, color: '#6B655E', fontFamily: "'JetBrains Mono', monospace", marginBottom: 6, letterSpacing: '0.18em', textTransform: 'uppercase' }}>One-liner</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#0F0C0A', borderRadius: 5, padding: '8px 10px', border: '1px solid #272220' }}>
              <code style={{ flex: 1, fontSize: 11, color: '#E4DFD5', fontFamily: "'JetBrains Mono', monospace", wordBreak: 'break-all', lineHeight: 1.5 }}>{INSTALL_CMD}</code>
              <CopyBtn text={INSTALL_CMD} />
            </div>
          </div>

          {/* steps */}
          <div style={{ padding: '10px 16px 14px' }}>
            <p style={{ fontSize: 10, color: '#6B655E', fontFamily: "'JetBrains Mono', monospace", marginBottom: 8, letterSpacing: '0.18em', textTransform: 'uppercase' }}>Manual</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {STEPS.map(({ n, label, cmd }) => (
                <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 16, height: 16, borderRadius: '50%', background: 'rgba(74,158,245,0.1)', border: '1px solid rgba(74,158,245,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#4A9EF5', fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>{n}</span>
                  <span style={{ fontSize: 10, color: '#6B655E', width: 96, flexShrink: 0, fontFamily: "'JetBrains Mono', monospace" }}>{label}</span>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4, background: '#0F0C0A', borderRadius: 4, padding: '5px 8px', border: '1px solid #272220', minWidth: 0 }}>
                    <code style={{ flex: 1, fontSize: 10, color: '#C9C1B4', fontFamily: "'JetBrains Mono', monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cmd}</code>
                    <CopyBtn text={cmd} />
                  </div>
                </div>
              ))}
            </div>
            <p style={{ marginTop: 10, fontSize: 10, color: '#3D3730', fontFamily: "'JetBrains Mono', monospace" }}>
              Rust · Node 20+ · <span style={{ color: '#4A9EF5' }}>localhost:3000</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export function DashboardPage() {
  const { heroRef, playHero, playSidebarAfterDelay } = useVideoPlay();

  usePageHeader({
    icon: LayoutDashboard,
    title: 'Dashboard',
    subtitle: 'Your development intelligence platform',
  });

  return (
    <div className="flex flex-col gap-6 animate-fade-in">

      {/* ── Top bar: gear icon sits top-right ── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '20px 24px 0', position: 'relative', zIndex: 100 }}>
        <InstallDropdown />
      </div>

      {/* ── Hero video ── */}
      <div
        onClick={playHero}
        style={{
          height: '48vh',
          minHeight: 320,
          padding: '14px',
          background: 'hsl(20, 8%, 13%)',
          borderRadius: '3px',
          border: '1px solid',
          borderColor: 'rgba(255,255,255,0.16) rgba(0,0,0,0.8) rgba(0,0,0,0.8) rgba(255,255,255,0.16)',
          boxShadow: [
            'inset 0 5px 0 rgba(0,0,0,0.96)',
            'inset 5px 0 0 rgba(0,0,0,0.88)',
            'inset 0 -2px 0 rgba(255,255,255,0.08)',
            'inset -2px 0 0 rgba(255,255,255,0.06)',
            'inset 0 14px 36px rgba(0,0,0,0.82)',
            'inset 10px 0 24px rgba(0,0,0,0.62)',
            'inset -10px 0 24px rgba(0,0,0,0.52)',
            'inset 0 -8px 20px rgba(0,0,0,0.58)',
          ].join(', '),
          position: 'relative',
          boxSizing: 'border-box',
          cursor: 'pointer',
        }}
      >
        <video
          ref={heroRef}
          autoPlay
          muted
          playsInline
          style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
          onEnded={() => {
            if (heroRef.current) {
              heroRef.current.currentTime = 0;
              heroRef.current.pause();
            }
            playSidebarAfterDelay(SIDEBAR_PLAY_OFFSET_MS);
          }}
        >
          <source src={`${import.meta.env.BASE_URL}hero.mp4`} type="video/mp4" />
        </video>
      </div>

    </div>
  );
}
