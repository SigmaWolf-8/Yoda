import type React from 'react';

/* ── Skeleton primitives ── */

function Pulse({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`animate-pulse rounded bg-[var(--color-surface-tertiary)] ${className ?? ''}`}
      style={style}
    />
  );
}

/* ── Card skeleton (project cards, engine cards) ── */

export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)] p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Pulse className="w-16 h-4" />
        <Pulse className="w-10 h-4 rounded-full" />
      </div>
      <Pulse className="w-3/4 h-3" />
      <Pulse className="w-1/2 h-3" />
      <div className="flex gap-2">
        <Pulse className="w-20 h-3" />
        <Pulse className="w-16 h-3" />
      </div>
    </div>
  );
}

/* ── Row skeleton (table rows, list items) ── */

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Pulse className="w-4 h-4 rounded-full" />
      <Pulse className="flex-1 h-3" />
      <Pulse className="w-20 h-3" />
      <Pulse className="w-12 h-3" />
    </div>
  );
}

/* ── Text block skeleton (content panels) ── */

export function SkeletonText({ lines = 4 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <Pulse
          key={i}
          className="h-3"
          style={{ width: `${70 + Math.random() * 30}%` } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

/* ── Grid of card skeletons ── */

export function SkeletonCardGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

/* ── Page-level skeleton (header + content) ── */

export function SkeletonPage() {
  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto animate-fade-in space-y-6">
      <div className="flex items-center gap-3">
        <Pulse className="w-5 h-5 rounded" />
        <Pulse className="w-40 h-7" />
      </div>
      <Pulse className="w-64 h-4" />
      <SkeletonCardGrid count={3} />
    </div>
  );
}
