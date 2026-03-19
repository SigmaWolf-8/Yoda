import { Link } from 'react-router-dom';
import { FolderOpen, Settings, BookOpen, Zap, LayoutDashboard } from 'lucide-react';
import { usePageHeader } from '../context/PageHeader';

export function DashboardPage() {
  usePageHeader({
    icon: LayoutDashboard,
    title: 'Dashboard',
    subtitle: 'Your development intelligence platform',
  });

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto animate-fade-in">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { to: '/projects', icon: FolderOpen, label: 'Projects', desc: 'View and manage your projects' },
          { to: '/settings/engines', icon: Zap, label: 'AI Engines', desc: 'Configure AI engines' },
          { to: '/settings', icon: Settings, label: 'Settings', desc: 'Platform configuration' },
        ].map(({ to, icon: Icon, label, desc }) => (
          <Link
            key={to}
            to={to}
            className="group p-5 rounded-xl bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] hover:border-[var(--color-border-accent)] transition-all"
          >
            <Icon className="w-5 h-5 text-[var(--color-gold-500)] mb-3 group-hover:scale-110 transition-transform" />
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">{label}</h3>
            <p className="text-xs text-[var(--color-text-tertiary)]">{desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
