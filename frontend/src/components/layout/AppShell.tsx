import { useState, useRef, useCallback } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderKanban,
  Settings,
  BarChart3,
  Menu,
  X,
  Zap,
  Users,
  Cpu,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { UserProfile } from '../auth/UserProfile';
import { usePageHeaderCtx } from '../../context/PageHeader';

/* ── Nav config ── */
const MAIN_NAV = [
  { to: '/',           icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/projects',   icon: FolderKanban,    label: 'Projects' },
  { to: '/agents',           icon: Users,           label: 'Agents'     },
  { to: '/settings/engines', icon: Cpu,             label: 'AI Engines' },
  { to: '/monitoring',       icon: BarChart3,       label: 'Monitoring' },
] as const;

/* Sidebar logo-area height in px — top bar must match this */
export const HEADER_H = 144;

const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 256;

function loadSidebarWidth(): number {
  try {
    const s = localStorage.getItem('yoda-sidebar-width');
    if (s) return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, parseInt(s, 10)));
  } catch { /* ignore */ }
  return SIDEBAR_DEFAULT;
}

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed]     = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const [isResizing, setIsResizing]   = useState(false);
  const { header }                    = usePageHeaderCtx();

  const startResizeX   = useRef(0);
  const startResizeW   = useRef(0);

  const startResize = useCallback((e: React.MouseEvent) => {
    if (collapsed) return;
    e.preventDefault();
    startResizeX.current = e.clientX;
    startResizeW.current = sidebarWidth;
    setIsResizing(true);
    document.body.style.cursor      = 'col-resize';
    document.body.style.userSelect  = 'none';

    const clamp = (w: number) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w));

    const onMove = (ev: MouseEvent) => {
      setSidebarWidth(clamp(startResizeW.current + ev.clientX - startResizeX.current));
    };

    const onUp = (ev: MouseEvent) => {
      const final = clamp(startResizeW.current + ev.clientX - startResizeX.current);
      setSidebarWidth(final);
      try { localStorage.setItem('yoda-sidebar-width', String(final)); } catch { /* ignore */ }
      setIsResizing(false);
      document.body.style.cursor     = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
  }, [collapsed, sidebarWidth]);

  const navCls = ({ isActive }: { isActive: boolean }) =>
    [
      'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150',
      collapsed && 'justify-center',
      isActive
        ? 'bg-[hsl(210,80%,55%)]/15 text-[hsl(210,80%,68%)] border border-[hsl(210,80%,55%)]/28'
        : 'text-[hsl(220,12%,42%)] hover:text-[hsl(220,15%,15%)] hover:bg-[hsl(220,15%,90%)]',
    ].filter(Boolean).join(' ');

  const asideWidth = collapsed ? '4rem' : `${sidebarWidth}px`;

  return (
    <div className="flex min-h-screen w-full bg-[var(--color-surface-primary)]">
      <a href="#main-content" className="skip-nav">Skip to main content</a>

      {/* ── Mobile backdrop ── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ── */}
      <aside
        style={{
          width: asideWidth,
          background: 'linear-gradient(160deg, hsl(220,20%,98%) 0%, hsl(220,15%,95%) 100%)',
          boxShadow: [
            'inset 0 60px 90px rgba(0,0,0,0.28)',
            'inset 0 -60px 90px rgba(0,0,0,0.28)',
            'inset -8px 0 32px rgba(0,0,0,0.14)',
            '4px 0 28px rgba(0,0,0,0.28)',
            '8px 0 56px rgba(0,0,0,0.16)',
          ].join(', '),
        }}
        className={[
          'fixed lg:sticky top-0 left-0 z-40 h-screen flex-shrink-0 relative',
          'border-r border-[hsl(220,15%,86%)]',
          'flex flex-col overflow-hidden',
          isResizing ? '' : 'transition-all duration-200',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        ].filter(Boolean).join(' ')}
      >
        {/* Logo — height must match top bar (HEADER_H) */}
        <div
          className={[
            'flex items-center gap-3 border-b flex-shrink-0',
            collapsed ? 'px-4 justify-center' : 'px-5',
          ].join(' ')}
          style={{
            height: HEADER_H,
            borderBottomColor: 'hsl(220,15%,86%)',
            boxShadow: [
              'inset 0 16px 40px rgba(0,0,0,0.22)',
              'inset 0 -8px 24px rgba(0,0,0,0.12)',
              'inset 8px 0 28px rgba(0,0,0,0.14)',
              'inset -8px 0 28px rgba(0,0,0,0.14)',
              '0 3px 12px rgba(0,0,0,0.18)',
            ].join(', '),
          }}
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              background: 'var(--color-gold-500)',
              boxShadow: [
                '0 3px 14px rgba(0,0,0,0.65)',
                '0 0 18px var(--color-gold-500)',
                'inset 0 1px 0 rgba(255,255,255,0.35)',
                'inset 0 -1px 0 rgba(0,0,0,0.25)',
              ].join(', '),
            }}
          >
            <Zap className="w-4 h-4 text-[var(--color-navy-950)]" />
          </div>
          {!collapsed && (
            <>
              <span className="text-lg font-bold tracking-wide text-[hsl(220,15%,12%)]">
                YODA
              </span>
              <button
                className="ml-auto lg:hidden text-[hsl(220,12%,50%)] hover:text-[hsl(220,15%,20%)]"
                onClick={() => setSidebarOpen(false)}
              >
                <X className="w-5 h-5" />
              </button>
            </>
          )}
        </div>

        {/* Main nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Main navigation">
          {MAIN_NAV.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setSidebarOpen(false)}
              className={navCls}
              title={collapsed ? label : undefined}
            >
              <Icon className="w-[18px] h-[18px] flex-shrink-0" />
              {!collapsed && label}
            </NavLink>
          ))}
        </nav>

        {/* ── Footer: Settings + Collapse ── */}
        <div
          className="border-t px-3 py-3 space-y-2"
          style={{
            borderTopColor: 'hsl(220,15%,86%)',
            boxShadow: '0 -2px 20px rgba(0,0,0,0.50)',
          }}
        >
          <div className="flex items-center gap-1">
            <NavLink
              to="/settings"
              onClick={() => setSidebarOpen(false)}
              className={navCls}
              title={collapsed ? 'Settings' : undefined}
              style={{ flex: 1 }}
            >
              <Settings className="w-[18px] h-[18px] flex-shrink-0" />
              {!collapsed && 'Settings'}
            </NavLink>

            <button
              onClick={() => setCollapsed(c => !c)}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="ml-auto p-2.5 rounded-lg text-[hsl(220,12%,50%)] hover:text-[hsl(220,15%,20%)] hover:bg-[hsl(220,15%,90%)] transition-colors flex-shrink-0"
            >
              {collapsed
                ? <ChevronRight className="w-4 h-4" />
                : <ChevronLeft  className="w-4 h-4" />}
            </button>
          </div>

          {!collapsed && (
            <p
              className="text-[hsl(220,12%,55%)] leading-tight px-3 pb-1 whitespace-nowrap overflow-hidden"
              style={{ fontSize: Math.max(9, Math.min(12, (sidebarWidth - 48) / 14)) }}
            >
              Capomastro Holdings Ltd.
            </p>
          )}
        </div>

        {/* ── Resize handle ── */}
        {!collapsed && (
          <div
            onMouseDown={startResize}
            className="absolute right-0 top-0 h-full z-50 group"
            style={{ width: 6, cursor: 'col-resize' }}
          >
            <div
              className={[
                'absolute right-0 top-0 h-full transition-opacity duration-150',
                isResizing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
              ].join(' ')}
              style={{ width: 2, background: 'rgba(0,0,0,0.14)' }}
            />
          </div>
        )}
      </aside>

      {/* ── Main column ── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Top bar — same height as sidebar logo area */}
        <header
          className="sticky top-0 z-20 flex items-center gap-4 px-5 border-b border-[var(--color-border-subtle)] flex-shrink-0 relative overflow-hidden"
          style={{
            height: HEADER_H,
            background: [
              'repeating-linear-gradient(45deg,  transparent, transparent 1px, rgba(255,255,255,0.022) 1px, rgba(255,255,255,0.022) 3px)',
              'repeating-linear-gradient(-45deg, transparent, transparent 1px, rgba(255,255,255,0.022) 1px, rgba(255,255,255,0.022) 3px)',
              'linear-gradient(180deg, hsl(20,14%,8%) 0%, hsl(20,12%,6%) 100%)',
            ].join(', '),
            boxShadow: [
              'inset 0 1px 0 rgba(255,255,255,0.07)',
              'inset 0 -1px 0 rgba(255,255,255,0.03)',
              'inset 0 14px 48px rgba(0,0,0,0.60)',
              'inset 0 -14px 48px rgba(0,0,0,0.45)',
              '0 4px 28px rgba(0,0,0,0.65)',
              '0 1px 0 rgba(255,255,255,0.04)',
            ].join(', '),
          }}
        >
          {/* Mobile hamburger */}
          <button
            className="lg:hidden text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] flex-shrink-0"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Page icon + title injected by the active page */}
          {header && (
            <div className="flex items-center gap-4 min-w-0 flex-1">
              {header.icon && (
                <header.icon className="w-9 h-9 text-[hsl(210,70%,65%)] flex-shrink-0" />
              )}
              <div className="min-w-0">
                <p
                  className="truncate"
                  style={{
                    fontFamily: "'Orbitron', sans-serif",
                    fontSize: '34px',
                    fontWeight: 800,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    lineHeight: 1.15,
                    color: 'var(--color-text-primary)',
                    margin: 0,
                    textShadow: [
                      '0 1px 0 rgba(0,0,0,0.4)',
                      '0 2px 0 rgba(0,0,0,0.3)',
                      '0 4px 16px rgba(0,0,0,0.5)',
                      '0 0 60px hsl(210,70%,65%,0.12)',
                    ].join(', '),
                  }}
                >
                  {header.title}
                </p>
                {header.subtitle && (
                  <p className="text-sm text-[var(--color-text-muted)] font-mono leading-tight truncate mt-1">
                    {header.subtitle}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Page action (e.g. "New Agent" button) */}
          {header?.action && (
            <div className="flex-shrink-0">
              {header.action}
            </div>
          )}

          <UserProfile />

          {/* ── Full-width geometric underline ── absolutely positioned so it
               spans the entire header width, anchored near the bottom */}
          {header && (
            <svg
              aria-hidden="true"
              viewBox="0 0 1000 16"
              preserveAspectRatio="none"
              fill="none"
              style={{
                position: 'absolute',
                bottom: 14,
                left: 0,
                right: 0,
                width: '100%',
                height: 16,
                pointerEvents: 'none',
                color: 'hsl(210,70%,65%)',
              }}
            >
              <line x1="0"    y1="8"  x2="1000" y2="8"  stroke="currentColor" strokeWidth="1"   opacity="0.25" />
              <line x1="0"    y1="1"  x2="0"    y2="15" stroke="currentColor" strokeWidth="2"   opacity="0.8"  />
              <line x1="60"   y1="2"  x2="60"   y2="14" stroke="currentColor" strokeWidth="1.5" opacity="0.55" />
              <line x1="72"   y1="2"  x2="72"   y2="14" stroke="currentColor" strokeWidth="1.5" opacity="0.55" />
              <polygon points="90,8 104,2 118,8 104,14" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.4" />
              <line x1="400"  y1="4"  x2="400"  y2="12" stroke="currentColor" strokeWidth="1"   opacity="0.3"  />
              <line x1="500"  y1="4"  x2="500"  y2="12" stroke="currentColor" strokeWidth="1"   opacity="0.3"  />
              <line x1="850"  y1="2"  x2="850"  y2="14" stroke="currentColor" strokeWidth="1.5" opacity="0.45" />
              <line x1="862"  y1="2"  x2="862"  y2="14" stroke="currentColor" strokeWidth="1.5" opacity="0.45" />
              <line x1="1000" y1="1"  x2="1000" y2="15" stroke="currentColor" strokeWidth="2"   opacity="0.8"  />
            </svg>
          )}
        </header>

        <main id="main-content" className="flex-1 overflow-y-auto" aria-label="Page content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
