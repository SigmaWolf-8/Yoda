import { NavLink, Outlet } from 'react-router-dom';
import { Cpu, Building2, Key, Settings as SettingsIcon } from 'lucide-react';
import { usePageHeader } from '../../context/PageHeader';
import { BevelBox } from '../../components/ui/BevelBox';

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
      <div className="grid gap-4 sm:grid-cols-3">
        {SETTINGS_NAV.map(({ to, icon: Icon, label }) => (
          <BevelBox key={to} hoverBorder className="bg-[var(--color-surface-secondary)]">
            <NavLink to={to} className="block p-5">
              <Icon className="w-5 h-5 text-[var(--color-gold-400)] mb-3" />
              <h3 className="text-sm font-bold text-white group-hover:text-[var(--color-gold-400)] transition-colors tracking-wide">
                {label}
              </h3>
            </NavLink>
          </BevelBox>
        ))}
      </div>
    </div>
  );
}
