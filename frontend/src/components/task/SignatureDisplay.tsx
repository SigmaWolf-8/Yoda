import { useState } from 'react';
import { Shield, CheckCircle2, Link as LinkIcon, Clock } from 'lucide-react';
import type { SignatureChainEntry } from '../../types';

interface Props {
  signature: string;
  chain: SignatureChainEntry[];
}

export function SignatureDisplay({ signature, chain }: Props) {
  const [showFull, setShowFull] = useState(false);

  return (
    <div>
      <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
        Cryptographic Signature
      </p>

      {/* Main signature badge */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-ok)]/5 border border-[var(--color-ok)]/20 mb-3">
        <Shield className="w-4 h-4 text-[var(--color-ok)] flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-[var(--color-ok)]">TL-DSA Signed</p>
          <p className="text-[11px] font-mono text-[var(--color-text-muted)] truncate">
            {showFull ? signature : `${signature.slice(0, 32)}…`}
          </p>
        </div>
        <button
          onClick={() => setShowFull(!showFull)}
          className="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] flex-shrink-0"
        >
          {showFull ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {/* Signature chain */}
      {chain.length > 0 && (
        <div className="space-y-0">
          <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase mb-1.5">
            Integrity Chain ({chain.length} entries)
          </p>
          <div className="relative pl-4">
            {/* Vertical line */}
            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[var(--color-border-subtle)]" />

            {chain.map((entry, i) => (
              <div key={i} className="relative flex items-start gap-2 pb-2.5 last:pb-0">
                {/* Dot on the line */}
                <div className="absolute left-[-9px] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--color-ok)]/40 bg-[var(--color-surface-secondary)]" />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-[var(--color-text-secondary)]">
                      Step {entry.step}
                    </span>
                    <CheckCircle2 className="w-3 h-3 text-[var(--color-ok)]" />
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
                    <LinkIcon className="w-2.5 h-2.5" />
                    <span className="font-mono truncate">{entry.hash}</span>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-[var(--color-text-muted)]">
                    <Clock className="w-2.5 h-2.5" />
                    {new Date(entry.timestamp).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
