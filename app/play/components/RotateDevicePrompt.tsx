'use client';

import React from 'react';
import { RotateCcw } from 'lucide-react';

interface RotateDevicePromptProps {
  /** Dismiss the gate and render the board anyway. Rotation lock is common,
   *  and a live game must never be unreachable. */
  onContinueAnyway: () => void;
  /** Route back to the lobby. The gate replaces the whole shell, including
   *  the turn bar that normally owns Back and Concede, so without this a
   *  player could be stuck watching their clock run down. */
  lobbyHref: string;
}

/**
 * Portrait gate for phones. A real portrait layout is a separate project
 * (zone tabs, one territory at a time); until then a clear prompt beats a
 * board rendered at 6x8px cards.
 *
 * It is deliberately an ESCAPABLE gate, not a wall: this replaces the entire
 * game shell, so a player with rotation lock on, or in iPad Split View, would
 * otherwise have no way to concede or leave a live game.
 */
export function RotateDevicePrompt({ onContinueAnyway, lobbyHref }: RotateDevicePromptProps) {
  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col items-center justify-center
                 gap-4 bg-neutral-950 px-8 text-center"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
      data-testid="rotate-device-prompt"
    >
      <RotateCcw className="h-12 w-12 text-neutral-400" aria-hidden />
      <h1 className="text-xl font-semibold text-neutral-100">Rotate your device</h1>
      <p className="max-w-xs text-sm text-neutral-400">
        Redemption plays in landscape &mdash; there isn&apos;t enough width in
        portrait to show both sides of the board.
      </p>

      <div className="mt-2 flex flex-col items-stretch gap-2">
        <button
          type="button"
          onClick={onContinueAnyway}
          data-testid="rotate-continue-anyway"
          className="min-h-[44px] rounded-lg border border-neutral-600 bg-neutral-800
                     px-5 text-[15px] font-medium text-neutral-100 active:bg-neutral-700"
        >
          Continue anyway
        </button>
        <a
          href={lobbyHref}
          data-testid="rotate-back-to-lobby"
          className="flex min-h-[44px] items-center justify-center rounded-lg px-5
                     text-[15px] text-neutral-400 active:text-neutral-100"
        >
          Back to lobby
        </a>
      </div>
    </div>
  );
}
