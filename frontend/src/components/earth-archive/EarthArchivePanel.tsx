import { useState } from 'react';
import { Download, ExternalLink, HardDrive, RefreshCw } from 'lucide-react';
import { BevelBox } from '../ui/BevelBox';
import { useArchiveInstaller, useEarthArchiveStatus } from './use-earth-archive';

function count(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value.toLocaleString() : 'Not reported';
}

function bytes(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 'Not reported';
  if (value === 0) return '0 bytes';
  const units = ['bytes', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** exponent).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${units[exponent]}`;
}

function date(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not reported';
  return new Date(value).toLocaleString();
}

export function EarthArchivePanel() {
  const installer = useArchiveInstaller();
  const status = useEarthArchiveStatus(installer.hasIssued);
  const [downloadedForId, setDownloadedForId] = useState<string | undefined>();
  const installation = status.data?.installation;
  const report = installation?.report;
  const lastReport = installation?.last_report_at;
  const stale = Boolean(lastReport && Number.isFinite(Date.parse(lastReport)) &&
    Date.now() - Date.parse(lastReport) > 15 * 60_000);
  const expired = Boolean(installation?.expires_at &&
    Date.parse(installation.expires_at) <= Date.now());
  const awaitingSetup = installer.hasIssued && (!report || installation?.id === downloadedForId);
  const state = awaitingSetup ? 'Download requested · open setup on Windows' :
    !report ? 'Not connected · waiting for Windows setup' : expired ? 'Reporting credential expired' :
    stale ? 'Connected previously · report is stale' :
    report.archive_complete ? 'Archive ready · client-reported' : 'Connected · archive in progress';
  const actionLabel = awaitingSetup ? 'Download setup again' : report ? 'Update Windows installation' :
    installation ? 'Download setup again' : 'Install on Windows';

  function downloadInstaller() {
    setDownloadedForId(installation?.id);
    installer.mutate();
  }

  return <BevelBox className="bg-[var(--color-surface-primary)] p-4 sm:p-6">
    <section aria-labelledby="earth-archive-title" className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[var(--color-gold-400)] mb-2">Earth & Isopsephy / Windows setup</div>
          <h2 id="earth-archive-title" className="text-xl sm:text-2xl font-bold flex items-center gap-2"><HardDrive size={22} aria-hidden="true" />Your Earth archive, on your Windows PC.</h2>
          <p className="mt-2 text-sm text-[var(--color-text-muted)] leading-relaxed">Choose a folder. Setup handles the runtime and daily updates. No command line or manual Python installation.</p>
        </div>
        <button type="button" className="earth-instrument-action disabled:opacity-50" disabled={status.isFetching}
          onClick={() => void status.refetch()}><RefreshCw size={14} aria-hidden="true" />{status.isFetching ? 'Refreshing…' : 'Refresh status'}</button>
      </div>

      <div className="border border-[var(--color-gold-400)]/40 bg-[var(--color-gold-400)]/5 p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="earth-instrument-action !bg-[var(--color-gold-400)] !text-[var(--color-surface-primary)] !border-[var(--color-gold-400)] !px-5 !py-3 !font-bold disabled:opacity-50"
            disabled={installer.isPending} onClick={downloadInstaller}>
            <Download size={18} aria-hidden="true" />{installer.isPending ? 'Preparing setup download…' : actionLabel}
          </button>
          <span className="text-xs text-[var(--color-text-muted)]">Windows · setup downloads a private Python runtime if needed</span>
        </div>
        <p className="text-xs leading-relaxed">One click downloads setup; your browser cannot install it for you. Open the file on Windows and accept the setup confirmation, then choose your folder.</p>
        <ol aria-label="Windows setup steps" className="list-decimal pl-5 space-y-2 text-sm">
          <li>Open your browser’s <strong>Downloads</strong>.</li>
          <li>Open <strong className="font-mono break-all">Yoda-Earth-Setup.cmd</strong>.</li>
          <li>Confirm setup, choose your archive folder, and select <strong>OK</strong>.</li>
        </ol>
        <p className="text-xs text-[var(--color-text-muted)]">Existing data resumes when you choose its folder. Daily updates run automatically while you’re logged in. Plan for a multi-terabyte archive; setup checks free disk space.</p>
        {installer.isSuccess && <p role="status" className="text-sm text-[var(--color-gold-400)]">Download requested — not yet installed. {awaitingSetup ? 'Follow the steps above; this page waits for the new Windows connection.' : 'A new Windows report has arrived.'}</p>}
        {installer.isError && <div role="alert" className="text-sm space-y-2">
          <p>Setup could not be downloaded. Check your connection and use the setup button to retry. Your current installation has not been revoked.</p>
        </div>}
        <details className="text-xs leading-relaxed">
          <summary className="cursor-pointer font-semibold">Download didn’t appear?</summary>
          <p className="mt-2">Check your browser’s Downloads for Yoda-Earth-Setup.cmd, then use the setup button to retry if it is missing. If your browser or company policy blocks the download, contact IT. Do not bypass security warnings.</p>
        </details>
      </div>
      <p className="text-[11px] text-[var(--color-text-muted)]">Renderer remains Tier 1 (T1). T5 / global-native rendering is not complete; archive downloads do not upgrade the globe.</p>

      {status.isLoading && <div role="status" aria-label="Loading Windows archive status" className="space-y-3">
        <div className="h-5 w-48 bg-[var(--color-surface-secondary)]" />
        <div className="h-20 bg-[var(--color-surface-secondary)]" />
      </div>}
      {status.isError && <div role="alert" className="border border-[var(--color-border-subtle)] p-4 text-xs leading-relaxed">
        Archive status could not be loaded. Installation state is unknown; no success or counters can be inferred. Use Refresh status to retry.
      </div>}
      {(status.data || installer.hasIssued) && <div className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-border-subtle)] pb-3">
          <h3 className="text-sm font-semibold">{state}</h3>
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-gold-400)]">Client-reported · not server-verified</span>
        </div>
        <ol aria-label="Archive connection progress" className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
          <li>1 · {installer.hasIssued || installation ? 'Setup issued' : 'Download setup'}</li>
          <li>2 · {report ? 'Connected (client report)' : 'Waiting for connection'}</li>
          <li>3 · {report?.archive_complete ? 'Archive ready (client report)' : 'Archive not yet ready'}</li>
        </ol>
        {awaitingSetup && report && <p className="text-xs text-[var(--color-text-muted)]">The previous installation’s report remains visible while the new setup connects.</p>}
        {!installation ? <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">No Windows report yet. Downloading setup alone does not mean it is installed.</p> : <details className="text-xs">
          <summary className="cursor-pointer font-semibold">Advanced archive diagnostics & reporting record</summary>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-xs">
            <div><dt className="text-[var(--color-text-muted)]">Reported phase</dt><dd className="mt-1 break-words">{report?.phase || 'Not reported'}</dd></div>
            <div><dt className="text-[var(--color-text-muted)]">Last report received</dt><dd className="mt-1">{date(lastReport)}</dd></div>
            <div><dt className="text-[var(--color-text-muted)]">Catalog objects / size</dt><dd className="mt-1 font-mono">{count(report?.catalog_objects)} / {bytes(report?.catalog_bytes)}</dd></div>
            <div><dt className="text-[var(--color-text-muted)]">Locally verified objects / size</dt><dd className="mt-1 font-mono">{count(report?.verified_objects)} / {bytes(report?.verified_bytes)}</dd></div>
            <div><dt className="text-[var(--color-text-muted)]">Reported failures</dt><dd className="mt-1 font-mono">{count(report?.failures)}</dd></div>
            <div><dt className="text-[var(--color-text-muted)]">Catalog enumeration</dt><dd className="mt-1">{report?.catalog_complete === true ? 'Client reports complete' : report?.catalog_complete === false ? 'Incomplete' : 'Not reported'}</dd></div>
            <div><dt className="text-[var(--color-text-muted)]">Archive completion</dt><dd className="mt-1">{report?.archive_complete === true ? 'Client reports all required sources verified; not independently confirmed' : report?.archive_complete === false ? 'Incomplete — all required sources must be verified' : 'Not reported'}</dd></div>
            <div><dt className="text-[var(--color-text-muted)]">Supplied engine download</dt><dd className="mt-1">{report?.engine_ready === true ? 'Client reports existing supplied engine downloaded; not T5 readiness' : report?.engine_ready === false ? 'Not ready' : 'Not reported'}</dd></div>
          </dl>
          {report?.sources && <div className="border-t border-[var(--color-border-subtle)] pt-4">
            <h4 className="text-xs font-semibold">Per-source catalogue · client-reported</h4>
            <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">Catalogue enumeration is not evidence of downloaded or verified source data.</p>
            <dl className="mt-3 space-y-3 text-xs">
              {([
                ['copernicus', 'Copernicus'],
                ['gebco', 'GEBCO'],
                ['egm2008', 'EGM2008 · NGA'],
              ] as const).map(([key, label]) => {
                const source = report.sources?.[key];
                return <div key={key} className="border-b border-[var(--color-border-subtle)] pb-3">
                  <dt className="font-semibold">{label}</dt>
                  <dd className="mt-1 leading-relaxed">
                    {source ? <>
                      <span className="font-mono">{count(source.objects)}</span> catalogued objects · {source.complete ? 'Catalogue complete' : 'Catalogue incomplete'}
                      <span className="block text-[var(--color-text-muted)]">Client timestamp: {date(source.at)}</span>
                      {source.error_type && <span className="block break-words text-[var(--color-gold-400)]">Reported error: {source.error_type}</span>}
                    </> : 'Not reported'}
                  </dd>
                </div>;
              })}
            </dl>
          </div>}
          {(stale || expired) && <p role="status" className="text-xs text-[var(--color-gold-400)]">{expired ? 'The reporting credential has expired. Download and open setup to restore reporting.' : 'The last report is over 15 minutes old. Do not infer that acquisition is still running.'}</p>}
          {report?.message && <p className="text-xs leading-relaxed whitespace-pre-wrap break-words border-l-2 border-[var(--color-gold-400)]/40 pl-3"><span className="text-[var(--color-text-muted)]">Windows message: </span>{report.message}</p>}
          <details className="text-xs">
            <summary className="cursor-pointer text-[var(--color-text-muted)]">Reporting record</summary>
            <dl className="mt-3 space-y-2 break-all">
              <div><dt>Installation ID</dt><dd className="font-mono">{installation.id}</dd></div>
              <div><dt>Installer issued</dt><dd>{date(installation.created_at)}</dd></div>
              <div><dt>Reporting credential expires</dt><dd>{date(installation.expires_at)}</dd></div>
              <div><dt>Client timestamp</dt><dd>{date(report?.reported_at)}</dd></div>
            </dl>
          </details>
          <p className="text-[11px] text-[var(--color-text-muted)]">Status polls every 15 seconds while an installation is registered. Local verification counts are Windows reports, not server inspection of your disk.</p>
        </details>}
      </div>}

      <details className="border-t border-[var(--color-border-subtle)] pt-4 text-xs leading-relaxed">
        <summary className="cursor-pointer font-semibold">Scope, privacy & data retention</summary>
        <p className="mt-3">Acquisition runs on your Windows machine. Keep the setup file private: it contains a write-only reporting credential. Downloading an update does not revoke the current reporter; it is retired when the new installation connects.</p>
        <p className="mt-2">Downloads resume from partial files. To pause, stop the managed acquisition task in Windows Task Scheduler and retain the archive folder for resume. Daily updates and the logon viewer run only while your Windows account is signed in.</p>
        <p className="mt-2">Status is client-reported, not independent inspection of your disk or Windows installation. Archive completion is not survey certification or T5 rendering readiness.</p>
      </details>

      <div className="border-t border-[var(--color-border-subtle)] pt-4 text-xs leading-relaxed">
        <a className="earth-instrument-action mr-2 mb-2" href="/api/earth-archive/guide" target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true" />Setup & retention guide</a>
        <a className="earth-instrument-action mr-2 mb-2" href="/capomastro/engines/arc182/engine/isopsephy_engine_v0_0_20.py" target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true" />Open engine source</a>
        <a href="http://127.0.0.1:18482" target="_blank" rel="noreferrer" className="earth-instrument-action"><ExternalLink size={14} aria-hidden="true" />Open local Windows archive / viewer</a>
        <p className="mt-2 text-[var(--color-text-muted)]">Same Windows machine only · http://127.0.0.1:18482. Open this link on the Windows machine running the archive service. It is not a hosted viewer; this page neither embeds nor fetches the local service.</p>
      </div>
    </section>
  </BevelBox>;
}
