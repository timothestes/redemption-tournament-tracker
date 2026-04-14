'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useSpacetimeConnection } from '@/app/play/hooks/useSpacetimeConnection';
import { SpacetimeProvider } from '@/app/play/lib/spacetimedb-provider';
import { useGameState } from '@/app/play/hooks/useGameState';
import { useSpacetimeDB } from 'spacetimedb/react';
import GameOverOverlay, { deriveEndReason } from '@/app/play/components/GameOverOverlay';
import TurnIndicator from '@/app/play/components/TurnIndicator';
import ChatPanel from '../components/ChatPanel';
import { CardPreviewProvider, useCardPreview } from '@/app/goldfish/state/CardPreviewContext';
import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';
import TopNav from '@/components/top-nav';
import { GameToolbar } from '@/app/shared/components/GameToolbar';
import { useGameHotkeys } from '@/app/shared/hooks/useGameHotkeys';
import { GameToastContainer, showGameToast } from '@/app/shared/components/GameToast';
import type { GameActions } from '@/app/shared/types/gameActions';
import WaitingRoomGoldfish from '../components/WaitingRoomGoldfish';
import { SpreadHandProvider, useSpreadHand } from '../contexts/SpreadHandContext';
import { convertToGoldfishDeck, type GameCardData } from '../utils/convertToGoldfishDeck';
import PregameScreen, { PregameCeremonyOverlay } from '../components/PregameScreen';
import { DeckPickerModal } from '../components/DeckPickerModal';
import { getRandomLoadingMessage } from '@/app/shared/constants/loadingMessages';
import { ArrowLeft } from 'lucide-react';
import type { DeckOption } from '../components/DeckPickerCard';
import { loadUserDecks, loadDeckForGame } from '../actions';

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
  deckName?: string;
  paragon?: string | null;
  isPublic?: boolean;
  lobbyMessage?: string;
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
      <CardPreviewProvider storageKey="multiplayer-loupe-visible" defaultVisible>
        <SpreadHandProvider>
          <GameInner code={code} isConnected={isConnected} />
        </SpreadHandProvider>
      </CardPreviewProvider>
    </SpacetimeProvider>
  );
}

// ---------------------------------------------------------------------------
// Inner component — must live inside SpacetimeProvider to use SpacetimeDB hooks
// ---------------------------------------------------------------------------
type LifecycleState = 'creating' | 'joining' | 'waiting' | 'pregame' | 'playing' | 'finished' | 'error';

// WaitingScreen and CopyButton removed — now handled by unified PregameScreen

// ---------------------------------------------------------------------------
// Inner component — must live inside SpacetimeProvider to use SpacetimeDB hooks
// ---------------------------------------------------------------------------

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
  const [loadingMessage, setLoadingMessage] = useState('Loading...');

  useEffect(() => {
    const stored = sessionStorage.getItem('stdb_loading_message');
    if (stored) {
      sessionStorage.removeItem('stdb_loading_message');
      setLoadingMessage(stored);
    } else {
      setLoadingMessage(getRandomLoadingMessage());
    }
  }, []);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPracticing, setIsPracticing] = useState(false);
  const [playAgainTriggered, setPlayAgainTriggered] = useState(false);
  const [gameId, setGameId] = useState<bigint | null>(null);
  const didCallReducer = useRef(false);
  const didSubscribe = useRef(false);

  // Deck reload state
  const [showReloadDeckPicker, setShowReloadDeckPicker] = useState(false);
  const [reloadMyDecks, setReloadMyDecks] = useState<DeckOption[]>([]);
  const [reloadDeckConfirm, setReloadDeckConfirm] = useState<{ deckId: string; deckName: string; deckData: string } | null>(null);

  useEffect(() => {
    if (showReloadDeckPicker && reloadMyDecks.length === 0) {
      loadUserDecks().then(setReloadMyDecks).catch(() => {});
    }
  }, [showReloadDeckPicker, reloadMyDecks.length]);

  // Card preview hook — must be called before any early returns (Rules of Hooks)
  const { isLoupeVisible, toggleLoupe, previewCard } = useCardPreview();
  const { isSpreadHand, toggleSpreadHand } = useSpreadHand();

  // Phase 1: Subscribe to game table filtered by code so we can discover the
  // numeric gameId. This avoids sequential scans on unfiltered SELECT * queries.
  useEffect(() => {
    if ((!isConnected && !isActive) || !conn || didSubscribe.current) return;
    didSubscribe.current = true;
    try {
      conn.subscriptionBuilder().subscribe([
        `SELECT * FROM game WHERE code = '${code}'`,
      ]);
    } catch (e) {
      console.error('Failed to subscribe (phase 1):', e);
    }
  }, [isConnected, isActive, conn, code]);

  // Phase 2: Once gameId is known, subscribe to remaining tables scoped to
  // this game. This uses the btree indexes on game_id columns, eliminating
  // the "subscription queries with sequential scan" warnings.
  const didSubscribePhase2 = useRef(false);
  useEffect(() => {
    if (!conn || gameId === null || didSubscribePhase2.current) return;
    didSubscribePhase2.current = true;
    try {
      conn.subscriptionBuilder().subscribe([
        `SELECT * FROM player WHERE game_id = ${gameId}`,
        `SELECT * FROM card_instance WHERE game_id = ${gameId}`,
        `SELECT * FROM card_counter`,
        `SELECT * FROM game_action WHERE game_id = ${gameId}`,
        `SELECT * FROM chat_message WHERE game_id = ${gameId}`,
        `SELECT * FROM spectator WHERE game_id = ${gameId}`,
        `SELECT * FROM disconnect_timeout WHERE game_id = ${gameId}`,
        `SELECT * FROM zone_search_request WHERE game_id = ${gameId}`,
      ]);
    } catch (e) {
      console.error('Failed to subscribe (phase 2):', e);
    }
  }, [conn, gameId]);

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

  // Must be declared before the reducer effect so isGamesReady is available
  // in the dependency array (which is evaluated during render).
  const gameState = useGameState(gameId ?? BigInt(0));

  // Persist chat/log tab across loupe toggles so it doesn't reset to chat
  const [chatTab, setChatTab] = useState<'chat' | 'log'>('chat');

  // Track unread chat messages at this level so the count survives ChatPanel
  // unmounting when the right panel collapses.
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

  // Keyboard shortcuts — active only during a live game.
  const hotkeysActions = useMemo<GameActions>(() => ({
    drawCard: () => gameState.drawCard(),
    shuffleDeck: () => gameState.shuffleDeck(),
    moveCard: () => {},
    moveCardsBatch: () => {},
    flipCard: () => {},
    meekCard: () => {},
    unmeekCard: () => {},
    addCounter: () => {},
    removeCounter: () => {},
    shuffleCardIntoDeck: () => {},
    setNote: () => {},
    exchangeCards: () => {},
    drawMultiple: () => {},
    moveCardToTopOfDeck: () => {},
    moveCardToBottomOfDeck: () => {},
    randomHandToZone: () => {},
    reloadDeck: () => {},
  }), [gameState]);

  useGameHotkeys({
    actions: hotkeysActions,
    mode: 'multiplayer',
    isMyTurn: gameState.isMyTurn,
    enabled: lifecycle === 'playing',
    handSize: gameState.myCards['hand']?.length ?? 0,
    deckSize: gameState.myCards['deck']?.length ?? 0,
    onRollDice: () => gameState.rollDice(BigInt(20)),
    onToggleSpreadHand: toggleSpreadHand,
    onToggleLoupe: toggleLoupe,
    onAdvancePhase: gameState.endTurn,
  });

  // Once subscription data is ready, call the appropriate reducer once.
  // Gate on isGamesReady (subscription applied) instead of isConnected (WebSocket open)
  // to eliminate the race where allGames is empty and createGame re-fires.
  useEffect(() => {
    console.log('[game-debug] reducer effect:', { isGamesReady: gameState.isGamesReady, hasConn: !!conn, didCall: didCallReducer.current, role: gameParams?.role });
    if (!gameState.isGamesReady || !conn || didCallReducer.current) return;
    didCallReducer.current = true;

    if (!gameParams) {
      console.log('[game-debug] no gameParams — showing error');
      setErrorMessage('No game parameters found. Please return to the lobby.');
      setLifecycle('error');
      return;
    }

    // Reconnect scenario: if we're the creator and the game already exists,
    // skip the createGame call (it would fail with "code already in use").
    // Joiners must always call joinGame — they see the game via subscription
    // before joining, so we can't use game existence as a skip signal for them.
    // Filter out finished games — old games with the same code may still exist.
    if (gameParams.role === 'create') {
      const existingGames = [...(gameState.allGames || [])];
      console.log('[game-debug] reconnect check — games with this code:', existingGames.filter((g: any) => g.code === code).map((g: any) => ({ id: String(g.id), status: g.status })));
      const existingGame = existingGames.find((g: any) => g.code === code && g.status !== 'finished');
      if (existingGame) {
        console.log('[game-debug] reconnect — reusing existing game:', String(existingGame.id), existingGame.status);
        setGameId(existingGame.id);
        return; // lifecycle sync effect handles the rest
      }
    }

    try {
      if (gameParams.role === 'create') {
        console.log('[game-debug] calling createGame reducer for code:', code);
        setLifecycle('creating');
        conn.reducers.createGame({
          code,
          deckId: gameParams.deckId,
          displayName: gameParams.displayName,
          format: gameParams.format ?? 'standard',
          supabaseUserId: gameParams.supabaseUserId,
          deckData: gameParams.deckData,
          isPublic: gameParams.isPublic ?? true,
          lobbyMessage: gameParams.lobbyMessage ?? '',
        });
        // Transition to waiting — the game row will appear via subscription
        console.log('[game-debug] createGame called — setting lifecycle to waiting');
        setLifecycle('waiting');
      } else {
        setLifecycle('joining');
        try {
          conn.reducers.joinGame({
            code,
            deckId: gameParams.deckId,
            displayName: gameParams.displayName,
            supabaseUserId: gameParams.supabaseUserId,
            deckData: gameParams.deckData,
          });
        } catch (joinErr: unknown) {
          // SpacetimeDB SenderError may throw synchronously
          const msg = joinErr instanceof Error ? joinErr.message : 'Failed to join game';
          setErrorMessage(msg.includes('No waiting game')
            ? `No game found with code "${code}". The game may have ended or the code may be incorrect.`
            : msg);
          setLifecycle('error');
          return;
        }
      }
    } catch (e: unknown) {
      setErrorMessage(e instanceof Error ? e.message : 'Failed to initialize game');
      setLifecycle('error');
    }
  }, [gameState.isGamesReady, conn, code, gameParams]);

  // Also get raw game list to find our game by code before we know the ID
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const spacetimeCtxForGames = useSpacetimeDB() as any;

  useEffect(() => {
    if (gameId !== null) return; // Already discovered
    const { allGames } = gameState;
    if (!allGames) return;
    const gamesWithCode = allGames.filter((g: any) => g.code === code);
    if (gamesWithCode.length > 0) {
      console.log('[game-debug] discovery — all games with code:', gamesWithCode.map((g: any) => ({ id: String(g.id), status: g.status })));
    }
    // Prefer active games — old finished games with the same code may still exist
    const found = allGames.find((g: any) => g.code === code && g.status !== 'finished')
      ?? allGames.find((g: any) => g.code === code);
    if (found) {
      console.log('[game-debug] discovery — selected game:', String(found.id), 'status:', found.status);
      setGameId(found.id);
    }
  }, [gameState.allGames, code, gameId]);

  // Fast detection: once subscription data arrives and we're still 'joining',
  // check if a game with our code exists. If not, fail immediately.
  // Only look for non-finished games — finished games with the same code are stale.
  useEffect(() => {
    if (lifecycle !== 'joining') return;
    const { allGames } = gameState;
    if (!gameState.isGamesReady) return; // subscription not applied yet
    const found = allGames.find((g: any) => g.code === code && g.status !== 'finished');
    if (!found) {
      setErrorMessage(`No game found with code "${code}". The game may have ended or the code may be incorrect.`);
      setLifecycle('error');
    }
  }, [lifecycle, gameState.allGames, code]);

  // Fallback timeout — if subscription never arrives (network issues), fail after 5s
  useEffect(() => {
    if (lifecycle !== 'joining') return;
    const timeout = setTimeout(() => {
      setErrorMessage(`Could not connect to game "${code}". Please check your connection and try again.`);
      setLifecycle('error');
    }, 12000);
    return () => clearTimeout(timeout);
  }, [lifecycle, code]);

  // Sync lifecycle state from live game data
  useEffect(() => {
    const { game } = gameState;
    if (!game) return;

    console.log('[game-debug] lifecycle sync — game.status:', game.status, 'current lifecycle:', lifecycle, 'gameId:', String(game.id));

    if (game.status === 'waiting') {
      setLifecycle('waiting');
    } else if (game.status === 'pregame') {
      setLifecycle('pregame');
    } else if (game.status === 'playing') {
      setLifecycle('playing');
    } else if (game.status === 'finished' && lifecycle === 'pregame') {
      setErrorMessage('Opponent disconnected. Game cancelled.');
      setLifecycle('error');
      return;
    } else if (game.status === 'finished') {
      console.log('[game-debug] lifecycle sync — transitioning to FINISHED from', lifecycle);
      setLifecycle('finished');
    }
  }, [gameState.game, lifecycle]);

  // Clean up waiting-status games when the user navigates away (component unmount).
  // We intentionally do NOT use beforeunload — it fires on page refresh, which
  // would kill the game immediately. Instead, the server's 30-second disconnect
  // timeout (DisconnectTimeout) handles tab close / crashes, giving enough time
  // for page refreshes and WebSocket reconnections.
  const lifecycleRef = useRef(lifecycle);
  lifecycleRef.current = lifecycle;
  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;

  useEffect(() => {
    if (gameId === null) return;
    return () => {
      // Component unmount (navigation away) — clean up if still waiting
      if (lifecycleRef.current === 'waiting') {
        gameStateRef.current.leaveGame();
      }
    };
  }, [gameId]);

  // Build a player name map for ChatPanel
  const playerNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (gameState.myPlayer) map[gameState.myPlayer.id.toString()] = gameState.myPlayer.displayName;
    if (gameState.opponentPlayer) map[gameState.opponentPlayer.id.toString()] = gameState.opponentPlayer.displayName;
    return map;
  }, [gameState.myPlayer, gameState.opponentPlayer]);

  // Compute goldfish deck for practice-while-waiting
  const goldfishDeck = useMemo(() => {
    if (!gameParams?.deckData) return null;
    try {
      const cards = JSON.parse(gameParams.deckData) as GameCardData[];
      if (cards.length === 0) return null;
      return convertToGoldfishDeck(
        cards,
        gameParams.deckId,
        gameParams.deckName || 'Practice Deck',
        gameParams.format || 'Type 1',
        gameParams.paragon
      );
    } catch {
      return null;
    }
  }, [gameParams]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  // Auto-redirect to lobby when game is not found (stale lobby, expired, wrong code)
  // instead of stranding the user on a dead-end error page
  const isGameNotFound = lifecycle === 'error' && errorMessage?.includes('No game found');
  useEffect(() => {
    if (!isGameNotFound) return;
    sessionStorage.setItem('lobby_error', `Game "${code}" is no longer available.`);
    router.replace('/play');
  }, [isGameNotFound, code, router]);

  if (lifecycle === 'error') {
    if (isGameNotFound) {
      // Show brief loading state while redirecting
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <p className="text-sm text-muted-foreground">Returning to lobby...</p>
        </div>
      );
    }
    return (
      <>
      <TopNav />
      <div className="flex min-h-[calc(100vh-56px)] items-center justify-center px-4">
        <div className="rounded-lg border border-border bg-card/95 backdrop-blur-sm p-8 text-center max-w-sm">
          <div className="mb-4 flex justify-center">
            <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center">
              <svg className="w-8 h-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
          </div>
          <p className="text-lg font-semibold font-cinzel mb-2">Connection Error</p>
          <p className="text-sm text-muted-foreground">
            {errorMessage ?? 'An unexpected error occurred.'}
          </p>
          <a
            href="/play"
            className="mt-6 inline-block rounded-md border border-border px-5 py-2.5 text-sm font-medium hover:bg-muted transition-colors"
          >
            Back to Lobby
          </a>
        </div>
      </div>
      </>
    );
  }

  if (lifecycle === 'creating' || lifecycle === 'joining' || (!isConnected && !isActive)) {
    return (
      <>
      <TopNav />
      <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-black">
        {/* Cave background */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-40"
          style={{ backgroundImage: 'url(/gameplay/cave_background.png)', backgroundPosition: 'center 70%' }}
        />
        {/* Vignette */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 90% 85% at 50% 50%, transparent 60%, rgba(0,0,0,0.85) 100%)' }}
        />
        <div className="relative z-10 text-center">
          <p className="font-cinzel text-xl tracking-wide text-amber-200/90 mb-6">
            {loadingMessage}
          </p>
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-amber-200/50 border-t-transparent mx-auto" />
        </div>
      </div>
      </>
    );
  }

  // Determine if we're in a ceremony phase (rolling/choosing/revealing) where
  // the game board should be visible behind the overlay.
  // Once the local player has acknowledged during 'revealing', dismiss the overlay
  // immediately instead of waiting for the server round-trip from the other player.
  const pregamePhase = gameState.game?.pregamePhase;
  const myAckedRevealing = (() => {
    if (pregamePhase !== 'revealing' || !gameState.game || !gameState.myPlayer) return false;
    const isSeat0 = gameState.myPlayer.seat.toString() === '0';
    return isSeat0 ? gameState.game.pregameReady0 : gameState.game.pregameReady1;
  })();
  const isCeremonyPhase = lifecycle === 'pregame' &&
    (pregamePhase === 'rolling' || pregamePhase === 'choosing' || (pregamePhase === 'revealing' && !myAckedRevealing));

  if ((lifecycle === 'waiting' || lifecycle === 'pregame') && !isCeremonyPhase) {
    if (isPracticing && goldfishDeck) {
      return (
        <div className="fixed inset-0 bg-background">
          {/* Floating banner */}
          <div className="fixed top-0 inset-x-0 z-50 h-12 flex items-center justify-between px-4 bg-background/90 backdrop-blur-sm border-b border-border">
            <button
              onClick={() => setIsPracticing(false)}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Exit Practice
            </button>
            <div className="flex items-center gap-3">
              <span className="font-mono text-lg font-bold tracking-wider">{code}</span>
              <span className="text-sm text-muted-foreground">Waiting for opponent</span>
              <span className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <span key={i} className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </span>
            </div>
          </div>
          <div className="pt-12">
            <WaitingRoomGoldfish deck={goldfishDeck} />
          </div>
        </div>
      );
    }

    return (
      <PregameScreen
        code={code}
        lifecycle={lifecycle}
        gameId={gameId}
        gameState={gameState}
        myDisplayName={gameParams?.displayName ?? ''}
        myDeckName={gameParams?.deckName}
        goldfishDeck={goldfishDeck}
        onPractice={() => setIsPracticing(true)}
        onUpdateMessage={gameId && conn ? (message: string) => {
          conn.reducers.updateLobbyMessage({ gameId, message });
        } : undefined}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // Return to lobby handler used by GameOverOverlay
  // ---------------------------------------------------------------------------
  function handleReturnToLobby() {
    gameState.leaveGame();
    router.push('/play');
  }

  // ---------------------------------------------------------------------------
  // Right panel — collapses entirely when preview is hidden
  // ---------------------------------------------------------------------------
  const PANEL_EXPANDED_WIDTH = 'clamp(280px, 20vw, 380px)';
  const PANEL_COLLAPSED_WIDTH = 36;

  const rightPanel = (
    <div style={{
      width: isLoupeVisible ? PANEL_EXPANDED_WIDTH : PANEL_COLLAPSED_WIDTH,
      minWidth: isLoupeVisible ? undefined : PANEL_COLLAPSED_WIDTH,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      background: isLoupeVisible ? 'rgba(10, 8, 5, 0.97)' : 'transparent',
      borderLeft: '1px solid rgba(107, 78, 39, 0.3)',
      overflow: 'hidden',
      transition: 'width 0.2s ease',
    }}>
      <button
        onClick={toggleLoupe}
        title={isLoupeVisible ? 'Hide panel (Tab)' : 'Show panel (Tab)'}
        style={{
          width: '100%',
          height: 48,
          minHeight: 48,
          background: 'rgba(10, 8, 5, 0.96)',
          borderTop: 'none',
          borderLeft: 'none',
          borderRight: 'none',
          borderBottom: '1px solid rgba(107, 78, 39, 0.5)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: isLoupeVisible ? 'flex-start' : 'center',
          gap: 6,
          padding: isLoupeVisible ? '0 12px' : '0',
          color: 'rgba(232, 213, 163, 0.5)',
          flexShrink: 0,
        }}
      >
        {isLoupeVisible ? (
          <>
            <span style={{ fontSize: 14 }}>›</span>
            <span style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 11,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}>
              Preview
            </span>
          </>
        ) : (
          <span style={{ fontSize: 14, position: 'relative' }}>
            ‹
            {unreadChatCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: -2,
                  right: -6,
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: '#c4955a',
                  boxShadow: '0 0 4px rgba(196, 149, 90, 0.6)',
                  animation: 'unread-pulse 2s ease-in-out infinite',
                }}
              />
            )}
          </span>
        )}
      </button>
      {/* Keyframe for unread dot pulse */}
      {unreadChatCount > 0 && !isLoupeVisible && (
        <style>{`
          @keyframes unread-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
        `}</style>
      )}
      {isLoupeVisible && (
        <>
          <div style={{
            flexShrink: 0,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
          }}>
            {previewCard ? (
              <div style={{
                width: '100%',
                aspectRatio: '375 / 525',
                borderRadius: 6,
                overflow: 'hidden',
                boxShadow: '0 4px 24px rgba(0,0,0,0.7), 0 0 8px rgba(212,168,103,0.2)',
                background: '#000',
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={getCardImageUrl(previewCard.cardImgFile)}
                  alt={previewCard.cardName}
                  style={{
                    display: 'block',
                    width: '100%',
                    height: '100%',
                    objectFit: 'fill',
                    transform: previewCard.isMeek ? 'rotate(180deg)' : undefined,
                  }}
                />
              </div>
            ) : (
              <div style={{
                width: '100%',
                aspectRatio: '1 / 1.4',
                borderRadius: 6,
                border: '1px dashed rgba(107, 78, 39, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: 0.55,
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/gameplay/cardback.webp"
                  alt="Hover a card"
                  style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 6, opacity: 0.7 }}
                />
              </div>
            )}
          </div>
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', borderTop: '1px solid rgba(107, 78, 39, 0.3)' }}>
            <ChatPanel
              chatMessages={gameState.chatMessages}
              gameActions={gameState.gameActions}
              myPlayerId={gameState.myPlayer?.id ?? BigInt(0)}
              onSendChat={gameState.sendChat}
              playerNames={playerNameMap}
              activeTab={chatTab}
              onActiveTabChange={setChatTab}
            />
          </div>
        </>
      )}
    </div>
  );

  // lifecycle === 'pregame' ceremony phases (rolling/choosing/revealing) —
  // show the game board with the roll/choose overlay on top so players
  // can see their dealt hand while deciding who goes first.
  if (isCeremonyPhase) {
    return (
      <div style={{ display: 'flex', width: '100vw', height: '100dvh', backgroundImage: 'url(/gameplay/cave_background.png)', backgroundSize: 'cover', backgroundPosition: 'center' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flexShrink: 0, height: 48 }}>
            <TurnIndicator
              game={gameState.game}
              myPlayer={gameState.myPlayer}
              opponentPlayer={gameState.opponentPlayer}
              opponentConnectionStatus={gameState.opponentConnectionStatus}
              isMyTurn={false}
              onSetPhase={() => {}}
              onEndTurn={() => {}}
              myScore={gameState.myCards['land-of-redemption']?.length ?? 0}
              opponentScore={gameState.opponentCards['land-of-redemption']?.length ?? 0}
            />
          </div>
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            {gameId !== null && (
              <MultiplayerCanvas gameId={gameId} onLoadDeck={() => setShowReloadDeckPicker(true)} />
            )}
            <PregameCeremonyOverlay gameState={gameState} />
            <GameToastContainer />
          </div>
        </div>
        {rightPanel}
      </div>
    );
  }

  // lifecycle === 'finished' — show canvas (frozen) with GameOverOverlay on top,
  // or render the overlay standalone if canvas data is unavailable.
  if (lifecycle === 'finished') {
    const { label: endLabel, winnerName } = deriveEndReason(gameState.gameActions, gameState.myPlayer);
    const opponentDisconnected = endLabel === 'Opponent disconnected';
    const opponentResigned = endLabel === 'Opponent resigned';

    // Show the overlay over the frozen canvas — always render canvas if gameId is known
    if (gameId !== null) {
      return (
        <div style={{ display: 'flex', width: '100vw', height: '100dvh', backgroundImage: 'url(/gameplay/cave_background.png)', backgroundSize: 'cover', backgroundPosition: 'center' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ flexShrink: 0, height: 48 }}>
              <TurnIndicator
                game={gameState.game}
                myPlayer={gameState.myPlayer}
                opponentPlayer={gameState.opponentPlayer}
              opponentConnectionStatus={gameState.opponentConnectionStatus}
                isMyTurn={false}
                onSetPhase={() => {}}
                onEndTurn={() => {}}
                isFinished
                winnerName={winnerName}
                onPlayAgain={opponentDisconnected ? undefined : () => setPlayAgainTriggered(true)}
                myScore={gameState.myCards['land-of-redemption']?.length ?? 0}
                opponentScore={gameState.opponentCards['land-of-redemption']?.length ?? 0}
              />
            </div>
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              <MultiplayerCanvas gameId={gameId} />
              {/* Bottom toolbar — stays active for draw/shuffle, end turn disabled */}
              <GameToolbar
                actions={{
                  drawCard: () => gameState.drawCard(),
                  drawMultiple: (n) => gameState.drawMultiple(BigInt(n)),
                  moveCard: (id, zone, px, py) => gameState.moveCard(BigInt(id), zone, undefined, px, py),
                  moveCardsBatch: (ids, zone) => gameState.moveCardsBatch(JSON.stringify(ids), zone),
                  flipCard: (id) => gameState.flipCard(BigInt(id)),
                  meekCard: (id) => gameState.meekCard(BigInt(id)),
                  unmeekCard: (id) => gameState.unmeekCard(BigInt(id)),
                  addCounter: (id, c) => gameState.addCounter(BigInt(id), c),
                  removeCounter: (id, c) => gameState.removeCounter(BigInt(id), c),
                  shuffleCardIntoDeck: (id) => gameState.shuffleCardIntoDeck(BigInt(id)),
                  shuffleDeck: () => gameState.shuffleDeck(),
                  setNote: (id, t) => gameState.setNote(BigInt(id), t),
                  exchangeCards: (ids) => gameState.exchangeCards(JSON.stringify(ids)),
                  moveCardToTopOfDeck: (id) => gameState.moveCardToTopOfDeck(BigInt(id)),
                  moveCardToBottomOfDeck: (id) => gameState.moveCardToBottomOfDeck(BigInt(id)),
                  randomHandToZone: (count, toZone, deckPosition) => gameState.randomHandToZone(count, toZone, deckPosition),
                  reloadDeck: (deckId, deckData) => gameState.reloadDeck(deckId, deckData),
                } satisfies GameActions}
                mode="multiplayer"
                isMyTurn={true}
                isFinished
                isSpreadHand={isSpreadHand}
                onToggleSpreadHand={toggleSpreadHand}
                deckCount={gameState.myCards['deck']?.length ?? 0}
                handCount={gameState.myCards['hand']?.length ?? 0}
                onRollDice={() => gameState.rollDice(BigInt(20))}
                onShowToast={showGameToast}
                onEndTurn={() => {}}
              />
              <GameToastContainer />
              <GameOverOverlay
                game={gameState.game}
                myPlayer={gameState.myPlayer}
                opponentPlayer={gameState.opponentPlayer}
                gameActions={gameState.gameActions}
                gameState={gameState}
                onReturnToLobby={handleReturnToLobby}
                playAgainTriggered={playAgainTriggered}
                onPlayAgainHandled={() => setPlayAgainTriggered(false)}
              />
            </div>
          </div>
          {rightPanel}
        </div>
      );
    }
    // Fallback — canvas not ready
    return (
      <div style={{ display: 'flex', width: '100vw', height: '100dvh', backgroundImage: 'url(/gameplay/cave_background.png)', backgroundSize: 'cover', backgroundPosition: 'center' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flexShrink: 0, height: 48 }}>
            <TurnIndicator
              game={gameState.game}
              myPlayer={gameState.myPlayer}
              opponentPlayer={gameState.opponentPlayer}
              opponentConnectionStatus={gameState.opponentConnectionStatus}
              isMyTurn={false}
              onSetPhase={() => {}}
              onEndTurn={() => {}}
              isFinished
              winnerName={winnerName}
              onPlayAgain={opponentDisconnected ? undefined : () => setPlayAgainTriggered(true)}
              myScore={gameState.myCards['land-of-redemption']?.length ?? 0}
              opponentScore={gameState.opponentCards['land-of-redemption']?.length ?? 0}
            />
          </div>
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <GameOverOverlay
              game={gameState.game}
              myPlayer={gameState.myPlayer}
              opponentPlayer={gameState.opponentPlayer}
              gameActions={gameState.gameActions}
              gameState={gameState}
              onReturnToLobby={handleReturnToLobby}
            />
          </div>
        </div>
        {rightPanel}
      </div>
    );
  }

  // lifecycle === 'playing' — two-column layout: canvas + right panel (preview + chat)
  return (
    <div style={{ display: 'flex', width: '100vw', height: '100dvh', backgroundImage: 'url(/gameplay/cave_background.png)', backgroundSize: 'cover', backgroundPosition: 'center' }}>
      {/* Turn bar + Canvas + Toolbar */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flexShrink: 0, height: 48 }}>
          <TurnIndicator
            game={gameState.game}
            myPlayer={gameState.myPlayer}
            opponentPlayer={gameState.opponentPlayer}
            opponentConnectionStatus={gameState.opponentConnectionStatus}
            isMyTurn={gameState.isMyTurn}
            onSetPhase={gameState.setPhase}
            onEndTurn={gameState.endTurn}
            onConcede={gameState.resignGame}
            onRequestPriority={() => gameState.requestZoneSearch('action-priority')}
            hasPendingPriority={gameState.zoneSearchRequests.some(
              (r: any) => r.zone === 'action-priority' && r.status === 'pending' && r.requesterId === gameState.myPlayer?.id
            )}
            myScore={gameState.myCards['land-of-redemption']?.length ?? 0}
            opponentScore={gameState.opponentCards['land-of-redemption']?.length ?? 0}
            disconnectTimeoutFired={gameState.disconnectTimeoutFired}
            onClaimVictory={gameState.claimTimeoutVictory}
          />
        </div>
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {gameId !== null && (
            <MultiplayerCanvas gameId={gameId} onLoadDeck={() => setShowReloadDeckPicker(true)} />
          )}
          {/* Quick action toolbar — floating above hand area */}
          <GameToolbar
            actions={{
              drawCard: () => gameState.drawCard(),
              drawMultiple: (n) => gameState.drawMultiple(BigInt(n)),
              moveCard: (id, zone, px, py) => gameState.moveCard(BigInt(id), zone, undefined, px, py),
              moveCardsBatch: (ids, zone) => gameState.moveCardsBatch(JSON.stringify(ids), zone),
              flipCard: (id) => gameState.flipCard(BigInt(id)),
              meekCard: (id) => gameState.meekCard(BigInt(id)),
              unmeekCard: (id) => gameState.unmeekCard(BigInt(id)),
              addCounter: (id, c) => gameState.addCounter(BigInt(id), c),
              removeCounter: (id, c) => gameState.removeCounter(BigInt(id), c),
              shuffleCardIntoDeck: (id) => gameState.shuffleCardIntoDeck(BigInt(id)),
              shuffleDeck: () => gameState.shuffleDeck(),
              setNote: (id, t) => gameState.setNote(BigInt(id), t),
              exchangeCards: (ids) => gameState.exchangeCards(JSON.stringify(ids)),
              moveCardToTopOfDeck: (id) => gameState.moveCardToTopOfDeck(BigInt(id)),
              moveCardToBottomOfDeck: (id) => gameState.moveCardToBottomOfDeck(BigInt(id)),
              randomHandToZone: (count, toZone, deckPosition) => gameState.randomHandToZone(count, toZone, deckPosition),
              reloadDeck: (deckId, deckData) => gameState.reloadDeck(deckId, deckData),
            } satisfies GameActions}
            mode="multiplayer"
            isMyTurn={gameState.isMyTurn}
            isSpreadHand={isSpreadHand}
            onToggleSpreadHand={toggleSpreadHand}
            deckCount={gameState.myCards['deck']?.length ?? 0}
            handCount={gameState.myCards['hand']?.length ?? 0}
            onRollDice={() => gameState.rollDice(BigInt(20))}
            onShowToast={showGameToast}
            onEndTurn={gameState.endTurn}
            onRequestPriority={() => gameState.requestZoneSearch('action-priority')}
            hasPendingPriority={gameState.zoneSearchRequests.some(
              (r: any) => r.zone === 'action-priority' && r.status === 'pending' && r.requesterId === gameState.myPlayer?.id
            )}
          />
          <GameToastContainer />
        </div>
      </div>

      {/* Right panel — preview on top, chat below */}
      {rightPanel}

      {/* Deck reload picker */}
      <DeckPickerModal
        open={showReloadDeckPicker}
        onOpenChange={(open) => setShowReloadDeckPicker(open)}
        onSelect={async (deck) => {
          const result = await loadDeckForGame(deck.id);
          setShowReloadDeckPicker(false);
          setReloadDeckConfirm({ deckId: deck.id, deckName: deck.name, deckData: JSON.stringify(result.deckData) });
        }}
        myDecks={reloadMyDecks}
      />

      {/* Deck reload confirmation dialog */}
      {reloadDeckConfirm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: 'rgba(14, 10, 6, 0.97)',
            border: '1px solid rgba(107, 78, 39, 0.3)',
            borderRadius: 8,
            padding: '20px 28px',
            maxWidth: 320,
            width: '100%',
            textAlign: 'center',
            boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(196, 149, 90, 0.08)',
          }}>
            <p style={{
              fontFamily: 'Georgia, serif',
              color: '#e8d5a3',
              fontSize: 13,
              lineHeight: 1.5,
            }}>
              Clear all cards and load a new deck?
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 18 }}>
              <button
                onClick={() => setReloadDeckConfirm(null)}
                style={{
                  padding: '7px 18px',
                  background: 'transparent',
                  border: '1px solid rgba(107, 78, 39, 0.3)',
                  borderRadius: 4,
                  color: 'rgba(196, 149, 90, 0.6)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontFamily: 'Georgia, serif',
                  transition: 'all 0.15s ease',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  gameState.reloadDeck(reloadDeckConfirm.deckId, reloadDeckConfirm.deckData);
                  setReloadDeckConfirm(null);
                }}
                style={{
                  padding: '7px 18px',
                  background: 'rgba(196, 149, 90, 0.15)',
                  border: '1px solid rgba(196, 149, 90, 0.45)',
                  borderRadius: 4,
                  color: '#e8d5a3',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontFamily: 'Georgia, serif',
                  fontWeight: 600,
                  transition: 'all 0.15s ease',
                }}
              >
                Load Deck
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
