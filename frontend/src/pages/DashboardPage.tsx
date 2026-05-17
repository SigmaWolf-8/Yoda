import { useState } from 'react';
import { LayoutDashboard, Download, Copy, Check, Terminal } from 'lucide-react';
import { usePageHeader } from '../context/PageHeader';
import { useVideoPlay } from '../context/VideoPlay';

const SIDEBAR_PLAY_OFFSET_MS = 800;

const INSTALL_CMD = `bash <(curl -fsSL ${window.location.origin}/install-local.sh)`;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={copy}
      title="Copy to clipboard"
      style={{
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: '2px 6px',
        borderRadius: 4,
        color: copied ? '#8BA633' : '#6B655E',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        transition: 'color 0.15s',
      }}
    >
      {copied
        ? <><Check style={{ width: 13, height: 13 }} /><span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>copied</span></>
        : <Copy style={{ width: 13, height: 13 }} />}
    </button>
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

      {/* ── Top metrics row (future: Open Tunnels, Active Sessions, etc.) ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 min-h-[80px] px-6 lg:px-8 pt-6 lg:pt-8" />

      {/* ── Hero video — true recess ── */}
      {/*
        Bevel anatomy (light source top-left):
          outer rim  — thin 1-px border, lighter top/left, darker bottom/right → raised lip
          inner lip  — hard 0-blur inset strips: dark top/left (shadow), faint bottom/right (reflected light)
          pit fill   — large blurry inset shadows deepen the sense of drop
        The frame bg MUST be a visible mid-tone, not black — otherwise the
        shadow and highlight strips vanish into the same shade.
      */}
      <div
        onClick={playHero}
        style={{
          height: '48vh',
          minHeight: 320,
          marginTop: '24px',
          padding: '14px',
          background: 'hsl(20, 8%, 13%)',   /* medium-dark leather tone — not black */
          borderRadius: '3px',
          /* Outer raised rim: lighter top/left, darker bottom/right */
          border: '1px solid',
          borderColor: 'rgba(255,255,255,0.16) rgba(0,0,0,0.8) rgba(0,0,0,0.8) rgba(255,255,255,0.16)',
          boxShadow: [
            /* Hard bevel at inner lip — no blur so the edge is sharp */
            'inset 0 5px 0 rgba(0,0,0,0.96)',          /* top lip: deep shadow */
            'inset 5px 0 0 rgba(0,0,0,0.88)',          /* left lip: deep shadow */
            'inset 0 -2px 0 rgba(255,255,255,0.08)',   /* bottom lip: faint reflected light */
            'inset -2px 0 0 rgba(255,255,255,0.06)',   /* right lip: faint reflected light */
            /* Blurry pit-drop — fades from the bevel inward */
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

      {/* ── Install Locally ── */}
      <div className="px-6 lg:px-8 pb-8">
        <div style={{
          background: '#181411',
          border: '1px solid #272220',
          borderRadius: 12,
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid #272220',
            flexWrap: 'wrap',
            gap: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Terminal style={{ width: 16, height: 16, color: '#4A9EF5', flexShrink: 0 }} />
              <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: '0.28em', textTransform: 'uppercase', color: '#998F82' }}>
                Install Locally
              </span>
            </div>
            <a
              href="/install-local.sh"
              download="install-local.sh"
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 6,
                background: 'rgba(74,158,245,0.1)', border: '1px solid rgba(74,158,245,0.3)',
                color: '#4A9EF5', textDecoration: 'none',
                fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
                cursor: 'pointer', transition: 'background 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(74,158,245,0.18)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(74,158,245,0.1)')}
            >
              <Download style={{ width: 13, height: 13 }} />
              install-local.sh
            </a>
          </div>

          {/* One-liner */}
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #272220' }}>
            <p style={{ fontSize: 11, color: '#6B655E', fontFamily: "'JetBrains Mono', monospace", marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.2em' }}>
              One-liner
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#0F0C0A', borderRadius: 6, padding: '10px 14px', border: '1px solid #272220' }}>
              <code style={{ flex: 1, fontSize: 13, color: '#E4DFD5', fontFamily: "'JetBrains Mono', monospace", wordBreak: 'break-all' }}>
                {INSTALL_CMD}
              </code>
              <CopyButton text={INSTALL_CMD} />
            </div>
          </div>

          {/* Steps */}
          <div style={{ padding: '14px 20px' }}>
            <p style={{ fontSize: 11, color: '#6B655E', fontFamily: "'JetBrains Mono', monospace", marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.2em' }}>
              Manual steps
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { n: '1', label: 'Install Rust', cmd: 'curl --proto \'=https\' --tlsv1.2 -sSf https://sh.rustup.rs | sh' },
                { n: '2', label: 'Build frontend', cmd: 'cd frontend && npm install && npm run build && cd ..' },
                { n: '3', label: 'Build & run backend', cmd: 'cargo build --bin yoda-api && BIND_PORT=3000 ./target/debug/yoda-api' },
              ].map(({ n, label, cmd }) => (
                <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(74,158,245,0.12)', border: '1px solid rgba(74,158,245,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#4A9EF5', fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>{n}</span>
                  <span style={{ fontSize: 11, color: '#998F82', width: 130, flexShrink: 0, fontFamily: "'JetBrains Mono', monospace" }}>{label}</span>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, background: '#0F0C0A', borderRadius: 5, padding: '7px 12px', border: '1px solid #272220', minWidth: 0 }}>
                    <code style={{ flex: 1, fontSize: 12, color: '#C9C1B4', fontFamily: "'JetBrains Mono', monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {cmd}
                    </code>
                    <CopyButton text={cmd} />
                  </div>
                </div>
              ))}
            </div>
            <p style={{ marginTop: 14, fontSize: 11, color: '#6B655E', fontFamily: "'JetBrains Mono', monospace" }}>
              Requires: <span style={{ color: '#4A9EF5' }}>Rust</span> · <span style={{ color: '#4A9EF5' }}>Node.js 20+</span> · open <span style={{ color: '#4A9EF5' }}>http://localhost:3000</span>
            </p>
          </div>
        </div>
      </div>

    </div>
  );
}
