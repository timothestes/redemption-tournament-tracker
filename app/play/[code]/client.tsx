'use client';

import { useEffect, useRef, useState } from 'react';
import { useSpacetimeConnection } from '@/app/play/hooks/useSpacetimeConnection';
import { SpacetimeProvider } from '@/app/play/lib/spacetimedb-provider';
import { useGameState } from '@/app/play/hooks/useGameState';
import { useSpacetimeDB } from 'spacetimedb/react';

// ---------------------------------------------------------------------------
// Session storage key for lobby-provided game params
// ---------------------------------------------------------------------------
const SESSION_KEY_PREFIX = 'stdb_game_params_';

interface GameParams {
  role: 'create' | 'join';
  deckId: string;
  displayName: string;
  supabaseUserId: string;
  deckData: string;
  format?: string;
}

// ---------------------------------------------------------------------------
// Public props
// ---------------------------------------------------------------------------
interface GameClientProps {
  code: string;
}

// ---------------------------------------------------------------------------
// Outer component — owns the connection builder and wraps the provider
// ---------------------------------------------------------------------------
export function GameClient({ code }: GameClientProps) {
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
      <GameInner code={code} isConnected={isConnected} />
    </SpacetimeProvider>
  );
}

// ---------------------------------------------------------------------------
// Inner component — must live inside SpacetimeProvider to use SpacetimeDB hooks
// ---------------------------------------------------------------------------
type LifecycleState = 'creating' | 'joining' | 'waiting' | 'playing' | 'finished' | 'error';

interface GameInnerProps {
  code: string;
  isConnected: boolean;
}

function GameInner({ code, isConnected }: GameInnerProps) {
  const { conn } = useSpacetimeDB() as any;

  const [lifecycle, setLifecycle] = useState<LifecycleState>('creating');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [gameId, setGameId] = useState<bigint | null>(null);
  const didCallReducer = useRef(false);

  // Read session storage params set by the lobby page
  const [gameParams] = useState<GameParams | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = sessionStorage.getItem(`${SESSION_KEY_PREFIX}${code}`);
      return raw ? (JSON.parse(raw) as GameParams) : null;
    } catch {
      return null;
    }
  });

  // Once connected, call the appropriate reducer once
  useEffect(() => {
    if (!isConnected || !conn || didCallReducer.current) return;
    didCallReducer.current = true;

    if (!gameParams) {
      setErrorMessage('No game parameters found. Please return to the lobby.');
      setLifecycle('error');
      return;
    }

    try {
      if (gameParams.role === 'create') {
        setLifecycle('creating');
        conn.reducers.createGame({
          deckId: gameParams.deckId,
          displayName: gameParams.displayName,
          format: gameParams.format ?? 'standard',
          supabaseUserId: gameParams.supabaseUserId,
          deckData: gameParams.deckData,
        });
        // Transition to waiting — the game row will appear via subscription
        setLifecycle('waiting');
      } else {
        setLifecycle('joining');
        conn.reducers.joinGame({
          code,
          deckId: gameParams.deckId,
          displayName: gameParams.displayName,
          supabaseUserId: gameParams.supabaseUserId,
          deckData: gameParams.deckData,
        });
      }
    } catch (e: unknown) {
      setErrorMessage(e instanceof Error ? e.message : 'Failed to initialize game');
      setLifecycle('error');
    }
  }, [isConnected, conn, code, gameParams]);

  // Derive gameId once we have a connection — use the code index to find it
  // useGameState requires a gameId; we pass 0n until we know the real one
  const resolvedGameId = gameId ?? BigInt(0);
  const gameState = useGameState(resolvedGameId);

  // Sync lifecycle state from live game data
  useEffect(() => {
    const { game } = gameState;
    if (!game) return;

    // Capture the real gameId from the first matching game row
    if (gameId === null && game.code === code) {
      setGameId(game.id);
    }

    if (game.status === 'waiting') {
      setLifecycle('waiting');
    } else if (game.status === 'playing') {
      setLifecycle('playing');
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

  if (lifecycle === 'creating' || lifecycle === 'joining' || !isConnected) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto" />
          <p className="text-sm text-muted-foreground">Connecting...</p>
        </div>
      </div>
    );
  }

  if (lifecycle === 'waiting') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Game code</p>
          <p className="font-mono text-5xl font-bold tracking-wider text-foreground">{code}</p>
          <p className="mt-6 text-sm text-muted-foreground">Waiting for opponent to join...</p>
          <div className="mt-4 flex justify-center gap-1">
            <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-primary" />
          </div>
        </div>
      </div>
    );
  }

  if (lifecycle === 'playing' && gameState.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto" />
          <p className="text-sm text-muted-foreground">Game starting...</p>
        </div>
      </div>
    );
  }

  if (lifecycle === 'finished') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-lg font-semibold text-foreground">Game over</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Souls rescued — You: {gameState.soulsRescued.me} / Opponent: {gameState.soulsRescued.opponent}
          </p>
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

  // lifecycle === 'playing' — game canvas placeholder (Task 14)
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="rounded-lg border border-border p-8 text-center">
        <p className="font-mono text-xs text-muted-foreground mb-1">Code: {code}</p>
        <p className="text-sm text-foreground">Game in progress - Canvas coming in Task 14</p>
      </div>
    </div>
  );
}
