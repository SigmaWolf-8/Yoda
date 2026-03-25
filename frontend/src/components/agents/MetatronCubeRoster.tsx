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
  central:   22,
  inner:     14,
  outer:     12,
  depth:     15,
  satellite: 9,
};

/* ── Edge config — boosted for visibility, pulse applied per-frame ── */
function edgeStyles(eA: number) {
  return {
    f:  `hsla(210, 80%, 65%, ${(0.72 * eA).toFixed(3)})`,   // central → inner
    i:  `hsla(210, 80%, 65%, ${(0.52 * eA).toFixed(3)})`,   // inner ring adjacent
    is: `hsla(210, 70%, 65%, ${(0.28 * eA).toFixed(3)})`,   // inner ring skip-1
    io: `hsla(210, 60%, 65%, ${(0.16 * eA).toFixed(3)})`,   // inner ring diameter
    o:  `hsla(270, 60%, 70%, ${(0.48 * eA).toFixed(3)})`,   // outer ring adjacent
    os: `hsla(270, 55%, 70%, ${(0.24 * eA).toFixed(3)})`,   // outer ring skip
    c:  `hsla(340, 65%, 65%, ${(0.32 * eA).toFixed(3)})`,   // cross inner→outer
    d:  `hsla(210, 65%, 65%, ${(0.28 * eA).toFixed(3)})`,   // depth → inner
    s:  `hsla(180, 65%, 65%, ${(0.62 * eA).toFixed(3)})`,   // satellite tethers
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
  const containerRef   = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 800 });
  const [phase, setPhase] = useState(0);
  const rafRef = useRef(0);

  /* Hover tracking — ref for RAF loop, state for React render deps */
  const [hoveredDivision, setHoveredDivision] = useState<AgentDivision | null>(null);
  const hoveredDivRef   = useRef<AgentDivision | null>(null);
  /* hoverProgress: 0 = idle, 1 = fully bloomed. Lerped in RAF, read during render. */
  const hoverProgressRef = useRef(0);

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

  /* Animation — rotates geometry AND lerps hoverProgress each frame */
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    let on = true;
    const tick = () => {
      if (!on) return;
      setPhase(p => (p + 0.003) % (Math.PI * 2));
      /* Smooth lerp: bloom in slowly (~55 frames ≈ 0.9s), decay out even slower */
      const target = hoveredDivRef.current ? 1 : 0;
      const cur    = hoverProgressRef.current;
      const speed  = target > cur ? 0.018 : 0.011;
      hoverProgressRef.current = cur + (target - cur) * speed;
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

  /* Hover agents — shown as spray on mouseover even without clicking */
  const hoverAgents = useMemo(
    () => (hoveredDivision && hoveredDivision !== selectedDivision)
      ? agents.filter(a => a.division === hoveredDivision)
      : [],
    [agents, hoveredDivision, selectedDivision],
  );

  /* Geometry — orbit radii bloom outward while hovering */
  const { w, h } = dims;
  const sz  = Math.min(w, h) - 24;
  const cx  = w / 2;
  const cy  = h / 2;

  /* Base radii */
  const rIBase = sz * 0.14;
  const rOBase = sz * 0.31;
  const rDBase = sz * 0.43;

  /* Bloomed radii — expand toward page corners on hover (up to 1.55× outer) */
  const hp   = hoverProgressRef.current;          // read live on every render
  const rI   = rIBase * (1 + hp * 0.30);
  const rO   = rOBase * (1 + hp * 0.55);
  const rD   = rDBase * (1 + hp * 0.22);
  const rS   = rI * 0.72;

  /* Main node positions — driven by phase + bloomed radii */
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

  /* Satellite sub-node positions */
  const subNodes: SubNodePos[] = useMemo(() => {
    return SAT_DIVS.map(div => {
      const parent = positions.find(p => p.div.id === div.satelliteParent);
      const parentId = div.satelliteParent!;
      if (!parent) return { div, x: cx, y: cy, ring: 'satellite' as CubeRing, parentId };
      const baseAngle  = Math.atan2(parent.y - cy, parent.x - cx);
      const finalAngle = baseAngle + (div.satelliteAngleOffset ?? 0);
      return {
        div,
        x: parent.x + rS * Math.cos(finalAngle),
        y: parent.y + rS * Math.sin(finalAngle),
        ring: 'satellite' as CubeRing,
        parentId,
      };
    });
  }, [positions, cx, cy, rS]);

  const allPositions = useMemo(() => [...positions, ...subNodes], [positions, subNodes]);

  /* Agent satellites — for selected division (click) */
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

  /* Hover agent satellites — for hovered division (mouseover spray) */
  const hoverSatellites = useMemo(() => {
    if (!hoveredDivision || hoverAgents.length === 0) return [];
    const pos = allPositions.find(p => p.div.id === hoveredDivision);
    if (!pos) return [];
    const r   = NODE_RADIUS[pos.ring];
    const sat = r + 32 + Math.max(0, (hoverAgents.length - 5) * 3);
    return hoverAgents.map((ag, ai) => {
      const sa = (ai * Math.PI * 2) / hoverAgents.length - Math.PI / 2;
      return { agent: ag, idx: ai, x: pos.x + sat * Math.cos(sa), y: pos.y + sat * Math.sin(sa), pos };
    });
  }, [allPositions, hoveredDivision, hoverAgents]);

  /* Handlers */
  const handleDivClick = (e: React.MouseEvent, divId: AgentDivision) => {
    e.stopPropagation();
    if (selectedDivision === divId) {
      onSelectDivision(null);
      onSelectAgent(null);
    } else {
      onSelectDivision(divId);
      onSelectAgent(null);
    }
  };

  const handleDivHover = (divId: AgentDivision | null) => {
    hoveredDivRef.current = divId;
    setHoveredDivision(divId);
  };

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

  /* Pulse: slow breath between 65 % and 100 % opacity — two overlapping waves */
  const edgePulse = (0.65 + 0.20 * Math.sin(phase * 1.2) + 0.15 * Math.sin(phase * 0.7)).toFixed(3);

  const buildEdges = () => {
    const inner: string[] = [];
    const outer: string[] = [];
    const cross: string[] = [];
    const depth: string[] = [];
    const teth:  string[] = [];

    /* Central → inner */
    inn.forEach(n => inner.push(`<line x1="${cen.x}" y1="${cen.y}" x2="${n.x}" y2="${n.y}" stroke="${EC.f}" stroke-width="1.6"/>`));
    /* Inner ring */
    for (let i = 0; i < nI; i++) {
      inner.push(`<line x1="${inn[i].x}" y1="${inn[i].y}" x2="${inn[(i+1)%nI].x}" y2="${inn[(i+1)%nI].y}" stroke="${EC.i}" stroke-width="1.1"/>`);
      inner.push(`<line x1="${inn[i].x}" y1="${inn[i].y}" x2="${inn[(i+2)%nI].x}" y2="${inn[(i+2)%nI].y}" stroke="${EC.is}" stroke-width="0.7"/>`);
      inner.push(`<line x1="${inn[i].x}" y1="${inn[i].y}" x2="${inn[(i+Math.floor(nI/2))%nI].x}" y2="${inn[(i+Math.floor(nI/2))%nI].y}" stroke="${EC.io}" stroke-width="0.5"/>`);
    }
    /* Outer ring */
    for (let i = 0; i < nO; i++) {
      outer.push(`<line x1="${out[i].x}" y1="${out[i].y}" x2="${out[(i+1)%nO].x}" y2="${out[(i+1)%nO].y}" stroke="${EC.o}" stroke-width="1.1"/>`);
      outer.push(`<line x1="${out[i].x}" y1="${out[i].y}" x2="${out[(i+2)%nO].x}" y2="${out[(i+2)%nO].y}" stroke="${EC.os}" stroke-width="0.6"/>`);
    }
    /* Cross: inner → outer */
    for (let i = 0; i < nO; i++) {
      cross.push(`<line x1="${inn[i % nI].x}" y1="${inn[i % nI].y}" x2="${out[i].x}" y2="${out[i].y}" stroke="${EC.c}" stroke-width="0.9"/>`);
      cross.push(`<line x1="${inn[(i+1) % nI].x}" y1="${inn[(i+1) % nI].y}" x2="${out[i].x}" y2="${out[i].y}" stroke="${EC.c}" stroke-width="0.9"/>`);
    }
    /* Depth → inner */
    inn.forEach(n => depth.push(`<line x1="${dep.x}" y1="${dep.y}" x2="${n.x}" y2="${n.y}" stroke="${EC.d}" stroke-width="0.8"/>`));
    /* Satellite tethers — pulse independently at slightly different phase */
    const tethPulse = (0.5 + 0.35 * Math.sin(phase * 1.5 + 0.9)).toFixed(3);
    subNodes.forEach(s => {
      const parent = positions.find(p => p.div.id === s.parentId);
      if (!parent) return;
      const dimmed = selectedDivision && selectedDivision !== s.div.id && selectedDivision !== s.parentId;
      teth.push(`<line x1="${parent.x}" y1="${parent.y}" x2="${s.x}" y2="${s.y}" stroke="${EC.s}" stroke-width="1.3" stroke-dasharray="3 2" opacity="${dimmed ? '0.08' : tethPulse}" pointer-events="none"/>`);
    });

    /* Wrap structural lines in a single pulsing group */
    return `<g opacity="${edgePulse}">${[...inner, ...outer, ...cross, ...depth].join('')}</g>${teth.join('')}`;
  };

  const buildNodes = () => {
    const parts: string[] = [];

    /* ── Main ring nodes ── */
    positions.forEach(p => {
      const col     = P[RING_COLOR_KEY[p.ring]];
      const r       = NODE_RADIUS[p.ring];
      const isSel   = selectedDivision === p.div.id;
      const isHov   = hoveredDivision === p.div.id && !isSel;
      const dimmed  = (selectedDivision && !isSel) || (!!hoveredDivision && !isHov && !isSel);
      const op      = dimmed ? 0.12 : 1;
      const count   = divCounts[p.div.id] || 0;
      const isDepth = p.ring === 'depth';
      /* Hovered node grows larger — lerp toward 2× */
      const displayR = isHov ? r * (1 + hp * 1.0) : isSel ? r + 3 : r;

      if (p.ring === 'central' && !dimmed) {
        parts.push(`<circle cx="${p.x}" cy="${p.y}" r="${r+8}" fill="none" stroke="${col}" stroke-width="0.6" opacity="0.4" pointer-events="none"><animate attributeName="r" values="${r+6};${r+10};${r+6}" dur="4s" repeatCount="indefinite"/></circle>`);
      }
      if (isSel) {
        parts.push(`<circle cx="${p.x}" cy="${p.y}" r="${r+16}" fill="${col}" opacity="0.03" pointer-events="none"/>`);
        parts.push(`<circle cx="${p.x}" cy="${p.y}" r="${r+8}" fill="none" stroke="${col}" stroke-width="1.3" opacity="0.5" pointer-events="none"/>`);
      }
      if (isHov) {
        parts.push(`<circle cx="${p.x}" cy="${p.y}" r="${displayR+10}" fill="${col}" opacity="${(0.06 * hp).toFixed(3)}" pointer-events="none"/>`);
        parts.push(`<circle cx="${p.x}" cy="${p.y}" r="${displayR+5}" fill="none" stroke="${col}" stroke-width="1" opacity="${(0.4 * hp).toFixed(3)}" pointer-events="none"/>`);
      }
      parts.push(`<circle cx="${p.x}" cy="${p.y}" r="${displayR}" fill="${col}" opacity="${op * (isSel || isHov ? 1 : 0.75)}" pointer-events="none"/>`);

      const ly    = isDepth ? p.y - displayR - 14 : p.y + displayR + 22;
      const lblOp = dimmed ? 0.08 : isHov ? 1 : 0.85;
      const lblCol  = isHov ? col : P.fgSoft;
      const lblSize = isHov ? Math.round(18 + 24 * hp) : 18;
      const cntSize = isHov ? Math.round(13 + 8  * hp) : 13;
      const cntGap  = isHov ? Math.round(20 + 18 * hp) : 20;
      parts.push(`<text x="${p.x}" y="${ly}" text-anchor="middle" fill="${lblCol}" font-size="${lblSize}" font-family="'Orbitron', sans-serif" font-weight="700" letter-spacing="0.08em" opacity="${lblOp}" pointer-events="none">${p.div.label}</text>`);
      if (!dimmed && !isDepth) {
        parts.push(`<text x="${p.x}" y="${ly + cntGap}" text-anchor="middle" fill="${P.fgMuted}" font-size="${cntSize}" font-family="'JetBrains Mono', monospace" opacity="${isHov ? 0.85 : 0.6}" pointer-events="none">${count} agent${count !== 1 ? 's' : ''}</text>`);
      }

      /* Agent spray — selected (opaque) */
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

      /* Agent spray — hovered (dots only, no text — side panel carries the list) */
      if (isHov && hoverAgents.length > 0) {
        const n    = hoverAgents.length;
        const satR = (r + 32 + Math.max(0, (n - 5) * 3)) * (0.5 + hp * 0.5);
        hoverAgents.forEach((_ag, ai) => {
          const sa  = (ai * Math.PI * 2) / n - Math.PI / 2;
          const sx  = p.x + satR * Math.cos(sa);
          const sy  = p.y + satR * Math.sin(sa);
          const sr  = 3.5 * (0.5 + hp * 0.5);
          parts.push(`<line x1="${p.x}" y1="${p.y}" x2="${sx}" y2="${sy}" stroke="${col}" stroke-width="0.4" opacity="${(0.15 * hp).toFixed(3)}" pointer-events="none"/>`);
          parts.push(`<circle cx="${sx}" cy="${sy}" r="${sr}" fill="${col}" opacity="${(0.55 * hp).toFixed(3)}" pointer-events="none"/>`);
        });
      }
    });

    /* ── Satellite sub-nodes ── */
    subNodes.forEach(s => {
      const col    = P[RING_COLOR_KEY['satellite']];
      const r      = NODE_RADIUS['satellite'];
      const isSel  = selectedDivision === s.div.id;
      const isHov  = hoveredDivision === s.div.id && !isSel;
      const dimmed = (selectedDivision && !isSel && selectedDivision !== s.parentId)
                  || (!!hoveredDivision && !isHov && !isSel);
      const op     = dimmed ? 0.1 : 1;
      const count  = divCounts[s.div.id] || 0;

      const dr = isSel ? r * 2 : isHov ? r * (1 + hp * 1.0) : r;
      if (isSel) {
        parts.push(`<circle cx="${s.x}" cy="${s.y}" r="${dr+14}" fill="${col}" opacity="0.04" pointer-events="none"/>`);
        parts.push(`<circle cx="${s.x}" cy="${s.y}" r="${dr+7}" fill="none" stroke="${col}" stroke-width="1.1" opacity="0.45" pointer-events="none"/>`);
      }
      if (isHov) {
        parts.push(`<circle cx="${s.x}" cy="${s.y}" r="${dr+8}" fill="${col}" opacity="${(0.06 * hp).toFixed(3)}" pointer-events="none"/>`);
        parts.push(`<circle cx="${s.x}" cy="${s.y}" r="${dr+4}" fill="none" stroke="${col}" stroke-width="0.9" opacity="${(0.4 * hp).toFixed(3)}" pointer-events="none"/>`);
      }
      parts.push(`<circle cx="${s.x}" cy="${s.y}" r="${dr}" fill="${col}" opacity="${op * (isSel || isHov ? 1 : 0.72)}" pointer-events="none"/>`);

      const ly    = s.y + dr + 18;
      const lblOp = dimmed ? 0.08 : isHov ? 1 : 0.8;
      const sLblSize = isHov ? Math.round(15 + 21 * hp) : 15;
      const sCntSize = isHov ? Math.round(12 + 7  * hp) : 12;
      const sCntGap  = isHov ? Math.round(17 + 16 * hp) : 17;
      parts.push(`<text x="${s.x}" y="${ly}" text-anchor="middle" fill="${isHov ? col : P.satellite}" font-size="${sLblSize}" font-family="'Orbitron', sans-serif" font-weight="700" letter-spacing="0.06em" opacity="${lblOp}" pointer-events="none">${s.div.label}</text>`);
      if (!dimmed) {
        parts.push(`<text x="${s.x}" y="${ly + sCntGap}" text-anchor="middle" fill="${P.fgMuted}" font-size="${sCntSize}" font-family="'JetBrains Mono', monospace" opacity="${isHov ? 0.85 : 0.55}" pointer-events="none">${count} agent${count !== 1 ? 's' : ''}</text>`);
      }

      /* Agent spray — selected */
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

      /* Agent spray — hovered (dots only) */
      if (isHov && hoverAgents.length > 0) {
        const n    = hoverAgents.length;
        const satR = (r + 28 + Math.max(0, (n - 5) * 3)) * (0.5 + hp * 0.5);
        hoverAgents.forEach((_ag, ai) => {
          const sa  = (ai * Math.PI * 2) / n - Math.PI / 2;
          const sx  = s.x + satR * Math.cos(sa);
          const sy  = s.y + satR * Math.sin(sa);
          const sr  = 3.5 * (0.5 + hp * 0.5);
          parts.push(`<line x1="${s.x}" y1="${s.y}" x2="${sx}" y2="${sy}" stroke="${col}" stroke-width="0.4" opacity="${(0.15 * hp).toFixed(3)}" pointer-events="none"/>`);
          parts.push(`<circle cx="${sx}" cy="${sy}" r="${sr}" fill="${col}" opacity="${(0.55 * hp).toFixed(3)}" pointer-events="none"/>`);
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
  }, [positions, subNodes, P, EC, cx, cy, rI, rO, rD, h, agents.length, divCounts,
      divAgents, hoverAgents, selectedDivision, selectedAgentIdx, hoveredDivision, hp]);

  /* ── Hover agent panel — which side to show on ── */
  const hoveredPos = hoveredDivision ? allPositions.find(p => p.div.id === hoveredDivision) : null;
  const panelOnLeft = hoveredPos ? hoveredPos.x > cx : false;
  const hoveredRingCol = hoveredPos ? P[RING_COLOR_KEY[hoveredPos.ring]] : P.primary;

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 400 }}>

      {/* Visual layer */}
      <svg
        viewBox={`0 0 ${w} ${h}`}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        dangerouslySetInnerHTML={{ __html: svgContent }}
      />

      {/* ── Dynamic hover agent panel ── */}
      <div style={{
        position: 'absolute',
        ...(panelOnLeft ? { left: 0 } : { right: 0 }),
        top: 0, bottom: 0,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: panelOnLeft ? '24px 16px 24px 20px' : '24px 20px 24px 16px',
        width: '220px',
        pointerEvents: 'none', zIndex: 10,
        opacity: hp,
        transform: panelOnLeft
          ? `translateX(${(1 - hp) * -24}px)`
          : `translateX(${(1 - hp) * 24}px)`,
      }}>
        {hoveredPos && (
          <>
            {/* Division title */}
            <p style={{
              fontFamily: "'Orbitron', sans-serif",
              fontSize: '18px', fontWeight: 800,
              letterSpacing: '0.12em', textTransform: 'uppercase',
              lineHeight: 1.15, margin: '0 0 4px 0',
              color: hoveredRingCol,
              textShadow: `0 0 24px ${hoveredRingCol}55`,
            }}>{hoveredPos.div.label}</p>
            <p style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '11px', color: P.fgMuted,
              margin: '0 0 18px 0', letterSpacing: '0.05em',
            }}>{hoverAgents.length} agent{hoverAgents.length !== 1 ? 's' : ''}</p>

            {/* Agent list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {hoverAgents.map((ag, i) => (
                <div key={ag.agent_id ?? i} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{
                    fontFamily: "'Orbitron', sans-serif",
                    fontSize: '13px', fontWeight: 700,
                    letterSpacing: '0.08em', textTransform: 'uppercase',
                    color: 'var(--color-text-primary)', lineHeight: 1.2,
                  }}>{ag.display_name}</span>
                  {ag.primary_role && (
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '10px', color: P.fgMuted, letterSpacing: '0.04em',
                    }}>{ag.primary_role}</span>
                  )}
                </div>
              ))}
              {hoverAgents.length === 0 && (
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '11px', color: P.fgFaint, fontStyle: 'italic',
                }}>no agents assigned</span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Click + hover target overlay */}
      <svg
        viewBox={`0 0 ${w} ${h}`}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        onClick={() => { onSelectDivision(null); onSelectAgent(null); }}
        onMouseLeave={() => handleDivHover(null)}
      >
        {/* Main division hit-areas — large radius, no per-node leave (outer SVG handles clear) */}
        {positions.map(p => (
          <circle
            key={p.div.id}
            cx={p.x} cy={p.y}
            r={NODE_RADIUS[p.ring] + 36}
            fill="transparent"
            style={{ cursor: 'pointer' }}
            onClick={(e) => handleDivClick(e, p.div.id)}
            onMouseEnter={(e) => { e.stopPropagation(); handleDivHover(p.div.id); }}
          />
        ))}

        {/* Satellite sub-node hit-areas */}
        {subNodes.map(s => (
          <circle
            key={s.div.id}
            cx={s.x} cy={s.y}
            r={NODE_RADIUS['satellite'] + 30}
            fill="transparent"
            style={{ cursor: 'pointer' }}
            onClick={(e) => handleDivClick(e, s.div.id)}
            onMouseEnter={(e) => { e.stopPropagation(); handleDivHover(s.div.id); }}
          />
        ))}

        {/* Agent satellite hit-areas */}
        {agentSatellites.map(s => (
          <circle
            key={`sat-${s.idx}`}
            cx={s.x} cy={s.y}
            r={20}
            fill="transparent"
            style={{ cursor: 'pointer' }}
            onClick={(e) => handleAgentClick(e, s.idx)}
          />
        ))}

        {/* Hover spray hit-areas (keeps hover live while cursor is over an agent dot) */}
        {hoverSatellites.map(s => (
          <circle
            key={`hsat-${s.idx}`}
            cx={s.x} cy={s.y}
            r={18}
            fill="transparent"
            style={{ cursor: 'default' }}
            onMouseEnter={(e) => { e.stopPropagation(); handleDivHover(hoveredDivision); }}
          />
        ))}
      </svg>

    </div>
  );
}
