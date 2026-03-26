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
import { GameToastContainer, showGameToast } from '@/app/shared/components/GameToast';
import type { GameActions } from '@/app/shared/types/gameActions';
import WaitingRoomGoldfish from '../components/WaitingRoomGoldfish';
import { SpreadHandProvider, useSpreadHand } from '../contexts/SpreadHandContext';
import { convertToGoldfishDeck, type GameCardData } from '../utils/convertToGoldfishDeck';
import PregameScreen from '../components/PregameScreen';
import { DeckPickerModal } from '../components/DeckPickerModal';
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
      <CardPreviewProvider storageKey="multiplayer-loupe-visible">
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

// ---------------------------------------------------------------------------
// Waiting screen — shown while waiting for opponent
// ---------------------------------------------------------------------------

function CopyButton({ text, label, icon, inline }: { text: string; label: string; icon: 'copy' | 'link'; inline?: boolean }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (inline) {
    return (
      <button
        onClick={handleCopy}
        title={label}
        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        {copied ? (
          <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
        )}
      </button>
    );
  }

  return (
    <button
      onClick={handleCopy}
      title={label}
      className="flex items-center gap-2 px-4 py-2 rounded-md text-sm border border-border bg-card hover:bg-muted transition-colors"
    >
      {copied ? (
        <>
          <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          <span className="text-primary">Copied!</span>
        </>
      ) : icon === 'copy' ? (
        <>
          <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
          <span>Copy Code</span>
        </>
      ) : (
        <>
          <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
          </svg>
          <span>Invite Link</span>
        </>
      )}
    </button>
  );
}

function WaitingScreen({ code, goldfishDeck, onPractice, onUpdateMessage }: {
  code: string;
  goldfishDeck: import('@/app/goldfish/types').DeckDataForGoldfish | null;
  onPractice: () => void;
  onUpdateMessage?: (message: string) => void;
}) {
  const [message, setMessage] = useState('');
  const [messageSaved, setMessageSaved] = useState(false);

  function handleSaveMessage() {
    if (!onUpdateMessage) return;
    onUpdateMessage(message);
    setMessageSaved(true);
    setTimeout(() => setMessageSaved(false), 2000);
  }

  return (
    <>
    <TopNav />
    <div className="flex min-h-[calc(100vh-56px)] items-center justify-center px-4">
      <div className="rounded-xl border border-border bg-card/95 backdrop-blur-sm p-8 sm:p-10 text-center max-w-md w-full">
        {/* Code display */}
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-cinzel">Game Code</p>
        <div className="flex items-center justify-center gap-3 mt-2">
          <p className="font-mono text-5xl sm:text-6xl font-bold tracking-wider text-foreground">{code}</p>
          <CopyButton text={code} label="Copy code" icon="copy" inline />
        </div>

        {/* Status */}
        <p className="mt-5 text-sm text-muted-foreground">Waiting for opponent to join...</p>
        <div className="mt-3 flex justify-center gap-1.5">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
        </div>

        {/* Lobby message */}
        {onUpdateMessage && (
          <div className="mt-5">
            <div className="flex gap-2">
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 100))}
                placeholder="Lobby message (optional)"
                maxLength={100}
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary"
              />
              <button
                onClick={handleSaveMessage}
                disabled={messageSaved}
                className="shrink-0 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted transition-colors disabled:opacity-50"
              >
                {messageSaved ? 'Saved' : 'Set'}
              </button>
            </div>
          </div>
        )}

        {/* Share actions */}
        <div className="mt-6 flex justify-center gap-2">
          <CopyButton
            text={typeof window !== 'undefined' ? `${window.location.origin}/play?join=${code}` : code}
            label="Copy invite link"
            icon="link"
          />
        </div>

        {/* Practice */}
        {goldfishDeck && (
          <>
            <div className="my-6 h-px bg-border" />
            <button
              onClick={onPractice}
              className="w-full py-3 rounded-lg border border-border hover:bg-muted/50 transition-colors font-cinzel tracking-wide text-sm"
            >
              Practice While You Wait
            </button>
          </>
        )}

        <a
          href="/play"
          className="mt-4 inline-block text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        >
          Back to lobby
        </a>
      </div>
    </div>
    </>
  );
}

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

  // Once connected, call the appropriate reducer once
  useEffect(() => {
    if ((!isConnected && !isActive) || !conn || didCallReducer.current) return;
    didCallReducer.current = true;

    if (!gameParams) {
      setErrorMessage('No game parameters found. Please return to the lobby.');
      setLifecycle('error');
      return;
    }

    // Reconnect scenario: if we're the creator and the game already exists,
    // skip the createGame call (it would fail with "code already in use").
    // Joiners must always call joinGame — they see the game via subscription
    // before joining, so we can't use game existence as a skip signal for them.
    if (gameParams.role === 'create') {
      const existingGames = [...(gameState.allGames || [])];
      const existingGame = existingGames.find((g: any) => g.code === code);
      if (existingGame) {
        setGameId(existingGame.id);
        return; // lifecycle sync effect handles the rest
      }
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
          isPublic: gameParams.isPublic ?? true,
          lobbyMessage: gameParams.lobbyMessage ?? '',
        });
        // Transition to waiting — the game row will appear via subscription
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

  // Fast detection: once subscription data arrives and we're still 'joining',
  // check if a game with our code exists. If not, fail immediately.
  useEffect(() => {
    if (lifecycle !== 'joining') return;
    const { allGames } = gameState;
    if (!allGames || allGames.length === 0) return; // subscription not applied yet
    const found = allGames.find((g: any) => g.code === code);
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
    }, 5000);
    return () => clearTimeout(timeout);
  }, [lifecycle, code]);

  // Sync lifecycle state from live game data
  useEffect(() => {
    const { game } = gameState;
    if (!game) return;

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
      setLifecycle('finished');
    }
  }, [gameState.game, lifecycle]);

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

  if (lifecycle === 'error') {
    const isGameNotFound = errorMessage?.includes('No game found');
    return (
      <>
      <TopNav />
      <div className="flex min-h-[calc(100vh-56px)] items-center justify-center px-4">
        <div className="rounded-lg border border-border bg-card/95 backdrop-blur-sm p-8 text-center max-w-sm">
          {/* Visual anchor */}
          <div className="mb-4 flex justify-center">
            <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center">
              {isGameNotFound ? (
                <svg className="w-8 h-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
              ) : (
                <svg className="w-8 h-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              )}
            </div>
          </div>
          <p className="text-lg font-semibold font-cinzel mb-2">
            {isGameNotFound ? 'Game Not Found' : 'Connection Error'}
          </p>
          <p className="text-sm text-muted-foreground">
            {isGameNotFound
              ? `No game found with code "${code}".`
              : (errorMessage ?? 'An unexpected error occurred.')}
          </p>
          {isGameNotFound && (
            <p className="text-xs text-muted-foreground/70 mt-1">
              The game may have ended, or the code may be wrong.
            </p>
          )}
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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="text-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto" />
          <p className="text-sm text-foreground">
            {lifecycle === 'joining' ? `Joining game ${code}...` : 'Setting up game...'}
          </p>
          {lifecycle === 'joining' && (
            <p className="text-xs text-muted-foreground mt-2">
              Looking for game room...
            </p>
          )}
        </div>
      </div>
    );
  }

  if (lifecycle === 'waiting') {
    if (isPracticing && goldfishDeck) {
      return (
        <div className="fixed inset-0 bg-background">
          {/* Floating banner */}
          <div className="fixed top-0 inset-x-0 z-50 h-12 flex items-center justify-between px-4 bg-background/90 backdrop-blur-sm border-b border-border">
            <div className="flex items-center gap-3">
              <span className="font-mono text-lg font-bold tracking-wider">{code}</span>
              <span className="text-sm text-muted-foreground">Waiting for opponent</span>
              <span className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <span key={i} className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </span>
            </div>
            <button
              onClick={() => setIsPracticing(false)}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Exit Practice
            </button>
          </div>
          <div className="pt-12">
            <WaitingRoomGoldfish deck={goldfishDeck} />
          </div>
        </div>
      );
    }

    return (
      <WaitingScreen
        code={code}
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
      borderLeft: isLoupeVisible ? '1px solid rgba(107, 78, 39, 0.3)' : 'none',
      overflow: 'hidden',
      transition: 'width 0.2s ease',
    }}>
      <button
        onClick={toggleLoupe}
        title={isLoupeVisible ? 'Hide panel (Tab)' : 'Show panel (Tab)'}
        style={{
          width: '100%',
          height: 40,
          minHeight: 40,
          background: 'rgba(30, 22, 16, 0.92)',
          borderTop: 'none',
          borderLeft: 'none',
          borderRight: 'none',
          borderBottom: isLoupeVisible ? '1px solid rgba(107, 78, 39, 0.4)' : 'none',
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
          <span style={{ fontSize: 14 }}>‹</span>
        )}
      </button>
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
            />
          </div>
        </>
      )}
    </div>
  );

  if (lifecycle === 'pregame') {
    const phase = gameState.game?.pregamePhase;

    // rolling / choosing: render game canvas with pregame overlay
    // Cards are already loaded — players can see their hand
    return (
      <div style={{ display: 'flex', width: '100vw', height: '100dvh', backgroundImage: 'url(/gameplay/cave_background.png)', backgroundSize: 'cover', backgroundPosition: 'center' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Pregame status bar instead of TurnIndicator */}
          <div style={{
            flexShrink: 0,
            height: 48,
            background: 'rgba(10, 8, 5, 0.96)',
            borderBottom: '1px solid rgba(107, 78, 39, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}>
            <span style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 11,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'rgba(196, 149, 90, 0.6)',
            }}>
              {phase === 'rolling' ? 'Rolling for first player...' : 'Choosing who goes first...'}
            </span>
          </div>
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            {gameId !== null && (
              <MultiplayerCanvas gameId={gameId} />
            )}
            {/* Pregame overlay — pointer events pass through backdrop, only modal blocks */}
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, pointerEvents: 'none' }}>
              <div style={{ pointerEvents: 'auto' }}>
                <PregameScreen
                  gameId={gameId!}
                  gameState={gameState}
                  code={code}
                />
              </div>
            </div>
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
    const { winnerName } = deriveEndReason(gameState.gameActions, gameState.myPlayer);

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
                isMyTurn={false}
                onSetPhase={() => {}}
                onEndTurn={() => {}}
                isFinished
                winnerName={winnerName}
                onPlayAgain={() => setPlayAgainTriggered(true)}
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
              isMyTurn={false}
              onSetPhase={() => {}}
              onEndTurn={() => {}}
              isFinished
              winnerName={winnerName}
              onPlayAgain={() => setPlayAgainTriggered(true)}
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
            isMyTurn={gameState.isMyTurn}
            onSetPhase={gameState.setPhase}
            onEndTurn={gameState.endTurn}
            onConcede={gameState.resignGame}
          />
        </div>
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {gameId !== null && (
            <MultiplayerCanvas gameId={gameId} />
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
            onLoadDeck={() => setShowReloadDeckPicker(true)}
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
            background: 'var(--gf-bg, #1a1410)', border: '1px solid var(--gf-border, #3d2e1f)',
            borderRadius: 8, padding: 24, maxWidth: 400, textAlign: 'center',
          }}>
            <p style={{ color: 'var(--gf-text, #e8d5a3)', marginBottom: 16, fontSize: 14 }}>
              This will clear all your cards from the game and load <strong>{reloadDeckConfirm.deckName}</strong>. Continue?
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button
                onClick={() => setReloadDeckConfirm(null)}
                style={{
                  padding: '8px 20px', background: 'transparent',
                  border: '1px solid var(--gf-border, #3d2e1f)',
                  borderRadius: 4, color: 'var(--gf-text-dim, #a89070)', cursor: 'pointer',
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
                  padding: '8px 20px', background: 'rgba(196,149,90,0.2)',
                  border: '1px solid #c4955a', borderRadius: 4,
                  color: '#e8d5a3', cursor: 'pointer',
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
