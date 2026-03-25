'use client';

import { useState, useEffect, useCallback } from 'react';
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

  return (
    <>
      <TopNav />
      <div className="flex min-h-[calc(100vh-56px)] items-center justify-center px-4">
        {phase === 'deck_select' && (
          <DeckSelectPhase gameState={gameState} gameId={gameId} />
        )}
        {phase === 'rolling' && (
          <RollingPhase gameState={gameState} gameId={gameId} />
        )}
        {phase === 'choosing' && (
          <ChoosingPhase gameState={gameState} gameId={gameId} />
        )}
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

  // Animate: show dice rolling, then reveal results after delay
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
    <div className="rounded-xl border border-border bg-card/95 backdrop-blur-sm p-8 sm:p-10 text-center max-w-md w-full">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-cinzel">Dice Roll</p>
      <h2 className="text-2xl font-bold font-cinzel mt-2">Who Goes First?</h2>

      <div className="mt-8 flex justify-center gap-8">
        {/* My die */}
        <div className="text-center">
          <p className="text-sm text-muted-foreground mb-2">{myPlayer.displayName}</p>
          <div className={`w-20 h-20 rounded-xl border-2 flex items-center justify-center text-3xl font-bold font-mono transition-all duration-500 ${
            showResults
              ? iWon ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-muted text-muted-foreground'
              : 'border-border bg-muted animate-pulse'
          }`}>
            {showResults ? myRoll : '?'}
          </div>
        </div>

        {/* VS */}
        <div className="flex items-center text-muted-foreground font-cinzel text-sm pt-6">vs</div>

        {/* Opponent die */}
        <div className="text-center">
          <p className="text-sm text-muted-foreground mb-2">{opponentPlayer?.displayName || 'Opponent'}</p>
          <div className={`w-20 h-20 rounded-xl border-2 flex items-center justify-center text-3xl font-bold font-mono transition-all duration-500 ${
            showResults
              ? !iWon ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-muted text-muted-foreground'
              : 'border-border bg-muted animate-pulse'
          }`}>
            {showResults ? opponentRoll : '?'}
          </div>
        </div>
      </div>

      {showResults && (
        <div className="mt-6">
          <p className="text-lg font-semibold font-cinzel">
            {winnerName} wins the roll!
          </p>

          {!acknowledged ? (
            <Button className="mt-4" onClick={handleAcknowledge}>
              Continue
            </Button>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              Waiting for opponent to continue...
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

  return (
    <div className="rounded-xl border border-border bg-card/95 backdrop-blur-sm p-8 sm:p-10 text-center max-w-md w-full">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-cinzel">First Player</p>

      {iWon ? (
        <>
          <h2 className="text-2xl font-bold font-cinzel mt-2">You Won the Roll!</h2>
          <p className="mt-2 text-muted-foreground">Who should go first?</p>

          <div className="mt-6 flex flex-col gap-3">
            <Button size="lg" onClick={() => handleChoose(mySeat)}>
              I&apos;ll go first
            </Button>
            <Button size="lg" variant="outline" onClick={() => handleChoose(mySeat.toString() === '0' ? BigInt(1) : BigInt(0))}>
              {opponentPlayer?.displayName || 'Opponent'} goes first
            </Button>
          </div>
        </>
      ) : (
        <>
          <h2 className="text-2xl font-bold font-cinzel mt-2">{winnerName} Won the Roll</h2>
          <p className="mt-4 text-muted-foreground">Waiting for them to choose who goes first...</p>
          <div className="mt-3 flex justify-center gap-1.5">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
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
