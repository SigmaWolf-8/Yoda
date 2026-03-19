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
} from 'lucide-react';
import { UserProfile } from '../auth/UserProfile';

const NAV_ITEMS = [
  { to: '/',            icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/projects',    icon: FolderKanban,    label: 'Projects' },
  { to: '/monitoring',  icon: BarChart3,       label: 'Monitoring' },
  { to: '/settings',    icon: Settings,        label: 'Settings' },
] as const;

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen w-full bg-[var(--color-surface-primary)]">
      {/* Skip navigation for keyboard users */}
      <a href="#main-content" className="skip-nav">
        Skip to main content
      </a>

      {/* ── Mobile overlay ── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ── */}
      <aside
        className={`
          fixed lg:sticky top-0 left-0 z-40 h-screen w-64 flex-shrink-0
          bg-[var(--color-surface-secondary)] border-r border-[var(--color-border-subtle)]
          flex flex-col transition-transform duration-200
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-[var(--color-border-subtle)]">
          <div className="w-8 h-8 rounded-lg bg-[var(--color-gold-500)] flex items-center justify-center flex-shrink-0">
            <Zap className="w-4 h-4 text-[var(--color-navy-950)]" />
          </div>
          <span className="text-lg font-bold tracking-wide text-[var(--color-text-primary)]">
            YODA
          </span>
          <button
            className="ml-auto lg:hidden text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Main navigation">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) => `
                flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                transition-colors duration-150
                ${
                  isActive
                    ? 'bg-[var(--color-gold-500)]/10 text-[var(--color-gold-400)] border border-[var(--color-gold-500)]/20'
                    : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)]'
                }
              `}
            >
              <Icon className="w-4.5 h-4.5 flex-shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[var(--color-border-subtle)]">
          <p className="text-[10px] text-[var(--color-text-muted)] leading-tight">
            Capomastro Holdings Ltd.
            <br />
            Applied Physics Division
          </p>
        </div>
      </aside>

      {/* ── Main column ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-20 h-14 flex items-center gap-3 px-4 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)]/80 backdrop-blur-md">
          {/* Mobile hamburger */}
          <button
            className="lg:hidden text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex-1" />

          <UserProfile />
        </header>

        {/* Page content */}
        <main id="main-content" className="flex-1 overflow-y-auto" aria-label="Page content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
