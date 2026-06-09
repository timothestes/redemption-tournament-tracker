'use client';

import { useToastKeyboardNav } from '@/app/shared/components/toastKeyboardNav';

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

  return <PauseConsentBody message={message} onAccept={onAccept} onDecline={onDecline} />;
}

/**
 * Rendered only while a request is pending so the keyboard-nav hook (which
 * registers a global listener) is active only when the toast is visible.
 * Accept is the affirmative default (Enter); Escape declines.
 */
function PauseConsentBody({
  message,
  onAccept,
  onDecline,
}: {
  message: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { focusedIndex, setFocusedIndex } = useToastKeyboardNav({
    count: 2,
    defaultIndex: 0, // Accept
    onSelect: idx => (idx === 0 ? onAccept() : onDecline()),
    onCancel: onDecline,
  });

  const acceptFocused = focusedIndex === 0;
  const declineFocused = focusedIndex === 1;

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
        onMouseEnter={() => setFocusedIndex(0)}
        style={{
          padding: '8px 16px',
          borderRadius: 4,
          border: '1px solid rgba(196, 149, 90, 0.45)',
          background: acceptFocused ? 'rgba(196, 149, 90, 0.30)' : 'rgba(196, 149, 90, 0.15)',
          color: '#e8d5a3',
          fontFamily: 'var(--font-cinzel), Georgia, serif',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          boxShadow: acceptFocused ? '0 0 14px rgba(196, 149, 90, 0.35)' : 'none',
          transition: 'background 0.14s, box-shadow 0.14s, color 0.14s, border-color 0.14s',
        }}
      >
        Accept
      </button>
      <button
        onClick={onDecline}
        onMouseEnter={() => setFocusedIndex(1)}
        style={{
          padding: '8px 16px',
          borderRadius: 4,
          border: `1px solid ${declineFocused ? 'rgba(196, 149, 90, 0.4)' : 'rgba(107, 78, 39, 0.3)'}`,
          background: declineFocused ? 'rgba(196, 149, 90, 0.12)' : 'transparent',
          color: declineFocused ? 'rgba(196, 149, 90, 0.85)' : 'rgba(196, 149, 90, 0.5)',
          fontFamily: 'var(--font-cinzel), Georgia, serif',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          transition: 'background 0.14s, box-shadow 0.14s, color 0.14s, border-color 0.14s',
        }}
      >
        Decline
      </button>
    </div>
  );
}
