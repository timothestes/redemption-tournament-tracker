'use client';

import { useRouter } from 'next/navigation';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GameOverOverlayProps {
  game: any;           // Game row
  myPlayer: any;       // My player row
  opponentPlayer: any; // Opponent player row
  gameActions: any[];  // To determine how game ended
  onReturnToLobby: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveEndReason(
  gameActions: any[],
  myPlayer: any,
): { label: string; sub: string } {
  // Walk gameActions in reverse to find the last RESIGN or TIMEOUT action
  for (let i = gameActions.length - 1; i >= 0; i--) {
    const action = gameActions[i];
    const actionType: string = (action.actionType ?? '').toUpperCase();

    if (actionType === 'RESIGN') {
      // If the actor is me, I resigned; otherwise the opponent did
      const actorId = action.playerId ?? action.actorId;
      const myId = myPlayer?.id;
      if (myId !== undefined && actorId !== undefined && actorId === myId) {
        return { label: 'You resigned', sub: 'Better luck next time.' };
      }
      return { label: 'Opponent resigned', sub: 'Well played.' };
    }

    if (actionType === 'TIMEOUT') {
      return { label: 'Opponent disconnected', sub: 'Opponent timed out.' };
    }
  }

  // Fallback — no resign/timeout action found, game ended normally
  return { label: 'Game ended', sub: '' };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GameOverOverlay({
  game,
  myPlayer,
  opponentPlayer,
  gameActions,
  onReturnToLobby,
}: GameOverOverlayProps) {
  const { label, sub } = deriveEndReason(gameActions, myPlayer);

  const myName: string = myPlayer?.displayName ?? 'You';
  const oppName: string = opponentPlayer?.displayName ?? 'Opponent';

  const soulsMe =
    game && myPlayer
      ? (game.soulsRescuedPlayer1 !== undefined
          ? myPlayer.seat === 0
            ? Number(game.soulsRescuedPlayer1)
            : Number(game.soulsRescuedPlayer2)
          : undefined)
      : undefined;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 900,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(6, 4, 2, 0.82)',
        backdropFilter: 'blur(4px)',
      }}
    >
      {/* Center card */}
      <div
        style={{
          background: 'rgba(14, 10, 6, 0.97)',
          border: '1px solid rgba(107, 78, 39, 0.6)',
          borderRadius: 8,
          padding: '40px 48px',
          textAlign: 'center',
          minWidth: 320,
          maxWidth: 420,
          boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(196, 149, 90, 0.08)',
        }}
      >
        {/* Header */}
        <p
          style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'rgba(232, 213, 163, 0.45)',
            marginBottom: 12,
          }}
        >
          Game Over
        </p>

        {/* End reason */}
        <p
          style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 22,
            fontWeight: 700,
            color: '#e8d5a3',
            lineHeight: 1.2,
            marginBottom: sub ? 8 : 20,
          }}
        >
          {label}
        </p>

        {sub && (
          <p
            style={{
              fontSize: 13,
              color: 'rgba(232, 213, 163, 0.5)',
              marginBottom: 20,
              letterSpacing: '0.02em',
            }}
          >
            {sub}
          </p>
        )}

        {/* Divider */}
        <div
          style={{
            height: 1,
            background: 'rgba(107, 78, 39, 0.35)',
            margin: '0 0 20px',
          }}
        />

        {/* Player names */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 12,
            color: 'rgba(232, 213, 163, 0.55)',
            marginBottom: 24,
            gap: 24,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              letterSpacing: '0.05em',
              color: 'rgba(196, 149, 90, 0.85)',
            }}
          >
            {myName}
          </span>
          <span style={{ color: 'rgba(232, 213, 163, 0.3)', alignSelf: 'center' }}>vs</span>
          <span
            style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              letterSpacing: '0.05em',
              color: 'rgba(74, 122, 181, 0.85)',
            }}
          >
            {oppName}
          </span>
        </div>

        {/* Return to Lobby button */}
        <button
          onClick={onReturnToLobby}
          style={{
            width: '100%',
            padding: '10px 0',
            background: 'rgba(196, 149, 90, 0.15)',
            border: '1px solid rgba(196, 149, 90, 0.5)',
            borderRadius: 4,
            cursor: 'pointer',
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 11,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: '#e8d5a3',
            transition: 'background 0.15s, border-color 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(196, 149, 90, 0.28)';
            e.currentTarget.style.borderColor = 'rgba(196, 149, 90, 0.75)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(196, 149, 90, 0.15)';
            e.currentTarget.style.borderColor = 'rgba(196, 149, 90, 0.5)';
          }}
        >
          Return to Lobby
        </button>
      </div>
    </div>
  );
}
