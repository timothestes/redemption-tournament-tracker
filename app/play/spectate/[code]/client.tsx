'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useSpacetimeConnection } from '@/app/play/hooks/useSpacetimeConnection';
import { SpacetimeProvider } from '@/app/play/lib/spacetimedb-provider';
import { useSpectatorGameState } from '@/app/play/hooks/useGameState';
import { SpectatorBar } from '@/app/play/components/SpectatorBar';
import { SpectatorPregameView } from '@/app/play/components/PregameScreen';
import { CardPreviewProvider } from '@/app/goldfish/state/CardPreviewContext';
import { useSpacetimeDB } from 'spacetimedb/react';
import { showGameToast } from '@/app/shared/components/GameToast';
import { useMultiplayerImagePreloader } from '@/app/play/hooks/useMultiplayerImagePreloader';
import { buildPrioritizedImageUrls } from '@/app/play/lib/multiplayerImageUrls';
import TurnIndicator from '@/app/play/components/TurnIndicator';
import { useGameTimer } from '../../hooks/useGameTimer';
import RightPanel from '@/app/play/components/RightPanel';
import { useChatScale } from '@/app/shared/hooks/useChatScale';
import { useCardPreview } from '@/app/goldfish/state/CardPreviewContext';

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
      <CardPreviewProvider storageKey="multiplayer-loupe-visible" defaultVisible>
        <SpectatorInner code={code} isConnected={isConnected} displayName={displayName} />
      </CardPreviewProvider>
    </SpacetimeProvider>
  );
}

// ---------------------------------------------------------------------------
// Inner component — must live inside SpacetimeProvider to use SpacetimeDB hooks
// ---------------------------------------------------------------------------
type LifecycleState = 'joining' | 'watching' | 'error';

interface SpectatorInnerProps {
  code: string;
  isConnected: boolean;
  displayName: string;
}

function SpectatorInner({ code, isConnected, displayName }: SpectatorInnerProps) {
  const spacetimeCtx = useSpacetimeDB() as any;
  const conn = spacetimeCtx?.getConnection?.() ?? null;
  const isActive = spacetimeCtx?.isActive ?? false;
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
    if ((!isConnected && !isActive) || !conn || didSubscribe.current) return;
    didSubscribe.current = true;
    try {
      conn.subscriptionBuilder().subscribe([
        `SELECT * FROM game WHERE code = '${code}'`,
        `SELECT * FROM card_counter`,
      ]);
    } catch (e) {
      console.error('Failed to subscribe (spectator phase 1):', e);
    }
  }, [isConnected, isActive, conn, code]);

  // Once connected, call joinAsSpectator once
  useEffect(() => {
    if ((!isConnected && !isActive) || !conn || didCallReducer.current) return;
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
  }, [isConnected, isActive, conn, code, displayName]);

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

    // Spectators stay in 'watching' for the entire game including after
    // it finishes — the canvas keeps rendering the final board state so
    // viewers can review what happened.
    setLifecycle('watching');
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

  // Image preloader — mirrors player client but without the myDeckImageUrls
  // since spectators don't have a personal deck.
  const allImageUrls = useMemo(() => {
    return buildPrioritizedImageUrls(
      gameState.myCards,
      gameState.opponentCards,
      gameState.sharedCards ?? {},
    );
  }, [gameState.myCards, gameState.opponentCards, gameState.sharedCards]);

  const { getImage } = useMultiplayerImagePreloader(allImageUrls);

  // Chat/log font scale
  const { chatScale } = useChatScale();

  // Card preview — needed for unread tracking
  const { isLoupeVisible } = useCardPreview();

  // Unread chat count — increments while panel is collapsed
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const prevChatCountRef = useRef(0);
  useEffect(() => {
    const current = gameState.chatMessages.length;
    if (current > prevChatCountRef.current) {
      const newCount = current - prevChatCountRef.current;
      if (!isLoupeVisible) {
        setUnreadChatCount((n) => n + newCount);
      }
    }
    prevChatCountRef.current = current;
  }, [gameState.chatMessages.length, isLoupeVisible]);

  // Clear unread when panel opens
  useEffect(() => {
    if (isLoupeVisible) {
      setUnreadChatCount(0);
    }
  }, [isLoupeVisible]);

  // Player name map for ChatPanel
  const playerNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (gameState.myPlayer) map[gameState.myPlayer.id.toString()] = gameState.myPlayer.displayName;
    if (gameState.opponentPlayer) map[gameState.opponentPlayer.id.toString()] = gameState.opponentPlayer.displayName;
    return map;
  }, [gameState.myPlayer, gameState.opponentPlayer]);

  // Game timer — anchored to server-recorded playingStartedAtMicros so
  // elapsed time survives navigating away and back. Matches player client.
  const gameTimer = useGameTimer(
    gameState.game?.playingStartedAtMicros ?? null,
    gameState.game?.pauseStartedAtMicros ?? 0n,
    gameState.game?.totalPausedMicros ?? 0n,
  );

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

  if (lifecycle === 'joining' || (!isConnected && !isActive)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto" />
          <p className="text-sm text-muted-foreground">Joining as spectator...</p>
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

  const myScore = gameState.myCards['land-of-redemption']?.length ?? 0;
  const opponentScore = gameState.opponentCards['land-of-redemption']?.length ?? 0;

  return (
    <div
      style={{
        display: 'flex',
        width: '100vw',
        height: '100dvh',
        backgroundImage: 'url(/gameplay/cave_background.png)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* SpectatorBar — fixed overlay at top */}
      <SpectatorBar
        code={code}
        spectatorCount={spectatorCount}
        gameId={gameId ?? 0n}
      />

      {/* Main content column — below the SpectatorBar (40px) */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', paddingTop: 40 }}>
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
          // status === 'playing' — RightPanel spans full height alongside
          // a (TurnIndicator + canvas) column, matching the player layout.
          <div style={{ flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ flexShrink: 0, height: 48 }}>
                <TurnIndicator
                  readOnly
                  game={gameState.game}
                  myPlayer={gameState.myPlayer}
                  opponentPlayer={gameState.opponentPlayer}
                  opponentConnectionStatus={gameState.opponentConnectionStatus}
                  isMyTurn={false}
                  onSetPhase={() => {}}
                  onEndTurn={() => {}}
                  myScore={myScore}
                  opponentScore={opponentScore}
                  timerDisplay={gameTimer.formatted}
                  timerVisible={gameTimer.isTimerVisible}
                />
              </div>
              <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                <MultiplayerCanvas
                  gameId={gameId}
                  viewerKind="spectator"
                  getImage={getImage}
                />
              </div>
            </div>
            <RightPanel
              chatMessages={gameState.chatMessages}
              gameActions={gameState.gameActions}
              myPlayerId={BigInt(0)}
              onSendChat={gameState.sendChat}
              playerNames={playerNameMap}
              chatScale={chatScale}
              unreadChatCount={unreadChatCount}
              chatDisabled
            />
          </div>
        )}
      </div>
    </div>
  );
}
