'use client';

import React from 'react';
import type { JumpTarget, JumpTargetId } from '@/app/play/lib/jumpTargets';

interface TouchControlsProps {
  targets: JumpTarget[];
  onJump: (target: JumpTarget) => void;
  activeId: JumpTargetId | null;
}

/**
 * Camera jump cluster. Every button clears 44x44 (WCAG 2.5.5 / Apple HIG) --
 * unlike GameToolbar, which is sized for a mouse.
 */
export function TouchControls({ targets, onJump, activeId }: TouchControlsProps) {
  return (
    <div
      // Docked below the turn bar at the RIGHT end of the play area, clear of
      // the 10% sidebar rail. It sits over the right end of the opponent's
      // LoB band — souls auto-arrange from the LEFT, so that end is the last
      // to fill. Left-docked it sat exactly on the first souls and made them
      // untappable at fit (rescue acceptance run); the bar overlays the top
      // 48px on touch, so a right-side dock no longer collides with Concede.
      // Vertically it stays a single row so it cannot eat half a 393px
      // viewport.
      className="pointer-events-auto absolute z-30 flex flex-row gap-1
                 rounded-lg border border-neutral-700 bg-neutral-900/90 p-1 backdrop-blur"
      style={{
        top: 'calc(48px + env(safe-area-inset-top))',
        right: 'calc(10% + 8px)',
      }}
      data-testid="touch-controls"
    >
      {targets.map((t) => (
        <button
          key={t.id}
          type="button"
          disabled={!t.rect}
          onClick={() => t.rect && onJump(t)}
          data-testid={`jump-${t.id}`}
          aria-label={`Jump camera to ${t.label}`}
          className={
            'min-h-[44px] min-w-[44px] rounded-md px-3 text-[13px] font-medium ' +
            'disabled:opacity-40 ' +
            (activeId === t.id
              ? 'bg-neutral-700 text-neutral-50'
              : 'text-neutral-300 active:bg-neutral-800')
          }
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
