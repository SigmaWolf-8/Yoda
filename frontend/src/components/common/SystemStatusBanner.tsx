import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, XCircle, ChevronDown, ChevronUp, RefreshCw, X } from 'lucide-react';

interface SystemIssue {
  id: string;
  severity: 'critical' | 'warning';
  title: string;
  detail: string;
  action: string;
}

interface SystemStatus {
  ok: boolean;
  llm_gateway: { enabled: boolean };
  relay: { armed: boolean; live_peer_count: number };
  agents: { loaded: number };
  issues: SystemIssue[];
}

const DISMISSED_KEY = 'yoda-dismissed-issues-v1';

function getDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

function saveDismissed(ids: Set<string>) {
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids])); } catch { /* quota */ }
}

export function SystemStatusBanner() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(getDismissed);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStatus = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await fetch('/api/system/status');
      if (!res.ok) return;
      const data: SystemStatus = await res.json();
      setStatus(data);
      setLastFetch(new Date());
    } catch {
      // silently fail — the banner itself shouldn't cause errors
    } finally {
      if (manual) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(() => fetchStatus(), 30_000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const dismiss = (id: string) => {
    const next = new Set(dismissed).add(id);
    setDismissed(next);
    saveDismissed(next);
  };

  if (!status) return null;

  const visibleIssues = status.issues.filter(i => !dismissed.has(i.id));
  if (visibleIssues.length === 0) return null;

  const hasCritical = visibleIssues.some(i => i.severity === 'critical');

  return (
    <div
      role="alert"
      style={{
        background: hasCritical
          ? 'linear-gradient(90deg, rgba(200,40,40,0.12) 0%, rgba(200,40,40,0.06) 100%)'
          : 'linear-gradient(90deg, rgba(200,140,0,0.10) 0%, rgba(200,140,0,0.04) 100%)',
        borderBottom: `1px solid ${hasCritical ? 'rgba(200,40,40,0.25)' : 'rgba(200,140,0,0.22)'}`,
        padding: '0',
      }}
    >
      {visibleIssues.map((issue) => {
        const isCrit = issue.severity === 'critical';
        const isOpen = expanded === issue.id;

        return (
          <div
            key={issue.id}
            style={{
              borderBottom: visibleIssues.indexOf(issue) < visibleIssues.length - 1
                ? `1px solid ${isCrit ? 'rgba(200,40,40,0.15)' : 'rgba(200,140,0,0.12)'}` : 'none',
            }}
          >
            {/* Summary row */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 16px',
                cursor: 'pointer',
              }}
              onClick={() => setExpanded(isOpen ? null : issue.id)}
            >
              {isCrit
                ? <XCircle style={{ width: 14, height: 14, color: '#E05050', flexShrink: 0 }} />
                : <AlertTriangle style={{ width: 14, height: 14, color: '#C9910A', flexShrink: 0 }} />
              }

              <span style={{
                fontSize: 12,
                fontWeight: 600,
                color: isCrit ? '#E4A0A0' : '#D4B060',
                flex: 1,
                lineHeight: 1.4,
              }}>
                {issue.title}
              </span>

              <span style={{
                fontSize: 10,
                color: isCrit ? '#A07070' : '#8B7040',
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                flexShrink: 0,
                marginRight: 4,
              }}>
                {isCrit ? 'CRITICAL' : 'WARNING'}
              </span>

              {isOpen
                ? <ChevronUp style={{ width: 12, height: 12, color: isCrit ? '#A07070' : '#8B7040', flexShrink: 0 }} />
                : <ChevronDown style={{ width: 12, height: 12, color: isCrit ? '#A07070' : '#8B7040', flexShrink: 0 }} />
              }

              <button
                onClick={(e) => { e.stopPropagation(); dismiss(issue.id); }}
                title="Dismiss"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '2px', display: 'flex', alignItems: 'center', flexShrink: 0,
                  color: isCrit ? '#7A5050' : '#6B5530',
                }}
              >
                <X style={{ width: 12, height: 12 }} />
              </button>
            </div>

            {/* Expanded detail */}
            {isOpen && (
              <div style={{
                padding: '0 16px 12px 40px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}>
                <p style={{ fontSize: 12, color: isCrit ? '#C09090' : '#B09060', lineHeight: 1.6, margin: 0 }}>
                  {issue.detail}
                </p>
                <p style={{
                  fontSize: 11,
                  color: isCrit ? '#A07070' : '#9A8050',
                  fontFamily: "'JetBrains Mono', monospace",
                  lineHeight: 1.5,
                  margin: 0,
                  paddingTop: 2,
                  borderTop: `1px solid ${isCrit ? 'rgba(200,40,40,0.12)' : 'rgba(200,140,0,0.10)'}`,
                }}>
                  Fix: {issue.action}
                </p>
              </div>
            )}
          </div>
        );
      })}

      {/* Footer: agent count + refresh */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '5px 16px 6px',
        borderTop: `1px solid ${hasCritical ? 'rgba(200,40,40,0.10)' : 'rgba(200,140,0,0.08)'}`,
      }}>
        <span style={{ fontSize: 10, color: '#4A4540', fontFamily: "'JetBrains Mono', monospace" }}>
          {status.agents.loaded} agents · {status.relay.live_peer_count} cube peers
          {lastFetch && ` · checked ${lastFetch.toLocaleTimeString()}`}
        </span>
        <button
          onClick={() => fetchStatus(true)}
          disabled={refreshing}
          style={{
            background: 'none', border: 'none', cursor: refreshing ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 10, color: '#4A4540', fontFamily: "'JetBrains Mono', monospace',",
            opacity: refreshing ? 0.5 : 1,
          }}
        >
          <RefreshCw style={{ width: 10, height: 10, animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
          refresh
        </button>
      </div>
    </div>
  );
}
