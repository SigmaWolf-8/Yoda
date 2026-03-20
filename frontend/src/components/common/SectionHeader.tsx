interface SectionHeaderProps {
  title: string;
  accentColor?: string;
  className?: string;
}

export function SectionHeader({
  title,
  accentColor = '#38BDF8',
  className = '',
}: SectionHeaderProps) {
  return (
    <div className={`mb-8 ${className}`}>
      <h1
        style={{
          fontFamily: "'Orbitron', sans-serif",
          fontSize: '34px',
          fontWeight: 800,
          letterSpacing: '0.12em',
          lineHeight: 1.15,
          textTransform: 'uppercase',
          color: 'inherit',
          textShadow:
            '0 1px 0 rgba(0,0,0,0.15), 0 2px 0 rgba(0,0,0,0.1), 0 4px 12px rgba(0,0,0,0.12)',
          margin: 0,
        }}
      >
        {title}
      </h1>

      <svg
        aria-hidden="true"
        width="100%"
        height="16"
        viewBox="0 0 1000 16"
        preserveAspectRatio="none"
        fill="none"
        style={{ display: 'block', marginTop: '10px', color: accentColor }}
      >
        <line x1="0" y1="8" x2="1000" y2="8" stroke="currentColor" strokeWidth="1" opacity="0.25" />

        <line x1="0"   y1="1"  x2="0"   y2="15" stroke="currentColor" strokeWidth="2"   opacity="0.8" />
        <line x1="60"  y1="2"  x2="60"  y2="14" stroke="currentColor" strokeWidth="1.5" opacity="0.55" />
        <line x1="72"  y1="2"  x2="72"  y2="14" stroke="currentColor" strokeWidth="1.5" opacity="0.55" />

        <polygon points="90,8 104,2 118,8 104,14" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.4" />

        <line x1="400" y1="4"  x2="400" y2="12" stroke="currentColor" strokeWidth="1"   opacity="0.3" />
        <line x1="500" y1="4"  x2="500" y2="12" stroke="currentColor" strokeWidth="1"   opacity="0.3" />

        <line x1="850" y1="2"  x2="850" y2="14" stroke="currentColor" strokeWidth="1.5" opacity="0.45" />
        <line x1="862" y1="2"  x2="862" y2="14" stroke="currentColor" strokeWidth="1.5" opacity="0.45" />
        <line x1="1000" y1="1" x2="1000" y2="15" stroke="currentColor" strokeWidth="2" opacity="0.8" />
      </svg>
    </div>
  );
}
