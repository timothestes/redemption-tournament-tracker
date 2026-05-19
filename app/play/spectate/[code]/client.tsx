'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useSpacetimeConnection } from '@/app/play/hooks/useSpacetimeConnection';
import { SpacetimeProvider } from '@/app/play/lib/spacetimedb-provider';
import { useSpectatorGameState } from '@/app/play/hooks/useGameState';
import { SpectatorBar } from '@/app/play/components/SpectatorBar';
import { SpectatorPregameView } from '@/app/play/components/PregameScreen';
import { useSpacetimeDB } from 'spacetimedb/react';
import { showGameToast } from '@/app/shared/components/GameToast';

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
  displayName: string;
}

// ---------------------------------------------------------------------------
// Outer component — owns the connection builder and wraps the provider
// ---------------------------------------------------------------------------
export function SpectatorClient({ code, displayName }: SpectatorClientProps) {
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
      <SpectatorInner code={code} isConnected={isConnected} displayName={displayName} />
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
  displayName: string;
}

function SpectatorInner({ code, isConnected, displayName }: SpectatorInnerProps) {
  const spacetimeCtx = useSpacetimeDB() as any;
  const conn = spacetimeCtx?.getConnection?.() ?? null;
  const myIdentityHex: string | undefined = spacetimeCtx?.identity?.toHexString?.();
  const router = useRouter();

  const [lifecycle, setLifecycle] = useState<LifecycleState>('joining');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [gameId, setGameId] = useState<bigint | null>(null);
  const didSubscribe = useRef(false);
  const didCallReducer = useRef(false);
  const wasWatching = useRef(false);

  // Phase 1: Seed subscriptions for tables that don't auto-subscribe via
  // typed .where() queries (Game and CardCounter). Mirrors the player
  // client's phase-1 SQL subscription pattern in app/play/[code]/client.tsx.
  // Without this, `useTable(tables.Game)` returns empty rows and we can
  // never find the game by code.
  useEffect(() => {
    if (!isConnected || !conn || didSubscribe.current) return;
    didSubscribe.current = true;
    try {
      conn.subscriptionBuilder().subscribe([
        `SELECT * FROM game WHERE code = '${code}'`,
        `SELECT * FROM card_counter`,
      ]);
    } catch (e) {
      console.error('Failed to subscribe (spectator phase 1):', e);
    }
  }, [isConnected, conn, code]);

  // Once connected, call joinAsSpectator once
  useEffect(() => {
    if (!isConnected || !conn || didCallReducer.current) return;
    didCallReducer.current = true;

    // joinAsSpectator returns a Promise that rejects asynchronously on
    // server-side SenderError. A synchronous try/catch won't catch those
    // rejections — attach .catch() instead.
    conn.reducers.joinAsSpectator({
      code,
      displayName,
    }).catch((e: unknown) => {
      setErrorMessage(e instanceof Error ? e.message : 'Failed to join as spectator');
      setLifecycle('error');
    });
  }, [isConnected, conn, code, displayName]);

  // Leave as spectator on unmount
  useEffect(() => {
    return () => {
      if (gameId !== null && conn) {
        conn.reducers.leaveAsSpectator({ gameId });
      }
    };
  }, [gameId, conn]);

  // Derive gameId and lifecycle from live game data
  const resolvedGameId = gameId ?? BigInt(0);
  const gameState = useSpectatorGameState(resolvedGameId);

  // Resolve gameId by scanning the unfiltered `allGames` subscription — the
  // filtered `game` field is keyed by gameId, which we don't have yet.
  // Prefer non-finished rows in case the code was reused.
  useEffect(() => {
    const allGames = gameState.allGames ?? [];
    const game =
      allGames.find((g: any) => g.code === code && g.status !== 'finished') ??
      allGames.find((g: any) => g.code === code);
    if (!game) return;

    if (gameId === null) {
      setGameId(game.id);
    }

    if (game.status === 'playing' || game.status === 'waiting') {
      setLifecycle('watching');
    } else if (game.status === 'finished') {
      setLifecycle('finished');
    }
  }, [gameState.allGames, code, gameId]);

  // Detect kick: once we're watching, if our Spectator row disappears, redirect.
  useEffect(() => {
    if (lifecycle !== 'watching' || !gameId || !myIdentityHex) return;
    const isStillSpectator = gameState.spectators.some(
      (s: any) => s.identity?.toHexString?.() === myIdentityHex,
    );
    if (isStillSpectator) {
      wasWatching.current = true;
      return;
    }
    if (wasWatching.current) {
      showGameToast('You were removed from this game');
      router.push('/play');
    }
  }, [gameState.spectators, lifecycle, gameId, myIdentityHex, router]);

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

  // lifecycle === 'watching' — render based on game.status
  const spectatorCount = gameState.spectators.length;
  const game = (gameState.allGames ?? []).find(
    (g: any) => g.code === code && g.status !== 'finished',
  ) ?? (gameState.allGames ?? []).find((g: any) => g.code === code);
  const status = game?.status;

  return (
    <div className="h-screen w-screen overflow-hidden bg-background">
      <SpectatorBar
        code={code}
        spectatorCount={spectatorCount}
        gameId={gameId ?? 0n}
      />

      <div className="pt-10 h-full w-full relative">
        {gameId === null || !game ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto" />
              <p className="text-sm text-muted-foreground">Loading game state...</p>
            </div>
          </div>
        ) : status === 'waiting' ? (
          <div className="flex h-full items-center justify-center px-4">
            <div className="rounded-xl border border-border bg-card/95 backdrop-blur-sm p-8 sm:p-10 text-center max-w-md w-full">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-cinzel">
                Spectating
              </p>
              <h2 className="text-2xl font-bold font-cinzel mt-2">Waiting for opponent</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Game code <span className="font-mono tracking-wider text-primary">{code}</span>
              </p>
              {game.lobbyMessage && (
                <p className="mt-4 text-sm text-foreground/80 italic">"{game.lobbyMessage}"</p>
              )}
            </div>
          </div>
        ) : status === 'pregame' ? (
          <div className="flex h-full items-center justify-center px-4">
            <SpectatorPregameView game={game} />
          </div>
        ) : (
          <MultiplayerCanvas
            gameId={gameId}
            viewerKind="spectator"
            getImage={() => null}
          />
        )}
      </div>
    </div>
  );
}
