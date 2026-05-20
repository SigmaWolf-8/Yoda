import { LayoutDashboard } from 'lucide-react';
import { usePageHeader } from '../context/PageHeader';
import { useVideoPlay } from '../context/VideoPlay';

const SIDEBAR_PLAY_OFFSET_MS = 800;

export function DashboardPage() {
  const { heroRef, playHero, playSidebarAfterDelay } = useVideoPlay();

  usePageHeader({
    icon: LayoutDashboard,
    title: 'Dashboard',
    subtitle: 'Your development intelligence platform',
  });

  return (
    <div className="flex flex-col gap-6 animate-fade-in">

      {/* ── Hero video ── */}
      <div
        onClick={playHero}
        style={{
          height: '48vh',
          minHeight: 320,
          padding: '14px',
          background: 'hsl(20, 8%, 13%)',
          borderRadius: '3px',
          border: '1px solid',
          borderColor: 'rgba(255,255,255,0.16) rgba(0,0,0,0.8) rgba(0,0,0,0.8) rgba(255,255,255,0.16)',
          boxShadow: [
            'inset 0 5px 0 rgba(0,0,0,0.96)',
            'inset 5px 0 0 rgba(0,0,0,0.88)',
            'inset 0 -2px 0 rgba(255,255,255,0.08)',
            'inset -2px 0 0 rgba(255,255,255,0.06)',
            'inset 0 14px 36px rgba(0,0,0,0.82)',
            'inset 10px 0 24px rgba(0,0,0,0.62)',
            'inset -10px 0 24px rgba(0,0,0,0.52)',
            'inset 0 -8px 20px rgba(0,0,0,0.58)',
          ].join(', '),
          position: 'relative',
          boxSizing: 'border-box',
          cursor: 'pointer',
        }}
      >
        <video
          ref={heroRef}
          autoPlay
          muted
          playsInline
          style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
          onEnded={() => {
            if (heroRef.current) {
              heroRef.current.currentTime = 0;
              heroRef.current.pause();
            }
            playSidebarAfterDelay(SIDEBAR_PLAY_OFFSET_MS);
          }}
        >
          <source src={`${import.meta.env.BASE_URL}hero.mp4`} type="video/mp4" />
        </video>
      </div>

    </div>
  );
}
