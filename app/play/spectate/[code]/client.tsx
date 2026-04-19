'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSpacetimeConnection } from '@/app/play/hooks/useSpacetimeConnection';
import { SpacetimeProvider } from '@/app/play/lib/spacetimedb-provider';
import { useGameState } from '@/app/play/hooks/useGameState';
import { SpectatorBar } from '@/app/play/components/SpectatorBar';
import { useSpacetimeDB } from 'spacetimedb/react';

// Konva requires browser APIs — lazy-load to avoid SSR issues
const MultiplayerCanvas = dynamic(
  () => import('@/app/play/components/MultiplayerCanvas'),
  { ssr: false },
);

// ---------------------------------------------------------------------------
// Public props
// ---------------------------------------------------------------------------
interface SpectatorClientProps {
  code: string;
}

// ---------------------------------------------------------------------------
// Outer component — owns the connection builder and wraps the provider
// ---------------------------------------------------------------------------
export function SpectatorClient({ code }: SpectatorClientProps) {
  const { connectionBuilder, isConnected, error } = useSpacetimeConnection();

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <p className="text-lg font-semibold text-destructive">Connection error</p>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <a
            href="/play"
            className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Back to lobby
          </a>
        </div>
      </div>
    );
  }

  return (
    <SpacetimeProvider connectionBuilder={connectionBuilder}>
      <SpectatorInner code={code} isConnected={isConnected} />
    </SpacetimeProvider>
  );
}

// ---------------------------------------------------------------------------
// Inner component — must live inside SpacetimeProvider to use SpacetimeDB hooks
// ---------------------------------------------------------------------------
type LifecycleState = 'joining' | 'watching' | 'finished' | 'error';

interface SpectatorInnerProps {
  code: string;
  isConnected: boolean;
}

function SpectatorInner({ code, isConnected }: SpectatorInnerProps) {
  const { conn } = useSpacetimeDB() as any;

  const [lifecycle, setLifecycle] = useState<LifecycleState>('joining');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [gameId, setGameId] = useState<bigint | null>(null);
  const didCallReducer = useRef(false);

  // Once connected, call joinAsSpectator once
  useEffect(() => {
    if (!isConnected || !conn || didCallReducer.current) return;
    didCallReducer.current = true;

    try {
      conn.reducers.joinAsSpectator({
        code,
        displayName: 'Spectator',
      });
    } catch (e: unknown) {
      setErrorMessage(e instanceof Error ? e.message : 'Failed to join as spectator');
      setLifecycle('error');
    }
  }, [isConnected, conn, code]);

  // Derive gameId and lifecycle from live game data
  const resolvedGameId = gameId ?? BigInt(0);
  const gameState = useGameState(resolvedGameId);

  useEffect(() => {
    const { game } = gameState;
    if (!game) return;

    if (gameId === null && game.code === code) {
      setGameId(game.id);
    }

    if (game.status === 'playing' || game.status === 'waiting') {
      setLifecycle('watching');
    } else if (game.status === 'finished') {
      setLifecycle('finished');
    }
  }, [gameState, code, gameId]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (lifecycle === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <p className="text-lg font-semibold text-destructive">Error</p>
          <p className="mt-2 text-sm text-muted-foreground">{errorMessage ?? 'An unexpected error occurred.'}</p>
          <a
            href="/play"
            className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Back to lobby
          </a>
        </div>
      </div>
    );
  }

  if (lifecycle === 'joining' || !isConnected) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto" />
          <p className="text-sm text-muted-foreground">Joining as spectator...</p>
        </div>
      </div>
    );
  }

  if (lifecycle === 'finished') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-lg font-semibold text-foreground">Game over</p>
          <p className="mt-1 text-sm text-muted-foreground">This game has ended.</p>
          <a
            href="/play"
            className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Back to lobby
          </a>
        </div>
      </div>
    );
  }

  // lifecycle === 'watching' — render the canvas with a read-only overlay
  const spectatorCount = gameState.spectators.length;

  return (
    <div className="h-screen w-screen overflow-hidden bg-background">
      <SpectatorBar code={code} spectatorCount={spectatorCount} />

      {/* Canvas area — offset top to account for the spectator bar */}
      <div className="pt-10 h-full w-full relative">
        {gameId !== null && (
          <>
            <MultiplayerCanvas gameId={gameId} />

            {/* Read-only overlay — intercepts all pointer events on the canvas */}
            <div
              className="absolute inset-0 z-40 cursor-not-allowed"
              aria-label="Spectator mode — read only"
              onContextMenu={(e) => e.preventDefault()}
            />
          </>
        )}

        {gameId === null && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto" />
              <p className="text-sm text-muted-foreground">Loading game state...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
