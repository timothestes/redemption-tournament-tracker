'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import TopNav from '@/components/top-nav';
import { DeckPickerModal } from './DeckPickerModal';
import type { DeckOption } from './DeckPickerCard';
import { loadUserDecks, loadDeckForGame } from '../actions';
import type { GameState } from '../hooks/useGameState';

// ---------------------------------------------------------------------------
// Timing constants
// ---------------------------------------------------------------------------

const RITUAL_TUMBLE_MS = 1200;
const RITUAL_TUMBLE_FRAMES = 18;
const ROLLING_RESULT_DISPLAY_MS = 2200;
const CHOOSE_TIME_LIMIT_S = 30;
const REVEAL_AUTO_ACK_MS = 1500;

// ---------------------------------------------------------------------------
// OpponentDisconnectBanner — shown during pregame when opponent drops
// ---------------------------------------------------------------------------

function OpponentDisconnectBanner({ connectionStatus }: { connectionStatus: 'connected' | 'reconnecting' | 'disconnected' }) {
  if (connectionStatus === 'connected') return null;

  const isReconnecting = connectionStatus === 'reconnecting';

  return (
    <div className={`mb-3 rounded border px-3 py-2 text-xs ${
      isReconnecting
        ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300/90'
        : 'border-red-500/30 bg-red-500/10 text-red-300/90'
    }`}>
      <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle" style={{
        backgroundColor: isReconnecting ? '#eab308' : '#ef4444',
        boxShadow: `0 0 4px ${isReconnecting ? 'rgba(234, 179, 8, 0.6)' : 'rgba(239, 68, 68, 0.6)'}`,
      }} />
      {isReconnecting
        ? 'Opponent disconnected — waiting for reconnect...'
        : 'Opponent has left the game. It will be cancelled shortly.'}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PregameScreenProps {
  code: string;
  lifecycle: 'waiting' | 'pregame';
  gameId: bigint | null;
  gameState: GameState;
  myDisplayName: string;
  myDeckName?: string;
  goldfishDeck: import('@/app/goldfish/types').DeckDataForGoldfish | null;
  onPractice: () => void;
  onBackToLobby: () => void;
  onUpdateMessage?: (message: string) => void;
}

// ---------------------------------------------------------------------------
// PregameScreen — default export, unified layout shell
// ---------------------------------------------------------------------------

export default function PregameScreen({
  code,
  lifecycle,
  gameId,
  gameState,
  myDisplayName,
  myDeckName,
  goldfishDeck,
  onPractice,
  onBackToLobby,
  onUpdateMessage,
}: PregameScreenProps) {
  const { game, myPlayer, opponentPlayer } = gameState;

  const phase = game?.pregamePhase ?? 'deck_select';
  const isWaiting = lifecycle === 'waiting';

  // During pregame, if there's no myPlayer, show spectator view
  if (lifecycle === 'pregame' && !myPlayer && game) {
    return (
      <>
        <TopNav />
        <div className="flex min-h-[calc(100vh-56px)] items-center justify-center px-4">
          <SpectatorPregameView game={game} />
        </div>
      </>
    );
  }

  // Derive ready state from game flags
  const isSeat0 = myPlayer ? myPlayer.seat.toString() === '0' : false;
  const myReady = game ? (isSeat0 ? game.pregameReady0 : game.pregameReady1) : false;
  const opponentReady = game ? (isSeat0 ? game.pregameReady1 : game.pregameReady0) : false;

  // Derive roll results
  const myRoll = game ? (isSeat0 ? Number(game.rollResult0) : Number(game.rollResult1)) : 0;
  const opponentRoll = game ? (isSeat0 ? Number(game.rollResult1) : Number(game.rollResult0)) : 0;
  const iWonRoll = myPlayer && game ? myPlayer.seat.toString() === game.rollWinner : false;
  const opponentName = opponentPlayer?.displayName || 'Opponent';

  return (
    <>
      <TopNav />
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-black">
        {/* Cave background */}
        <div
          className="absolute inset-0 bg-cover bg-no-repeat opacity-40"
          style={{ backgroundImage: 'url(/gameplay/cave_background.png)', backgroundPosition: 'center 70%' }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 90% 85% at 50% 50%, transparent 60%, rgba(0,0,0,0.85) 100%)' }}
        />

        <div className="relative z-10 rounded-xl border border-amber-200/10 bg-black/60 backdrop-blur-sm p-6 sm:p-8 text-center max-w-md w-full mx-4">
          {/* Back to lobby */}
          <div className="text-left mb-4">
            <button
              onClick={onBackToLobby}
              className="inline-flex items-center gap-1 text-xs text-amber-200/40 hover:text-amber-200/60 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              Back to lobby
            </button>
          </div>

          {/* Game code header — always visible */}
          <GameCodeHeader code={code} />

          {/* Player cards */}
          <PlayerCards
            isWaiting={isWaiting}
            phase={phase}
            myDisplayName={myPlayer?.displayName ?? myDisplayName}
            myDeckName={myDeckName}
            myReady={myReady}
            opponentName={opponentName}
            opponentReady={opponentReady}
            hasOpponent={!!opponentPlayer}
            myRoll={myRoll}
            opponentRoll={opponentRoll}
            iWonRoll={iWonRoll}
            myPlayer={myPlayer}
            gameState={gameState}
            showDice={phase === 'rolling' || phase === 'choosing' || phase === 'revealing'}
          />

          {/* Action area — contextual */}
          <div className="mt-5">
            {isWaiting ? (
              <WaitingActions
                goldfishDeck={goldfishDeck}
                onPractice={onPractice}
                onUpdateMessage={onUpdateMessage}
              />
            ) : phase === 'deck_select' ? (
              // Nothing extra — player cards have the ready button
              myReady && !opponentReady ? (
                <>
                  <OpponentDisconnectBanner connectionStatus={gameState.opponentConnectionStatus} />
                  <p className="text-xs text-amber-200/40 font-cinzel tracking-wide">
                    Waiting for opponent to ready up...
                  </p>
                </>
              ) : null
            ) : phase === 'rolling' || phase === 'choosing' ? (
              <>
                <OpponentDisconnectBanner connectionStatus={gameState.opponentConnectionStatus} />
                <RollAndChooseArea
                  gameState={gameState}
                  phase={phase}
                  iWonRoll={iWonRoll}
                  opponentName={opponentName}
                  myPlayer={myPlayer}
                />
              </>
            ) : phase === 'revealing' ? (
              <>
                <OpponentDisconnectBanner connectionStatus={gameState.opponentConnectionStatus} />
                <RevealArea
                  gameState={gameState}
                  myPlayer={myPlayer}
                  opponentName={opponentName}
                  iWonRoll={iWonRoll}
                />
              </>
            ) : null}
          </div>

        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// GameCodeHeader — game code display + copy buttons
// ---------------------------------------------------------------------------

function GameCodeHeader({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copyInviteLink = () => {
    const url = typeof window !== 'undefined' ? `${window.location.origin}/play?join=${code}` : code;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mb-5">
      <p className="text-[10px] uppercase tracking-[0.2em] text-amber-200/50 font-cinzel">Game Code</p>
      <div className="flex items-center justify-center gap-2 mt-1">
        <p
          onClick={copyInviteLink}
          title="Copy invite link"
          className="font-mono text-4xl sm:text-5xl font-bold tracking-wider text-amber-200/90 cursor-pointer hover:text-amber-200 transition-colors select-none"
        >
          {code}
        </p>
        <button
          onClick={copyInviteLink}
          title="Copy invite link"
          className="p-1.5 rounded-md text-amber-200/40 hover:text-amber-200/80 transition-colors"
        >
          {copied ? (
            <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          )}
        </button>
      </div>
      {copied ? (
        <p className="mt-1 text-[10px] text-green-400 font-cinzel tracking-wide">Invite link copied!</p>
      ) : (
        <p className="mt-1 text-[10px] text-amber-200/25 font-cinzel tracking-wide">Tap to copy invite link</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PlayerCards — two-column grid with player info, dice, ready button
// ---------------------------------------------------------------------------

function PlayerCards({
  isWaiting,
  phase,
  myDisplayName,
  myDeckName,
  myReady,
  opponentName,
  opponentReady,
  hasOpponent,
  myRoll,
  opponentRoll,
  iWonRoll,
  myPlayer,
  gameState,
  showDice,
}: {
  isWaiting: boolean;
  phase: string;
  myDisplayName: string;
  myDeckName?: string;
  myReady: boolean;
  opponentName: string;
  opponentReady: boolean;
  hasOpponent: boolean;
  myRoll: number;
  opponentRoll: number;
  iWonRoll: boolean;
  myPlayer: any;
  gameState: GameState;
  showDice: boolean;
}) {
  const [myDecks, setMyDecks] = useState<DeckOption[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isChangingDeck, setIsChangingDeck] = useState(false);

  // Load user's decks on mount (for deck picker)
  useEffect(() => {
    loadUserDecks().then(setMyDecks).catch(() => {});
  }, []);

  const handleDeckSelected = async (deck: DeckOption) => {
    setPickerOpen(false);
    setIsChangingDeck(true);
    try {
      const result = await loadDeckForGame(deck.id);
      gameState.pregameChangeDeck(deck.id, JSON.stringify(result.deckData));
    } catch (e) {
      console.error('Failed to change deck:', e);
    } finally {
      setIsChangingDeck(false);
    }
  };

  const handleToggleReady = () => {
    gameState.pregameReady(!myReady);
  };

  const isDeckSelect = phase === 'deck_select' && !isWaiting;

  // Die animation state — track whether dice have been revealed for this session
  const [diceRevealed, setDiceRevealed] = useState(false);
  const [diceSkipped, setDiceSkipped] = useState(false);
  useEffect(() => {
    if (!showDice) return;
    // Start tumbling after a brief pause
    const timer = setTimeout(() => setDiceRevealed(true), 600);
    return () => clearTimeout(timer);
  }, [showDice]);

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {/* My card */}
        <div className="rounded-lg border border-[#c4955a]/30 bg-black/40 p-3 text-left">
          <p className="text-xs font-cinzel text-[#c4955a] truncate">{myDisplayName}</p>
          {isWaiting && (
            <p className="text-[10px] text-[#c4955a]/50 mt-1 font-cinzel tracking-wide">Ready</p>
          )}
          {isDeckSelect && (
            <p className="text-[10px] text-amber-200/40 mt-0.5 truncate">
              {myPlayer?.deckId ? (myDeckName || 'Deck selected') : 'No deck'}
            </p>
          )}

          {/* Dice during rolling+ phases */}
          {showDice && (
            <div className="mt-2 flex justify-center">
              <InlineDie
                finalValue={myRoll}
                accentColor="#c4955a"
                isWinner={iWonRoll}
                revealed={diceRevealed}
                skipAnimation={diceSkipped}
              />
            </div>
          )}

          {/* Ready button in deck_select */}
          {isDeckSelect && (
            <div className="mt-2 flex flex-col gap-1.5">
              {!myReady && (
                <button
                  onClick={() => setPickerOpen(true)}
                  disabled={isChangingDeck}
                  className="text-[10px] text-amber-200/40 hover:text-amber-200/70 transition-colors disabled:opacity-50"
                >
                  {isChangingDeck ? 'Loading...' : 'Change deck'}
                </button>
              )}
              <Button
                variant={myReady ? 'outline' : 'default'}
                size="sm"
                onClick={handleToggleReady}
                className={myReady
                  ? 'h-7 text-xs border-[#c4955a]/30 text-[#c4955a]/70 bg-[#c4955a]/10 hover:bg-[#c4955a]/20'
                  : 'h-7 text-xs bg-[#c4955a]/80 text-black hover:bg-[#c4955a]'
                }
              >
                {myReady ? 'Ready' : 'Ready up'}
              </Button>
            </div>
          )}
        </div>

        {/* Opponent card */}
        <div className="rounded-lg border border-[#4a7ab5]/30 bg-black/40 p-3 text-left">
          {isWaiting || !hasOpponent ? (
            <>
              <p className="text-xs font-cinzel text-[#4a7ab5]/60">Waiting</p>
              <div className="mt-2 flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#4a7ab5]/50 [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#4a7ab5]/50 [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#4a7ab5]/50" />
              </div>
            </>
          ) : (
            <>
              <p className="text-xs font-cinzel text-[#4a7ab5] truncate">{opponentName}</p>
              {isDeckSelect && (
                <p className="text-[10px] text-amber-200/40 mt-0.5">
                  {opponentReady ? 'Ready' : 'Selecting deck...'}
                </p>
              )}

              {/* Dice during rolling+ phases */}
              {showDice && (
                <div className="mt-2 flex justify-center">
                  <InlineDie
                    finalValue={opponentRoll}
                    accentColor="#4a7ab5"
                    isWinner={!iWonRoll}
                    revealed={diceRevealed}
                    skipAnimation={diceSkipped}
                  />
                </div>
              )}

              {isDeckSelect && opponentReady && (
                <div className="mt-2">
                  <span className="inline-block text-[10px] font-medium text-[#4a7ab5]/70 px-2 py-0.5 rounded-full bg-[#4a7ab5]/10">
                    Ready
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <DeckPickerModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={handleDeckSelected}
        myDecks={myDecks}
        selectedDeckId={myPlayer?.deckId}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// InlineDie — wraps RitualDie at size 56, with "Winner" label
// ---------------------------------------------------------------------------

function InlineDie({
  finalValue,
  accentColor,
  isWinner,
  revealed,
  skipAnimation,
}: {
  finalValue: number;
  accentColor: string;
  isWinner: boolean;
  revealed: boolean;
  skipAnimation?: boolean;
}) {
  // Only reveal the "Winner" label after the die has actually landed,
  // otherwise the result is spoiled before the tumble animation finishes.
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    if (skipAnimation) {
      setLanded(true);
      return;
    }
    if (!revealed) {
      setLanded(false);
      return;
    }
    const timer = setTimeout(() => setLanded(true), RITUAL_TUMBLE_MS);
    return () => clearTimeout(timer);
  }, [revealed, skipAnimation]);

  return (
    <div className="flex flex-col items-center gap-1">
      <RitualDie
        finalValue={finalValue}
        accentColor={accentColor}
        size={56}
        isWinner={isWinner}
        revealed={revealed}
        skipAnimation={skipAnimation}
      />
      {isWinner && landed && (
        <motion.span
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="text-[9px] font-cinzel uppercase tracking-widest"
          style={{ color: accentColor }}
        >
          Winner
        </motion.span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WaitingActions — lobby message + practice + invite link
// ---------------------------------------------------------------------------

function WaitingActions({
  goldfishDeck,
  onPractice,
  onUpdateMessage,
}: {
  goldfishDeck: import('@/app/goldfish/types').DeckDataForGoldfish | null;
  onPractice: () => void;
  onUpdateMessage?: (message: string) => void;
}) {
  const [message, setMessage] = useState('');
  const [messageSaved, setMessageSaved] = useState(false);
  const [messageExpanded, setMessageExpanded] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');

  function handleSaveMessage() {
    if (!onUpdateMessage) return;
    onUpdateMessage(message);
    setSavedMessage(message);
    setMessageSaved(true);
    setMessageExpanded(false);
    setTimeout(() => setMessageSaved(false), 2000);
  }

  return (
    <div>
      {/* Lobby message — pencil icon, expands on click */}
      {onUpdateMessage && (
        <div className="mt-2">
          {messageExpanded ? (
            <div className="flex gap-2">
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 100))}
                placeholder="Lobby message (optional)"
                maxLength={100}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveMessage();
                  if (e.key === 'Escape') setMessageExpanded(false);
                }}
                className="flex-1 rounded-md border border-amber-200/15 bg-black/40 px-3 py-2 text-sm text-amber-200/80 placeholder:text-amber-200/25 focus-visible:outline-none focus-visible:border-amber-200/30"
              />
              <button
                onClick={handleSaveMessage}
                className="shrink-0 rounded-md border border-amber-200/15 px-3 py-2 text-sm text-amber-200/60 hover:bg-amber-200/5 transition-colors"
              >
                Save
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setMessageExpanded(true)}
                title="Set lobby message"
                className="flex items-center gap-1 text-[10px] text-amber-200/30 hover:text-amber-200/50 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                </svg>
                {savedMessage ? (
                  <span className="max-w-[200px] truncate">{savedMessage}</span>
                ) : messageSaved ? (
                  <span className="text-green-400">Saved!</span>
                ) : (
                  <span>Set lobby message</span>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Practice */}
      {goldfishDeck && (
        <button
          onClick={onPractice}
          className="mt-4 w-full py-2.5 rounded-lg border border-amber-200/15 hover:bg-amber-200/5 transition-colors font-cinzel tracking-wide text-sm text-amber-200/60"
        >
          Practice While You Wait
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PregameCeremonyOverlay — floating overlay for rolling/choosing/revealing
// phases, rendered on top of the game board in client.tsx
// ---------------------------------------------------------------------------

export function PregameCeremonyOverlay({ gameState }: { gameState: GameState }) {
  const { game, myPlayer, opponentPlayer } = gameState;
  if (!game || !myPlayer) return null;

  const phase = game.pregamePhase;
  const isSeat0 = myPlayer.seat.toString() === '0';
  const myRoll = isSeat0 ? Number(game.rollResult0) : Number(game.rollResult1);
  const opponentRoll = isSeat0 ? Number(game.rollResult1) : Number(game.rollResult0);
  const iWonRoll = myPlayer.seat.toString() === game.rollWinner;
  const opponentName = opponentPlayer?.displayName || 'Opponent';

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
      <div className="pointer-events-auto rounded-xl border border-amber-200/10 bg-black/80 backdrop-blur-md p-6 sm:p-8 text-center max-w-md w-full mx-4">
        {/* Player cards with dice */}
        <PlayerCards
          isWaiting={false}
          phase={phase}
          myDisplayName={myPlayer.displayName}
          opponentName={opponentName}
          myReady={isSeat0 ? game.pregameReady0 : game.pregameReady1}
          opponentReady={isSeat0 ? game.pregameReady1 : game.pregameReady0}
          hasOpponent={!!opponentPlayer}
          myRoll={myRoll}
          opponentRoll={opponentRoll}
          iWonRoll={iWonRoll}
          myPlayer={myPlayer}
          gameState={gameState}
          showDice={true}
        />

        {/* Action area */}
        <div className="mt-5">
          {phase === 'rolling' || phase === 'choosing' ? (
            <RollAndChooseArea
              gameState={gameState}
              phase={phase}
              iWonRoll={iWonRoll}
              opponentName={opponentName}
              myPlayer={myPlayer}
            />
          ) : phase === 'revealing' ? (
            <RevealArea
              gameState={gameState}
              myPlayer={myPlayer}
              opponentName={opponentName}
              iWonRoll={iWonRoll}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RollAndChooseArea — winner announcement, choose buttons, timer
// ---------------------------------------------------------------------------

function RollAndChooseArea({
  gameState,
  phase,
  iWonRoll,
  opponentName,
  myPlayer,
}: {
  gameState: GameState;
  phase: string;
  iWonRoll: boolean;
  opponentName: string;
  myPlayer: any;
}) {
  const { game } = gameState;
  const hasChosenRef = useRef(false);

  // Compute seconds left from server-set deadline so a page refresh
  // doesn't reset the countdown and give extra time.
  const deadlineMicros = game?.choosingDeadlineMicros ?? 0n;
  const deadlineMs = Number(deadlineMicros / 1000n);
  const computeSecondsLeft = () => Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
  const [secondsLeft, setSecondsLeft] = useState(computeSecondsLeft);

  const mySeat = myPlayer?.seat;
  const isSeat0 = mySeat?.toString() === '0';
  const myRollAcked = game ? (isSeat0 ? game.pregameReady0 : game.pregameReady1) : false;

  // Winner name for announcement
  const winnerName = iWonRoll ? 'You win' : `${opponentName} wins`;

  // Show results = dice have landed (we track this via a brief delay)
  const [showResults, setShowResults] = useState(false);
  useEffect(() => {
    // Show results after tumble animation completes
    const timer = setTimeout(() => setShowResults(true), RITUAL_TUMBLE_MS + 700);
    return () => clearTimeout(timer);
  }, []);

  // Auto-acknowledge roll for the loser (after tumble + display time)
  useEffect(() => {
    if (iWonRoll || myRollAcked) return;
    if (phase !== 'rolling') return;
    const timer = setTimeout(() => {
      gameState.pregameAcknowledgeRoll();
    }, RITUAL_TUMBLE_MS + ROLLING_RESULT_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [iWonRoll, myRollAcked, phase, gameState]);

  // Countdown timer — synced to server deadline
  useEffect(() => {
    if (!showResults) return;
    const interval = setInterval(() => {
      const remaining = computeSecondsLeft();
      setSecondsLeft(remaining);
      if (remaining <= 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [showResults, deadlineMs]);

  // Auto-choose when timer expires — winner defaults to going first
  useEffect(() => {
    if (secondsLeft === 0 && iWonRoll && mySeat !== undefined) {
      handleChoose(mySeat);
    }
  }, [secondsLeft, iWonRoll]);

  const handleChoose = (seat: bigint) => {
    if (hasChosenRef.current) return;
    hasChosenRef.current = true;
    if (phase === 'rolling') {
      // Skip to reveal — roll + choose in one step
      gameState.pregameSkipToReveal(seat);
    } else {
      // Choosing phase
      gameState.pregameChooseFirst(seat);
    }
  };

  if (!game || !myPlayer || mySeat === undefined) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={showResults ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
      transition={{ duration: 0.5, delay: showResults ? 0.2 : 0 }}
      style={{ pointerEvents: showResults ? 'auto' : 'none' }}
    >
      <p className="font-cinzel text-sm font-bold text-amber-200/90 tracking-wide">
        {winnerName} the roll!
      </p>

      {iWonRoll ? (
        <div className="mt-3 flex flex-col gap-2">
          <button
            onClick={() => handleChoose(mySeat)}
            className="w-full py-2.5 rounded border border-[#c4955a]/45 bg-[#c4955a]/15 font-cinzel text-xs font-bold uppercase tracking-wider text-amber-200/90 hover:bg-[#c4955a]/25 transition-colors"
          >
            I&apos;ll go first
          </button>
          <button
            onClick={() => handleChoose(isSeat0 ? BigInt(1) : BigInt(0))}
            className="w-full py-2.5 rounded border border-amber-200/15 bg-transparent font-cinzel text-xs font-bold uppercase tracking-wider text-amber-200/50 hover:text-amber-200/70 transition-colors"
          >
            {opponentName} goes first
          </button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-amber-200/40">
          {myRollAcked ? 'Waiting for them to choose...' : 'Waiting...'}
        </p>
      )}

      {/* Timer bar */}
      {showResults && (
        <div className="mt-4">
          <div className="w-full h-[3px] rounded-sm bg-amber-200/[0.08] overflow-hidden">
            <motion.div
              initial={{ width: `${(secondsLeft / CHOOSE_TIME_LIMIT_S) * 100}%` }}
              animate={{ width: '0%' }}
              transition={{ duration: secondsLeft, ease: 'linear' }}
              className="h-full rounded-sm"
              style={{
                backgroundColor: secondsLeft <= 10 ? 'rgba(220, 120, 80, 0.6)' : 'rgba(196, 149, 90, 0.4)',
                transition: 'background-color 0.5s ease',
              }}
            />
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// RevealArea — brief result message, auto-acknowledge after 2.5s
// ---------------------------------------------------------------------------

function RevealArea({
  gameState,
  myPlayer,
  opponentName,
  iWonRoll,
}: {
  gameState: GameState;
  myPlayer: any;
  opponentName: string;
  iWonRoll: boolean;
}) {
  const { game } = gameState;
  if (!game || !myPlayer) return null;

  const isSeat0 = myPlayer.seat.toString() === '0';
  const alreadyAcked = isSeat0 ? game.pregameReady0 : game.pregameReady1;

  const firstSeat = game.currentTurn;
  const iGoFirst = myPlayer.seat === firstSeat;

  // Build contextual headline
  let headline: string;
  if (iWonRoll) {
    headline = iGoFirst ? 'You chose to go first' : `You chose ${opponentName} to go first`;
  } else {
    headline = iGoFirst
      ? `${opponentName} chose you to go first`
      : `${opponentName} chose to go first`;
  }

  // Auto-acknowledge after display time
  useEffect(() => {
    if (alreadyAcked) return;
    const timer = setTimeout(() => {
      gameState.pregameAcknowledgeFirst();
    }, REVEAL_AUTO_ACK_MS);
    return () => clearTimeout(timer);
  }, [alreadyAcked, gameState]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <p className="font-cinzel text-sm font-bold text-amber-200/90 tracking-wide">
        {headline}
      </p>
      <p className="mt-2 text-xs text-amber-200/40">
        {alreadyAcked ? 'Waiting for opponent...' : 'Starting game...'}
      </p>

      {/* Progress bar */}
      {!alreadyAcked && (
        <div className="mt-3">
          <div className="w-full h-[2px] rounded-sm bg-amber-200/[0.06] overflow-hidden">
            <motion.div
              initial={{ width: '100%' }}
              animate={{ width: '0%' }}
              transition={{ duration: REVEAL_AUTO_ACK_MS / 1000, ease: 'linear' }}
              className="h-full rounded-sm bg-[#c4955a]/40"
            />
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Pregame D20 face — hexagonal d20 SVG face
// ---------------------------------------------------------------------------

function PregameD20({ value, size, accentColor }: { value: number | '?'; size: number; accentColor: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <polygon
        points="50,4 96,27 96,73 50,96 4,73 4,27"
        fill="#1a1308"
        stroke={accentColor}
        strokeWidth={2}
      />
      <polygon
        points="50,12 88,31 88,69 50,88 12,69 12,31"
        fill="none"
        stroke={`${accentColor}30`}
        strokeWidth={1}
      />
      <text
        x="50"
        y="28"
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontSize="11"
        fill={`${accentColor}99`}
        letterSpacing="1"
      >
        d20
      </text>
      <text
        x="50"
        y="62"
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontSize="28"
        fontWeight="bold"
        fill="#e8d5a3"
      >
        {String(value)}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Spark particles — burst outward from center on die landing
// ---------------------------------------------------------------------------

const RITUAL_SPARK_COUNT = 10;

function SparkBurst({ color, size }: { color: string; size: number }) {
  const sparks = useMemo(() =>
    Array.from({ length: RITUAL_SPARK_COUNT }, (_, i) => {
      const angle = (i / RITUAL_SPARK_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const dist = size * 0.6 + Math.random() * size * 0.4;
      return {
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        delay: Math.random() * 0.08,
        scale: 0.5 + Math.random() * 0.8,
      };
    }),
  [size]);

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {sparks.map((s, i) => (
        <motion.div
          key={i}
          initial={{ x: size / 2, y: size / 2, scale: s.scale, opacity: 1 }}
          animate={{ x: size / 2 + s.x, y: size / 2 + s.y, scale: 0, opacity: 0 }}
          transition={{ duration: 0.5, delay: s.delay, ease: 'easeOut' }}
          style={{
            position: 'absolute',
            width: 4,
            height: 4,
            borderRadius: '50%',
            backgroundColor: color,
            boxShadow: `0 0 6px ${color}`,
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Animated tumbling die for the ritual
// ---------------------------------------------------------------------------

function RitualDie({
  finalValue,
  accentColor,
  size,
  isWinner,
  revealed,
  skipAnimation,
}: {
  finalValue: number;
  accentColor: string;
  size: number;
  isWinner: boolean;
  revealed: boolean;
  skipAnimation?: boolean;
}) {
  const [displayValue, setDisplayValue] = useState<number | '?'>('?');
  const [isTumbling, setIsTumbling] = useState(false);
  const [showSparks, setShowSparks] = useState(false);

  // Skip: immediately land on final value
  useEffect(() => {
    if (skipAnimation && displayValue !== finalValue) {
      setIsTumbling(false);
      setDisplayValue(finalValue);
      setShowSparks(true);
    }
  }, [skipAnimation, finalValue, displayValue]);

  useEffect(() => {
    if (!revealed || skipAnimation) {
      if (!skipAnimation) setDisplayValue('?');
      return;
    }

    setIsTumbling(true);
    let frame = 0;
    const interval = setInterval(() => {
      frame++;
      if (frame >= RITUAL_TUMBLE_FRAMES) {
        clearInterval(interval);
        setDisplayValue(finalValue);
        setIsTumbling(false);
        setShowSparks(true);
      } else {
        setDisplayValue(Math.floor(Math.random() * 20) + 1);
      }
    }, RITUAL_TUMBLE_MS / RITUAL_TUMBLE_FRAMES);

    return () => clearInterval(interval);
  }, [revealed, finalValue, skipAnimation]);

  return (
    <div style={{ position: 'relative', width: size, height: size, margin: '0 auto' }}>
      {/* Glow pulse behind die on landing */}
      <AnimatePresence>
        {!isTumbling && revealed && isWinner && (
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: [0.5, 1.6, 1.2], opacity: [0, 0.4, 0.15] }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            style={{
              position: 'absolute',
              inset: -size * 0.3,
              borderRadius: '50%',
              background: `radial-gradient(circle, ${accentColor}40 0%, transparent 70%)`,
              pointerEvents: 'none',
            }}
          />
        )}
      </AnimatePresence>

      {/* Spark burst on landing */}
      {showSparks && <SparkBurst color={accentColor} size={size} />}

      {/* The die itself */}
      <motion.div
        animate={
          isTumbling
            ? {
                scale: [0.85, 1.1, 0.92, 1.06, 0.97, 1.02, 1],
                rotate: [-8, 12, -6, 4, -2, 1, 0],
              }
            : {
                scale: isWinner ? [1, 1.08, 1] : 1,
                rotate: 0,
              }
        }
        transition={
          isTumbling
            ? { duration: RITUAL_TUMBLE_MS / 1000, ease: 'easeOut' }
            : isWinner
              ? { duration: 0.4, ease: 'easeOut' }
              : { duration: 0.15 }
        }
        style={{
          filter: !isTumbling && revealed && isWinner
            ? `drop-shadow(0 0 16px ${accentColor}60) drop-shadow(0 4px 20px rgba(0,0,0,0.6))`
            : 'drop-shadow(0 4px 20px rgba(0,0,0,0.6))',
          transition: 'filter 0.4s ease',
        }}
      >
        <PregameD20 value={displayValue} size={size} accentColor={accentColor} />
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SpectatorPregameView — keep exactly as-is from existing file
// ---------------------------------------------------------------------------

function SpectatorPregameView({ game }: { game: any }) {
  const phase = game.pregamePhase;

  return (
    <div className="rounded-xl border border-border bg-card/95 backdrop-blur-sm p-8 sm:p-10 text-center max-w-md w-full">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-cinzel">Spectating</p>
      <h2 className="text-2xl font-bold font-cinzel mt-2">
        {phase === 'deck_select' && 'Players Preparing...'}
        {phase === 'rolling' && 'Rolling for First Player...'}
        {phase === 'choosing' && 'Choosing Who Goes First...'}
        {phase === 'revealing' && 'First Player Chosen'}
      </h2>

      {phase === 'deck_select' && (
        <div className="mt-6 space-y-2">
          <div className="p-3 rounded-lg border border-border">
            <span className="text-sm">Player 1: </span>
            <span className="text-sm font-medium">{game.pregameReady0 ? 'Ready' : 'Selecting deck...'}</span>
          </div>
          <div className="p-3 rounded-lg border border-border">
            <span className="text-sm">Player 2: </span>
            <span className="text-sm font-medium">{game.pregameReady1 ? 'Ready' : 'Selecting deck...'}</span>
          </div>
        </div>
      )}

      {phase === 'rolling' && (
        <div className="mt-6 flex justify-center gap-8">
          <div className="w-16 h-16 rounded-xl border-2 border-border flex items-center justify-center text-2xl font-bold font-mono">
            {Number(game.rollResult0) || '?'}
          </div>
          <div className="flex items-center text-muted-foreground text-sm">vs</div>
          <div className="w-16 h-16 rounded-xl border-2 border-border flex items-center justify-center text-2xl font-bold font-mono">
            {Number(game.rollResult1) || '?'}
          </div>
        </div>
      )}

      {phase === 'choosing' && (
        <p className="mt-4 text-sm text-muted-foreground">
          Waiting for roll winner to choose...
        </p>
      )}

      {phase === 'revealing' && (
        <p className="mt-4 text-sm text-muted-foreground">
          Seat {Number(game.currentTurn) + 1} goes first. Game starting...
        </p>
      )}
    </div>
  );
}
