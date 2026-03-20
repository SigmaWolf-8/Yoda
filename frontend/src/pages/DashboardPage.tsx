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

      {/* ── Hero video — true recess ── */}
      {/*
        Bevel anatomy (light source top-left):
          outer rim  — thin 1-px border, lighter top/left, darker bottom/right → raised lip
          inner lip  — hard 0-blur inset strips: dark top/left (shadow), faint bottom/right (reflected light)
          pit fill   — large blurry inset shadows deepen the sense of drop
        The frame bg MUST be a visible mid-tone, not black — otherwise the
        shadow and highlight strips vanish into the same shade.
      */}
      <div
        style={{
          height: '48vh',
          minHeight: 320,
          marginTop: '24px',
          padding: '14px',
          background: 'hsl(20, 8%, 13%)',   /* medium-dark leather tone — not black */
          borderRadius: '3px',
          /* Outer raised rim: lighter top/left, darker bottom/right */
          border: '1px solid',
          borderColor: 'rgba(255,255,255,0.16) rgba(0,0,0,0.8) rgba(0,0,0,0.8) rgba(255,255,255,0.16)',
          boxShadow: [
            /* Hard bevel at inner lip — no blur so the edge is sharp */
            'inset 0 5px 0 rgba(0,0,0,0.96)',          /* top lip: deep shadow */
            'inset 5px 0 0 rgba(0,0,0,0.88)',          /* left lip: deep shadow */
            'inset 0 -2px 0 rgba(255,255,255,0.08)',   /* bottom lip: faint reflected light */
            'inset -2px 0 0 rgba(255,255,255,0.06)',   /* right lip: faint reflected light */
            /* Blurry pit-drop — fades from the bevel inward */
            'inset 0 14px 36px rgba(0,0,0,0.82)',
            'inset 10px 0 24px rgba(0,0,0,0.62)',
            'inset -10px 0 24px rgba(0,0,0,0.52)',
            'inset 0 -8px 20px rgba(0,0,0,0.58)',
          ].join(', '),
          position: 'relative',
          boxSizing: 'border-box',
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
          onEnded={() => {
            if (videoRef.current) {
              videoRef.current.currentTime = 0;
              videoRef.current.pause();
            }
          }}
        >
          <source src={`${import.meta.env.BASE_URL}hero.mp4`} type="video/mp4" />
        </video>
      </div>

      {/* ── Bottom metrics row (future: Projects Under Construction, etc.) ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 min-h-[80px] px-6 lg:px-8 pb-6 lg:pb-8" />

    </div>
  );
}
