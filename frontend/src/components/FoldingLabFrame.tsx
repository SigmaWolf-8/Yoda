import { useEffect, useRef } from 'react';
import { createFoldingLabBridge } from './folding-lab-bridge';

export function FoldingLabFrame({ title }: { title: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<ReturnType<typeof createFoldingLabBridge> | null>(null);
  useEffect(() => {
    const frame = iframeRef.current?.contentWindow;
    if (!frame) return;
    const bridge = createFoldingLabBridge(frame);
    bridgeRef.current = bridge;
    const receive = (event: MessageEvent) => { void bridge.receive(event); };
    window.addEventListener('message', receive);
    return () => {
      window.removeEventListener('message', receive);
      bridge.dispose();
      bridgeRef.current = null;
    };
  }, []);
  return <div className="space-y-3">
    <div className="border-l-2 border-[var(--color-gold-400)] pl-3 text-xs leading-relaxed text-[var(--color-text-muted)]">
      <p className="font-semibold text-[var(--color-text-primary)]">Functional derivative · document and text inputs</p>
      <p>This selected frame is an adapted instrument, not the verbatim sealed source. Open, download and copy actions above still use the unchanged original.</p>
      <p>Uploaded documents are processed transiently on the server, not saved and not sent to AI. Maximum document size: 10 MiB. Extraction limitations are reported by the instrument; computed examples are not proof.</p>
    </div>
    <iframe ref={iframeRef} src="/capomastro/adapters/salvi-isopsephy-functional.html"
      title={`${title} — functional derivative`}
      className="w-full h-[75vh] bg-white border border-[var(--color-border-subtle)]"
      sandbox="allow-scripts" onLoad={() => bridgeRef.current?.reset()} />
  </div>;
}
