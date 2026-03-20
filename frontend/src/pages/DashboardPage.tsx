import { useRef } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { usePageHeader } from '../context/PageHeader';

export function DashboardPage() {
  const videoRef = useRef<HTMLVideoElement>(null);

  usePageHeader({
    icon: LayoutDashboard,
    title: 'Dashboard',
    subtitle: 'Your development intelligence platform',
  });

  return (
    <div className="flex flex-col gap-6 animate-fade-in">

      {/* ── Top metrics row (future: Open Tunnels, Active Sessions, etc.) ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 min-h-[80px] px-6 lg:px-8 pt-6 lg:pt-8" />

      {/* ── Hero video — deep recess ── */}
      <div
        style={{
          height: '48vh',
          minHeight: 320,
          marginTop: '24px',
          position: 'relative',
          /* Outer frame shadow — gives the "pit" illusion */
          boxShadow: `
            inset 0 6px 24px rgba(0,0,0,0.85),
            inset 0 -6px 24px rgba(0,0,0,0.70),
            inset 6px 0 24px rgba(0,0,0,0.60),
            inset -6px 0 24px rgba(0,0,0,0.60),
            0 0 0 1px rgba(0,0,0,0.6)
          `,
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="w-full h-full"
          style={{ display: 'block', objectFit: 'cover' }}
          onEnded={() => {
            if (videoRef.current) {
              videoRef.current.currentTime = 0;
              videoRef.current.pause();
            }
          }}
        >
          <source src={`${import.meta.env.BASE_URL}hero.mp4`} type="video/mp4" />
        </video>

        {/* Deep recess vignette overlay — dark gradient from all four edges */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background: `
              radial-gradient(ellipse at 50% 50%,
                transparent 35%,
                rgba(0,0,0,0.45) 65%,
                rgba(0,0,0,0.82) 100%)
            `,
            /* Top + bottom linear reinforcement */
            boxShadow: `
              inset 0 0 80px 40px rgba(0,0,0,0.55)
            `,
          }}
        />
      </div>

      {/* ── Bottom metrics row (future: Projects Under Construction, etc.) ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 min-h-[80px] px-6 lg:px-8 pb-6 lg:pb-8" />

    </div>
  );
}
