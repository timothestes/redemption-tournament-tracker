'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useSpacetimeConnection } from '@/app/play/hooks/useSpacetimeConnection';
import { SpacetimeProvider } from '@/app/play/lib/spacetimedb-provider';
import { useGameState } from '@/app/play/hooks/useGameState';
import { useSpacetimeDB } from 'spacetimedb/react';
import GameOverOverlay from '@/app/play/components/GameOverOverlay';
import CardPreviewPanel from '../components/CardPreviewPanel';
import ChatPanel from '../components/ChatPanel';
import type { GameCard } from '@/app/goldfish/types';

// Konva requires browser APIs — lazy-load to avoid SSR issues
const MultiplayerCanvas = dynamic(
  () => import('@/app/play/components/MultiplayerCanvas'),
  { ssr: false },
);

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
  const spacetimeCtx = useSpacetimeDB() as any;
  const conn = spacetimeCtx?.getConnection?.() ?? null;
  const isActive = spacetimeCtx?.isActive ?? false;
  const router = useRouter();

  const [lifecycle, setLifecycle] = useState<LifecycleState>('creating');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [gameId, setGameId] = useState<bigint | null>(null);
  const [hoveredCard, setHoveredCard] = useState<GameCard | null>(null);
  const didCallReducer = useRef(false);
  const didSubscribe = useRef(false);

  // Subscribe to all tables once connected
  useEffect(() => {
    if ((!isConnected && !isActive) || !conn || didSubscribe.current) return;
    didSubscribe.current = true;
    try {
      conn.subscriptionBuilder().subscribe([
        'SELECT * FROM game',
        'SELECT * FROM player',
        'SELECT * FROM card_instance',
        'SELECT * FROM card_counter',
        'SELECT * FROM game_action',
        'SELECT * FROM chat_message',
        'SELECT * FROM spectator',
        'SELECT * FROM disconnect_timeout',
      ]);
    } catch (e) {
      console.error('Failed to subscribe:', e);
    }
  }, [isConnected, isActive, conn]);

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
    if ((!isConnected && !isActive) || !conn || didCallReducer.current) return;
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
          code,
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
  }, [isConnected, isActive, conn, code, gameParams]);

  // Discover gameId by scanning all games for our code
  const gameState = useGameState(gameId ?? BigInt(0));

  // Also get raw game list to find our game by code before we know the ID
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const spacetimeCtxForGames = useSpacetimeDB() as any;

  useEffect(() => {
    if (gameId !== null) return; // Already discovered
    const { allGames } = gameState;
    if (!allGames) return;
    const found = allGames.find((g: any) => g.code === code);
    if (found) {
      setGameId(found.id);
    }
  }, [gameState.allGames, code, gameId]);

  // Sync lifecycle state from live game data
  useEffect(() => {
    const { game } = gameState;
    if (!game) return;

    if (game.status === 'waiting') {
      setLifecycle('waiting');
    } else if (game.status === 'playing') {
      setLifecycle('playing');
    } else if (game.status === 'finished') {
      setLifecycle('finished');
    }
  }, [gameState.game]);

  // Build a player name map for ChatPanel
  const playerNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (gameState.myPlayer) map[gameState.myPlayer.id.toString()] = gameState.myPlayer.displayName;
    if (gameState.opponentPlayer) map[gameState.opponentPlayer.id.toString()] = gameState.opponentPlayer.displayName;
    return map;
  }, [gameState.myPlayer, gameState.opponentPlayer]);

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

  if (lifecycle === 'creating' || lifecycle === 'joining' || (!isConnected && !isActive)) {
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

  // Note: removed isLoading gate — subscribeApplied is unreliable for the host
  // (tables that were empty at subscribe time may never flip to applied).
  // The canvas handles missing data gracefully with fallbacks.

  // ---------------------------------------------------------------------------
  // Concede handler — shown during 'playing'
  // ---------------------------------------------------------------------------
  function handleConcede() {
    const confirmed = window.confirm('Are you sure you want to concede this game?');
    if (confirmed) {
      gameState.resignGame();
    }
  }

  // ---------------------------------------------------------------------------
  // Return to lobby handler used by GameOverOverlay
  // ---------------------------------------------------------------------------
  function handleReturnToLobby() {
    router.push('/play');
  }

  // ---------------------------------------------------------------------------
  // Left sidebar — shared between playing and finished states
  // ---------------------------------------------------------------------------
  const leftSidebar = (
    <div style={{
      width: 'clamp(150px, 10vw, 220px)',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      background: 'rgba(10, 8, 5, 0.97)',
      borderRight: '1px solid rgba(107, 78, 39, 0.3)',
    }}>
      {/* Card Preview — top */}
      <div style={{ flexShrink: 0, borderBottom: '1px solid rgba(107, 78, 39, 0.2)' }}>
        <CardPreviewPanel card={hoveredCard} />
      </div>
      {/* Chat — bottom, takes remaining space */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <ChatPanel
          chatMessages={gameState.chatMessages}
          gameActions={gameState.gameActions}
          myPlayerId={gameState.myPlayer?.id ?? BigInt(0)}
          onSendChat={gameState.sendChat}
          playerNames={playerNameMap}
        />
      </div>
    </div>
  );

  // lifecycle === 'finished' — show canvas (frozen) with GameOverOverlay on top,
  // or render the overlay standalone if canvas data is unavailable.
  if (lifecycle === 'finished') {
    // If we have full game state, show the overlay over the frozen canvas
    if (gameId !== null && !gameState.isLoading) {
      return (
        <div style={{ display: 'flex', width: '100vw', height: '100dvh' }}>
          {leftSidebar}
          <div style={{ flex: 1, position: 'relative', pointerEvents: 'none' }}>
            <MultiplayerCanvas gameId={gameId} onHoveredCardChange={setHoveredCard} />
            <GameOverOverlay
              game={gameState.game}
              myPlayer={gameState.myPlayer}
              opponentPlayer={gameState.opponentPlayer}
              gameActions={gameState.gameActions}
              onReturnToLobby={handleReturnToLobby}
            />
          </div>
        </div>
      );
    }
    // Fallback — canvas not ready
    return (
      <div style={{ display: 'flex', width: '100vw', height: '100dvh' }}>
        {leftSidebar}
        <div style={{ flex: 1, position: 'relative' }}>
          <GameOverOverlay
            game={gameState.game}
            myPlayer={gameState.myPlayer}
            opponentPlayer={gameState.opponentPlayer}
            gameActions={gameState.gameActions}
            onReturnToLobby={handleReturnToLobby}
          />
        </div>
      </div>
    );
  }

  // lifecycle === 'playing' — flex layout with left sidebar + canvas
  return (
    <div style={{ display: 'flex', width: '100vw', height: '100dvh' }}>
      {leftSidebar}

      {/* Game canvas — takes remaining width */}
      <div style={{ flex: 1, position: 'relative' }}>
        {gameId !== null && (
          <MultiplayerCanvas gameId={gameId} onHoveredCardChange={setHoveredCard} />
        )}

        {/* Concede floating button — sits above the canvas, bottom-right */}
        {lifecycle === 'playing' && (
          <button
            onClick={handleConcede}
            style={{
              position: 'absolute',
              bottom: 60,   // above TurnIndicator bar (52px) with a small gap
              right: 12,
              zIndex: 300,
              padding: '5px 12px',
              background: 'rgba(30, 10, 10, 0.9)',
              border: '1px solid rgba(180, 60, 60, 0.45)',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 10,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: 'rgba(220, 120, 120, 0.75)',
              transition: 'background 0.15s, border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(60, 10, 10, 0.95)';
              e.currentTarget.style.borderColor = 'rgba(220, 80, 80, 0.7)';
              e.currentTarget.style.color = 'rgba(240, 150, 150, 0.95)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(30, 10, 10, 0.9)';
              e.currentTarget.style.borderColor = 'rgba(180, 60, 60, 0.45)';
              e.currentTarget.style.color = 'rgba(220, 120, 120, 0.75)';
            }}
          >
            Concede
          </button>
        )}
      </div>
    </div>
  );
}
