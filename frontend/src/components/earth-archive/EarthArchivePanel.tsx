import { useState } from 'react';
import { Download, ExternalLink, HardDrive, RefreshCw } from 'lucide-react';
import { BevelBox } from '../ui/BevelBox';
import { useArchiveInstaller, useEarthArchiveStatus } from './use-earth-archive';

const TARGET = 'C:\\downloads\\isopsephy_engine_globe_package_v0_0_21';

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
  const status = useEarthArchiveStatus();
  const installer = useArchiveInstaller();
  const [confirmReissue, setConfirmReissue] = useState(false);
  const installation = status.data?.installation;
  const report = installation?.report;
  const lastReport = installation?.last_report_at;
  const stale = Boolean(lastReport && Number.isFinite(Date.parse(lastReport)) &&
    Date.now() - Date.parse(lastReport) > 15 * 60_000);
  const expired = Boolean(installation?.expires_at &&
    Date.parse(installation.expires_at) <= Date.now());
  const state = !installation ? 'Not installed' : expired ? 'Reporting credential expired' :
    !lastReport ? 'Awaiting Windows report' : stale ? 'Stale Windows report' : 'Client report received';

  function downloadInstaller() {
    if (installation && !confirmReissue) {
      setConfirmReissue(true);
      return;
    }
    setConfirmReissue(false);
    installer.mutate();
  }

  return <BevelBox className="bg-[var(--color-surface-primary)] p-4 sm:p-6">
    <section aria-labelledby="earth-archive-title" className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[var(--color-gold-400)] mb-2">Windows archive / operator setup</div>
          <h2 id="earth-archive-title" className="text-base sm:text-lg font-bold flex items-center gap-2"><HardDrive size={18} aria-hidden="true" />GLOBAL native-resolution archive</h2>
          <p className="mt-2 text-xs text-[var(--color-text-muted)] leading-relaxed">Acquisition runs on your Windows machine, not on this server. The installer has not been executed or independently inspected on Windows from Replit.</p>
        </div>
        <button type="button" className="earth-instrument-action disabled:opacity-50" disabled={status.isFetching}
          onClick={() => void status.refetch()}><RefreshCw size={14} aria-hidden="true" />{status.isFetching ? 'Refreshing…' : 'Refresh status'}</button>
      </div>

      <div className="border border-[var(--color-gold-400)]/40 bg-[var(--color-gold-400)]/5 p-4 text-xs leading-relaxed">
        <p className="font-semibold text-[var(--color-gold-400)]">Scope boundary · renderer remains Tier 1 (T1)</p>
        <p className="mt-2">Downloading the archive does not automatically upgrade the globe above. T5 / global-native end-to-end remains incomplete until verified source data are wired into rendering and distribution. No independent server inspection, certification, or closed-recursion claim is made here.</p>
      </div>

      {status.isLoading && <div role="status" aria-label="Loading Windows archive status" className="space-y-3">
        <div className="h-5 w-48 bg-[var(--color-surface-secondary)]" />
        <div className="h-20 bg-[var(--color-surface-secondary)]" />
      </div>}
      {status.isError && <div role="alert" className="border border-[var(--color-border-subtle)] p-4 text-xs leading-relaxed">
        Archive status could not be loaded. Installation state is unknown; no success or counters can be inferred. Use Refresh status to retry.
      </div>}
      {status.data && <div className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-border-subtle)] pb-3">
          <h3 className="text-sm font-semibold">{state}</h3>
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-gold-400)]">Client-reported · not server-verified</span>
        </div>
        {!installation ? <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">No installation is registered. Download the installer, then run it once on Windows. Issuing an installer alone is not evidence of a running archive.</p> : <>
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
          {(stale || expired) && <p role="status" className="text-xs text-[var(--color-gold-400)]">{expired ? 'The reporting credential has expired. Reissue and run the installer to restore reporting.' : 'The last report is over 15 minutes old. Do not infer that acquisition is still running.'}</p>}
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
        </>}
      </div>}

      <div className="border-t border-[var(--color-border-subtle)] pt-5">
        <h3 className="text-sm font-semibold">Install once on Windows</h3>
        <ol className="list-decimal pl-5 mt-3 space-y-3 text-xs leading-relaxed">
          <li>Use your Windows account with <strong>Python 3.11+</strong> installed. No administrator privileges are assumed. Plan for a <strong>multi-terabyte archive</strong>; the runner checks free disk space before acquisition.</li>
          <li>Download the PowerShell installer below. It contains a narrow, write-only reporting credential: keep it private. <strong>Reissuing an installer revokes the earlier reporter.</strong></li>
          <li>Open PowerShell in the folder where you saved the installer and run it once:
            <code className="block mt-2 p-3 bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] font-mono break-all select-all">powershell -NoProfile -File .\install-yoda-earth.ps1</code>
            <p className="mt-2 text-[var(--color-text-muted)]">If Windows policy blocks the script, review it and follow your organization’s approved process. No execution-policy bypass is required by this guide.</p>
          </li>
        </ol>
        <div className="mt-4 text-xs leading-relaxed">
          <p className="text-[var(--color-text-muted)]">Default Windows target</p>
          <code className="block font-mono break-all mt-1 text-[var(--color-gold-400)]">{TARGET}</code>
          <p className="mt-3">Downloads resume from <code>.part</code> files. To pause, stop the managed acquisition task in Windows Task Scheduler; keep partial files for resume. The daily updater and logon viewer run only while that Windows user is signed in.</p>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          <button type="button" className="earth-instrument-action disabled:opacity-50"
            disabled={installer.isPending || status.isLoading || status.isError} onClick={downloadInstaller}>
            <Download size={14} aria-hidden="true" />{installer.isPending ? 'Preparing private installer…' : installation ? 'Reissue installer · revokes earlier reporter' : 'Download Windows installer'}
          </button>
          <a className="earth-instrument-action" href="/api/earth-archive/guide" target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true" />Detailed plaintext guide</a>
        </div>
        {confirmReissue && <div role="alert" className="mt-3 border border-[var(--color-gold-400)]/40 p-3 text-xs leading-relaxed">
          <p>Reissuing immediately revokes the earlier reporter. Run the new installer once on Windows to replace it. Existing reports do not prove installation or acquisition is complete.</p>
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" className="earth-instrument-action" onClick={downloadInstaller}>Revoke earlier reporter & download</button>
            <button type="button" className="earth-instrument-action" onClick={() => setConfirmReissue(false)}>Cancel</button>
          </div>
        </div>}
        {installer.isError && <p role="alert" className="mt-3 text-xs">Installer download failed. No credential contents are displayed. Refresh status before retrying; a new request may have revoked the earlier reporter.</p>}
        {installer.isSuccess && <p role="status" className="mt-3 text-xs text-[var(--color-gold-400)]">Installer download requested. Save it privately and run it once on Windows; this does not mean installation or acquisition succeeded.</p>}
      </div>

      <div className="border-t border-[var(--color-border-subtle)] pt-4 text-xs leading-relaxed">
        <a href="http://127.0.0.1:18482" target="_blank" rel="noreferrer" className="earth-instrument-action"><ExternalLink size={14} aria-hidden="true" />Open local Windows archive / viewer</a>
        <p className="mt-2 text-[var(--color-text-muted)]">Same Windows machine only · http://127.0.0.1:18482. Open this link on the Windows machine running the archive service. It is not a hosted viewer; this page neither embeds nor fetches the local service.</p>
      </div>
    </section>
  </BevelBox>;
}
