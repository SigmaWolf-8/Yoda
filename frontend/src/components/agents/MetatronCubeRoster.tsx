import { useState, useEffect, useRef, useMemo } from 'react';
import type { AgentWithStats, AgentDivision } from '../../types';
import { DIVISIONS } from '../../types/agent';

interface Props {
  agents: AgentWithStats[];
  selectedDivision: AgentDivision | null;
  selectedAgentIdx: number | null;
  onSelectDivision: (div: AgentDivision | null) => void;
  onSelectAgent: (idx: number | null) => void;
}

/* ── Palette ── */
function palette(dark: boolean) {
  return {
    primary:     dark ? 'hsl(210, 80%, 55%)' : 'hsl(210, 100%, 45%)',
    primarySoft: dark ? 'hsl(210, 70%, 65%)' : 'hsl(210, 80%, 55%)',
    esoteric:    dark ? 'hsl(270, 50%, 65%)' : 'hsl(270, 50%, 55%)',
    depth:       dark ? 'hsla(210, 60%, 65%, 0.85)' : 'hsla(210, 60%, 50%, 0.85)',
    satellite:   dark ? 'hsl(180, 55%, 60%)' : 'hsl(180, 60%, 42%)',
    fgSoft:      dark ? 'hsl(40, 15%, 70%)' : 'hsl(220, 15%, 35%)',
    fgMuted:     dark ? 'hsl(35, 10%, 50%)' : 'hsl(220, 10%, 55%)',
    fgFaint:     dark ? 'hsl(30, 8%, 35%)' : 'hsl(220, 8%, 72%)',
    orb:         dark ? 'hsla(210, 50%, 50%, 0.06)' : 'hsla(210, 60%, 50%, 0.08)',
    glowC:       dark ? 'hsla(210, 80%, 55%, 0.12)' : 'hsla(210, 100%, 45%, 0.06)',
    glowE:       dark ? 'hsla(210, 80%, 55%, 0.03)' : 'hsla(210, 100%, 45%, 0.015)',
  };
}

type CubeRing = 'central' | 'inner' | 'outer' | 'depth' | 'satellite';

const RING_COLOR_KEY: Record<CubeRing, keyof ReturnType<typeof palette>> = {
  central:   'primary',
  inner:     'primarySoft',
  outer:     'esoteric',
  depth:     'depth',
  satellite: 'satellite',
};

const NODE_RADIUS: Record<CubeRing, number> = {
  central:   14,
  inner:     8,
  outer:     7,
  depth:     9,
  satellite: 5,
};

/* ── Edge config ── */
function edgeStyles(eA: number) {
  return {
    f:  `hsla(210, 80%, 55%, ${(0.22 * eA).toFixed(3)})`,
    i:  `hsla(210, 80%, 55%, ${(0.12 * eA).toFixed(3)})`,
    is: `hsla(210, 70%, 55%, ${(0.06 * eA).toFixed(3)})`,
    io: `hsla(210, 60%, 55%, ${(0.03 * eA).toFixed(3)})`,
    o:  `hsla(270, 50%, 60%, ${(0.10 * eA).toFixed(3)})`,
    os: `hsla(270, 50%, 60%, ${(0.05 * eA).toFixed(3)})`,
    c:  `hsla(340, 55%, 55%, ${(0.07 * eA).toFixed(3)})`,
    d:  `hsla(210, 60%, 60%, ${(0.06 * eA).toFixed(3)})`,
    s:  `hsla(180, 55%, 60%, ${(0.30 * eA).toFixed(3)})`,
  };
}

/* Derived ring arrays — all geometry driven from these */
const SAT_DIVS    = DIVISIONS.filter(d => d.ring === 'satellite');
const INNER_DIVS  = DIVISIONS.filter(d => d.ring === 'inner');
const OUTER_DIVS  = DIVISIONS.filter(d => d.ring === 'outer');
const CENTRAL_DIV = DIVISIONS.find(d => d.ring === 'central')!;
const DEPTH_DIV   = DIVISIONS.find(d => d.ring === 'depth')!;

type NodePos    = { div: typeof DIVISIONS[number]; x: number; y: number; ring: CubeRing };
type SubNodePos = NodePos & { parentId: AgentDivision };

/* ── Component ── */
export function MetatronCubeRoster({
  agents, selectedDivision, selectedAgentIdx,
  onSelectDivision, onSelectAgent,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 800 });
  const [phase, setPhase] = useState(0);
  const rafRef = useRef(0);

  const dark = useMemo(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }, []);

  const P  = useMemo(() => palette(dark), [dark]);
  const EC = useMemo(() => edgeStyles(dark ? 1 : 0.7), [dark]);

  /* Resize observer */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setDims({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* Animation */
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    let on = true;
    const tick = () => {
      if (!on) return;
      setPhase(p => (p + 0.003) % (Math.PI * 2));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { on = false; cancelAnimationFrame(rafRef.current); };
  }, []);

  /* Derived data */
  const divCounts = useMemo(() => {
    const m: Record<string, number> = {};
    agents.forEach(a => { m[a.division] = (m[a.division] || 0) + 1; });
    return m;
  }, [agents]);

  const divAgents = useMemo(
    () => selectedDivision ? agents.filter(a => a.division === selectedDivision) : [],
    [agents, selectedDivision],
  );

  /* Geometry */
  const { w, h } = dims;
  const sz  = Math.min(w, h) - 24;
  const cx  = w / 2;
  const cy  = h / 2;
  const rI  = sz * 0.14;
  const rO  = sz * 0.31;
  const rD  = sz * 0.43;
  const rS  = rI * 0.72;   // satellite orbit radius from parent

  /* Main node positions — driven by INNER_DIVS / OUTER_DIVS counts, no hardcoding */
  const positions: NodePos[] = useMemo(() => {
    const pos: NodePos[] = [];
    pos.push({ div: CENTRAL_DIV, x: cx, y: cy, ring: 'central' });
    INNER_DIVS.forEach((div, i) => {
      const a = (i * Math.PI * 2) / INNER_DIVS.length + phase * 0.25;
      pos.push({ div, x: cx + rI * Math.cos(a), y: cy + rI * Math.sin(a), ring: 'inner' });
    });
    OUTER_DIVS.forEach((div, i) => {
      const a = (i * Math.PI * 2) / OUTER_DIVS.length + Math.PI / 10 - phase * 0.15;
      pos.push({ div, x: cx + rO * Math.cos(a), y: cy + rO * Math.sin(a), ring: 'outer' });
    });
    pos.push({ div: DEPTH_DIV, x: cx, y: cy - rD, ring: 'depth' });
    return pos;
  }, [cx, cy, rI, rO, rD, phase]);

  /* Satellite sub-node positions — derived from parent positions each frame */
  const subNodes: SubNodePos[] = useMemo(() => {
    return SAT_DIVS.map(div => {
      const parent = positions.find(p => p.div.id === div.satelliteParent);
      const parentId = div.satelliteParent!;
      if (!parent) return { div, x: cx, y: cy, ring: 'satellite' as CubeRing, parentId };
      const baseAngle   = Math.atan2(parent.y - cy, parent.x - cx);
      const finalAngle  = baseAngle + (div.satelliteAngleOffset ?? 0);
      return {
        div,
        x: parent.x + rS * Math.cos(finalAngle),
        y: parent.y + rS * Math.sin(finalAngle),
        ring: 'satellite' as CubeRing,
        parentId,
      };
    });
  }, [positions, cx, cy, rS]);

  /* All clickable positions (main + sub) */
  const allPositions = useMemo(() => [...positions, ...subNodes], [positions, subNodes]);

  /* Agent satellite click positions when a division is selected */
  const agentSatellites = useMemo(() => {
    if (!selectedDivision || divAgents.length === 0) return [];
    const selPos = allPositions.find(p => p.div.id === selectedDivision);
    if (!selPos) return [];
    const r   = NODE_RADIUS[selPos.ring];
    const sat = r + 32 + Math.max(0, (divAgents.length - 5) * 3);
    return divAgents.map((ag, ai) => {
      const sa = (ai * Math.PI * 2) / divAgents.length - Math.PI / 2;
      return { agent: ag, idx: ai, x: selPos.x + sat * Math.cos(sa), y: selPos.y + sat * Math.sin(sa), selPos };
    });
  }, [allPositions, selectedDivision, divAgents]);

  /* Division click handler */
  const handleDivClick = (divId: AgentDivision) => {
    if (selectedDivision === divId) {
      onSelectDivision(null);
      onSelectAgent(null);
    } else {
      onSelectDivision(divId);
      onSelectAgent(null);
    }
  };

  /* Agent satellite click handler */
  const handleAgentClick = (e: React.MouseEvent, ai: number) => {
    e.stopPropagation();
    onSelectAgent(selectedAgentIdx === ai ? null : ai);
  };

  /* ── Build visual SVG string ── */
  const nI  = INNER_DIVS.length;
  const nO  = OUTER_DIVS.length;
  const cen = positions[0];
  const inn = positions.slice(1, 1 + nI);
  const out = positions.slice(1 + nI, 1 + nI + nO);
  const dep = positions[1 + nI + nO];

  const buildEdges = () => {
    const lines: string[] = [];
    /* Central → inner */
    inn.forEach(n => lines.push(`<line x1="${cen.x}" y1="${cen.y}" x2="${n.x}" y2="${n.y}" stroke="${EC.f}" stroke-width="0.9"/>`));
    /* Inner ring: adjacent + skip-1 + near-diameter */
    for (let i = 0; i < nI; i++) {
      lines.push(`<line x1="${inn[i].x}" y1="${inn[i].y}" x2="${inn[(i+1)%nI].x}" y2="${inn[(i+1)%nI].y}" stroke="${EC.i}" stroke-width="0.5"/>`);
      lines.push(`<line x1="${inn[i].x}" y1="${inn[i].y}" x2="${inn[(i+2)%nI].x}" y2="${inn[(i+2)%nI].y}" stroke="${EC.is}" stroke-width="0.4"/>`);
      lines.push(`<line x1="${inn[i].x}" y1="${inn[i].y}" x2="${inn[(i+Math.floor(nI/2))%nI].x}" y2="${inn[(i+Math.floor(nI/2))%nI].y}" stroke="${EC.io}" stroke-width="0.3"/>`);
    }
    /* Outer ring: pentagon adjacent + skip-1 */
    for (let i = 0; i < nO; i++) {
      lines.push(`<line x1="${out[i].x}" y1="${out[i].y}" x2="${out[(i+1)%nO].x}" y2="${out[(i+1)%nO].y}" stroke="${EC.o}" stroke-width="0.5"/>`);
      lines.push(`<line x1="${out[i].x}" y1="${out[i].y}" x2="${out[(i+2)%nO].x}" y2="${out[(i+2)%nO].y}" stroke="${EC.os}" stroke-width="0.3"/>`);
    }
    /* Cross: inner → outer (use nO pairs so we never go out of bounds) */
    for (let i = 0; i < nO; i++) {
      lines.push(`<line x1="${inn[i % nI].x}" y1="${inn[i % nI].y}" x2="${out[i].x}" y2="${out[i].y}" stroke="${EC.c}" stroke-width="0.4"/>`);
      lines.push(`<line x1="${inn[(i+1) % nI].x}" y1="${inn[(i+1) % nI].y}" x2="${out[i].x}" y2="${out[i].y}" stroke="${EC.c}" stroke-width="0.4"/>`);
    }
    /* Depth → inner */
    inn.forEach(n => lines.push(`<line x1="${dep.x}" y1="${dep.y}" x2="${n.x}" y2="${n.y}" stroke="${EC.d}" stroke-width="0.4"/>`));
    /* Satellite tethers */
    subNodes.forEach(s => {
      const parent = positions.find(p => p.div.id === s.parentId);
      if (!parent) return;
      const dimmed = selectedDivision && selectedDivision !== s.div.id && selectedDivision !== s.parentId;
      lines.push(`<line x1="${parent.x}" y1="${parent.y}" x2="${s.x}" y2="${s.y}" stroke="${EC.s}" stroke-width="0.7" stroke-dasharray="3 2" opacity="${dimmed ? '0.08' : '0.35'}" pointer-events="none"/>`);
    });
    return lines.join('');
  };

  const buildNodes = () => {
    const parts: string[] = [];

    /* ── Main ring nodes ── */
    positions.forEach(p => {
      const col    = P[RING_COLOR_KEY[p.ring]];
      const r      = NODE_RADIUS[p.ring];
      const isSel  = selectedDivision === p.div.id;
      const dimmed = selectedDivision && !isSel;
      const op     = dimmed ? 0.12 : 1;
      const count  = divCounts[p.div.id] || 0;
      const isDepth = p.ring === 'depth';

      if (p.ring === 'central' && !dimmed) {
        parts.push(`<circle cx="${p.x}" cy="${p.y}" r="${r+8}" fill="none" stroke="${col}" stroke-width="0.6" opacity="0.4" pointer-events="none"><animate attributeName="r" values="${r+6};${r+10};${r+6}" dur="4s" repeatCount="indefinite"/></circle>`);
      }
      if (isSel) {
        parts.push(`<circle cx="${p.x}" cy="${p.y}" r="${r+16}" fill="${col}" opacity="0.03" pointer-events="none"/>`);
        parts.push(`<circle cx="${p.x}" cy="${p.y}" r="${r+8}" fill="none" stroke="${col}" stroke-width="1.3" opacity="0.5" pointer-events="none"/>`);
      }
      parts.push(`<circle cx="${p.x}" cy="${p.y}" r="${isSel ? r+3 : r}" fill="${col}" opacity="${op * (isSel ? 1 : 0.75)}" pointer-events="none"/>`);

      const ly     = isDepth ? p.y - r - 10 : p.y + r + 15;
      const lblOp  = dimmed ? 0.15 : 0.85;
      parts.push(`<text x="${p.x}" y="${ly}" text-anchor="middle" fill="${P.fgSoft}" font-size="13" font-family="'JetBrains Mono', monospace" font-weight="500" opacity="${lblOp}" pointer-events="none">${p.div.label}</text>`);

      if (!dimmed && !isDepth) {
        parts.push(`<text x="${p.x}" y="${ly + 14}" text-anchor="middle" fill="${P.fgMuted}" font-size="11" font-family="'JetBrains Mono', monospace" opacity="0.6" pointer-events="none">${count} agent${count !== 1 ? 's' : ''}</text>`);
      }

      /* Agent satellites for a selected main-ring node */
      if (isSel && divAgents.length > 0) {
        const n    = divAgents.length;
        const satR = r + 32 + Math.max(0, (n - 5) * 3);
        divAgents.forEach((ag, ai) => {
          const sa     = (ai * Math.PI * 2) / n - Math.PI / 2;
          const sx     = p.x + satR * Math.cos(sa);
          const sy     = p.y + satR * Math.sin(sa);
          const isSelA = selectedAgentIdx === ai;
          const sr     = isSelA ? 5.5 : 3.5;
          parts.push(`<line x1="${p.x}" y1="${p.y}" x2="${sx}" y2="${sy}" stroke="${col}" stroke-width="0.25" opacity="0.2" pointer-events="none"/>`);
          if (isSelA) {
            parts.push(`<circle cx="${sx}" cy="${sy}" r="${sr+3.5}" fill="none" stroke="${col}" stroke-width="0.8" opacity="0.4" pointer-events="none"/>`);
            parts.push(`<text x="${sx}" y="${sy - sr - 8}" text-anchor="middle" fill="${P.fgSoft}" font-size="12" font-family="'JetBrains Mono', monospace" font-weight="500" pointer-events="none">${ag.display_name}</text>`);
          }
          parts.push(`<circle cx="${sx}" cy="${sy}" r="${sr}" fill="${col}" opacity="${isSelA ? 0.95 : 0.45}" pointer-events="none"/>`);
        });
      }
    });

    /* ── Satellite sub-nodes ── */
    subNodes.forEach(s => {
      const col    = P[RING_COLOR_KEY['satellite']];
      const r      = NODE_RADIUS['satellite'];
      const isSel  = selectedDivision === s.div.id;
      /* dim when something else is selected and it's not the parent */
      const dimmed = selectedDivision && !isSel && selectedDivision !== s.parentId;
      const op     = dimmed ? 0.1 : 1;
      const count  = divCounts[s.div.id] || 0;

      if (isSel) {
        parts.push(`<circle cx="${s.x}" cy="${s.y}" r="${r+14}" fill="${col}" opacity="0.04" pointer-events="none"/>`);
        parts.push(`<circle cx="${s.x}" cy="${s.y}" r="${r+7}" fill="none" stroke="${col}" stroke-width="1.1" opacity="0.45" pointer-events="none"/>`);
      }
      parts.push(`<circle cx="${s.x}" cy="${s.y}" r="${isSel ? r+2 : r}" fill="${col}" opacity="${op * (isSel ? 1 : 0.72)}" pointer-events="none"/>`);

      const ly    = s.y + r + 13;
      const lblOp = dimmed ? 0.1 : 0.8;
      parts.push(`<text x="${s.x}" y="${ly}" text-anchor="middle" fill="${P.satellite}" font-size="11" font-family="'JetBrains Mono', monospace" font-weight="500" opacity="${lblOp}" pointer-events="none">${s.div.label}</text>`);
      if (!dimmed) {
        parts.push(`<text x="${s.x}" y="${ly + 13}" text-anchor="middle" fill="${P.fgMuted}" font-size="10" font-family="'JetBrains Mono', monospace" opacity="0.55" pointer-events="none">${count} agent${count !== 1 ? 's' : ''}</text>`);
      }

      /* Agent satellites for a selected sub-node */
      if (isSel && divAgents.length > 0) {
        const n    = divAgents.length;
        const satR = r + 28 + Math.max(0, (n - 5) * 3);
        divAgents.forEach((ag, ai) => {
          const sa     = (ai * Math.PI * 2) / n - Math.PI / 2;
          const sx     = s.x + satR * Math.cos(sa);
          const sy     = s.y + satR * Math.sin(sa);
          const isSelA = selectedAgentIdx === ai;
          const sr     = isSelA ? 5.5 : 3.5;
          parts.push(`<line x1="${s.x}" y1="${s.y}" x2="${sx}" y2="${sy}" stroke="${col}" stroke-width="0.25" opacity="0.2" pointer-events="none"/>`);
          if (isSelA) {
            parts.push(`<circle cx="${sx}" cy="${sy}" r="${sr+3.5}" fill="none" stroke="${col}" stroke-width="0.8" opacity="0.4" pointer-events="none"/>`);
            parts.push(`<text x="${sx}" y="${sy - sr - 8}" text-anchor="middle" fill="${P.fgSoft}" font-size="12" font-family="'JetBrains Mono', monospace" font-weight="500" pointer-events="none">${ag.display_name}</text>`);
          }
          parts.push(`<circle cx="${sx}" cy="${sy}" r="${sr}" fill="${col}" opacity="${isSelA ? 0.95 : 0.45}" pointer-events="none"/>`);
        });
      }
    });

    return parts.join('');
  };

  const svgContent = useMemo(() => {
    const defs = `<defs>
      <radialGradient id="mcgl" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="${P.glowC}"/>
        <stop offset="60%" stop-color="${P.glowE}"/>
        <stop offset="100%" stop-color="transparent"/>
      </radialGradient>
      <filter id="mcng"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>`;
    const glow   = `<circle cx="${cx}" cy="${cy}" r="${rD * 0.88}" fill="url(#mcgl)" pointer-events="none"/>`;
    const orbits = [rI + 18, rO + 18, rD].map((r, i) =>
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${P.orb}" stroke-width="0.6" ${i === 2 ? 'stroke-dasharray="3 5"' : ''} pointer-events="none"/>`,
    ).join('');
    const shellDesc = SAT_DIVS.length > 0 ? `3 shells + ${SAT_DIVS.length} satellite` : '3 shells';
    const footer = `<text x="${cx}" y="${h - 24}" text-anchor="middle" fill="${P.fgFaint}" font-size="11" font-family="'JetBrains Mono', monospace" letter-spacing="0.5" pointer-events="none">${DIVISIONS.length} divisions · ${shellDesc} · ${agents.length} agent${agents.length !== 1 ? 's' : ''}</text>`;
    return `${defs}${glow}${orbits}${buildEdges()}${buildNodes()}${footer}`;
  }, [positions, subNodes, P, EC, cx, cy, rI, rO, rD, h, agents.length, divCounts, divAgents, selectedDivision, selectedAgentIdx]);

  /* ── Render ── */
  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 400 }}>

      {/* Visual layer */}
      <svg
        viewBox={`0 0 ${w} ${h}`}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        dangerouslySetInnerHTML={{ __html: svgContent }}
      />

      {/* Click-target overlay */}
      <svg
        viewBox={`0 0 ${w} ${h}`}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      >
        {/* Main division hit-areas */}
        {positions.map(p => (
          <circle
            key={p.div.id}
            cx={p.x} cy={p.y}
            r={NODE_RADIUS[p.ring] + 14}
            fill="transparent"
            style={{ cursor: 'pointer' }}
            onClick={() => handleDivClick(p.div.id)}
          />
        ))}

        {/* Satellite sub-node hit-areas */}
        {subNodes.map(s => (
          <circle
            key={s.div.id}
            cx={s.x} cy={s.y}
            r={NODE_RADIUS['satellite'] + 12}
            fill="transparent"
            style={{ cursor: 'pointer' }}
            onClick={() => handleDivClick(s.div.id)}
          />
        ))}

        {/* Agent satellite hit-areas */}
        {agentSatellites.map(s => (
          <circle
            key={`sat-${s.idx}`}
            cx={s.x} cy={s.y}
            r={12}
            fill="transparent"
            style={{ cursor: 'pointer' }}
            onClick={(e) => handleAgentClick(e, s.idx)}
          />
        ))}
      </svg>

    </div>
  );
}
