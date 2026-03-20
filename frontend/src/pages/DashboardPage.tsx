import { LayoutDashboard } from 'lucide-react';
import { usePageHeader } from '../context/PageHeader';

export function DashboardPage() {
  usePageHeader({
    icon: LayoutDashboard,
    title: 'Dashboard',
    subtitle: 'Your development intelligence platform',
  });

  return (
    <div className="w-full h-full animate-fade-in">
      <video
        autoPlay
        muted
        loop
        playsInline
        className="w-full h-full"
        style={{
          display: 'block',
          objectFit: 'cover',
          minHeight: 'calc(100vh - 144px)',
        }}
      >
        <source src={`${import.meta.env.BASE_URL}hero.mp4`} type="video/mp4" />
      </video>
    </div>
  );
}
