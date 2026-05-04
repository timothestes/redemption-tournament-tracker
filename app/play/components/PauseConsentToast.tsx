'use client';

interface PauseConsentToastProps {
  /** Game row from SpacetimeDB. */
  game: any;
  /** Local player row. */
  myPlayer: any;
  /** Opponent player row (for the display name). */
  opponentPlayer: any;
  /** Called with `accepted` when responding to a pending pause request. */
  onRespondToPause: (accepted: boolean) => void;
  /** Called with `accepted` when responding to a pending resume request. */
  onRespondToResume: (accepted: boolean) => void;
}

/**
 * Floating banner that appears when the OPPONENT has requested a pause or
 * resume. Self-hides when no relevant request is pending. The requester's own
 * UI lives on the pause/play button in TurnIndicator (which flips to a cancel
 * affordance while their request is outstanding).
 */
export default function PauseConsentToast({
  game,
  myPlayer,
  opponentPlayer,
  onRespondToPause,
  onRespondToResume,
}: PauseConsentToastProps) {
  const mySeatStr: string = myPlayer?.seat?.toString() ?? '';
  const requestedBy: string = game?.pauseRequestedBy ?? '';
  const requestType: string = game?.pauseRequestType ?? '';

  // Only render when the OPPONENT has a pending request directed at me.
  if (!requestedBy || requestedBy === mySeatStr) return null;
  if (requestType !== 'pause' && requestType !== 'resume') return null;

  const oppName: string = opponentPlayer?.displayName ?? 'Opponent';
  const message =
    requestType === 'pause'
      ? `${oppName} wants to pause the game`
      : `${oppName} wants to resume the game`;
  const onAccept = () =>
    requestType === 'pause' ? onRespondToPause(true) : onRespondToResume(true);
  const onDecline = () =>
    requestType === 'pause' ? onRespondToPause(false) : onRespondToResume(false);

  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 800,
        background: 'rgba(14, 10, 6, 0.95)',
        border: '1px solid rgba(196, 149, 90, 0.4)',
        borderRadius: 8,
        padding: '12px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
      }}
    >
      <p
        style={{
          fontFamily: 'Georgia, serif',
          fontSize: 14,
          color: '#e8d5a3',
          whiteSpace: 'nowrap',
          margin: 0,
        }}
      >
        {message}
      </p>
      <button
        onClick={onAccept}
        style={{
          padding: '8px 16px',
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
          whiteSpace: 'nowrap',
        }}
      >
        Accept
      </button>
      <button
        onClick={onDecline}
        style={{
          padding: '8px 16px',
          borderRadius: 4,
          border: '1px solid rgba(107, 78, 39, 0.3)',
          background: 'transparent',
          color: 'rgba(196, 149, 90, 0.5)',
          fontFamily: 'var(--font-cinzel), Georgia, serif',
          fontSize: 12,
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
  );
}
