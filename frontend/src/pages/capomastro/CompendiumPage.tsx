import { ExternalLink, ScrollText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePageHeader } from '../../context/PageHeader';
import { Panel } from './ui';
import { correctionPath } from './use-conservation';

/** A navigation wrapper only. The original compendium bytes stay untouched. */
export function CompendiumPage() {
  usePageHeader({ icon: ScrollText, title: 'Sovereign Compendium', subtitle: 'Original document with supplemental live gate navigation' });
  return <div className="conservation p-4 lg:p-8 max-w-7xl mx-auto space-y-5">
    <Panel title="Original compendium">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4 text-xs">
        <p className="text-[var(--color-text-muted)] max-w-xl">The original document is reproduced in an isolated frame, unchanged. Supplemental checks and corrections belong to the surrounding application, not the sealed text.</p>
        <Link to={correctionPath} className="gate-button">Read the mathematical correction</Link>
        <a href="/capomastro/assayer.html" target="_blank" rel="noreferrer" className="gate-button"><ExternalLink size={13} />Open original file</a>
      </div>
      <iframe src="/capomastro/assayer.html" title="Original Sovereign Compendium" sandbox="allow-scripts" className="w-full h-[75vh] border border-[var(--color-border-subtle)] bg-[var(--color-surface-primary)]" />
    </Panel>
  </div>;
}
