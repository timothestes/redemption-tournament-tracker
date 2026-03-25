'use client';

import { useState, useEffect } from 'react';
import { useTable, useSpacetimeDB } from 'spacetimedb/react';
import { tables } from '@/lib/spacetimedb/module_bindings';
import type { Game } from '@/lib/spacetimedb/module_bindings/types';
import { Button } from '@/components/ui/button';

type GameRow = Game;

interface LobbyListProps {
  selectedDeckId: string | null;
  onJoinGame: (code: string) => void;
  onSwitchToCreate: () => void;
}

export function LobbyList({ selectedDeckId, onJoinGame, onSwitchToCreate }: LobbyListProps) {
  // Follow existing codebase pattern: useSpacetimeDB() returns a context object,
  // not the connection directly. Use .getConnection() to get the actual DbConnection.
  const spacetimeCtx = useSpacetimeDB() as any;
  const conn = spacetimeCtx?.getConnection?.() ?? null;

  // useTable returns [rows, subscribeApplied] where subscribeApplied=true means data is ready
  const [games, subscribeApplied] = useTable(tables.Game) as [GameRow[], boolean];
  const [now, setNow] = useState(Date.now());

  // Subscribe to waiting public games on mount
  useEffect(() => {
    if (!conn) return;
    try {
      conn.subscriptionBuilder().subscribe([
        "SELECT * FROM game WHERE status = 'waiting' AND is_public = true",
      ]);
    } catch (e) {
      console.error('Lobby subscription failed:', e);
    }
  }, [conn]);

  // Update relative timestamps every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  // Client-side filter as safety net (subscription already filters server-side)
  const openGames = (games || []).filter(
    (g) => g.status === 'waiting' && g.isPublic
  );

  if (!subscribeApplied) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        Connecting to lobby...
      </div>
    );
  }

  if (openGames.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-muted-foreground mb-3">
          No open games right now.
        </p>
        <Button variant="outline" size="sm" onClick={onSwitchToCreate}>
          Create one
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {openGames.map((game) => {
        const createdAt = new Date(
          Number(game.createdAt.microsSinceUnixEpoch / BigInt(1000))
        );
        const minutesAgo = Math.max(
          0,
          Math.floor((now - createdAt.getTime()) / 60_000)
        );
        const timeLabel =
          minutesAgo < 1 ? 'Just now' : `${minutesAgo} min ago`;

        return (
          <div
            key={game.code}
            className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
          >
            <div className="flex flex-col gap-0.5 min-w-0 flex-1 mr-3">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm truncate">
                  {game.createdByName || 'Unknown'}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {game.format}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  · {timeLabel}
                </span>
              </div>
              {game.lobbyMessage && (
                <p className="text-xs text-muted-foreground truncate">
                  {game.lobbyMessage}
                </p>
              )}
            </div>
            <Button
              size="sm"
              onClick={() => onJoinGame(game.code)}
              disabled={!selectedDeckId}
              className="shrink-0"
            >
              Join
            </Button>
          </div>
        );
      })}
      {!selectedDeckId && (
        <p className="text-xs text-muted-foreground text-center mt-1">
          Select a deck to join a game
        </p>
      )}
    </div>
  );
}
