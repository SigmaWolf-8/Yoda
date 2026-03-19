import { useState, useMemo, useRef, useCallback } from 'react';
import { TaskNode } from './TaskNode';
import type { Task } from '../../types';

interface Props {
  tasks: Task[];
  selectedId?: string;
  onSelect: (taskId: string) => void;
}

/* ── Layout constants ── */
const NODE_W = 224;  // w-56 = 14rem = 224px
const NODE_H = 120;
const GAP_X = 60;
const GAP_Y = 40;
const PAD = 40;

/* ── Topological sort → layer assignment ── */

interface Layer {
  tasks: Task[];
  y: number;
}

function computeLayers(tasks: Task[]): { layers: Layer[]; positions: Map<string, { x: number; y: number }> } {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  // Build adjacency from dependencies
  for (const t of tasks) {
    if (!inDegree.has(t.id)) inDegree.set(t.id, 0);
    if (!adj.has(t.id)) adj.set(t.id, []);
    for (const depId of t.dependencies) {
      if (!taskMap.has(depId)) continue;
      if (!adj.has(depId)) adj.set(depId, []);
      adj.get(depId)!.push(t.id);
      inDegree.set(t.id, (inDegree.get(t.id) ?? 0) + 1);
    }
  }

  // BFS by layers (Kahn's algorithm with layer tracking)
  const layerAssign = new Map<string, number>();
  let queue = tasks.filter((t) => (inDegree.get(t.id) ?? 0) === 0).map((t) => t.id);
  let layerIdx = 0;

  while (queue.length > 0) {
    const nextQueue: string[] = [];
    for (const id of queue) {
      layerAssign.set(id, layerIdx);
      for (const succ of adj.get(id) ?? []) {
        const newDeg = (inDegree.get(succ) ?? 1) - 1;
        inDegree.set(succ, newDeg);
        if (newDeg === 0) nextQueue.push(succ);
      }
    }
    queue = nextQueue;
    layerIdx++;
  }

  // Assign any unvisited nodes (disconnected) to last layer
  for (const t of tasks) {
    if (!layerAssign.has(t.id)) {
      layerAssign.set(t.id, layerIdx);
    }
  }

  // Group into layers
  const layerGroups = new Map<number, Task[]>();
  for (const t of tasks) {
    const l = layerAssign.get(t.id) ?? 0;
    if (!layerGroups.has(l)) layerGroups.set(l, []);
    layerGroups.get(l)!.push(t);
  }

  // Sort each layer by task_number for consistency
  for (const [, group] of layerGroups) {
    group.sort((a, b) => a.task_number.localeCompare(b.task_number));
  }

  // Compute positions
  const positions = new Map<string, { x: number; y: number }>();
  const layers: Layer[] = [];
  let yOffset = PAD;

  const sortedLayerKeys = [...layerGroups.keys()].sort((a, b) => a - b);
  for (const lk of sortedLayerKeys) {
    const group = layerGroups.get(lk)!;
    const totalW = group.length * NODE_W + (group.length - 1) * GAP_X;
    let xOffset = PAD;

    layers.push({ tasks: group, y: yOffset });

    for (const t of group) {
      positions.set(t.id, { x: xOffset, y: yOffset });
      xOffset += NODE_W + GAP_X;
    }
    yOffset += NODE_H + GAP_Y;
  }

  return { layers, positions };
}

/* ── Dependency edge component ── */

function DependencyEdges({
  tasks,
  positions,
}: {
  tasks: Task[];
  positions: Map<string, { x: number; y: number }>;
}) {
  const taskSet = new Set(tasks.map((t) => t.id));

  return (
    <svg className="absolute inset-0 pointer-events-none" style={{ overflow: 'visible' }}>
      <defs>
        <marker
          id="arrowhead"
          markerWidth="6"
          markerHeight="4"
          refX="6"
          refY="2"
          orient="auto"
        >
          <polygon points="0 0, 6 2, 0 4" fill="var(--color-navy-500)" />
        </marker>
      </defs>
      {tasks.map((t) =>
        t.dependencies
          .filter((depId) => taskSet.has(depId) && positions.has(depId))
          .map((depId) => {
            const from = positions.get(depId)!;
            const to = positions.get(t.id)!;
            const x1 = from.x + NODE_W / 2;
            const y1 = from.y + NODE_H;
            const x2 = to.x + NODE_W / 2;
            const y2 = to.y;
            const midY = (y1 + y2) / 2;

            return (
              <path
                key={`${depId}-${t.id}`}
                d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                fill="none"
                stroke="var(--color-navy-600)"
                strokeWidth="1.5"
                strokeDasharray="4 3"
                markerEnd="url(#arrowhead)"
                opacity={0.5}
              />
            );
          }),
      )}
    </svg>
  );
}

/* ── Main DAGCanvas ── */

export function DAGCanvas({ tasks, selectedId, onSelect }: Props) {
  const { layers, positions } = useMemo(() => computeLayers(tasks), [tasks]);
  const containerRef = useRef<HTMLDivElement>(null);

  // Compute canvas size
  const maxX = Math.max(...[...positions.values()].map((p) => p.x), 0) + NODE_W + PAD * 2;
  const maxY = Math.max(...[...positions.values()].map((p) => p.y), 0) + NODE_H + PAD * 2;

  if (!tasks.length) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-[var(--color-text-muted)]">
        No tasks to display. Submit a query to see the DAG.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative overflow-auto h-full"
    >
      <div
        className="relative"
        style={{ minWidth: maxX, minHeight: maxY }}
      >
        {/* SVG edges */}
        <DependencyEdges tasks={tasks} positions={positions} />

        {/* Task nodes */}
        {tasks.map((t) => {
          const pos = positions.get(t.id);
          if (!pos) return null;
          return (
            <div
              key={t.id}
              className="absolute transition-all duration-300"
              style={{ left: pos.x, top: pos.y }}
            >
              <TaskNode
                task={t}
                selected={t.id === selectedId}
                onClick={() => onSelect(t.id)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
