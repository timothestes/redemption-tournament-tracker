'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import TopNav from '@/components/top-nav';
import { DeckPickerModal } from './DeckPickerModal';
import type { DeckOption } from './DeckPickerCard';
import { loadUserDecks, loadDeckForGame } from '../actions';
import type { GameState } from '../hooks/useGameState';

interface PregameScreenProps {
  gameId: bigint;
  gameState: GameState;
  code: string;
}

export default function PregameScreen({ gameId, gameState, code }: PregameScreenProps) {
  const { game, myPlayer, opponentPlayer } = gameState;

  if (!game) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // Spectator view — no myPlayer means we're watching
  if (!myPlayer) {
    return (
      <>
        <TopNav />
        <div className="flex min-h-[calc(100vh-56px)] items-center justify-center px-4">
          <SpectatorPregameView game={game} />
        </div>
      </>
    );
  }

  const phase = game.pregamePhase;

  // rolling/choosing/revealing render as modal content (parent provides the overlay)
  if (phase === 'rolling') {
    // If this player already acknowledged the roll (skip or auto), show a
    // preview of the choosing phase so it feels like we've moved forward.
    const isSeat0 = myPlayer.seat.toString() === '0';
    const myRollAcked = isSeat0 ? game.pregameReady0 : game.pregameReady1;
    if (myRollAcked) {
      return <ChoosingPreview gameState={gameState} />;
    }
    return <RollingPhase gameState={gameState} gameId={gameId} />;
  }
  if (phase === 'choosing') {
    return <ChoosingPhase gameState={gameState} gameId={gameId} />;
  }
  if (phase === 'revealing') {
    return <RevealingPhase gameState={gameState} gameId={gameId} />;
  }

  // deck_select: full-screen with TopNav
  return (
    <>
      <TopNav />
      <div className="flex min-h-[calc(100vh-56px)] items-center justify-center px-4">
        <DeckSelectPhase gameState={gameState} gameId={gameId} />
      </div>
    </>
  );
}

function DeckSelectPhase({ gameState, gameId }: { gameState: GameState; gameId: bigint }) {
  const { game, myPlayer, opponentPlayer } = gameState;
  const [myDecks, setMyDecks] = useState<DeckOption[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isChangingDeck, setIsChangingDeck] = useState(false);

  // Load user's decks on mount
  useEffect(() => {
    loadUserDecks().then(setMyDecks).catch(() => {});
  }, []);

  if (!game || !myPlayer) return null;

  const mySeat = myPlayer.seat;
  const isSeat0 = mySeat.toString() === '0';
  const myReady = isSeat0 ? game.pregameReady0 : game.pregameReady1;
  const opponentReady = isSeat0 ? game.pregameReady1 : game.pregameReady0;

  const handleToggleReady = () => {
    gameState.pregameReady(!myReady);
  };

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

  return (
    <div className="rounded-xl border border-border bg-card/95 backdrop-blur-sm p-8 sm:p-10 text-center max-w-md w-full">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-cinzel">Pre-Game</p>
      <h2 className="text-2xl font-bold font-cinzel mt-2">Get Ready</h2>

      {/* My player section */}
      <div className="mt-6 p-4 rounded-lg border border-border bg-background/50">
        <div className="flex items-center justify-between">
          <div className="text-left">
            <p className="font-semibold">{myPlayer.displayName} <span className="text-xs text-muted-foreground">(you)</span></p>
            <p className="text-sm text-muted-foreground mt-0.5">
              Deck: {myPlayer.deckId ? 'Selected' : 'None'}
            </p>
          </div>
          {myReady ? (
            <span className="text-xs font-medium text-primary px-2 py-1 rounded-full bg-primary/10">Ready</span>
          ) : (
            <span className="text-xs text-muted-foreground">Not ready</span>
          )}
        </div>

        <div className="flex gap-2 mt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPickerOpen(true)}
            disabled={myReady || isChangingDeck}
          >
            {isChangingDeck ? 'Loading...' : 'Change Deck'}
          </Button>
          <Button
            variant={myReady ? 'outline' : 'default'}
            size="sm"
            onClick={handleToggleReady}
          >
            {myReady ? 'Un-ready' : 'Ready'}
          </Button>
        </div>
      </div>

      {/* Opponent section */}
      <div className="mt-3 p-4 rounded-lg border border-border bg-background/50">
        <div className="flex items-center justify-between">
          <p className="font-semibold">{opponentPlayer?.displayName || 'Opponent'}</p>
          {opponentReady ? (
            <span className="text-xs font-medium text-primary px-2 py-1 rounded-full bg-primary/10">Ready</span>
          ) : (
            <span className="text-xs text-muted-foreground">Selecting deck...</span>
          )}
        </div>
      </div>

      {/* Status hint */}
      {myReady && !opponentReady && (
        <p className="mt-4 text-sm text-muted-foreground">Waiting for opponent to ready up...</p>
      )}

      <DeckPickerModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={handleDeckSelected}
        myDecks={myDecks}
        selectedDeckId={myPlayer.deckId}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pregame D20 face — reuses the same hexagonal SVG from DiceOverlay
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

const RITUAL_TUMBLE_MS = 1200;
const RITUAL_TUMBLE_FRAMES = 18;

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
// Rolling phase — animated ritual
// ---------------------------------------------------------------------------

const ROLLING_PAUSE_MS = 600;
const ROLLING_RESULT_DISPLAY_MS = 2200;
const ROLLING_TOTAL_MS = ROLLING_PAUSE_MS + RITUAL_TUMBLE_MS + ROLLING_RESULT_DISPLAY_MS;

function RollingPhase({ gameState, gameId }: { gameState: GameState; gameId: bigint }) {
  const { game, myPlayer, opponentPlayer } = gameState;
  const [revealed, setRevealed] = useState(false);
  const [skipped, setSkipped] = useState(false);

  // Start the tumble after a brief dramatic pause
  useEffect(() => {
    if (skipped) return;
    const timer = setTimeout(() => setRevealed(true), ROLLING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [skipped]);

  // Auto-advance after tumble + display time
  const alreadyAcknowledged = game && myPlayer
    ? (myPlayer.seat.toString() === '0' ? game.pregameReady0 : game.pregameReady1)
    : false;

  // Auto-advance only for the loser — the winner chooses manually via buttons
  const iAmWinner = game && myPlayer ? myPlayer.seat.toString() === game.rollWinner : false;
  useEffect(() => {
    if (iAmWinner || skipped || alreadyAcknowledged) return;
    if (!revealed) return;
    const timer = setTimeout(() => {
      gameState.pregameAcknowledgeRoll();
    }, RITUAL_TUMBLE_MS + ROLLING_RESULT_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [revealed, skipped, alreadyAcknowledged, iAmWinner, gameState]);

  // Loser skip — just acknowledge the roll
  const handleSkip = () => {
    if (skipped || alreadyAcknowledged) return;
    setSkipped(true);
    setRevealed(true);
    gameState.pregameAcknowledgeRoll();
  };

  if (!game || !myPlayer) return null;

  const mySeat = myPlayer.seat;
  const isSeat0 = mySeat.toString() === '0';
  const myRoll = isSeat0 ? Number(game.rollResult0) : Number(game.rollResult1);
  const opponentRoll = isSeat0 ? Number(game.rollResult1) : Number(game.rollResult0);
  const iWon = mySeat.toString() === game.rollWinner;
  const winnerName = iWon ? myPlayer.displayName : (opponentPlayer?.displayName || 'Opponent');

  // Winner choose — acknowledge roll + choose first in one step, skip to revealing
  const hasChosenRef = useRef(false);
  const handleChooseFirst = (seat: bigint) => {
    if (hasChosenRef.current) return;
    hasChosenRef.current = true;
    gameState.pregameSkipToReveal(seat);
  };

  // Show results = tumble finished (revealed + tumble duration elapsed), or skipped
  const [showResults, setShowResults] = useState(false);
  useEffect(() => {
    if (skipped) {
      setShowResults(true);
      return;
    }
    if (!revealed) return;
    const timer = setTimeout(() => setShowResults(true), RITUAL_TUMBLE_MS + 100);
    return () => clearTimeout(timer);
  }, [revealed, skipped]);

  // Auto-choose when timer expires — winner defaults to going first
  useEffect(() => {
    if (!showResults || !iWon) return;
    const timer = setTimeout(() => {
      handleChooseFirst(mySeat);
    }, CHOOSE_TIME_LIMIT_S * 1000);
    return () => clearTimeout(timer);
  }, [showResults, iWon]);

  const dieSize = 88;

  return (
    <div style={{
      background: 'rgba(14, 10, 6, 0.97)',
      border: '1px solid rgba(107, 78, 39, 0.3)',
      borderRadius: 10,
      padding: '36px 32px',
      textAlign: 'center',
      maxWidth: 400,
      width: '100%',
      boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(196, 149, 90, 0.08)',
    }}>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        style={{
          fontFamily: 'var(--font-cinzel), Georgia, serif',
          fontSize: 10,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'rgba(196, 149, 90, 0.5)',
        }}
      >Dice Roll</motion.p>
      <motion.h2
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        style={{
          fontFamily: 'var(--font-cinzel), Georgia, serif',
          fontSize: 22,
          fontWeight: 700,
          color: '#e8d5a3',
          marginTop: 8,
          textShadow: '0 1px 6px rgba(0,0,0,0.5)',
        }}
      >Who Goes First?</motion.h2>

      {/* 3-column grid */}
      <div style={{
        marginTop: 28,
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        gap: 16,
      }}>
        {/* My die column */}
        <motion.div
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
          style={{ textAlign: 'center' }}
        >
          <p style={{
            fontFamily: 'Georgia, serif',
            fontSize: 12,
            color: '#c4955a',
            marginBottom: 10,
            letterSpacing: '0.06em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>{myPlayer.displayName}</p>
          <RitualDie
            finalValue={myRoll}
            accentColor="#c4955a"
            size={dieSize}
            isWinner={iWon}
            revealed={revealed}
            skipAnimation={skipped}
          />
        </motion.div>

        {/* VS divider */}
        <motion.span
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, delay: 0.3 }}
          style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 11,
            color: 'rgba(196, 149, 90, 0.3)',
            letterSpacing: '0.1em',
            userSelect: 'none',
          }}
        >VS</motion.span>

        {/* Opponent die column */}
        <motion.div
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
          style={{ textAlign: 'center' }}
        >
          <p style={{
            fontFamily: 'Georgia, serif',
            fontSize: 12,
            color: '#4a7ab5',
            marginBottom: 10,
            letterSpacing: '0.06em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>{opponentPlayer?.displayName || 'Opponent'}</p>
          <RitualDie
            finalValue={opponentRoll}
            accentColor="#4a7ab5"
            size={dieSize}
            isWinner={!iWon}
            revealed={revealed}
            skipAnimation={skipped}
          />
        </motion.div>
      </div>

      {/* Winner announcement + action area — fades in after dice land */}
      <motion.div
        animate={showResults ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
        transition={{ duration: 0.5, delay: showResults ? 0.2 : 0 }}
        style={{ marginTop: 24, pointerEvents: showResults ? 'auto' : 'none' }}
      >
        <p style={{
          fontFamily: 'var(--font-cinzel), Georgia, serif',
          fontSize: 15,
          fontWeight: 700,
          color: '#e8d5a3',
          letterSpacing: '0.06em',
          textShadow: '0 1px 4px rgba(0,0,0,0.5)',
        }}>
          {winnerName} wins the roll!
        </p>

        {/* Winner gets choice buttons immediately; loser sees skip */}
        {iWon ? (
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              onClick={() => handleChooseFirst(mySeat)}
              style={{
                padding: '10px 20px',
                borderRadius: 4,
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                border: '1px solid rgba(196, 149, 90, 0.45)',
                background: 'rgba(196, 149, 90, 0.15)',
                color: '#e8d5a3',
                transition: 'all 0.15s ease',
              }}
            >
              I&apos;ll go first
            </button>
            <button
              onClick={() => handleChooseFirst(mySeat.toString() === '0' ? BigInt(1) : BigInt(0))}
              style={{
                padding: '10px 20px',
                borderRadius: 4,
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                border: '1px solid rgba(107, 78, 39, 0.3)',
                background: 'transparent',
                color: 'rgba(196, 149, 90, 0.6)',
                transition: 'all 0.15s ease',
              }}
            >
              {opponentPlayer?.displayName || 'Opponent'} goes first
            </button>
          </div>
        ) : (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            onClick={handleSkip}
            disabled={alreadyAcknowledged}
            style={{
              marginTop: 12,
              background: 'none',
              border: 'none',
              fontFamily: 'Georgia, serif',
              fontSize: 11,
              color: 'rgba(196, 149, 90, 0.35)',
              cursor: alreadyAcknowledged ? 'default' : 'pointer',
              letterSpacing: '0.06em',
              padding: '4px 8px',
            }}
          >
            {alreadyAcknowledged ? 'Waiting for opponent to choose...' : 'Skip'}
          </motion.button>
        )}
      </motion.div>

      {/* Countdown bar — rolling animation timer (before results) or choosing timer (after results) */}
      <div style={{ marginTop: 20 }}>
        <div style={{
          width: '100%',
          height: 3,
          borderRadius: 2,
          backgroundColor: 'rgba(232,213,163,0.08)',
          overflow: 'hidden',
        }}>
          {!showResults && !skipped ? (
            <motion.div
              key="rolling-bar"
              initial={{ width: '100%' }}
              animate={{ width: '0%' }}
              transition={{ duration: ROLLING_TOTAL_MS / 1000, ease: 'linear' }}
              style={{
                height: '100%',
                borderRadius: 2,
                backgroundColor: 'rgba(196, 149, 90, 0.4)',
              }}
            />
          ) : (
            <motion.div
              key="choosing-bar"
              initial={{ width: '100%' }}
              animate={{ width: '0%' }}
              transition={{ duration: CHOOSE_TIME_LIMIT_S, ease: 'linear' }}
              style={{
                height: '100%',
                borderRadius: 2,
                backgroundColor: 'rgba(196, 149, 90, 0.4)',
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Choosing preview — shown when player acknowledged roll but opponent hasn't yet.
// Mirrors the choosing phase layout so the transition feels seamless.
// ---------------------------------------------------------------------------

function ChoosingPreview({ gameState }: { gameState: GameState }) {
  const { game, myPlayer, opponentPlayer } = gameState;
  const [secondsLeft, setSecondsLeft] = useState(CHOOSE_TIME_LIMIT_S);
  if (!game || !myPlayer) return null;

  const iWon = myPlayer.seat.toString() === game.rollWinner;
  const winnerName = iWon ? 'You' : (opponentPlayer?.displayName || 'Opponent');

  // Countdown for the loser's waiting view
  useEffect(() => {
    if (iWon) return;
    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [iWon]);

  return (
    <div style={{
      background: 'rgba(14, 10, 6, 0.97)',
      border: '1px solid rgba(107, 78, 39, 0.3)',
      borderRadius: 8,
      padding: '40px 48px',
      textAlign: 'center',
      maxWidth: 420,
      width: '100%',
      boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(196, 149, 90, 0.08)',
    }}>
      <p style={{
        fontFamily: 'var(--font-cinzel), Georgia, serif',
        fontSize: 10,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: 'rgba(196, 149, 90, 0.5)',
      }}>First Player</p>

      <h2 style={{
        fontFamily: 'var(--font-cinzel), Georgia, serif',
        fontSize: 22,
        fontWeight: 700,
        color: '#e8d5a3',
        marginTop: 8,
        textShadow: '0 1px 6px rgba(0,0,0,0.9)',
      }}>{winnerName} Won the Roll{iWon ? '!' : ''}</h2>

      <p style={{
        marginTop: 16,
        fontSize: 13,
        color: 'rgba(196, 149, 90, 0.45)',
        fontFamily: 'Georgia, serif',
      }}>
        {iWon ? 'Waiting for opponent to finish rolling...' : 'Waiting for them to choose who goes first...'}
      </p>

      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center', gap: 6 }}>
        <span className="animate-bounce [animation-delay:-0.3s]" style={{ width: 6, height: 6, borderRadius: '50%', background: '#c4955a' }} />
        <span className="animate-bounce [animation-delay:-0.15s]" style={{ width: 6, height: 6, borderRadius: '50%', background: '#c4955a' }} />
        <span className="animate-bounce" style={{ width: 6, height: 6, borderRadius: '50%', background: '#c4955a' }} />
      </div>

      {!iWon && (
        <div style={{ marginTop: 20 }}>
          <div style={{
            width: '100%',
            height: 3,
            borderRadius: 2,
            backgroundColor: 'rgba(232,213,163,0.08)',
            overflow: 'hidden',
          }}>
            <motion.div
              initial={{ width: '100%' }}
              animate={{ width: '0%' }}
              transition={{ duration: CHOOSE_TIME_LIMIT_S, ease: 'linear' }}
              style={{
                height: '100%',
                borderRadius: 2,
                backgroundColor: secondsLeft <= 10 ? 'rgba(220, 120, 80, 0.6)' : 'rgba(196, 149, 90, 0.4)',
                transition: 'background-color 0.5s ease',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

const CHOOSE_TIME_LIMIT_S = 30;

function ChoosingPhase({ gameState, gameId }: { gameState: GameState; gameId: bigint }) {
  const { game, myPlayer, opponentPlayer } = gameState;
  const [secondsLeft, setSecondsLeft] = useState(CHOOSE_TIME_LIMIT_S);
  const hasChosenRef = useRef(false);

  const mySeat = myPlayer?.seat;
  const iWon = mySeat !== undefined && game ? mySeat.toString() === game.rollWinner : false;
  const winnerSeat = game ? BigInt(game.rollWinner) : 0n;

  const handleChoose = (seat: bigint) => {
    if (hasChosenRef.current) return;
    hasChosenRef.current = true;
    gameState.pregameChooseFirst(seat);
  };

  // Countdown timer — ticks every second
  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Auto-choose when timer expires (only the winner's client fires this)
  useEffect(() => {
    if (secondsLeft === 0 && iWon) {
      handleChoose(winnerSeat);
    }
  }, [secondsLeft, iWon, winnerSeat]);

  if (!game || !myPlayer || mySeat === undefined) return null;

  const winnerName = iWon ? 'You' : (opponentPlayer?.displayName || 'Opponent');

  const btnBase: React.CSSProperties = {
    padding: '12px 24px',
    borderRadius: 4,
    fontFamily: 'var(--font-cinzel), Georgia, serif',
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    width: '100%',
    transition: 'all 0.15s ease',
  };

  const timerBar = (
    <div style={{ marginTop: 20 }}>
      <div style={{
        width: '100%',
        height: 3,
        borderRadius: 2,
        backgroundColor: 'rgba(232,213,163,0.08)',
        overflow: 'hidden',
      }}>
        <motion.div
          initial={{ width: '100%' }}
          animate={{ width: '0%' }}
          transition={{ duration: CHOOSE_TIME_LIMIT_S, ease: 'linear' }}
          style={{
            height: '100%',
            borderRadius: 2,
            backgroundColor: secondsLeft <= 10 ? 'rgba(220, 120, 80, 0.6)' : 'rgba(196, 149, 90, 0.4)',
            transition: 'background-color 0.5s ease',
          }}
        />
      </div>
    </div>
  );

  return (
    <div style={{
      background: 'rgba(14, 10, 6, 0.97)',
      border: '1px solid rgba(107, 78, 39, 0.3)',
      borderRadius: 8,
      padding: '40px 48px',
      textAlign: 'center',
      maxWidth: 420,
      width: '100%',
      boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(196, 149, 90, 0.08)',
    }}>
      <p style={{
        fontFamily: 'var(--font-cinzel), Georgia, serif',
        fontSize: 10,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: 'rgba(196, 149, 90, 0.5)',
      }}>First Player</p>

      {iWon ? (
        <>
          <h2 style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 22,
            fontWeight: 700,
            color: '#e8d5a3',
            marginTop: 8,
            textShadow: '0 1px 6px rgba(0,0,0,0.9)',
          }}>You Won the Roll!</h2>
          <p style={{
            marginTop: 8,
            fontSize: 13,
            color: 'rgba(196, 149, 90, 0.5)',
            fontFamily: 'Georgia, serif',
          }}>Who should go first?</p>

          <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button
              onClick={() => handleChoose(mySeat)}
              style={{
                ...btnBase,
                border: '1px solid rgba(196, 149, 90, 0.45)',
                background: 'rgba(196, 149, 90, 0.15)',
                color: '#e8d5a3',
              }}
            >
              I&apos;ll go first
            </button>
            <button
              onClick={() => handleChoose(mySeat.toString() === '0' ? BigInt(1) : BigInt(0))}
              style={{
                ...btnBase,
                border: '1px solid rgba(107, 78, 39, 0.3)',
                background: 'transparent',
                color: 'rgba(196, 149, 90, 0.6)',
              }}
            >
              {opponentPlayer?.displayName || 'Opponent'} goes first
            </button>
          </div>

          {timerBar}
        </>
      ) : (
        <>
          <h2 style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 22,
            fontWeight: 700,
            color: '#e8d5a3',
            marginTop: 8,
            textShadow: '0 1px 6px rgba(0,0,0,0.9)',
          }}>{winnerName} Won the Roll</h2>
          <p style={{
            marginTop: 16,
            fontSize: 13,
            color: 'rgba(196, 149, 90, 0.45)',
            fontFamily: 'Georgia, serif',
          }}>Waiting for them to choose who goes first...</p>
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center', gap: 6 }}>
            <span className="animate-bounce [animation-delay:-0.3s]" style={{ width: 6, height: 6, borderRadius: '50%', background: '#c4955a' }} />
            <span className="animate-bounce [animation-delay:-0.15s]" style={{ width: 6, height: 6, borderRadius: '50%', background: '#c4955a' }} />
            <span className="animate-bounce" style={{ width: 6, height: 6, borderRadius: '50%', background: '#c4955a' }} />
          </div>

          {timerBar}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Revealing phase — announce who goes first
// ---------------------------------------------------------------------------

const REVEAL_AUTO_ACK_MS = 3500;

function RevealingPhase({ gameState, gameId }: { gameState: GameState; gameId: bigint }) {
  const { game, myPlayer, opponentPlayer } = gameState;

  const alreadyAcknowledged = game && myPlayer
    ? (myPlayer.seat.toString() === '0' ? game.pregameReady0 : game.pregameReady1)
    : false;

  // Auto-acknowledge after display time
  useEffect(() => {
    if (alreadyAcknowledged) return;
    const timer = setTimeout(() => {
      gameState.pregameAcknowledgeFirst();
    }, REVEAL_AUTO_ACK_MS);
    return () => clearTimeout(timer);
  }, [alreadyAcknowledged, gameState]);

  if (!game || !myPlayer) return null;

  const firstSeat = game.currentTurn;
  const iGoFirst = myPlayer.seat === firstSeat;
  const iWonRoll = myPlayer.seat.toString() === game.rollWinner;
  const opponentName = opponentPlayer?.displayName || 'Opponent';
  const accentColor = iGoFirst ? '#c4955a' : '#4a7ab5';

  // Build contextual message based on who won the roll and who goes first
  let headline: string;
  if (iWonRoll) {
    headline = iGoFirst ? 'You chose to go first' : `You chose ${opponentName} to go first`;
  } else {
    headline = iGoFirst
      ? `${opponentName} chose you to go first`
      : `${opponentName} chose to go first`;
  }

  return (
    <div style={{
      background: 'rgba(14, 10, 6, 0.97)',
      border: '1px solid rgba(107, 78, 39, 0.3)',
      borderRadius: 10,
      padding: '44px 36px',
      textAlign: 'center',
      maxWidth: 400,
      width: '100%',
      boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(196, 149, 90, 0.08)',
    }}>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        style={{
          fontFamily: 'var(--font-cinzel), Georgia, serif',
          fontSize: 10,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'rgba(196, 149, 90, 0.5)',
        }}
      >First Player</motion.p>

      {/* Shield / icon accent */}
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
        style={{ marginTop: 20 }}
      >
        <svg width="56" height="56" viewBox="0 0 56 56" style={{ margin: '0 auto', display: 'block' }}>
          <path
            d="M28 4 L50 16 L50 32 C50 42 40 50 28 54 C16 50 6 42 6 32 L6 16 Z"
            fill="none"
            stroke={accentColor}
            strokeWidth={1.5}
            opacity={0.6}
          />
          <path
            d="M28 12 L44 20 L44 32 C44 39 37 45 28 48 C19 45 12 39 12 32 L12 20 Z"
            fill={`${accentColor}15`}
            stroke={`${accentColor}30`}
            strokeWidth={1}
          />
          <text
            x="28"
            y="36"
            textAnchor="middle"
            fontFamily="Georgia, serif"
            fontSize="20"
            fontWeight="bold"
            fill={accentColor}
          >
            1
          </text>
        </svg>
      </motion.div>

      <motion.h2
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.4 }}
        style={{
          fontFamily: 'var(--font-cinzel), Georgia, serif',
          fontSize: 20,
          fontWeight: 700,
          color: '#e8d5a3',
          marginTop: 16,
          textShadow: '0 1px 6px rgba(0,0,0,0.5)',
        }}
      >
        {headline}
      </motion.h2>

      {/* Continue button + progress bar */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        style={{ marginTop: 24 }}
      >
        {!alreadyAcknowledged ? (
          <>
            <button
              onClick={() => gameState.pregameAcknowledgeFirst()}
              style={{
                padding: '8px 24px',
                borderRadius: 4,
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                border: '1px solid rgba(196, 149, 90, 0.35)',
                background: 'rgba(196, 149, 90, 0.1)',
                color: 'rgba(232, 213, 163, 0.7)',
                transition: 'all 0.15s ease',
              }}
            >
              Continue
            </button>
            <div style={{
              marginTop: 12,
              width: '100%',
              height: 2,
              borderRadius: 1,
              backgroundColor: 'rgba(232,213,163,0.06)',
              overflow: 'hidden',
            }}>
              <motion.div
                initial={{ width: '100%' }}
                animate={{ width: '0%' }}
                transition={{ duration: REVEAL_AUTO_ACK_MS / 1000, ease: 'linear' }}
                style={{
                  height: '100%',
                  borderRadius: 1,
                  backgroundColor: `${accentColor}40`,
                }}
              />
            </div>
          </>
        ) : (
          <p style={{
            fontSize: 12,
            color: 'rgba(196, 149, 90, 0.45)',
            fontFamily: 'Georgia, serif',
          }}>Waiting for opponent...</p>
        )}
      </motion.div>
    </div>
  );
}

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
