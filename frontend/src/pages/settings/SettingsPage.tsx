import { NavLink, Outlet } from 'react-router-dom';
import { Cpu, Building2, Key, Settings as SettingsIcon } from 'lucide-react';
import { usePageHeader } from '../../context/PageHeader';
import { SectionHeader } from '../../components/common/SectionHeader';

const SETTINGS_NAV = [
  { to: '/settings/engines',  icon: Cpu,       label: 'AI Engines' },
  { to: '/settings/org',      icon: Building2, label: 'Organization' },
  { to: '/settings/api-keys', icon: Key,       label: 'API Keys' },
] as const;

export function SettingsPage() {
  usePageHeader({
    icon: SettingsIcon,
    title: 'Settings',
    subtitle: 'Platform configuration',
  });

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto animate-fade-in">
      <SectionHeader title="Settings" accentColor="#94A3B8" />
      <div className="grid gap-4 sm:grid-cols-3">
        {SETTINGS_NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className="group p-5 rounded-xl bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] hover:border-[var(--color-gold-500)]/30 transition-colors"
          >
            <Icon className="w-5 h-5 text-[var(--color-gold-400)] mb-3" />
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)] group-hover:text-[var(--color-gold-400)] transition-colors">
              {label}
            </h3>
          </NavLink>
        ))}
      </div>
    </div>
  );
}
