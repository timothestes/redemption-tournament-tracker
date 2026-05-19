'use client';

import { useState } from 'react';
import { useSpacetimeDB } from 'spacetimedb/react';

interface SpectatorBarProps {
  code: string;
  spectatorCount: number;
  gameId: bigint;
}

export function SpectatorBar({ code, spectatorCount, gameId }: SpectatorBarProps) {
  const spacetimeCtx = useSpacetimeDB() as any;
  const conn = spacetimeCtx?.getConnection?.() ?? null;
  const [cooldownUntil, setCooldownUntil] = useState<number>(0);
  const isCooling = Date.now() < cooldownUntil;

  const onRequest = () => {
    if (isCooling) return;
    conn?.reducers.requestSpectatorHandReveal({ gameId });
    setCooldownUntil(Date.now() + 30_000);
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between bg-background/90 backdrop-blur border-b border-border px-4 py-2 text-sm">
      <span className="font-medium text-foreground">
        Spectating Game{' '}
        <span className="font-mono tracking-wider text-primary">{code}</span>
      </span>
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground">
          {spectatorCount} {spectatorCount === 1 ? 'spectator' : 'spectators'}
        </span>
        <button
          onClick={onRequest}
          disabled={isCooling}
          className="rounded px-3 py-1 text-xs font-medium border border-border bg-background hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isCooling ? 'Request sent' : 'Request hands'}
        </button>
      </div>
    </div>
  );
}
