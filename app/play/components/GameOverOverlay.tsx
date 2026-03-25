'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { DeckPickerModal } from './DeckPickerModal';
import type { DeckOption } from './DeckPickerCard';
import { loadUserDecks, loadDeckForGame } from '../actions';
import type { GameState } from '../hooks/useGameState';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GameOverOverlayProps {
  game: any;
  myPlayer: any;
  opponentPlayer: any;
  gameActions: any[];
  gameState: GameState;
  onReturnToLobby: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveEndReason(gameActions: any[], myPlayer: any): string {
  for (let i = gameActions.length - 1; i >= 0; i--) {
    const action = gameActions[i];
    const actionType: string = (action.actionType ?? '').toUpperCase();

    if (actionType === 'RESIGN') {
      const actorId = action.playerId ?? action.actorId;
      const myId = myPlayer?.id;
      if (myId !== undefined && actorId !== undefined && actorId === myId) {
        return 'You resigned';
      }
      return 'Opponent resigned';
    }

    if (actionType === 'TIMEOUT') {
      return 'Opponent disconnected';
    }
  }

  return 'Game ended';
}

function generateCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const btnBase: React.CSSProperties = {
  width: '100%',
  padding: '10px 0',
  borderRadius: 4,
  cursor: 'pointer',
  fontFamily: 'var(--font-cinzel), Georgia, serif',
  fontSize: 11,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  transition: 'background 0.15s, border-color 0.15s',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GameOverOverlay({
  game,
  myPlayer,
  opponentPlayer,
  gameActions,
  gameState,
  onReturnToLobby,
}: GameOverOverlayProps) {
  const router = useRouter();
  const label = deriveEndReason(gameActions, myPlayer);
  const myName: string = myPlayer?.displayName ?? 'You';
  const oppName: string = opponentPlayer?.displayName ?? 'Opponent';
  const mySeat = myPlayer?.seat?.toString() ?? '0';

  // Deck picker state
  const [myDecks, setMyDecks] = useState<DeckOption[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<'request' | 'respond'>('request');
  const [isLoading, setIsLoading] = useState(false);

  // Load decks when needed
  useEffect(() => {
    if (pickerOpen && myDecks.length === 0) {
      loadUserDecks().then(setMyDecks).catch(() => {});
    }
  }, [pickerOpen, myDecks.length]);

  // Rematch state from game
  const rematchRequestedBy = game?.rematchRequestedBy ?? '';
  const rematchResponse = game?.rematchResponse ?? '';
  const rematchCode = game?.rematchCode ?? '';
  const iRequested = rematchRequestedBy === mySeat;
  const opponentRequested = rematchRequestedBy !== '' && !iRequested;

  // Navigate to new game when rematch code is set
  useEffect(() => {
    if (rematchCode && rematchResponse === 'accepted') {
      // Store game params in sessionStorage for the new game
      const isCreator = iRequested;
      const myDeckId = mySeat === '0' ? game.rematchDeckId0 : game.rematchDeckId1;
      const myDeckData = mySeat === '0' ? game.rematchDeckData0 : game.rematchDeckData1;

      const params = {
        role: isCreator ? 'create' : 'join',
        deckId: myDeckId,
        displayName: myPlayer?.displayName ?? 'Player',
        supabaseUserId: myPlayer?.supabaseUserId ?? '',
        deckData: myDeckData,
        format: game?.format ?? 'standard',
        isPublic: false,
        lobbyMessage: '',
      };

      sessionStorage.setItem(`stdb_game_params_${rematchCode}`, JSON.stringify(params));
      router.push(`/play/${rematchCode}`);
    }
  }, [rematchCode, rematchResponse, iRequested, mySeat, game, myPlayer, router]);

  // When both accept and I'm the requester, create the new game
  useEffect(() => {
    if (rematchResponse === 'accepted' && iRequested && !rematchCode) {
      const code = generateCode();
      gameState.setRematchCode(code);
    }
  }, [rematchResponse, iRequested, rematchCode, gameState]);

  // Deck selected handler
  const handleDeckSelected = async (deck: DeckOption) => {
    setPickerOpen(false);
    setIsLoading(true);
    try {
      const result = await loadDeckForGame(deck.id);
      const deckData = JSON.stringify(result.deckData);

      if (pickerMode === 'request') {
        gameState.requestRematch(deck.id, deckData);
      } else {
        gameState.respondRematch(true, deck.id, deckData);
      }
    } catch (e) {
      console.error('Failed to load deck:', e);
    } finally {
      setIsLoading(false);
    }
  };

  // Determine what to show
  let rematchContent: React.ReactNode = null;

  if (rematchResponse === 'declined') {
    // Opponent declined
    rematchContent = (
      <p style={{
        fontSize: 12,
        color: 'rgba(220, 120, 120, 0.6)',
        fontFamily: 'Georgia, serif',
        marginBottom: 16,
      }}>
        {iRequested ? 'Opponent declined the rematch.' : 'You declined the rematch.'}
      </p>
    );
  } else if (rematchResponse === 'accepted') {
    // Accepted — waiting for navigation
    rematchContent = (
      <p style={{
        fontSize: 12,
        color: 'rgba(196, 149, 90, 0.6)',
        fontFamily: 'Georgia, serif',
        marginBottom: 16,
      }}>
        Setting up rematch...
      </p>
    );
  } else if (iRequested) {
    // I requested, waiting for opponent
    rematchContent = (
      <p style={{
        fontSize: 12,
        color: 'rgba(196, 149, 90, 0.5)',
        fontFamily: 'Georgia, serif',
        marginBottom: 16,
      }}>
        Waiting for opponent to respond...
      </p>
    );
  } else if (opponentRequested) {
    // Opponent wants rematch — show accept/decline
    rematchContent = (
      <div style={{ marginBottom: 16 }}>
        <p style={{
          fontSize: 13,
          color: '#e8d5a3',
          fontFamily: 'Georgia, serif',
          marginBottom: 12,
        }}>
          {oppName} wants to play again!
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => {
              setPickerMode('respond');
              setPickerOpen(true);
            }}
            disabled={isLoading}
            style={{
              ...btnBase,
              background: 'rgba(196, 149, 90, 0.15)',
              border: '1px solid rgba(196, 149, 90, 0.5)',
              color: '#e8d5a3',
            }}
          >
            {isLoading ? 'Loading...' : 'Accept'}
          </button>
          <button
            onClick={() => gameState.respondRematch(false, '', '')}
            style={{
              ...btnBase,
              background: 'transparent',
              border: '1px solid rgba(107, 78, 39, 0.3)',
              color: 'rgba(196, 149, 90, 0.5)',
            }}
          >
            Decline
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 900,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(6, 4, 2, 0.6)',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            background: 'rgba(14, 10, 6, 0.97)',
            border: '1px solid rgba(107, 78, 39, 0.6)',
            borderRadius: 10,
            padding: '36px 40px',
            textAlign: 'center',
            minWidth: 300,
            maxWidth: 400,
            boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(196, 149, 90, 0.08)',
            pointerEvents: 'auto',
          }}
        >
          {/* Header */}
          <p style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'rgba(232, 213, 163, 0.45)',
            marginBottom: 12,
          }}>
            Game Over
          </p>

          {/* End reason */}
          <p style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 22,
            fontWeight: 700,
            color: '#e8d5a3',
            lineHeight: 1.2,
            marginBottom: 20,
          }}>
            {label}
          </p>

          {/* Divider */}
          <div style={{ height: 1, background: 'rgba(107, 78, 39, 0.35)', margin: '0 0 20px' }} />

          {/* Player names */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 12,
            color: 'rgba(232, 213, 163, 0.55)',
            marginBottom: 20,
            gap: 24,
          }}>
            <span style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              letterSpacing: '0.05em',
              color: 'rgba(196, 149, 90, 0.85)',
            }}>
              {myName}
            </span>
            <span style={{ color: 'rgba(232, 213, 163, 0.3)', alignSelf: 'center' }}>vs</span>
            <span style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              letterSpacing: '0.05em',
              color: 'rgba(74, 122, 181, 0.85)',
            }}>
              {oppName}
            </span>
          </div>

          {/* Rematch content */}
          {rematchContent}

          {/* Action buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Play Again — only show if no rematch in progress */}
            {!rematchRequestedBy && !rematchResponse && (
              <button
                onClick={() => {
                  setPickerMode('request');
                  setPickerOpen(true);
                }}
                disabled={isLoading}
                style={{
                  ...btnBase,
                  background: 'rgba(196, 149, 90, 0.15)',
                  border: '1px solid rgba(196, 149, 90, 0.5)',
                  color: '#e8d5a3',
                }}
              >
                {isLoading ? 'Loading...' : 'Play Again'}
              </button>
            )}

            <button
              onClick={onReturnToLobby}
              style={{
                ...btnBase,
                background: 'transparent',
                border: '1px solid rgba(107, 78, 39, 0.3)',
                color: 'rgba(196, 149, 90, 0.5)',
              }}
            >
              Return to Lobby
            </button>
          </div>
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
