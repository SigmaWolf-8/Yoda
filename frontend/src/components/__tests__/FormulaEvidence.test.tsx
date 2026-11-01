import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { FormulaEvidence } from '../FormulaEvidence';

describe('shared formula evidence view', () => {
  it('runs actual checks, shares their state across mounts and exports evidence', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    let exported: Blob | undefined;
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL(blob: Blob) { exported = blob; return 'blob:evidence'; }
      static revokeObjectURL() { /* no external resource in this test */ }
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      await act(async () => root.render(<FormulaEvidence />));
      expect(host.textContent).toContain('0 of 7 registered checks matched');
      expect(host.textContent).toContain('Compendium XOR: exhaustive Boolean-domain check');
      expect(host.textContent).toContain('All other document claims remain unverified');
      expect(host.textContent).toContain('Not established');
      const runAll = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Run all checks'))!;
      await act(async () => runAll.click());
      expect(host.textContent).toContain('6 of 7 registered checks matched');
      expect(host.textContent).toContain('Disproved');
      expect(host.textContent).toContain('Unavailable · no executor');
      expect(host.textContent).toContain('Browser / JavaScript (this tab); no daemon');

      await act(async () => root.render(<FormulaEvidence key="other-page" />));
      expect(host.textContent).toContain('6 of 7 registered checks matched');
      const exportButton = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Export current evidence'))!;
      await act(async () => exportButton.click());
      expect(click).toHaveBeenCalledOnce();
      const text = await new Promise<string>(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(exported!);
      });
      const payload = JSON.parse(text);
      expect(payload.records).toHaveLength(7);
      expect(payload.records.filter((r: { status: string }) => r.status === 'passed')).toHaveLength(6);
      expect(payload.scope).toContain('Boolean XOR');
      for (const id of ['xor-polynomial', 'xor-parity']) {
        expect(payload.records.find((r: { id: string }) => r.id === id)).toMatchObject({
          status: 'passed', observed: { evaluatedPairs: 4, outputs: [0, 1, 1, 0] },
          executionLocation: 'Browser / JavaScript (this tab); no daemon',
        });
      }
      expect(payload.records[0].traceId).toBeTruthy();
      expect(payload.localVanishingConclusion).toContain('Disproved');
      expect(payload.execution).toContain('daemon adapter absent');
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });
});
