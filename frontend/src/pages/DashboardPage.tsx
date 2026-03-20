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

      {/* ── Hero video — recess frame (padding lets inset shadows show) ── */}
      <div
        style={{
          height: '48vh',
          minHeight: 320,
          marginTop: '24px',
          padding: '10px',              /* frame gap so inset shadows are visible */
          background: 'rgba(0,0,0,0.55)',
          borderRadius: '4px',
          /* Inset shadows land on the frame, not buried under the video */
          boxShadow: `
            inset 0 8px 28px rgba(0,0,0,0.90),
            inset 0 -8px 28px rgba(0,0,0,0.75),
            inset 8px 0 28px rgba(0,0,0,0.65),
            inset -8px 0 28px rgba(0,0,0,0.65),
            0 0 0 1px rgba(0,0,0,0.7)
          `,
          position: 'relative',
          boxSizing: 'border-box',
        }}
      >
        {/* Video sits inside the padded recess */}
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

        {/* Soft vignette over the video only — edges dark, centre clear */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: '10px',              /* matches the frame padding */
            pointerEvents: 'none',
            background: [
              'linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, transparent 20%)',
              'linear-gradient(to top,    rgba(0,0,0,0.55) 0%, transparent 20%)',
              'linear-gradient(to right,  rgba(0,0,0,0.40) 0%, transparent 16%)',
              'linear-gradient(to left,   rgba(0,0,0,0.40) 0%, transparent 16%)',
            ].join(', '),
          }}
        />
      </div>

      {/* ── Bottom metrics row (future: Projects Under Construction, etc.) ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 min-h-[80px] px-6 lg:px-8 pb-6 lg:pb-8" />

    </div>
  );
}
