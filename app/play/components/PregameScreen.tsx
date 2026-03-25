'use client';

import { useState, useEffect } from 'react';
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

  // rolling/choosing render as modal content (parent provides the overlay)
  if (phase === 'rolling') {
    return <RollingPhase gameState={gameState} gameId={gameId} />;
  }
  if (phase === 'choosing') {
    return <ChoosingPhase gameState={gameState} gameId={gameId} />;
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

function RollingPhase({ gameState, gameId }: { gameState: GameState; gameId: bigint }) {
  const { game, myPlayer, opponentPlayer } = gameState;
  const [showResults, setShowResults] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowResults(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  if (!game || !myPlayer) return null;

  const mySeat = myPlayer.seat;
  const isSeat0 = mySeat.toString() === '0';
  const myRoll = isSeat0 ? Number(game.rollResult0) : Number(game.rollResult1);
  const opponentRoll = isSeat0 ? Number(game.rollResult1) : Number(game.rollResult0);
  const iWon = mySeat.toString() === game.rollWinner;
  const winnerName = iWon ? myPlayer.displayName : (opponentPlayer?.displayName || 'Opponent');

  const handleAcknowledge = () => {
    setAcknowledged(true);
    gameState.pregameAcknowledgeRoll();
  };

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
      }}>Dice Roll</p>
      <h2 style={{
        fontFamily: 'var(--font-cinzel), Georgia, serif',
        fontSize: 22,
        fontWeight: 700,
        color: '#e8d5a3',
        marginTop: 8,
        textShadow: '0 1px 6px rgba(0,0,0,0.9)',
      }}>Who Goes First?</h2>

      <div style={{ marginTop: 32, display: 'flex', justifyContent: 'center', gap: 32, alignItems: 'flex-end' }}>
        {/* My die */}
        <div style={{ textAlign: 'center' }}>
          <p style={{
            fontFamily: 'Georgia, serif',
            fontSize: 12,
            color: '#c4955a',
            marginBottom: 8,
            letterSpacing: '0.06em',
          }}>{myPlayer.displayName}</p>
          <div style={{
            width: 80,
            height: 80,
            borderRadius: 8,
            border: `2px solid ${showResults ? (iWon ? '#c4955a' : 'rgba(107, 78, 39, 0.3)') : 'rgba(107, 78, 39, 0.3)'}`,
            background: showResults && iWon ? 'rgba(196, 149, 90, 0.12)' : '#1a1308',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.5s ease',
            boxShadow: showResults && iWon ? '0 0 16px rgba(196, 149, 90, 0.25)' : 'none',
          }}>
            <span style={{
              fontFamily: 'Georgia, serif',
              fontSize: 28,
              fontWeight: 700,
              color: showResults ? (iWon ? '#e8d5a3' : 'rgba(196, 149, 90, 0.35)') : 'rgba(196, 149, 90, 0.6)',
            }}>{showResults ? myRoll : '?'}</span>
          </div>
        </div>

        <span style={{
          fontFamily: 'var(--font-cinzel), Georgia, serif',
          fontSize: 11,
          color: 'rgba(196, 149, 90, 0.35)',
          letterSpacing: '0.1em',
          paddingBottom: 30,
        }}>VS</span>

        {/* Opponent die */}
        <div style={{ textAlign: 'center' }}>
          <p style={{
            fontFamily: 'Georgia, serif',
            fontSize: 12,
            color: '#4a7ab5',
            marginBottom: 8,
            letterSpacing: '0.06em',
          }}>{opponentPlayer?.displayName || 'Opponent'}</p>
          <div style={{
            width: 80,
            height: 80,
            borderRadius: 8,
            border: `2px solid ${showResults ? (!iWon ? '#4a7ab5' : 'rgba(107, 78, 39, 0.3)') : 'rgba(107, 78, 39, 0.3)'}`,
            background: showResults && !iWon ? 'rgba(74, 122, 181, 0.12)' : '#1a1308',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.5s ease',
            boxShadow: showResults && !iWon ? '0 0 16px rgba(74, 122, 181, 0.25)' : 'none',
          }}>
            <span style={{
              fontFamily: 'Georgia, serif',
              fontSize: 28,
              fontWeight: 700,
              color: showResults ? (!iWon ? '#e8d5a3' : 'rgba(196, 149, 90, 0.35)') : 'rgba(196, 149, 90, 0.6)',
            }}>{showResults ? opponentRoll : '?'}</span>
          </div>
        </div>
      </div>

      {showResults && (
        <div style={{ marginTop: 24 }}>
          <p style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 16,
            fontWeight: 700,
            color: '#e8d5a3',
            letterSpacing: '0.06em',
            textShadow: '0 1px 6px rgba(0,0,0,0.9)',
          }}>
            {winnerName} wins the roll!
          </p>

          {!acknowledged ? (
            <button
              onClick={handleAcknowledge}
              style={{
                marginTop: 16,
                padding: '10px 32px',
                borderRadius: 4,
                border: '1px solid rgba(196, 149, 90, 0.45)',
                background: 'rgba(196, 149, 90, 0.15)',
                color: '#e8d5a3',
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              Continue
            </button>
          ) : (
            <p style={{
              marginTop: 16,
              fontSize: 12,
              color: 'rgba(196, 149, 90, 0.45)',
              fontFamily: 'Georgia, serif',
            }}>
              Waiting for opponent...
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ChoosingPhase({ gameState, gameId }: { gameState: GameState; gameId: bigint }) {
  const { game, myPlayer, opponentPlayer } = gameState;

  if (!game || !myPlayer) return null;

  const mySeat = myPlayer.seat;
  const iWon = mySeat.toString() === game.rollWinner;
  const winnerName = iWon ? 'You' : (opponentPlayer?.displayName || 'Opponent');

  const handleChoose = (seat: bigint) => {
    gameState.pregameChooseFirst(seat);
  };

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
        </>
      )}
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
    </div>
  );
}
