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

/* ── Palette: original MetatronsCube colors ── */

function palette(dark: boolean) {
  return {
    primary:     dark ? 'hsl(210, 80%, 55%)' : 'hsl(210, 100%, 45%)',
    primarySoft: dark ? 'hsl(210, 70%, 65%)' : 'hsl(210, 80%, 55%)',
    esoteric:    dark ? 'hsl(270, 50%, 65%)' : 'hsl(270, 50%, 55%)',
    depth:       dark ? 'hsla(210, 60%, 65%, 0.85)' : 'hsla(210, 60%, 50%, 0.85)',
    fgSoft:      dark ? 'hsl(40, 15%, 70%)' : 'hsl(220, 15%, 35%)',
    fgMuted:     dark ? 'hsl(35, 10%, 50%)' : 'hsl(220, 10%, 55%)',
    fgFaint:     dark ? 'hsl(30, 8%, 35%)' : 'hsl(220, 8%, 72%)',
    orb:         dark ? 'hsla(210, 50%, 50%, 0.06)' : 'hsla(210, 60%, 50%, 0.08)',
    glowC:       dark ? 'hsla(210, 80%, 55%, 0.12)' : 'hsla(210, 100%, 45%, 0.06)',
    glowE:       dark ? 'hsla(210, 80%, 55%, 0.03)' : 'hsla(210, 100%, 45%, 0.015)',
  };
}

type CubeRing = 'central' | 'inner' | 'outer' | 'depth';

const RING_COLOR_KEY: Record<CubeRing, 'primary' | 'primarySoft' | 'esoteric' | 'depth'> = {
  central: 'primary',
  inner:   'primarySoft',
  outer:   'esoteric',
  depth:   'depth',
};

const NODE_RADIUS: Record<CubeRing, number> = {
  central: 14,
  inner:   8,
  outer:   7,
  depth:   9,
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
  };
}

/* ── Component ── */

export function MetatronCubeRoster({
  agents, selectedDivision, selectedAgentIdx,
  onSelectDivision, onSelectAgent,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 800 });
  const [phase, setPhase] = useState(0);
  const rafRef = useRef(0);

  // Keep refs to the latest selection state so the native handler never
  // captures a stale closure.
  const selDivRef = useRef(selectedDivision);
  const selIdxRef = useRef(selectedAgentIdx);
  useEffect(() => { selDivRef.current = selectedDivision; }, [selectedDivision]);
  useEffect(() => { selIdxRef.current = selectedAgentIdx; }, [selectedAgentIdx]);

  const dark = useMemo(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }, []);

  const P = useMemo(() => palette(dark), [dark]);
  const EC = useMemo(() => edgeStyles(dark ? 1 : 0.7), [dark]);

  // Resize observer
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

  // Animation
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

  // Agent counts per division
  const divCounts = useMemo(() => {
    const m: Record<string, number> = {};
    agents.forEach(a => { m[a.division] = (m[a.division] || 0) + 1; });
    return m;
  }, [agents]);

  // Agents in selected division
  const divAgents = useMemo(() => {
    if (!selectedDivision) return [];
    return agents.filter(a => a.division === selectedDivision);
  }, [agents, selectedDivision]);

  // Compute positions
  const { w, h } = dims;
  const sz = Math.min(w, h) - 24;
  const cx = w / 2;
  const cy = h / 2;
  const rI = sz * 0.14;
  const rO = sz * 0.31;
  const rD = sz * 0.43;

  type NodePos = { div: (typeof DIVISIONS)[number]; x: number; y: number; ring: CubeRing };
  const positions: NodePos[] = useMemo(() => {
    const pos: NodePos[] = [];
    pos.push({ div: DIVISIONS[0], x: cx, y: cy, ring: 'central' });
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI * 2) / 6 + phase * 0.25;
      pos.push({ div: DIVISIONS[1 + i], x: cx + rI * Math.cos(a), y: cy + rI * Math.sin(a), ring: 'inner' });
    }
    for (let i = 0; i < 5; i++) {
      const a = (i * Math.PI * 2) / 5 + Math.PI / 10 - phase * 0.15;
      pos.push({ div: DIVISIONS[7 + i], x: cx + rO * Math.cos(a), y: cy + rO * Math.sin(a), ring: 'outer' });
    }
    pos.push({ div: DIVISIONS[12], x: cx, y: cy - rD, ring: 'depth' });
    return pos;
  }, [cx, cy, rI, rO, rD, phase]);

  const inn = positions.slice(1, 7);
  const out = positions.slice(7, 12);
  const cen = positions[0];
  const dep = positions[12];

  // Native click handler — attached directly to the SVG DOM node so that
  // React's synthetic-event delegation (which skips innerHTML children) can't
  // swallow real user clicks.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const handler = (e: MouseEvent) => {
      let hit: Element | null = null;
      let el: Element | null = e.target as Element;
      while (el && el !== svg) {
        if (el.hasAttribute('data-div') || el.hasAttribute('data-agent')) {
          hit = el;
          break;
        }
        el = el.parentElement;
      }
      if (!hit) return;

      const agentIdx = hit.getAttribute('data-agent');
      const divId    = hit.getAttribute('data-div');

      if (agentIdx !== null) {
        const idx = parseInt(agentIdx, 10);
        onSelectAgent(selIdxRef.current === idx ? null : idx);
        return;
      }
      if (divId) {
        if (selDivRef.current === divId) {
          onSelectDivision(null);
          onSelectAgent(null);
        } else {
          onSelectDivision(divId as AgentDivision);
          onSelectAgent(null);
        }
      }
    };

    svg.addEventListener('click', handler);
    return () => svg.removeEventListener('click', handler);
  // onSelectDivision / onSelectAgent are stable callbacks from the parent;
  // svgRef is stable. selDivRef/selIdxRef are always current via separate effects.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSelectDivision, onSelectAgent]);

  /* ── Build SVG content ── */

  const buildEdges = () => {
    const lines: string[] = [];
    // Central → inner
    inn.forEach(n => lines.push(`<line x1="${cen.x}" y1="${cen.y}" x2="${n.x}" y2="${n.y}" stroke="${EC.f}" stroke-width="0.9"/>`));
    // Inner ring + cross
    for (let i = 0; i < 6; i++) {
      lines.push(`<line x1="${inn[i].x}" y1="${inn[i].y}" x2="${inn[(i+1)%6].x}" y2="${inn[(i+1)%6].y}" stroke="${EC.i}" stroke-width="0.5"/>`);
      lines.push(`<line x1="${inn[i].x}" y1="${inn[i].y}" x2="${inn[(i+2)%6].x}" y2="${inn[(i+2)%6].y}" stroke="${EC.is}" stroke-width="0.4"/>`);
      lines.push(`<line x1="${inn[i].x}" y1="${inn[i].y}" x2="${inn[(i+3)%6].x}" y2="${inn[(i+3)%6].y}" stroke="${EC.io}" stroke-width="0.3"/>`);
    }
    // Outer ring + cross
    for (let i = 0; i < 5; i++) {
      lines.push(`<line x1="${out[i].x}" y1="${out[i].y}" x2="${out[(i+1)%5].x}" y2="${out[(i+1)%5].y}" stroke="${EC.o}" stroke-width="0.5"/>`);
      lines.push(`<line x1="${out[i].x}" y1="${out[i].y}" x2="${out[(i+2)%5].x}" y2="${out[(i+2)%5].y}" stroke="${EC.os}" stroke-width="0.3"/>`);
    }
    // Inner ↔ outer
    for (let i = 0; i < 5; i++) {
      lines.push(`<line x1="${inn[i].x}" y1="${inn[i].y}" x2="${out[i].x}" y2="${out[i].y}" stroke="${EC.c}" stroke-width="0.4"/>`);
      lines.push(`<line x1="${inn[i+1].x}" y1="${inn[i+1].y}" x2="${out[i].x}" y2="${out[i].y}" stroke="${EC.c}" stroke-width="0.4"/>`);
    }
    // Depth → inner
    inn.forEach(n => lines.push(`<line x1="${dep.x}" y1="${dep.y}" x2="${n.x}" y2="${n.y}" stroke="${EC.d}" stroke-width="0.4"/>`));
    return lines.join('');
  };

  const buildNodes = () => {
    const parts: string[] = [];
    positions.forEach(p => {
      const col = P[RING_COLOR_KEY[p.ring]];
      const r = NODE_RADIUS[p.ring];
      const isSel = selectedDivision === p.div.id;
      const dimmed = selectedDivision && !isSel;
      const op = dimmed ? 0.12 : 1;
      const count = divCounts[p.div.id] || 0;

      // Central breathing ring
      if (p.ring === 'central' && !dimmed) {
        parts.push(`<circle cx="${p.x}" cy="${p.y}" r="${r + 8}" fill="none" stroke="${col}" stroke-width="0.6" opacity="0.4" style="pointer-events:none"><animate attributeName="r" values="${r+6};${r+10};${r+6}" dur="4s" repeatCount="indefinite"/></circle>`);
      }

      // Selection bloom
      if (isSel) {
        parts.push(`<circle cx="${p.x}" cy="${p.y}" r="${r + 16}" fill="${col}" opacity="0.03" style="pointer-events:none"/>`);
        parts.push(`<circle cx="${p.x}" cy="${p.y}" r="${r + 8}" fill="none" stroke="${col}" stroke-width="1.3" opacity="0.5" style="pointer-events:none"/>`);
      }

      // Node circle
      parts.push(`<circle cx="${p.x}" cy="${p.y}" r="${isSel ? r + 3 : r}" fill="${col}" opacity="${op * (isSel ? 1 : 0.75)}" data-div="${p.div.id}" style="cursor:pointer"/>`);

      // Permanent label
      const ly = p.ring === 'depth' ? p.y - r - 10 : p.y + r + 15;
      const lblOp = dimmed ? 0.15 : 0.85;
      parts.push(`<text x="${p.x}" y="${ly}" text-anchor="middle" fill="${P.fgSoft}" font-size="10" font-family="'JetBrains Mono', monospace" font-weight="500" opacity="${lblOp}" style="pointer-events:none">${p.div.label}</text>`);

      // Agent count below label
      if (!dimmed) {
        const cy2 = p.ring === 'depth' ? ly - 13 : ly + 12;
        parts.push(`<text x="${p.x}" y="${cy2}" text-anchor="middle" fill="${P.fgMuted}" font-size="8" font-family="'JetBrains Mono', monospace" opacity="0.6" style="pointer-events:none">${count} agent${count !== 1 ? 's' : ''}</text>`);
      }

      // Satellite bloom when selected
      if (isSel && divAgents.length > 0) {
        const n = divAgents.length;
        const satR = r + 32 + Math.max(0, (n - 5) * 3);
        divAgents.forEach((ag, ai) => {
          const sa = (ai * Math.PI * 2) / n - Math.PI / 2;
          const sx = p.x + satR * Math.cos(sa);
          const sy = p.y + satR * Math.sin(sa);
          const isSelA = selectedAgentIdx === ai;
          const sr = isSelA ? 5.5 : 3.5;

          parts.push(`<line x1="${p.x}" y1="${p.y}" x2="${sx}" y2="${sy}" stroke="${col}" stroke-width="0.25" opacity="0.2" style="pointer-events:none"/>`);
          if (isSelA) {
            parts.push(`<circle cx="${sx}" cy="${sy}" r="${sr + 3.5}" fill="none" stroke="${col}" stroke-width="0.8" opacity="0.4" style="pointer-events:none"/>`);
            parts.push(`<text x="${sx}" y="${sy - sr - 7}" text-anchor="middle" fill="${P.fgSoft}" font-size="9" font-family="'JetBrains Mono', monospace" font-weight="500" style="pointer-events:none">${ag.display_name}</text>`);
          }
          parts.push(`<circle cx="${sx}" cy="${sy}" r="${sr}" fill="${col}" opacity="${isSelA ? 0.95 : 0.45}" data-agent="${ai}" style="cursor:pointer"/>`);
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
    const glow = `<circle cx="${cx}" cy="${cy}" r="${rD * 0.88}" fill="url(#mcgl)" style="pointer-events:none"/>`;
    const orbits = [rI + 18, rO + 18, rD].map((r, i) =>
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${P.orb}" stroke-width="0.6" ${i === 2 ? 'stroke-dasharray="3 5"' : ''} style="pointer-events:none"/>`
    ).join('');
    const shellLabels = [
      `<text x="${cx + rO + 22}" y="${cy - 10}" text-anchor="start" fill="${P.fgFaint}" font-size="8.5" font-family="'JetBrains Mono', monospace">Outer (5)</text>`,
      `<text x="${cx + rI + 18}" y="${cy + 6}" text-anchor="start" fill="${P.fgFaint}" font-size="8.5" font-family="'JetBrains Mono', monospace">Inner (6)</text>`,
    ].join('');
    const footer = `<text x="${cx}" y="${h - 10}" text-anchor="middle" fill="${P.fgFaint}" font-size="8.5" font-family="'JetBrains Mono', monospace" letter-spacing="0.5">13 divisions · 3 shells · ${agents.length} agents</text>`;

    return `${defs}${glow}${orbits}${buildEdges()}${shellLabels}${buildNodes()}${footer}`;
  }, [positions, P, EC, cx, cy, rI, rO, rD, h, agents.length, divCounts, divAgents, selectedDivision, selectedAgentIdx]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 400 }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${h}`}
        style={{ width: '100%', height: '100%', cursor: 'pointer' }}
        dangerouslySetInnerHTML={{ __html: svgContent }}
      />
    </div>
  );
}
