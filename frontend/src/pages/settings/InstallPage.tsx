import { useState } from 'react';
import { Download, Terminal, Copy, Check, HardDrive } from 'lucide-react';
import { usePageHeader } from '../../context/PageHeader';
import { BevelBox } from '../../components/ui/BevelBox';

const INSTALL_ROOT = 'C:\\Capomastro\\Yoda';
const ONE_LINER = 'irm {ORIGIN}/api/install/install.ps1 | iex';

export function InstallPage() {
  usePageHeader({
    icon: HardDrive,
    title: 'Local Install',
    subtitle: `Install YODA to ${INSTALL_ROOT} on Windows.`,
  });

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const oneLiner = ONE_LINER.replace('{ORIGIN}', origin);
  const sourceUrl = `${origin}/api/install/source.tar.gz`;
  const psUrl = `${origin}/api/install/install.ps1`;

  const [copied, setCopied] = useState(false);
  function copyOneLiner() {
    navigator.clipboard.writeText(oneLiner);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto animate-fade-in space-y-6">
      {/* One-liner — primary path */}
      <BevelBox className="bg-[var(--color-surface-secondary)]">
        <div className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <Terminal className="w-5 h-5 text-[var(--color-gold-400)]" />
            <h2 className="text-sm font-bold text-white tracking-wide">
              One-liner install (Windows PowerShell)
            </h2>
          </div>
          <p className="text-sm text-[var(--color-text-secondary)] mb-3">
            Open PowerShell on the target machine and paste this. It downloads
            the source, extracts to <code className="text-[var(--color-gold-400)]">{INSTALL_ROOT}</code>,
            and prints the build steps.
          </p>
          <div className="flex items-stretch gap-2">
            <pre className="flex-1 bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 text-xs text-white font-mono overflow-x-auto">
              {oneLiner}
            </pre>
            <button
              onClick={copyOneLiner}
              className="px-3 py-2 bg-[var(--color-gold-600)] hover:bg-[var(--color-gold-500)] text-black rounded text-xs font-bold flex items-center gap-1"
              title="Copy"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      </BevelBox>

      {/* Manual downloads */}
      <BevelBox className="bg-[var(--color-surface-secondary)]">
        <div className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <Download className="w-5 h-5 text-[var(--color-gold-400)]" />
            <h2 className="text-sm font-bold text-white tracking-wide">Manual downloads</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <a
              href={psUrl}
              className="block p-4 border border-[var(--color-border)] rounded hover:border-[var(--color-gold-400)] transition-colors"
            >
              <div className="text-sm font-bold text-white mb-1">install-yoda.ps1</div>
              <div className="text-xs text-[var(--color-text-secondary)]">
                Windows PowerShell installer script.
              </div>
            </a>
            <a
              href={sourceUrl}
              className="block p-4 border border-[var(--color-border)] rounded hover:border-[var(--color-gold-400)] transition-colors"
            >
              <div className="text-sm font-bold text-white mb-1">
                yoda-workspace-snapshot.tar.gz
              </div>
              <div className="text-xs text-[var(--color-text-secondary)]">
                Full source tarball (~41 MB).
              </div>
            </a>
          </div>
        </div>
      </BevelBox>

      {/* What the installer does */}
      <BevelBox className="bg-[var(--color-surface-secondary)]">
        <div className="p-5">
          <h2 className="text-sm font-bold text-white tracking-wide mb-3">
            What the installer does
          </h2>
          <ol className="text-sm text-[var(--color-text-secondary)] space-y-2 list-decimal list-inside">
            <li>Creates <code className="text-[var(--color-gold-400)]">{INSTALL_ROOT}</code> (prompts if it already exists).</li>
            <li>Downloads <code>source.tar.gz</code> from this server and extracts it.</li>
            <li>Copies <code>.env.example</code> → <code>.env</code>.</li>
            <li>Checks for prerequisites: <code>cargo</code>, <code>rustc</code>, <code>node</code>, <code>npm</code>, <code>psql</code>.</li>
            <li>Prints the manual build commands (cargo build, npm install, migrations).</li>
          </ol>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-4">
            The build (cargo + npm) and Postgres setup are not run automatically — the script prints
            the exact commands so you can run them on your own schedule.
          </p>
        </div>
      </BevelBox>
    </div>
  );
}
