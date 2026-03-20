import { LayoutDashboard } from 'lucide-react';
import { usePageHeader } from '../context/PageHeader';

export function DashboardPage() {
  usePageHeader({
    icon: LayoutDashboard,
    title: 'Dashboard',
    subtitle: 'Your development intelligence platform',
  });

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 animate-fade-in">

      {/* ── Top metrics row (future: Open Tunnels, Active Sessions, etc.) ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 min-h-[80px]" />

      {/* ── Hero video ── */}
      <div className="rounded-2xl overflow-hidden" style={{ height: '48vh', minHeight: 320 }}>
        <video
          autoPlay
          muted
          loop
          playsInline
          className="w-full h-full"
          style={{ display: 'block', objectFit: 'cover' }}
        >
          <source src={`${import.meta.env.BASE_URL}hero.mp4`} type="video/mp4" />
        </video>
      </div>

      {/* ── Bottom metrics row (future: Projects Under Construction, etc.) ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 min-h-[80px]" />

    </div>
  );
}
