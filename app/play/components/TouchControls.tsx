'use client';

import React from 'react';
import { ChevronLeft, ChevronRight, LayoutList } from 'lucide-react';
import type { JumpTarget, JumpTargetId } from '@/app/play/lib/jumpTargets';

interface TouchControlsProps {
  targets: JumpTarget[];
  onJump: (target: JumpTarget) => void;
  activeId: JumpTargetId | null;
  /** Screen-px distance from the container's right edge to the sidebar's left
   *  edge, so the cluster clears the pile rail on every layout profile — the
   *  old hardcoded 10% only matched the compact profile's sidebar ratio. */
  rightOffsetPx?: number;
  /** True when the board is wider than the viewport at the current zoom, i.e.
   *  there is somewhere to pan TO. */
  canPanHorizontally?: boolean;
  onPanHorizontal?: (direction: -1 | 1) => void;
  /** Opens the board browse sheet (every card in a zone, as a readable list). */
  onBrowseBoard?: () => void;
  /** Vertical clearance for the turn bar. The player shell overlays the bar on
   *  the canvas (default 48); the spectator shell gives the bar its own row,
   *  so the canvas starts below it already — pass 0 there. */
  topOffsetPx?: number;
}

const BTN =
  'flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md px-3 ' +
  'text-[13px] font-medium disabled:opacity-40';

/**
 * Camera cluster. Every button clears 44x44 (WCAG 2.5.5 / Apple HIG) --
 * unlike GameToolbar, which is sized for a mouse.
 *
 * Shown on every touch device, not only while zoomed. It used to unmount at
 * zoom 1, which made "Fit" a one-way trip: pressing it took the jump buttons
 * away with it and the only route back was a pinch.
 *
 * The second row is the answer to "I can never see the right-hand side of the
 * opponent's board". A side jump fills the viewport on the height axis, and a
 * side spans the whole board width, so roughly half of it is off-screen by
 * construction. Panning there needs bare board to grab, and a busy territory
 * has none — so the pan gets an explicit, always-hittable control.
 */
export function TouchControls({
  targets, onJump, activeId, rightOffsetPx,
  canPanHorizontally, onPanHorizontal, onBrowseBoard, topOffsetPx,
}: TouchControlsProps) {
  return (
    <div
      // Docked below the turn bar at the RIGHT end of the play area, clear of
      // the sidebar rail. It sits over the right end of the opponent's
      // LoB band — souls auto-arrange from the LEFT, so that end is the last
      // to fill. Left-docked it sat exactly on the first souls and made them
      // untappable at fit (rescue acceptance run); the bar overlays the top
      // 48px on touch, so a right-side dock no longer collides with Concede.
      className="pointer-events-auto absolute z-30 flex flex-col items-end gap-1"
      style={{
        top: `calc(${topOffsetPx ?? 48}px + env(safe-area-inset-top))`,
        right: rightOffsetPx != null ? Math.max(8, Math.round(rightOffsetPx)) : 'calc(10% + 8px)',
      }}
      data-testid="touch-controls"
    >
      <div className="flex flex-row gap-1 rounded-lg border border-neutral-700 bg-neutral-900/90 p-1 backdrop-blur">
        {targets.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={!t.rect}
            onClick={() => t.rect && onJump(t)}
            data-testid={`jump-${t.id}`}
            aria-label={`Jump camera to ${t.label}`}
            aria-pressed={activeId === t.id}
            className={
              BTN + ' ' +
              (activeId === t.id
                ? 'bg-neutral-700 text-neutral-50'
                : 'text-neutral-300 active:bg-neutral-800')
            }
          >
            {t.label}
          </button>
        ))}
        {onBrowseBoard && (
          <button
            type="button"
            onClick={onBrowseBoard}
            data-testid="browse-board"
            aria-label="Browse the cards on the board"
            className={BTN + ' border-l border-neutral-700 text-neutral-300 active:bg-neutral-800'}
          >
            <LayoutList size={18} />
          </button>
        )}
      </div>

      {canPanHorizontally && onPanHorizontal && (
        <div
          className="flex flex-row gap-1 rounded-lg border border-neutral-700 bg-neutral-900/90 p-1 backdrop-blur"
          data-testid="touch-pan-controls"
        >
          <button
            type="button"
            onClick={() => onPanHorizontal(-1)}
            data-testid="pan-left"
            aria-label="Pan left"
            className={BTN + ' text-neutral-300 active:bg-neutral-800'}
          >
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            onClick={() => onPanHorizontal(1)}
            data-testid="pan-right"
            aria-label="Pan right"
            className={BTN + ' text-neutral-300 active:bg-neutral-800'}
          >
            <ChevronRight size={20} />
          </button>
        </div>
      )}
    </div>
  );
}
