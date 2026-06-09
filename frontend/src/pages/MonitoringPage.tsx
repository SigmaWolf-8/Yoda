import { HEADER_H } from '../components/layout/AppShell';

export function MonitoringPage() {
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: `calc(100vh - ${HEADER_H}px)`,
        background: '#000',
        overflow: 'hidden',
      }}
    >
      <iframe
        src="/array3-cubes-flush.html"
        title="Array3 Monitor"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          border: 'none',
          background: '#000',
          display: 'block',
        }}
      />
    </div>
  );
}
