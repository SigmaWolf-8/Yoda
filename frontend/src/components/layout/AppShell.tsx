import { useState } from 'react';
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
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { UserProfile } from '../auth/UserProfile';

const MAIN_NAV = [
  { to: '/',           icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/projects',   icon: FolderKanban,    label: 'Projects' },
  { to: '/agents',     icon: Users,           label: 'Agents' },
  { to: '/monitoring', icon: BarChart3,        label: 'Monitoring' },
] as const;

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed]     = useState(false);

  const navCls = ({ isActive }: { isActive: boolean }) =>
    [
      'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150',
      collapsed && 'justify-center',
      isActive
        ? 'bg-[var(--color-gold-500)]/10 text-[var(--color-gold-400)] border border-[var(--color-gold-500)]/20'
        : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)]',
    ].filter(Boolean).join(' ');

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
          width: collapsed ? '4rem' : '16rem',
          boxShadow: [
            'inset 1px 0 0 rgba(255,255,255,0.045)',
            'inset 0 1px 0 rgba(255,255,255,0.03)',
            'inset -6px 0 28px rgba(0,0,0,0.55)',
            'inset 0 -12px 40px rgba(0,0,0,0.45)',
            'inset 0 12px 40px rgba(0,0,0,0.30)',
            '4px 0 24px rgba(0,0,0,0.40)',
          ].join(', '),
          background: 'linear-gradient(160deg, hsl(20,14%,9%) 0%, hsl(20,12%,7%) 100%)',
        }}
        className={[
          'fixed lg:sticky top-0 left-0 z-40 h-screen flex-shrink-0',
          'border-r border-white/[0.04]',
          'flex flex-col transition-all duration-200 overflow-hidden',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        ].join(' ')}
      >
        {/* Logo */}
        <div className={[
          'flex items-center gap-3 py-5 border-b border-white/[0.04]',
          collapsed ? 'px-4 justify-center' : 'px-5',
        ].join(' ')}>
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              background: 'var(--color-gold-500)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.2)',
            }}
          >
            <Zap className="w-4 h-4 text-[var(--color-navy-950)]" />
          </div>
          {!collapsed && (
            <>
              <span className="text-lg font-bold tracking-wide text-[var(--color-text-primary)]">
                YODA
              </span>
              <button
                className="ml-auto lg:hidden text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
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

        {/* ── Bottom footer: Settings + Collapse ── */}
        <div
          className="border-t border-white/[0.04] px-3 py-3 space-y-2"
          style={{ boxShadow: 'inset 0 2px 12px rgba(0,0,0,0.35)' }}
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

            {/* Collapse toggle — right-justified */}
            <button
              onClick={() => setCollapsed(c => !c)}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="ml-auto p-2.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-white/[0.06] transition-colors flex-shrink-0"
            >
              {collapsed
                ? <ChevronRight className="w-4 h-4" />
                : <ChevronLeft  className="w-4 h-4" />}
            </button>
          </div>

          {!collapsed && (
            <p className="text-[10px] text-[var(--color-text-muted)] leading-tight px-3 pb-1">
              Capomastro Holdings Ltd.
              <br />Applied Physics Division
            </p>
          )}
        </div>
      </aside>

      {/* ── Main column ── */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 h-14 flex items-center gap-3 px-4 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)]/80 backdrop-blur-md">
          <button
            className="lg:hidden text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex-1" />
          <UserProfile />
        </header>

        <main id="main-content" className="flex-1 overflow-y-auto" aria-label="Page content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
