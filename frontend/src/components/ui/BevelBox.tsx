import { type ReactNode, type ElementType } from 'react';

// ── Clip-path presets ────────────────────────────────────────────────────────

/** Standard 8px 45° chamfer on all four corners. */
export const BEVEL_CLIP =
  'polygon(8px 0%, calc(100% - 8px) 0%, 100% 8px, 100% calc(100% - 8px), calc(100% - 8px) 100%, 8px 100%, 0% calc(100% - 8px), 0% 8px)';

/**
 * Three-corner chamfer — top-left is a hard 90° joint.
 * Use when a tab or adjacent element connects flush to the top-left corner
 * (e.g. EngineSlotCard sitting below a tab bar where the active tab has no gap).
 */
export const BEVEL_NO_TL =
  'polygon(0 0, calc(100% - 8px) 0%, 100% 8px, 100% calc(100% - 8px), calc(100% - 8px) 100%, 8px 100%, 0% calc(100% - 8px))';

// ── Corner highlight geometry ────────────────────────────────────────────────
//
// Each entry covers a 10 × 10 px area at one corner.  The clip-path selects
// only the thin ~1 px diagonal strip that runs along the chamfer cut, leaving
// the rest of the area transparent.  The result is a subtle white glint that
// reads as a lit edge — visible only at the four bevel diagonals.

const CORNER_CLIPS: { pos: string; clip: string }[] = [
  { pos: 'top-[1px] left-[1px]',    clip: 'polygon(75% 0%, 85% 0%, 0% 85%, 0% 75%)' },
  { pos: 'top-[1px] right-[1px]',   clip: 'polygon(15% 0%, 25% 0%, 100% 75%, 100% 85%)' },
  { pos: 'bottom-[1px] right-[1px]',clip: 'polygon(100% 15%, 100% 25%, 25% 100%, 15% 100%)' },
  { pos: 'bottom-[1px] left-[1px]', clip: 'polygon(0% 15%, 0% 25%, 75% 100%, 85% 100%)' },
];

// ── Component ────────────────────────────────────────────────────────────────

interface BevelBoxProps {
  children: ReactNode;
  /** Classes applied to the inner content div (bg-*, p-*, text-*, etc.). */
  className?: string;
  /** Extra classes on the outermost wrapper div. */
  wrapperClassName?: string;
  /** Click handler — adds cursor-pointer to the wrapper. */
  onClick?: () => void;
  /**
   * When true the border layer transitions from the default subtle colour to
   * a gold tint on hover, matching the project-card hover convention.
   */
  hoverBorder?: boolean;
  /**
   * Override the clip-path polygon.  Defaults to BEVEL_CLIP (all four corners).
   * Pass BEVEL_NO_TL for a hard top-left joint.
   */
  bevel?: string;
  /** Render as a different HTML element (defaults to "div"). */
  as?: ElementType;
  /** Extra inline styles on the inner content div. */
  style?: React.CSSProperties;
  /** Ref forwarding is not supported — use a wrapper if needed. */
  ref?: never;
}

export function BevelBox({
  children,
  className = '',
  wrapperClassName = '',
  onClick,
  hoverBorder = false,
  bevel = BEVEL_CLIP,
  as: Tag = 'div',
  style,
}: BevelBoxProps) {
  return (
    <Tag
      className={`group relative ${onClick ? 'cursor-pointer' : ''} ${wrapperClassName}`}
      onClick={onClick}
    >
      {/* ── Border layer ──────────────────────────────────────────────────────
          Absolutely fills the outer div, clipped to the chamfer shape.
          Provides the 2 px perimeter border (the content div sits 2 px inside).
          hoverBorder wires the Tailwind group-hover class for gold highlight.  */}
      <div
        className={[
          'absolute inset-0 pointer-events-none transition-colors',
          hoverBorder
            ? 'bg-[var(--color-border-subtle)] group-hover:bg-[var(--color-gold-500)]/40'
            : 'bg-[var(--color-border-subtle)]',
        ].join(' ')}
        style={{ clipPath: bevel }}
      />

      {/* ── Corner highlight lines ────────────────────────────────────────────
          Four 10 × 10 px absolute divs, one per corner.  Each is clipped to
          a narrow parallelogram aligned with the 45° bevel diagonal.
          White at 30 % opacity — a subtle glint, not a bright stripe.         */}
      {CORNER_CLIPS.map(({ pos, clip }) => (
        <div
          key={pos}
          className={`absolute w-[10px] h-[10px] bg-white/30 pointer-events-none ${pos}`}
          style={{ clipPath: clip }}
        />
      ))}

      {/* ── Content layer ─────────────────────────────────────────────────────
          2 px margin exposes the border layer (and corner highlights) on all
          edges, including the diagonal bevel cuts.                            */}
      <div
        className={`relative ${className}`}
        style={{ clipPath: bevel, margin: '2px', ...style }}
      >
        {children}
      </div>
    </Tag>
  );
}
