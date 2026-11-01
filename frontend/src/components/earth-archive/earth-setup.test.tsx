import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../api/client';
import { EarthArchivePanel } from './EarthArchivePanel';
import { EarthEnginePage } from '../../pages/capomastro/EarthEnginePage';
import type { ArchiveStatus } from './use-earth-archive';

vi.mock('../../context/PageHeader', () => ({ usePageHeader: vi.fn() }));
vi.mock('../formula-evidence/FormulaEvidencePanel', () => ({ FormulaEvidencePanel: () => null }));

const emptyStatus: ArchiveStatus = {
  installation: null, coverage: 'GLOBAL', renderer_tier: 'T1', server_verified: false,
};
const registered: ArchiveStatus = {
  ...emptyStatus,
  installation: {
    id: 'windows-previous', created_at: '2026-04-01T08:11:00Z',
    last_report_at: null, expires_at: '2030-04-01T08:11:00Z', report: null,
  },
};
let host: HTMLDivElement;
let root: Root;
let client: QueryClient;
let filename: string | undefined;

async function mount(page = false, archive = false) {
  await act(async () => {
    root.render(<QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[archive ? '/capomastro/earth-engine?view=archive' : '/capomastro/earth-engine']}>
        {page ? <EarthEnginePage /> : <EarthArchivePanel />}
      </MemoryRouter>
    </QueryClientProvider>);
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
}

function button(label: string) {
  const found = Array.from(host.querySelectorAll('button')).find(node => node.textContent?.includes(label));
  expect(found, `Expected button: ${label}`).toBeTruthy();
  return found!;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  filename = undefined;
  vi.spyOn(apiClient, 'get').mockResolvedValue({ data: emptyStatus });
  vi.spyOn(apiClient, 'post').mockResolvedValue({ data: new Blob(['private setup fixture']) });
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL() { return 'blob:setup-fixture'; }
    static revokeObjectURL() {}
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    filename = this.download;
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Windows Earth setup', () => {
  it.each([false, true])('puts setup first on the Earth page (archive=%s), without auto-loading a globe', async archive => {
    await mount(true, archive);
    expect(button('Install on Windows').disabled).toBe(false);
    expect(host.querySelector('iframe')).toBeNull();
    expect(host.textContent?.indexOf('Install on Windows')).toBeLessThan(host.textContent!.indexOf('Tier 1'));
    if (!archive) {
      await act(async () => button('Open globe').click());
      expect(host.querySelector('iframe')?.getAttribute('src')).toContain('#cv_globe');
    }
  });

  it('uses a report, not registration alone, to offer an update', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: registered });
    await mount();
    expect(button('Download setup again').disabled).toBe(false);
    expect(host.textContent).not.toContain('Update Windows installation');
  });

  it('updates in one click, downloads the CMD file and retains next steps over the previous report', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { ...registered, installation: { ...registered.installation!, report: { phase: 'acquiring' } } },
    });
    await mount();
    await act(async () => button('Update Windows installation').click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(apiClient.post).toHaveBeenCalledWith('/earth-archive/installer', undefined, {
      withCredentials: true, responseType: 'blob',
    });
    expect(filename).toBe('Yoda-Earth-Setup.cmd');
    expect(button('Download setup again')).toBeTruthy();
    expect(host.textContent).toContain('previous installation’s report remains visible');
    expect(host.textContent).toContain('Download requested — not yet installed');
    expect(host.querySelector('[aria-label="Windows setup steps"]')?.children).toHaveLength(3);
    expect(host.textContent).not.toContain('Revoke earlier reporter & download');
  });

  it('keeps setup enabled when status fails, with a separate status retry', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error('offline'));
    await mount();
    expect(host.textContent).toContain('Archive status could not be loaded');
    expect(button('Install on Windows').disabled).toBe(false);
    expect(button('Refresh status').disabled).toBe(false);
    await act(async () => button('Install on Windows').click());
    expect(filename).toBe('Yoda-Earth-Setup.cmd');
  });

  it('disables only pending downloads and blocks duplicate network clicks', async () => {
    let finish!: (value: { data: Blob }) => void;
    vi.mocked(apiClient.post).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await mount();
    const install = button('Install on Windows');
    await act(async () => { install.click(); install.click(); });
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(button('Preparing setup download').disabled).toBe(true);
    await act(async () => finish({ data: new Blob(['private setup fixture']) }));
    expect(button('Download setup again').disabled).toBe(false);
  });

  it('offers actionable download retry without disabling setup or exposing response contents', async () => {
    vi.mocked(apiClient.post).mockRejectedValue({ response: { data: new Blob(['secret fixture']) } });
    await mount();
    await act(async () => button('Install on Windows').click());
    expect(host.textContent).toContain('Setup could not be downloaded');
    expect(host.textContent).not.toContain('secret fixture');
    expect(button('Install on Windows').disabled).toBe(false);
    expect(host.textContent).toContain('contact IT');
  });
});
