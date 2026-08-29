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
      className="pointer-events-auto absolute right-2 top-2 z-30 flex flex-col gap-1
                 rounded-lg border border-neutral-700 bg-neutral-900/90 p-1 backdrop-blur"
      style={{ marginRight: 'env(safe-area-inset-right)' }}
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
