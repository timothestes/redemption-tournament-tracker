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

function generateCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
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
  const router = useRouter();
  const { label, winnerName } = deriveEndReason(gameActions, myPlayer);
  const oppName: string = opponentPlayer?.displayName ?? 'Opponent';
  const mySeat = myPlayer?.seat?.toString() ?? '0';

  // Rematch state from game (derived before effects that use it)
  const rematchRequestedBy = game?.rematchRequestedBy ?? '';
  const rematchResponse = game?.rematchResponse ?? '';
  const rematchCode = game?.rematchCode ?? '';
  const iRequested = rematchRequestedBy === mySeat;
  const opponentRequested = rematchRequestedBy !== '' && !iRequested;

  // Toast visibility
  const [toastVisible, setToastVisible] = useState(true);

  // Auto-dismiss toast after 4 seconds
  useEffect(() => {
    const timer = setTimeout(() => setToastVisible(false), 4000);
    return () => clearTimeout(timer);
  }, []);

  // Open deck picker when Play Again is triggered from TurnIndicator
  useEffect(() => {
    if (playAgainTriggered && !rematchRequestedBy) {
      setPickerMode('request');
      setPickerOpen(true);
      onPlayAgainHandled?.();
    }
  }, [playAgainTriggered, rematchRequestedBy, onPlayAgainHandled]);

  // Deck picker state
  const [myDecks, setMyDecks] = useState<DeckOption[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<'request' | 'respond'>('request');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (pickerOpen && myDecks.length === 0) {
      loadUserDecks().then(setMyDecks).catch(() => {});
    }
  }, [pickerOpen, myDecks.length]);

  // Rematch state (derived above, before effects)

  // Navigate to new game when rematch code is set
  useEffect(() => {
    if (rematchCode && rematchResponse === 'accepted') {
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

  // Show opponent's rematch request as a persistent banner
  const showRematchBanner = opponentRequested && !rematchResponse;
  // Show waiting status
  const showWaitingStatus = iRequested && !rematchResponse;
  // Show rematch result
  const showRematchResult = rematchResponse === 'declined' || rematchResponse === 'accepted';

  return (
    <>
      {/* Temporary toast — auto-dismisses */}
      {toastVisible && (
        <div style={{
          position: 'fixed',
          top: 60,
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
          animation: 'fadeInDown 0.3s ease',
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
          position: 'fixed',
          bottom: 16,
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
          position: 'fixed',
          bottom: 16,
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
        <div style={{ position: 'fixed', inset: 0, zIndex: 950 }}>
          <DeckPickerModal
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            onSelect={handleDeckSelected}
            myDecks={myDecks}
            selectedDeckId={myPlayer?.deckId}
          />
        </div>
      )}

      {/* Inline CSS animation */}
      <style>{`
        @keyframes fadeInDown {
          from { opacity: 0; transform: translateX(-50%) translateY(-12px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </>
  );
}

// Export the helper so client.tsx can derive winner name
export { deriveEndReason };
