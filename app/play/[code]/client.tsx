'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useSpacetimeConnection } from '@/app/play/hooks/useSpacetimeConnection';
import { SpacetimeProvider } from '@/app/play/lib/spacetimedb-provider';
import { useGameState } from '@/app/play/hooks/useGameState';
import { useSpacetimeDB } from 'spacetimedb/react';
import GameOverOverlay from '@/app/play/components/GameOverOverlay';
import TurnIndicator from '@/app/play/components/TurnIndicator';
import ChatPanel from '../components/ChatPanel';
import { CardPreviewProvider } from '@/app/goldfish/state/CardPreviewContext';
import { CardLoupePanel } from '@/app/goldfish/components/CardLoupePanel';
import TopNav from '@/components/top-nav';
import WaitingRoomGoldfish from '../components/WaitingRoomGoldfish';
import { convertToGoldfishDeck, type GameCardData } from '../utils/convertToGoldfishDeck';

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
        <GameInner code={code} isConnected={isConnected} />
      </CardPreviewProvider>
    </SpacetimeProvider>
  );
}

// ---------------------------------------------------------------------------
// Inner component — must live inside SpacetimeProvider to use SpacetimeDB hooks
// ---------------------------------------------------------------------------
type LifecycleState = 'creating' | 'joining' | 'waiting' | 'playing' | 'finished' | 'error';

// ---------------------------------------------------------------------------
// Waiting screen — shown while waiting for opponent
// ---------------------------------------------------------------------------

function CopyButton({ text, label, icon }: { text: string; label: string; icon: 'copy' | 'link' }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
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
        <p className="font-mono text-5xl sm:text-6xl font-bold tracking-wider text-foreground mt-2">{code}</p>

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
          <CopyButton text={code} label="Copy code" icon="copy" />
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
  const [gameId, setGameId] = useState<bigint | null>(null);
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

  // Note: removed isLoading gate — subscribeApplied is unreliable for the host
  // (tables that were empty at subscribe time may never flip to applied).
  // The canvas handles missing data gracefully with fallbacks.

  // ---------------------------------------------------------------------------
  // Return to lobby handler used by GameOverOverlay
  // ---------------------------------------------------------------------------
  function handleReturnToLobby() {
    router.push('/play');
  }

  // ---------------------------------------------------------------------------
  // Right panel — card preview (loupe) on top, chat below
  // ---------------------------------------------------------------------------
  const rightPanel = (
    <div style={{
      width: 'clamp(280px, 20vw, 380px)',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      background: 'rgba(10, 8, 5, 0.97)',
      borderLeft: '1px solid rgba(107, 78, 39, 0.3)',
      overflow: 'hidden',
    }}>
      {/* Card preview — top portion, override loupe width to fill parent */}
      <div style={{ flexShrink: 0, overflow: 'hidden' }}>
        <div style={{ width: '100%' }}>
          <CardLoupePanel alwaysVisible />
        </div>
      </div>
      {/* Chat — fills remaining space */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', borderTop: '1px solid rgba(107, 78, 39, 0.3)' }}>
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
        <div style={{ display: 'flex', width: '100vw', height: '100dvh', backgroundImage: 'url(/gameplay/cave_background.png)', backgroundSize: 'cover', backgroundPosition: 'center' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden', pointerEvents: 'none' }}>
              <MultiplayerCanvas gameId={gameId} />
              <GameOverOverlay
                game={gameState.game}
                myPlayer={gameState.myPlayer}
                opponentPlayer={gameState.opponentPlayer}
                gameActions={gameState.gameActions}
                onReturnToLobby={handleReturnToLobby}
              />
            </div>
            <div style={{ flexShrink: 0, height: 56 }}>
              <TurnIndicator
                game={gameState.game}
                myPlayer={gameState.myPlayer}
                opponentPlayer={gameState.opponentPlayer}
                isMyTurn={gameState.isMyTurn}
                onSetPhase={gameState.setPhase}
                onEndTurn={gameState.endTurn}
                onDrawCard={gameState.drawCard}
                onRollDice={() => gameState.rollDice(BigInt(20))}
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
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <GameOverOverlay
              game={gameState.game}
              myPlayer={gameState.myPlayer}
              opponentPlayer={gameState.opponentPlayer}
              gameActions={gameState.gameActions}
              onReturnToLobby={handleReturnToLobby}
            />
          </div>
          <div style={{ flexShrink: 0, height: 56 }}>
            <TurnIndicator
              game={gameState.game}
              myPlayer={gameState.myPlayer}
              opponentPlayer={gameState.opponentPlayer}
              isMyTurn={gameState.isMyTurn}
              onSetPhase={gameState.setPhase}
              onEndTurn={gameState.endTurn}
              onDrawCard={gameState.drawCard}
              onRollDice={() => gameState.rollDice(BigInt(20))}
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
      {/* Canvas + phase bar */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {gameId !== null && (
            <MultiplayerCanvas gameId={gameId} />
          )}
        </div>
        <div style={{ flexShrink: 0, height: 56 }}>
          <TurnIndicator
            game={gameState.game}
            myPlayer={gameState.myPlayer}
            opponentPlayer={gameState.opponentPlayer}
            isMyTurn={gameState.isMyTurn}
            onSetPhase={gameState.setPhase}
            onEndTurn={gameState.endTurn}
            onDrawCard={gameState.drawCard}
            onRollDice={() => gameState.rollDice(BigInt(20))}
            onConcede={gameState.resignGame}
          />
        </div>
      </div>

      {/* Right panel — preview on top, chat below */}
      {rightPanel}
    </div>
  );
}
