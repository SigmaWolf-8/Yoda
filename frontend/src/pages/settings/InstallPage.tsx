import { useState } from 'react';
import { Download, Copy, Check, Terminal, AlertTriangle } from 'lucide-react';
import { usePageHeader } from '../../context/PageHeader';
import { Settings as SettingsIcon } from 'lucide-react';

const INSTALL_CMD = `bash <(curl -fsSL ${window.location.origin}/install-local.sh)`;

const PREREQS = [
  { label: 'Rust + Cargo', note: 'via rustup.rs — the script will install it if missing' },
  { label: 'Node.js 20+', note: 'download from nodejs.org — required, not auto-installed' },
  { label: 'PostgreSQL 14+', note: 'must be running locally with a database created' },
  { label: 'git', note: 'to clone the source repository' },
];

const STEPS = [
  { n: '1', label: 'Clone the repo', cmd: 'git clone <your-repo-url> && cd yoda' },
  { n: '2', label: 'Set env vars', cmd: 'cp .env.example .env  # then edit DATABASE_URL' },
  { n: '3', label: 'Run the script', cmd: 'bash install-local.sh' },
  { n: '4', label: 'Start server', cmd: 'BIND_PORT=3000 ./target/debug/yoda-api' },
];

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1800); })}
      title="Copy"
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        padding: '2px 6px', color: ok ? '#8BA633' : '#6B655E',
        display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0,
      }}
    >
      {ok ? <Check style={{ width: 13, height: 13 }} /> : <Copy style={{ width: 13, height: 13 }} />}
    </button>
  );
}

function CodeLine({ cmd }: { cmd: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      background: '#0F0C0A', borderRadius: 6, padding: '9px 12px',
      border: '1px solid #272220',
    }}>
      <code style={{ flex: 1, fontSize: 12, color: '#E4DFD5', fontFamily: "'JetBrains Mono', monospace", wordBreak: 'break-all', lineHeight: 1.5 }}>
        {cmd}
      </code>
      <CopyBtn text={cmd} />
    </div>
  );
}

export function InstallPage() {
  usePageHeader({
    icon: SettingsIcon,
    title: 'Settings',
    subtitle: 'Platform configuration',
  });

  return (
    <div style={{ padding: '32px 28px', maxWidth: 720, margin: '0 auto', fontFamily: 'inherit' }}>

      {/* ── Page title ── */}
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#E4DFD5', margin: 0, letterSpacing: '0.02em' }}>
          Local Installation
        </h2>
        <p style={{ marginTop: 6, fontSize: 13, color: '#6B655E', lineHeight: 1.6 }}>
          Run YODA on your own machine. This is a developer setup — not a one-click install.
          You will need a terminal and the prerequisites below.
        </p>
      </div>

      {/* ── Honest disclaimer ── */}
      <div style={{
        display: 'flex', gap: 12, alignItems: 'flex-start',
        background: 'rgba(255,180,0,0.06)', border: '1px solid rgba(255,180,0,0.2)',
        borderRadius: 8, padding: '14px 16px', marginBottom: 28,
      }}>
        <AlertTriangle style={{ width: 16, height: 16, color: '#C9910A', flexShrink: 0, marginTop: 1 }} />
        <div>
          <p style={{ margin: 0, fontSize: 12, color: '#C9C1B4', lineHeight: 1.6 }}>
            The script below will <strong style={{ color: '#E4DFD5' }}>build and configure</strong> the server,
            but it does <strong style={{ color: '#E4DFD5' }}>not</strong> start it, set up your database, or handle environment variables for you.
            Follow all four steps below for a complete setup.
          </p>
        </div>
      </div>

      {/* ── Prerequisites ── */}
      <section style={{ marginBottom: 28 }}>
        <p style={{ fontSize: 10, color: '#6B655E', fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.22em', textTransform: 'uppercase', marginBottom: 12 }}>
          Prerequisites
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {PREREQS.map(({ label, note }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{
                marginTop: 2, width: 6, height: 6, borderRadius: '50%',
                background: '#4A9EF5', flexShrink: 0,
              }} />
              <div>
                <span style={{ fontSize: 13, color: '#C9C1B4', fontWeight: 600 }}>{label}</span>
                <span style={{ fontSize: 12, color: '#524A42', marginLeft: 8 }}>{note}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Install script download ── */}
      <section style={{ marginBottom: 28 }}>
        <p style={{ fontSize: 10, color: '#6B655E', fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.22em', textTransform: 'uppercase', marginBottom: 12 }}>
          Install Script
        </p>
        <div style={{
          background: '#181411', border: '1px solid #2E2A26',
          borderRadius: 8, overflow: 'hidden',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #272220' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Terminal style={{ width: 14, height: 14, color: '#6B655E' }} />
              <span style={{ fontSize: 11, color: '#6B655E', fontFamily: "'JetBrains Mono', monospace" }}>
                install-local.sh
              </span>
            </div>
            <a
              href="/install-local.sh"
              download="install-local.sh"
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                color: '#4A9EF5', textDecoration: 'none',
                padding: '4px 10px', borderRadius: 5,
                background: 'rgba(74,158,245,0.08)',
                border: '1px solid rgba(74,158,245,0.2)',
              }}
            >
              <Download style={{ width: 11, height: 11 }} />
              Download .sh
            </a>
          </div>
          <div style={{ padding: '12px 14px' }}>
            <p style={{ fontSize: 11, color: '#6B655E', fontFamily: "'JetBrains Mono', monospace", marginBottom: 10, lineHeight: 1.5 }}>
              Or run directly from terminal (checks Rust, builds frontend + backend):
            </p>
            <CodeLine cmd={INSTALL_CMD} />
          </div>
        </div>
      </section>

      {/* ── Manual steps ── */}
      <section style={{ marginBottom: 28 }}>
        <p style={{ fontSize: 10, color: '#6B655E', fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.22em', textTransform: 'uppercase', marginBottom: 12 }}>
          Step-by-Step
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {STEPS.map(({ n, label, cmd }) => (
            <div key={n} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <span style={{
                width: 22, height: 22, borderRadius: '50%',
                background: 'rgba(74,158,245,0.1)',
                border: '1px solid rgba(74,158,245,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, color: '#4A9EF5',
                fontFamily: "'JetBrains Mono', monospace", flexShrink: 0, marginTop: 7,
              }}>{n}</span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: '0 0 5px', fontSize: 12, color: '#998F82', fontWeight: 600 }}>{label}</p>
                <CodeLine cmd={cmd} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Footer note ── */}
      <p style={{ fontSize: 11, color: '#3D3730', fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.7 }}>
        Requires: Rust · Node 20+ · PostgreSQL 14+ · git ·{' '}
        <span style={{ color: '#4A9EF5' }}>localhost:3000</span> after startup
      </p>

    </div>
  );
}
