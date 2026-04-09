'use client';

import { useState, useEffect, useRef } from 'react';
import { useTable, useSpacetimeDB } from 'spacetimedb/react';
import { tables } from '@/lib/spacetimedb/module_bindings';
import type { Game } from '@/lib/spacetimedb/module_bindings/types';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface LobbyListProps {
  selectedDeckId: string | null;
  joiningCode: string | null;
  onJoinGame: (code: string) => void;
}

export function LobbyList({ selectedDeckId, joiningCode, onJoinGame }: LobbyListProps) {
  // Follow existing codebase pattern: useSpacetimeDB() returns a context object,
  // not the connection directly. Use .getConnection() to get the actual DbConnection.
  const spacetimeCtx = useSpacetimeDB() as any;
  const conn = spacetimeCtx?.getConnection?.() ?? null;

  // Note: subscribeApplied is unreliable when the subscription returns no rows
  // (it may never flip to true). Don't gate rendering on it.
  const [games] = useTable(tables.Game) as [Game[], boolean];
  const [now, setNow] = useState(Date.now());
  const didSubscribe = useRef(false);

  // Subscribe to waiting public games — re-subscribe when connection changes
  // (e.g., after tab regains focus and WebSocket reconnects)
  useEffect(() => {
    if (!conn) {
      didSubscribe.current = false;
      return;
    }
    if (didSubscribe.current) return;
    didSubscribe.current = true;
    try {
      conn.subscriptionBuilder().subscribe([
        "SELECT * FROM game WHERE status = 'waiting' AND is_public = true",
      ]);
    } catch (e) {
      console.error('Lobby subscription failed:', e);
    }
  }, [conn]);

  // Update relative timestamps every 15 seconds + force refresh on tab focus
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 15_000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        setNow(Date.now());
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // Client-side filter as safety net (subscription already filters server-side)
  // Sort newest first so freshest games appear at top
  const openGames = (games || [])
    .filter((g) => g.status === 'waiting' && g.isPublic)
    .sort((a, b) => {
      const aTime = Number(a.createdAt.microsSinceUnixEpoch);
      const bTime = Number(b.createdAt.microsSinceUnixEpoch);
      return bTime - aTime;
    });

  if (!conn) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        Connecting to lobby...
      </div>
    );
  }

  if (openGames.length === 0) {
    return (
      <div className="py-6 text-center">
        <p className="text-sm text-muted-foreground">
          No open games right now.
        </p>
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
              disabled={!selectedDeckId || joiningCode !== null}
              className="shrink-0"
            >
              {joiningCode === game.code ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Join'
              )}
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
