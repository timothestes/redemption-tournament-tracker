'use client';

import React from 'react';
import { RotateCcw } from 'lucide-react';

/**
 * Portrait gate for phones. A real portrait layout is a separate project
 * (zone tabs, one territory at a time); until then a clear prompt beats a
 * board rendered at 6x8px cards.
 */
export function RotateDevicePrompt() {
  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col items-center justify-center
                 gap-4 bg-neutral-950 px-8 text-center"
      data-testid="rotate-device-prompt"
    >
      <RotateCcw className="h-12 w-12 text-neutral-400" aria-hidden />
      <h1 className="text-xl font-semibold text-neutral-100">Rotate your device</h1>
      <p className="max-w-xs text-sm text-neutral-400">
        Redemption plays in landscape &mdash; there isn&apos;t enough width in
        portrait to show both sides of the board.
      </p>
    </div>
  );
}
