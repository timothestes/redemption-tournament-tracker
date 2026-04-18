'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ParagonDrawer } from '@/app/shared/components/ParagonDrawer';
import { buildParagonEntries } from '@/app/shared/utils/paragonEntries';
import type { GameActions } from '@/app/shared/types/gameActions';
import WaitingRoomGoldfish from '../components/WaitingRoomGoldfish';
import { SpreadHandProvider, useSpreadHand } from '../contexts/SpreadHandContext';
import { convertToGoldfishDeck, type GameCardData } from '../utils/convertToGoldfishDeck';
import PregameScreen, { PregameCeremonyOverlay } from '../components/PregameScreen';
import { DeckPickerModal } from '../components/DeckPickerModal';
import { getRandomLoadingMessage } from '@/app/shared/constants/loadingMessages';
import { ArrowLeft } from 'lucide-react';
import { loadDeckForGame } from '../actions';
import { useUndoStack } from '../hooks/useUndoStack';
import { useGameTimer } from '../hooks/useGameTimer';
import { normalizeDeckFormat } from '@/lib/deck-format';

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
  const [errorFromPregame, setErrorFromPregame] = useState(false);
  const [isPracticing, setIsPracticing] = useState(false);
  // Guards against a visual flash: once the user chooses to leave, we freeze the
  // render on a transition overlay so that subsequent SpacetimeDB state updates
  // (which re-derive `lifecycle` and can fall through to the game canvas) can't
  // briefly reveal the territory zones before router.push unmounts us.
  const [isLeaving, setIsLeaving] = useState(false);
  const [playAgainTriggered, setPlayAgainTriggered] = useState(false);
  const [gameId, setGameId] = useState<bigint | null>(null);
  const didCallReducer = useRef(false);
  const didSubscribe = useRef(false);

  // Deck reload state
  const [showReloadDeckPicker, setShowReloadDeckPicker] = useState(false);
  const [reloadDeckConfirm, setReloadDeckConfirm] = useState<{ deckId: string; deckName: string; deckData: string; paragon: string } | null>(null);

  // Card preview hook — must be called before any early returns (Rules of Hooks)
  const { isLoupeVisible, toggleLoupe, previewCard } = useCardPreview();
  const { isSpreadHand, toggleSpreadHand } = useSpreadHand();

  // Client-side undo stack for multiplayer reverse actions
  const undoStack = useUndoStack();

  // Game timer — client-side only, tracks elapsed play time
  const gameTimer = useGameTimer();
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);

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

  // Deck data is loaded here (post-navigation) so the cave loading screen
  // appears immediately on click. Serialized once and reused for the reducer
  // call + goldfish practice-while-waiting.
  const [deckData, setDeckData] = useState<string | null>(null);
  const [deckLoadError, setDeckLoadError] = useState<string | null>(null);
  useEffect(() => {
    if (!gameParams || deckData !== null) return;
    let cancelled = false;
    loadDeckForGame(gameParams.deckId)
      .then((result) => {
        if (cancelled) return;
        setDeckData(JSON.stringify(result.deckData));
      })
      .catch((err) => {
        if (cancelled) return;
        setDeckLoadError(err instanceof Error ? err.message : 'Failed to load deck.');
      });
    return () => { cancelled = true; };
  }, [gameParams, deckData]);

  useEffect(() => {
    if (!deckLoadError) return;
    setErrorMessage(deckLoadError);
    setLifecycle('error');
  }, [deckLoadError]);

  // Must be declared before the reducer effect so isGamesReady is available
  // in the dependency array (which is evaluated during render).
  const gameState = useGameState(gameId ?? BigInt(0));

  // Persist chat/log/all tab across loupe toggles so it doesn't reset to chat
  const [chatTab, setChatTab] = useState<'chat' | 'log' | 'all'>('all');

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

  // Undo handler — pops the stack and shows toast
  const handleUndo = useCallback(() => {
    const description = undoStack.undo();
    if (description) {
      showGameToast(`Undo: ${description}`);
    }
  }, [undoStack]);

  // Clear undo stack on turn change
  const prevTurnRef = useRef<bigint | undefined>(undefined);
  useEffect(() => {
    const currentTurn = gameState.game?.turnNumber;
    if (currentTurn !== undefined && prevTurnRef.current !== undefined && currentTurn !== prevTurnRef.current) {
      undoStack.clear();
    }
    prevTurnRef.current = currentTurn;
  }, [gameState.game?.turnNumber, undoStack]);

  // Clear undo stack when leaving the playing state
  useEffect(() => {
    if (lifecycle !== 'playing') {
      undoStack.clear();
    }
  }, [lifecycle, undoStack]);

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
    randomReserveToZone: () => {},
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
    onUndo: handleUndo,
  });

  // Once subscription data is ready, call the appropriate reducer once.
  // Gate on isGamesReady (subscription applied) instead of isConnected (WebSocket open)
  // to eliminate the race where allGames is empty and createGame re-fires.
  useEffect(() => {
    console.log('[game-debug] reducer effect:', { isGamesReady: gameState.isGamesReady, hasConn: !!conn, didCall: didCallReducer.current, role: gameParams?.role, deckReady: deckData !== null });
    if (!gameState.isGamesReady || !conn || didCallReducer.current) return;

    if (!gameParams) {
      console.log('[game-debug] no gameParams — showing error');
      didCallReducer.current = true;
      setErrorMessage('No game parameters found. Please return to the lobby.');
      setLifecycle('error');
      return;
    }

    // Wait for the post-navigation deck load to complete before calling the
    // reducer. The cave loading screen is already visible to the user.
    if (deckData === null) return;
    didCallReducer.current = true;

    // Reconnect scenario: if the game already exists and we already have a
    // player row in it, skip the create/join call. Both fail otherwise:
    //   - createGame fails with "code already in use"
    //   - joinGame fails with "No waiting game found" (status is no longer 'waiting')
    // Filter out finished games — old games with the same code may still exist.
    const existingGame = (gameState.allGames || []).find(
      (g: any) => g.code === code && g.status !== 'finished'
    );
    if (existingGame) {
      const alreadyJoined = (gameState.allPlayers || []).some(
        (p: any) => p.gameId === existingGame.id
          && (p.identity as any)?.toHexString?.() === gameState.identityHex
      );
      if (gameParams.role === 'create' || alreadyJoined) {
        console.log('[game-debug] reconnect — reusing existing game:', String(existingGame.id), existingGame.status, 'role:', gameParams.role, 'alreadyJoined:', alreadyJoined);
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
          paragon: gameParams.paragon || '',
          format: gameParams.format ?? 'standard',
          supabaseUserId: gameParams.supabaseUserId,
          deckData,
          isPublic: gameParams.isPublic ?? true,
          lobbyMessage: gameParams.lobbyMessage ?? '',
        });
        // Transition to waiting — the game row will appear via subscription
        console.log('[game-debug] createGame called — setting lifecycle to waiting');
        setLifecycle('waiting');
      } else {
        setLifecycle('joining');

        // Pre-flight: reject obvious format mismatch before calling the reducer
        // so the user gets a crisp error instead of a generic SenderError toast.
        // The server performs the authoritative check (see spacetimedb/src/index.ts).
        const hostGame = (gameState.allGames || []).find(
          (g: any) => g.code === code && g.status === 'waiting'
        );
        if (hostGame) {
          const joinerFormat = normalizeDeckFormat(gameParams.format ?? 'Type 1');
          const hostFormat = normalizeDeckFormat(hostGame.format);
          if (joinerFormat !== hostFormat) {
            setErrorMessage(
              `This game is ${hostFormat}. Your selected deck is ${joinerFormat} — pick a ${hostFormat} deck to join.`
            );
            setLifecycle('error');
            return;
          }
        }

        try {
          conn.reducers.joinGame({
            code,
            deckId: gameParams.deckId,
            displayName: gameParams.displayName,
            paragon: gameParams.paragon || '',
            format: gameParams.format ?? 'Type 1',
            supabaseUserId: gameParams.supabaseUserId,
            deckData,
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
  }, [gameState.isGamesReady, conn, code, gameParams, deckData]);

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
      // Joiners should never render the "waiting" lobby — that state belongs
      // to the creator. The server's join_game reducer atomically transitions
      // status to 'pregame', so a joiner seeing 'waiting' means their join
      // hasn't committed yet. Keep them in the 'joining' loading screen.
      if (gameParams?.role === 'join') return;
      setLifecycle('waiting');
    } else if (game.status === 'pregame') {
      setLifecycle('pregame');
    } else if (game.status === 'playing') {
      setLifecycle('playing');
    } else if (game.status === 'finished' && lifecycle === 'pregame') {
      setErrorFromPregame(true);
      setErrorMessage('Opponent disconnected. Game cancelled.');
      setLifecycle('error');
      return;
    } else if (game.status === 'finished') {
      console.log('[game-debug] lifecycle sync — transitioning to FINISHED from', lifecycle);
      setLifecycle('finished');
    }
  }, [gameState.game, lifecycle]);

  // --- Game timer control ---
  // Start when lifecycle transitions to 'playing'; reset on pregame (rematch)
  useEffect(() => {
    if (lifecycle === 'playing') {
      gameTimer.start();
    } else if (lifecycle === 'pregame') {
      // Reset timer for rematch (pregame re-entered from finished)
      gameTimer.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lifecycle]);

  // Pause/resume based on search modal state
  useEffect(() => {
    if (lifecycle !== 'playing') return;
    if (isSearchModalOpen) {
      gameTimer.pause();
    } else {
      gameTimer.resume();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSearchModalOpen, lifecycle]);

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

  // Build paragon entries for the ParagonDrawer overlay (0-2 entries).
  const paragonEntries = useMemo(() => {
    const players: Array<{ id: string; displayName: string; paragonName: string | null; isSelf: boolean }> = [];
    if (gameState.myPlayer) {
      players.push({
        id: String(gameState.myPlayer.id),
        displayName: gameState.myPlayer.displayName,
        paragonName: gameState.myPlayer.paragon || null,
        isSelf: true,
      });
    }
    if (gameState.opponentPlayer) {
      players.push({
        id: String(gameState.opponentPlayer.id),
        displayName: gameState.opponentPlayer.displayName,
        paragonName: gameState.opponentPlayer.paragon || null,
        isSelf: false,
      });
    }
    return buildParagonEntries({ players });
  }, [gameState.myPlayer, gameState.opponentPlayer]);

  // Compute goldfish deck for practice-while-waiting
  const goldfishDeck = useMemo(() => {
    if (!gameParams || !deckData) return null;
    try {
      const cards = JSON.parse(deckData) as GameCardData[];
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
  }, [gameParams, deckData]);

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

  if (isLeaving) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black">
        <div
          className="absolute inset-0 bg-cover bg-no-repeat opacity-40"
          style={{ backgroundImage: 'url(/gameplay/cave_background.png)', backgroundPosition: 'center 70%' }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 90% 85% at 50% 50%, transparent 60%, rgba(0,0,0,0.85) 100%)' }}
        />
        <p className="relative z-10 font-cinzel text-sm tracking-wide text-amber-200/70">
          Returning to lobby...
        </p>
      </div>
    );
  }

  if (lifecycle === 'error') {
    if (isGameNotFound) {
      // Show brief loading state while redirecting
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <p className="text-sm text-muted-foreground">Returning to lobby...</p>
        </div>
      );
    }
    if (errorFromPregame) {
      return (
        <div className="fixed inset-0 flex flex-col items-center justify-center bg-black">
          <div
            className="absolute inset-0 bg-cover bg-no-repeat opacity-40"
            style={{ backgroundImage: 'url(/gameplay/cave_background.png)', backgroundPosition: 'center 70%' }}
          />
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'radial-gradient(ellipse 90% 85% at 50% 50%, transparent 60%, rgba(0,0,0,0.85) 100%)' }}
          />
          <div className="relative z-10 rounded-xl border border-red-500/20 bg-black/60 backdrop-blur-sm p-8 text-center max-w-sm mx-4">
            <div className="mb-4 flex justify-center">
              <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                <svg className="w-6 h-6 text-red-400/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              </div>
            </div>
            <p className="text-base font-semibold font-cinzel text-amber-200/90 mb-2">Game Cancelled</p>
            <p className="text-sm text-amber-200/50">
              {errorMessage ?? 'An unexpected error occurred.'}
            </p>
            <a
              href="/play"
              className="mt-6 inline-block rounded border border-[#c4955a]/45 bg-[#c4955a]/15 px-5 py-2.5 font-cinzel text-xs font-bold uppercase tracking-wider text-amber-200/90 hover:bg-[#c4955a]/25 transition-colors"
            >
              Back to Lobby
            </a>
          </div>
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

  // After the local player acknowledges during 'revealing', the ceremony overlay
  // is dismissed but the server hasn't transitioned game.status to 'playing' yet
  // (waiting for the opponent's ack). Show the game board without any overlay
  // during this brief gap to avoid flashing the lobby/dice screen.
  // Also covers the one-frame window where the server has already transitioned
  // to 'playing' (both acks received) but the lifecycle useEffect hasn't fired
  // yet — without this, the PregameScreen (with TopNav) briefly renders.
  const isAwaitingGameStart = lifecycle === 'pregame' && (
    (myAckedRevealing && pregamePhase === 'revealing') ||
    gameState.game?.status === 'playing'
  );

  // Whether we've requested a rematch and are waiting for the opponent's response
  const rematchPending = (() => {
    const reqBy = gameState.game?.rematchRequestedBy ?? '';
    if (!reqBy) return false;
    const mySeat = gameState.myPlayer ? String(gameState.myPlayer.seat) : '';
    return reqBy === mySeat && !(gameState.game?.rematchResponse);
  })();

  if ((lifecycle === 'waiting' || lifecycle === 'pregame') && !isCeremonyPhase && !isAwaitingGameStart) {
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
        onBackToLobby={handleReturnToLobby}
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
    setIsLeaving(true);
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
                position: 'relative',
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
                {previewCard.notes && (
                  <div style={{
                    position: 'absolute',
                    left: 8,
                    right: 8,
                    bottom: 10,
                    background: 'rgba(0, 0, 0, 0.88)',
                    border: '1px solid #c4955a',
                    borderRadius: 999,
                    padding: '5px 10px',
                    color: '#f0d9a8',
                    fontFamily: 'var(--font-cinzel), Georgia, serif',
                    fontSize: 12,
                    fontWeight: 700,
                    textAlign: 'center',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.8)',
                    wordBreak: 'break-word',
                  }}>
                    {previewCard.notes}
                  </div>
                )}
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
              timerDisplay={gameTimer.formatted}
              timerPaused={isSearchModalOpen}
              timerVisible={gameTimer.isTimerVisible}
            />
          </div>
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            {gameId !== null && (
              <MultiplayerCanvas gameId={gameId} onLoadDeck={() => setShowReloadDeckPicker(true)} undoStack={undoStack} onSearchModalChange={setIsSearchModalOpen} isTimerVisible={gameTimer.isTimerVisible} onToggleTimer={gameTimer.toggleTimerVisibility} />
            )}
            <PregameCeremonyOverlay gameState={gameState} />
            <GameToastContainer />
          </div>
        </div>
        {rightPanel}
        {/* Paragon drawer — self-hides when paragons list is empty. */}
        <ParagonDrawer paragons={paragonEntries} />
      </div>
    );
  }

  // Transitional state: local player has acked the reveal but the server hasn't
  // transitioned to 'playing' yet. Show the game board cleanly (no overlay, no
  // toolbar) so there's no flash of the lobby screen.
  if (isAwaitingGameStart) {
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
              timerDisplay={gameTimer.formatted}
              timerPaused={isSearchModalOpen}
              timerVisible={gameTimer.isTimerVisible}
            />
          </div>
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            {gameId !== null && (
              <MultiplayerCanvas gameId={gameId} onLoadDeck={() => setShowReloadDeckPicker(true)} undoStack={undoStack} onSearchModalChange={setIsSearchModalOpen} isTimerVisible={gameTimer.isTimerVisible} onToggleTimer={gameTimer.toggleTimerVisibility} />
            )}
            <GameToastContainer />
          </div>
        </div>
        {rightPanel}
        {/* Paragon drawer — self-hides when paragons list is empty. */}
        <ParagonDrawer paragons={paragonEntries} />
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
                onPlayAgain={opponentDisconnected || opponentResigned ? undefined : () => setPlayAgainTriggered(true)}
                rematchPending={rematchPending}
                myScore={gameState.myCards['land-of-redemption']?.length ?? 0}
                opponentScore={gameState.opponentCards['land-of-redemption']?.length ?? 0}
                timerDisplay={gameTimer.formatted}
                timerPaused={isSearchModalOpen}
                timerVisible={gameTimer.isTimerVisible}
              />
            </div>
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              <MultiplayerCanvas gameId={gameId} onLoadDeck={() => setShowReloadDeckPicker(true)} undoStack={undoStack} onSearchModalChange={setIsSearchModalOpen} isTimerVisible={gameTimer.isTimerVisible} onToggleTimer={gameTimer.toggleTimerVisibility} />
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
                  randomReserveToZone: (count, toZone, deckPosition) => gameState.randomReserveToZone(count, toZone, deckPosition),
                  reloadDeck: (deckId, deckData, paragon) => gameState.reloadDeck(deckId, deckData, paragon),
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
                onUndo={handleUndo}
                undoCount={undoStack.count}
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

          {/* Paragon drawer — self-hides when paragons list is empty. Rendered
              at the top level so it's a DOM sibling to the Konva canvas. */}
          <ParagonDrawer paragons={paragonEntries} />

          {/* Deck reload picker (available after game ends for rematch/practice) */}
          <DeckPickerModal
            open={showReloadDeckPicker}
            onOpenChange={(open) => setShowReloadDeckPicker(open)}
            onSelect={async (deck) => {
              const result = await loadDeckForGame(deck.id);
              setShowReloadDeckPicker(false);
              setReloadDeckConfirm({ deckId: deck.id, deckName: deck.name, deckData: JSON.stringify(result.deckData), paragon: deck.paragon || '' });
            }}
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
                      gameState.reloadDeck(reloadDeckConfirm.deckId, reloadDeckConfirm.deckData, reloadDeckConfirm.paragon);
                      gameTimer.reset();
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
              rematchPending={rematchPending}
              myScore={gameState.myCards['land-of-redemption']?.length ?? 0}
              opponentScore={gameState.opponentCards['land-of-redemption']?.length ?? 0}
              timerDisplay={gameTimer.formatted}
              timerPaused={isSearchModalOpen}
              timerVisible={gameTimer.isTimerVisible}
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
        {/* Paragon drawer — self-hides when paragons list is empty. */}
        <ParagonDrawer paragons={paragonEntries} />
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
            timerDisplay={gameTimer.formatted}
            timerPaused={isSearchModalOpen}
            timerVisible={gameTimer.isTimerVisible}
          />
        </div>
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {gameId !== null && (
            <MultiplayerCanvas gameId={gameId} onLoadDeck={() => setShowReloadDeckPicker(true)} undoStack={undoStack} onSearchModalChange={setIsSearchModalOpen} isTimerVisible={gameTimer.isTimerVisible} onToggleTimer={gameTimer.toggleTimerVisibility} />
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
              randomReserveToZone: (count, toZone, deckPosition) => gameState.randomReserveToZone(count, toZone, deckPosition),
              reloadDeck: (deckId, deckData, paragon) => gameState.reloadDeck(deckId, deckData, paragon),
            } satisfies GameActions}
            mode="multiplayer"
            isMyTurn={gameState.isMyTurn}
            isSpreadHand={isSpreadHand}
            onToggleSpreadHand={toggleSpreadHand}
            deckCount={gameState.myCards['deck']?.length ?? 0}
            handCount={gameState.myCards['hand']?.length ?? 0}
            onRollDice={() => gameState.rollDice(BigInt(20))}
            onShowToast={showGameToast}
            onUndo={handleUndo}
            undoCount={undoStack.count}
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

      {/* Paragon drawer — self-hides when paragons list is empty. Rendered at
          the top level so it's a DOM sibling to the Konva canvas, not inside. */}
      <ParagonDrawer paragons={paragonEntries} />

      {/* Deck reload picker */}
      <DeckPickerModal
        open={showReloadDeckPicker}
        onOpenChange={(open) => setShowReloadDeckPicker(open)}
        onSelect={async (deck) => {
          const result = await loadDeckForGame(deck.id);
          setShowReloadDeckPicker(false);
          setReloadDeckConfirm({ deckId: deck.id, deckName: deck.name, deckData: JSON.stringify(result.deckData), paragon: deck.paragon || '' });
        }}
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
                  gameState.reloadDeck(reloadDeckConfirm.deckId, reloadDeckConfirm.deckData, reloadDeckConfirm.paragon);
                  gameTimer.reset();
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
