'use client';

import { useState, useEffect } from 'react';
import { DeckPickerModal } from './DeckPickerModal';
import type { DeckOption } from './DeckPickerCard';
import { loadDeckForGame } from '../actions';
import type { GameState } from '../hooks/useGameState';
import { useCardPreview } from '@/app/goldfish/state/CardPreviewContext';

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
  playAgainTriggered?: boolean;
  onPlayAgainHandled?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveEndReason(gameActions: any[], myPlayer: any): { label: string; winnerName: string } {
  for (let i = gameActions.length - 1; i >= 0; i--) {
    const action = gameActions[i];
    const actionType: string = (action.actionType ?? '').toUpperCase();

    if (actionType === 'RESIGN') {
      const actorId = action.playerId ?? action.actorId;
      const myId = myPlayer?.id;
      if (myId !== undefined && actorId !== undefined && actorId === myId) {
        return { label: 'You resigned', winnerName: '' };
      }
      return { label: 'Opponent resigned', winnerName: myPlayer?.displayName ?? 'You' };
    }

    if (actionType === 'TIMEOUT') {
      return { label: 'Opponent disconnected', winnerName: myPlayer?.displayName ?? 'You' };
    }
  }

  return { label: 'Game ended', winnerName: '' };
}

// ---------------------------------------------------------------------------
// Component — temporary toast + rematch logic (no blocking modal)
// ---------------------------------------------------------------------------

export default function GameOverOverlay({
  game,
  myPlayer,
  opponentPlayer,
  gameActions,
  gameState,
  onReturnToLobby,
  playAgainTriggered,
  onPlayAgainHandled,
}: GameOverOverlayProps) {
  const { isLoupeVisible } = useCardPreview();
  const { label, winnerName } = deriveEndReason(gameActions, myPlayer);
  const oppName: string = opponentPlayer?.displayName ?? 'Opponent';
  const mySeat = myPlayer?.seat?.toString() ?? '0';

  // Determine if the game ended because of opponent action (resign/disconnect)
  const isOpponentResigned = label === 'Opponent resigned';
  const isOpponentDisconnected = label === 'Opponent disconnected';
  const isOpponentLeft = isOpponentResigned || isOpponentDisconnected;

  // Rematch state from game (derived before effects that use it)
  const rematchRequestedBy = game?.rematchRequestedBy ?? '';
  const rematchResponse = game?.rematchResponse ?? '';
  const iRequested = rematchRequestedBy === mySeat;
  const opponentRequested = rematchRequestedBy !== '' && !iRequested;

  // Toast visibility (only for non-opponent-left cases)
  const [toastVisible, setToastVisible] = useState(true);
  // Modal dismissed state
  const [modalDismissed, setModalDismissed] = useState(false);

  // Auto-dismiss toast after 4 seconds (only when not showing modal)
  useEffect(() => {
    if (isOpponentLeft) return;
    const timer = setTimeout(() => setToastVisible(false), 4000);
    return () => clearTimeout(timer);
  }, [isOpponentLeft]);

  // Open deck picker when Play Again is triggered from TurnIndicator
  useEffect(() => {
    if (playAgainTriggered && !rematchRequestedBy) {
      setPickerMode('request');
      setPickerOpen(true);
      onPlayAgainHandled?.();
    }
  }, [playAgainTriggered, rematchRequestedBy, onPlayAgainHandled]);

  // Deck picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<'request' | 'respond'>('request');
  const [isLoading, setIsLoading] = useState(false);

  // When rematch is accepted, the server resets the game in-place.
  // The game status changes from 'finished' to 'pregame/rolling' automatically
  // via SpacetimeDB subscription — no navigation needed.

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

  // Show opponent's rematch request as a persistent banner
  const showRematchBanner = opponentRequested && !rematchResponse;
  // Show waiting status
  const showWaitingStatus = iRequested && !rematchResponse;
  // Show rematch result
  const showRematchResult = rematchResponse === 'declined' || rematchResponse === 'accepted';

  return (
    <>
      {/* Opponent left/resigned — blocking modal */}
      {isOpponentLeft && !modalDismissed && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            right: isLoupeVisible ? 'clamp(280px, 20vw, 380px)' : '36px',
            zIndex: 900,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(6, 4, 2, 0.7)',
            backdropFilter: 'blur(3px)',
          }}
        >
          <div style={{
            background: 'rgba(14, 10, 6, 0.97)',
            border: `1px solid ${isOpponentResigned ? 'rgba(196, 149, 90, 0.4)' : 'rgba(107, 78, 39, 0.3)'}`,
            borderRadius: 10,
            padding: '32px 36px',
            textAlign: 'center',
            maxWidth: 340,
            width: '100%',
            boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(196, 149, 90, 0.08)',
          }}>
            <p style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 10,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: isOpponentResigned ? 'rgba(196, 149, 90, 0.7)' : 'rgba(196, 149, 90, 0.5)',
            }}>{isOpponentResigned ? 'Victory' : 'Game Over'}</p>
            <h2 style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 18,
              fontWeight: 700,
              color: '#e8d5a3',
              marginTop: 8,
              textShadow: '0 1px 4px rgba(0,0,0,0.5)',
            }}>{isOpponentResigned ? `${oppName} Conceded` : label}</h2>
            <p style={{
              marginTop: 8,
              fontFamily: 'Georgia, serif',
              fontSize: 13,
              color: 'rgba(196, 149, 90, 0.5)',
            }}>{isOpponentResigned ? 'Your opponent has surrendered the game.' : 'The game has ended.'}</p>

            <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
              <button
                onClick={() => setModalDismissed(true)}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  borderRadius: 4,
                  border: '1px solid rgba(107, 78, 39, 0.3)',
                  background: 'transparent',
                  color: 'rgba(196, 149, 90, 0.6)',
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                Dismiss
              </button>
              <button
                onClick={onReturnToLobby}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  borderRadius: 4,
                  border: '1px solid rgba(196, 149, 90, 0.45)',
                  background: 'rgba(196, 149, 90, 0.15)',
                  color: '#e8d5a3',
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                Back to Lobby
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Temporary toast — auto-dismisses (for self-resign / generic end) */}
      {!isOpponentLeft && toastVisible && (
        <div style={{
          position: 'absolute',
          bottom: 70,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 800,
          background: 'rgba(14, 10, 6, 0.95)',
          border: '1px solid rgba(107, 78, 39, 0.5)',
          borderRadius: 8,
          padding: '12px 24px',
          textAlign: 'center',
          boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
          pointerEvents: 'none',
          animation: 'fadeInUp 0.3s ease',
        }}>
          <p style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 14,
            fontWeight: 700,
            color: '#e8d5a3',
            letterSpacing: '0.06em',
          }}>
            {label}
          </p>
        </div>
      )}

      {/* Rematch request banner from opponent */}
      {showRematchBanner && (
        <div style={{
          position: 'absolute',
          bottom: 70,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 800,
          background: 'rgba(14, 10, 6, 0.95)',
          border: '1px solid rgba(196, 149, 90, 0.4)',
          borderRadius: 8,
          padding: '12px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
        }}>
          <p style={{
            fontFamily: 'Georgia, serif',
            fontSize: 13,
            color: '#e8d5a3',
            whiteSpace: 'nowrap',
          }}>
            {oppName} wants to play again
          </p>
          <button
            onClick={() => {
              setPickerMode('respond');
              setPickerOpen(true);
            }}
            disabled={isLoading}
            style={{
              padding: '6px 16px',
              borderRadius: 4,
              border: '1px solid rgba(196, 149, 90, 0.45)',
              background: 'rgba(196, 149, 90, 0.15)',
              color: '#e8d5a3',
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Accept
          </button>
          <button
            onClick={() => gameState.respondRematch(false, '', '')}
            style={{
              padding: '6px 16px',
              borderRadius: 4,
              border: '1px solid rgba(107, 78, 39, 0.3)',
              background: 'transparent',
              color: 'rgba(196, 149, 90, 0.5)',
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Decline
          </button>
        </div>
      )}

      {/* Waiting/result status toast */}
      {(showWaitingStatus || showRematchResult) && (
        <div style={{
          position: 'absolute',
          bottom: 70,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 800,
          background: 'rgba(14, 10, 6, 0.95)',
          border: `1px solid ${rematchResponse === 'declined' ? 'rgba(180, 60, 60, 0.3)' : 'rgba(107, 78, 39, 0.4)'}`,
          borderRadius: 8,
          padding: '10px 20px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
        }}>
          <p style={{
            fontFamily: 'Georgia, serif',
            fontSize: 12,
            color: rematchResponse === 'declined'
              ? 'rgba(220, 120, 120, 0.6)'
              : rematchResponse === 'accepted'
                ? 'rgba(196, 149, 90, 0.7)'
                : 'rgba(196, 149, 90, 0.5)',
          }}>
            {rematchResponse === 'declined'
              ? (iRequested ? 'Opponent declined.' : 'You declined.')
              : rematchResponse === 'accepted'
                ? 'Setting up rematch...'
                : 'Waiting for opponent...'}
          </p>
        </div>
      )}

      {/* Deck picker — renders above everything */}
      {pickerOpen && (
        <div style={{ position: 'fixed', inset: 0, right: isLoupeVisible ? 'clamp(280px, 20vw, 380px)' : '36px', zIndex: 950 }}>
          <DeckPickerModal
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            onSelect={handleDeckSelected}
            selectedDeckId={myPlayer?.deckId}
          />
        </div>
      )}

      {/* Inline CSS animation */}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateX(-50%) translateY(12px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </>
  );
}

// Export the helper so client.tsx can derive winner name
export { deriveEndReason };
