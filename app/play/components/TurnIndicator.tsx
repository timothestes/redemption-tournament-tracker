'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PHASE_ORDER } from '@/app/goldfish/types';
import { useCardPreview } from '@/app/goldfish/state/CardPreviewContext';
import type { GamePhase } from '@/app/shared/types/gameCard';

// ---------------------------------------------------------------------------
// Phase display labels
// ---------------------------------------------------------------------------

const PHASE_LABELS: Record<string, string> = {
  draw: 'Draw',
  upkeep: 'Upkeep',
  preparation: 'Preparation',
  battle: 'Battle',
  discard: 'Discard',
};

// Fluid type scale — keeps the bar legible on Retina laptops (small logical
// viewport, high DPI) without growing chunky on large monitors. Each clamp()
// floors near the original design size and grows ~1.2-1.3x at typical widths.
const FZ = {
  caption: 'clamp(9px, 0.4vw + 6px, 11px)',     // formerly 8 ("you", "opp")
  label: 'clamp(10px, 0.4vw + 7px, 12px)',      // formerly 9 ("X's turn")
  ui: 'clamp(11px, 0.45vw + 7px, 13px)',        // formerly 10 (Cinzel UI labels, phase buttons, End Turn, Concede)
  body: 'clamp(12px, 0.5vw + 8px, 14px)',       // formerly 12 (winner label, timer, modal buttons)
  bodyLg: 'clamp(13px, 0.5vw + 9px, 15px)',     // formerly 13 (turn number, modal body)
  headline: 'clamp(18px, 0.6vw + 12px, 22px)',  // formerly 18 (arrows, modal headlines)
  score: 'clamp(20px, 0.8vw + 14px, 26px)',     // formerly 20 (score numbers)
} as const;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TurnIndicatorProps {
  game: any;
  myPlayer: any;
  opponentPlayer: any;
  isMyTurn: boolean;
  onSetPhase: (phase: string) => void;
  onEndTurn: () => void;
  onConcede?: () => void;
  onRequestPriority?: () => void;
  hasPendingPriority?: boolean;
  isFinished?: boolean;
  winnerName?: string;
  onPlayAgain?: () => void;
  onBackToLobby?: () => void;
  myScore?: number;
  opponentScore?: number;
  opponentConnectionStatus?: 'connected' | 'reconnecting' | 'disconnected';
  disconnectTimeoutFired?: boolean;
  onClaimVictory?: () => void;
  /** Formatted timer string (e.g. "12:34" or "1:23:45"). */
  timerDisplay?: string;
  /** Whether the timer is currently paused (deck search open). */
  timerPaused?: boolean;
  /** Whether to show the timer at all (controlled by gear menu toggle). */
  timerVisible?: boolean;
  /** Whether a rematch request has been sent and we're waiting for the opponent. */
  rematchPending?: boolean;
  /** Send a pause request to the opponent. */
  onRequestPause?: () => void;
  /** Send a resume request to the opponent. */
  onRequestResume?: () => void;
  /** Cancel the locally-initiated pending pause/resume request. */
  onCancelPauseRequest?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TurnIndicator({
  game,
  myPlayer,
  opponentPlayer,
  isMyTurn,
  onSetPhase,
  onEndTurn,
  onConcede,
  onRequestPriority,
  hasPendingPriority,
  isFinished,
  winnerName,
  onPlayAgain,
  onBackToLobby,
  myScore = 0,
  opponentScore = 0,
  opponentConnectionStatus = 'connected',
  disconnectTimeoutFired = false,
  onClaimVictory,
  timerDisplay,
  timerPaused = false,
  timerVisible = true,
  rematchPending = false,
  onRequestPause,
  onRequestResume,
  onCancelPauseRequest,
}: TurnIndicatorProps) {
  const [showConcedeConfirm, setShowConcedeConfirm] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const { isLoupeVisible } = useCardPreview();
  const currentPhase: string = game?.currentPhase ?? 'draw';
  const turnNumber: number = game?.turnNumber ? Number(game.turnNumber) : 1;
  const currentIdx = PHASE_ORDER.indexOf(currentPhase as GamePhase);
  const isFirstPhase = currentIdx <= 0;
  const isLastPhase = currentIdx >= PHASE_ORDER.length - 1;

  // ---- Mutually-agreed pause state (server-authoritative) ----
  const mySeatStr: string = myPlayer?.seat?.toString() ?? '';
  const pauseRequestedBy: string = game?.pauseRequestedBy ?? '';
  const pauseRequestType: string = game?.pauseRequestType ?? '';
  const isServerPaused: boolean = (game?.pauseStartedAtMicros ?? 0n) > 0n;
  const isMyRequest = pauseRequestedBy !== '' && pauseRequestedBy === mySeatStr;
  const isOpponentRequest = pauseRequestedBy !== '' && pauseRequestedBy !== mySeatStr;
  // Button mode: pause | play | cancel | hidden
  // - pause:  no request pending, not currently paused → offer to start a pause
  // - play:   no request pending, currently paused → offer to start a resume
  // - cancel: I have a pending request → offer to cancel it
  // - hidden: opponent has a pending request → toast handles their consent UI
  const pauseButtonMode: 'pause' | 'play' | 'cancel' | 'hidden' =
    isOpponentRequest ? 'hidden' :
    isMyRequest ? 'cancel' :
    isServerPaused ? 'play' : 'pause';

  // Each client animates independently from its own currentPhase observation —
  // the SpacetimeDB subscription drives the re-render, CSS transitions do the slide.
  const phaseRowRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [activeBounds, setActiveBounds] = useState<{ left: number; width: number }>({ left: 0, width: 0 });
  const hasMeasuredRef = useRef(false);

  // Measure the bar's own width so we can hide non-essential bits (the timer)
  // when the playfield container is narrow — e.g. on a 14" laptop or when the
  // loupe sidebar is open. Width-based, not viewport-based, since the bar
  // shrinks when the right-side panel opens.
  const barRef = useRef<HTMLDivElement | null>(null);
  const [isBarNarrow, setIsBarNarrow] = useState(false);
  useEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => setIsBarNarrow(el.clientWidth < 1100);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const btn = buttonRefs.current[currentPhase];
    if (!btn) return;
    setActiveBounds({ left: btn.offsetLeft, width: btn.offsetWidth });
    hasMeasuredRef.current = true;
  }, [currentPhase]);

  // Remeasure on viewport changes and font load (Cinzel can shift widths).
  useEffect(() => {
    const remeasure = () => {
      const btn = buttonRefs.current[currentPhase];
      if (!btn) return;
      setActiveBounds({ left: btn.offsetLeft, width: btn.offsetWidth });
    };
    window.addEventListener('resize', remeasure);
    let observer: ResizeObserver | undefined;
    if (phaseRowRef.current && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(remeasure);
      observer.observe(phaseRowRef.current);
    }
    if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
      (document as any).fonts.ready.then(remeasure).catch(() => {});
    }
    return () => {
      window.removeEventListener('resize', remeasure);
      observer?.disconnect();
    };
  }, [currentPhase]);

  const myName: string = myPlayer?.displayName ?? 'You';
  const opponentName: string = opponentPlayer?.displayName ?? 'Opponent';

  const handlePrevPhase = () => {
    if (!isMyTurn || isFirstPhase) return;
    const prevPhase = PHASE_ORDER[currentIdx - 1];
    onSetPhase(prevPhase);
  };

  const handleNextPhase = () => {
    if (!isMyTurn) return;
    if (isLastPhase) {
      onEndTurn();
    } else {
      const nextPhase = PHASE_ORDER[currentIdx + 1];
      onSetPhase(nextPhase);
    }
  };

  return (
    <div
      ref={barRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: 'rgba(10, 8, 5, 0.96)',
        borderBottom: '1px solid rgba(107, 78, 39, 0.5)',
        // Three columns: left cluster | center cluster | right cluster.
        // `1fr auto 1fr` keeps the center anchored to the bar's geometric
        // midpoint while the side `1fr` tracks share the remaining space.
        // This works here because the left cluster (exit + score + timer)
        // and right cluster (Concede) are now both small enough to fit in
        // their 1fr share — TURN N / NAME's-turn moved to a canvas overlay
        // over the opponent's hand zone, freeing ~140px from the left.
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        gap: 8,
        paddingLeft: 12,
        paddingRight: 12,
      }}
    >
      {/* ================================================================
          LEFT — Exit + turn counter + whose turn + score + timer
          ================================================================ */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          minWidth: 0,
        }}
      >
      {/* Exit to lobby */}
      <button
        onClick={() => isFinished ? window.location.href = '/play' : setShowLeaveConfirm(true)}
        title="Back to lobby"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          borderRadius: 4,
          flexShrink: 0,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          color: 'rgba(232, 213, 163, 0.35)',
          transition: 'color 0.15s, background 0.15s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = '#e8d5a3';
          e.currentTarget.style.background = 'rgba(196, 149, 90, 0.1)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'rgba(232, 213, 163, 0.35)';
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 21H19a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H15" />
          <polyline points="8 17 3 12 8 7" />
          <line x1="3" y1="12" x2="15" y2="12" />
        </svg>
      </button>

      {/* Score + timer wrapper. The TURN N / NAME's turn block lives over
          the opponent's hand zone in the canvas instead — keeps the bar
          narrow enough that the centered phase row never collides. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexShrink: 0,
        }}
      >
      {/* Score */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontFamily: 'var(--font-cinzel), Georgia, serif',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <span style={{ color: '#c4955a', fontSize: FZ.score, fontWeight: 700, lineHeight: 1 }}>{myScore}</span>
          <span style={{ color: 'rgba(196, 149, 90, 0.45)', fontSize: FZ.caption, letterSpacing: '0.08em', textTransform: 'uppercase', lineHeight: 1, marginTop: 2 }}>you</span>
        </div>
        <span style={{ color: 'rgba(232, 213, 163, 0.2)', fontSize: FZ.ui, fontWeight: 400 }}>vs</span>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <span style={{ color: '#4a7ab5', fontSize: FZ.score, fontWeight: 700, lineHeight: 1 }}>{opponentScore}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'rgba(74, 122, 181, 0.45)', fontSize: FZ.caption, letterSpacing: '0.08em', textTransform: 'uppercase', lineHeight: 1, marginTop: 2 }}>
            opp
            <span
              title={opponentConnectionStatus === 'connected' ? 'Connected' : opponentConnectionStatus === 'reconnecting' ? 'Reconnecting...' : 'Disconnected'}
              style={{
                display: 'inline-block',
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: opponentConnectionStatus === 'connected' ? '#22c55e' : opponentConnectionStatus === 'reconnecting' ? '#eab308' : '#ef4444',
                boxShadow: `0 0 5px ${opponentConnectionStatus === 'connected' ? 'rgba(34, 197, 94, 0.6)' : opponentConnectionStatus === 'reconnecting' ? 'rgba(234, 179, 8, 0.6)' : 'rgba(239, 68, 68, 0.6)'}`,
                flexShrink: 0,
              }}
            />
          </span>
        </div>
      </div>

      {/* Game timer — hidden on narrow bars to avoid colliding with the
          centered phase indicator. */}
      {timerVisible && timerDisplay && !isBarNarrow && (
        <span
          title={
            isServerPaused ? 'Game is paused' :
            isMyRequest && pauseRequestType === 'pause' ? 'Waiting for opponent to accept pause' :
            isMyRequest && pauseRequestType === 'resume' ? 'Waiting for opponent to accept resume' :
            timerPaused ? 'Timer paused (searching)' : 'Elapsed game time'
          }
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: FZ.body,
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '0.04em',
            color: (isServerPaused || timerPaused) ? 'rgba(232, 213, 163, 0.25)' : 'rgba(232, 213, 163, 0.45)',
            fontStyle: isServerPaused ? 'italic' : 'normal',
            flexShrink: 0,
            transition: 'color 0.3s',
          }}
        >
          {/* Fixed-width slot so proportional digits in Cinzel don't shift the
              pause button as the timer ticks (e.g. "00:51" vs "00:54"). 4.5em
              fits "MM:SS"; once the game crosses an hour it grows to fit
              "H:MM:SS" — a one-time shift, not a per-second jitter. */}
          <span
            style={{
              display: 'inline-block',
              minWidth: timerDisplay && timerDisplay.length > 5 ? '6em' : '4.5em',
              textAlign: 'right',
            }}
          >
            {timerDisplay}
          </span>
          {isServerPaused && (
            <span
              style={{
                fontSize: FZ.caption,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'rgba(234, 179, 8, 0.7)',
                fontStyle: 'normal',
              }}
            >
              paused
            </span>
          )}
          {pauseButtonMode !== 'hidden' && (
            <button
              type="button"
              onClick={() => {
                if (pauseButtonMode === 'pause') onRequestPause?.();
                else if (pauseButtonMode === 'play') onRequestResume?.();
                else if (pauseButtonMode === 'cancel') onCancelPauseRequest?.();
              }}
              title={
                pauseButtonMode === 'pause' ? 'Pause game (asks opponent)' :
                pauseButtonMode === 'play' ? 'Resume game (asks opponent)' :
                'Cancel pending request'
              }
              aria-label={
                pauseButtonMode === 'pause' ? 'Pause game' :
                pauseButtonMode === 'play' ? 'Resume game' :
                'Cancel pause request'
              }
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 22,
                height: 22,
                padding: 0,
                background: 'transparent',
                border: '1px solid rgba(232, 213, 163, 0.25)',
                borderRadius: 4,
                color: pauseButtonMode === 'cancel'
                  ? 'rgba(234, 179, 8, 0.85)'
                  : 'rgba(232, 213, 163, 0.65)',
                cursor: 'pointer',
                transition: 'background 0.15s, border-color 0.15s, color 0.15s',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(232, 213, 163, 0.08)';
                e.currentTarget.style.borderColor = 'rgba(232, 213, 163, 0.5)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = 'rgba(232, 213, 163, 0.25)';
              }}
            >
              {pauseButtonMode === 'pause' && (
                <svg width="10" height="11" viewBox="0 0 10 11" fill="currentColor" aria-hidden="true">
                  <rect x="1" y="1" width="2.5" height="9" rx="0.5" />
                  <rect x="6.5" y="1" width="2.5" height="9" rx="0.5" />
                </svg>
              )}
              {pauseButtonMode === 'play' && (
                <svg width="10" height="11" viewBox="0 0 10 11" fill="currentColor" aria-hidden="true">
                  <path d="M2 1.5 L2 9.5 L9 5.5 Z" />
                </svg>
              )}
              {pauseButtonMode === 'cancel' && (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M2 2 L8 8 M8 2 L2 8" />
                </svg>
              )}
            </button>
          )}
        </span>
      )}
      </div>
      </div>

      {/* ================================================================
          CENTER — ‹ Arrow | Phase buttons | › Arrow | End Turn
          Sits in the middle grid column. With `1fr auto 1fr` columns the
          center is anchored to the bar's geometric midpoint while the
          left/right `1fr` tracks absorb spare space — and shifts gracefully
          rather than overlapping when one side outgrows its track.
          ================================================================ */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          minWidth: 0,
        }}
      >
        {/* Previous phase arrow */}
        <button
          onClick={handlePrevPhase}
          disabled={!isMyTurn || isFirstPhase}
          title="Previous phase"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: !isMyTurn || isFirstPhase ? 'default' : 'pointer',
            color: !isMyTurn || isFirstPhase ? 'rgba(107, 78, 39, 0.3)' : 'rgba(232, 213, 163, 0.45)',
            fontSize: FZ.headline,
            fontFamily: 'serif',
            padding: '2px 6px',
            transition: 'color 0.2s',
            lineHeight: 1,
          }}
          onMouseEnter={(e) => { if (isMyTurn && !isFirstPhase) e.currentTarget.style.color = '#e8d5a3'; }}
          onMouseLeave={(e) => { if (isMyTurn && !isFirstPhase) e.currentTarget.style.color = 'rgba(232, 213, 163, 0.45)'; }}
        >
          &#x276E;
        </button>

        <div
          ref={phaseRowRef}
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'stretch',
            gap: 2,
          }}
        >
          {/* Sliding pill (behind the buttons). */}
          <span
            aria-hidden
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: activeBounds.width,
              transform: `translateX(${activeBounds.left}px)`,
              background: 'rgba(196, 149, 90, 0.15)',
              border: '1px solid rgba(196, 149, 90, 0.45)',
              borderRadius: 20,
              boxSizing: 'border-box',
              opacity: hasMeasuredRef.current && activeBounds.width > 0 ? 1 : 0,
              transition: 'transform 0.32s cubic-bezier(0.4, 0, 0.2, 1), width 0.32s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s',
              pointerEvents: 'none',
              willChange: 'transform, width',
            }}
          />

          {/* Sliding underline (rides along under the pill). */}
          <span
            aria-hidden
            style={{
              position: 'absolute',
              bottom: 2,
              left: 0,
              height: 2,
              width: activeBounds.width * 0.7,
              transform: `translateX(${activeBounds.left + activeBounds.width * 0.15}px)`,
              background: '#c4955a',
              borderRadius: 1,
              boxShadow: '0 0 6px rgba(196, 149, 90, 0.5)',
              opacity: hasMeasuredRef.current && activeBounds.width > 0 ? 1 : 0,
              transition: 'transform 0.32s cubic-bezier(0.4, 0, 0.2, 1), width 0.32s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s',
              pointerEvents: 'none',
              willChange: 'transform, width',
              zIndex: 1,
            }}
          />

          {PHASE_ORDER.map((phase) => {
            const isActive = phase === currentPhase;
            const canClick = isMyTurn && !isActive;

            return (
              <button
                key={phase}
                ref={(el) => { buttonRefs.current[phase] = el; }}
                onClick={() => canClick && onSetPhase(phase)}
                disabled={!isMyTurn}
                title={isMyTurn ? `Go to ${PHASE_LABELS[phase]}` : PHASE_LABELS[phase]}
                style={{
                  position: 'relative',
                  padding: '4px 10px',
                  background: 'transparent',
                  border: '1px solid transparent',
                  borderRadius: 20,
                  cursor: canClick ? 'pointer' : 'default',
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: FZ.ui,
                  letterSpacing: '0.07em',
                  textTransform: 'uppercase',
                  color: isActive
                    ? '#e8d5a3'
                    : isMyTurn
                    ? 'rgba(232, 213, 163, 0.45)'
                    : 'rgba(150, 150, 160, 0.35)',
                  transition: 'color 0.24s ease-out',
                  whiteSpace: 'nowrap',
                  zIndex: 1,
                }}
                onMouseEnter={(e) => {
                  if (canClick) e.currentTarget.style.color = '#e8d5a3';
                }}
                onMouseLeave={(e) => {
                  if (canClick) e.currentTarget.style.color = 'rgba(232, 213, 163, 0.45)';
                }}
              >
                {PHASE_LABELS[phase]}
              </button>
            );
          })}
        </div>

        {/* Next phase / End Turn arrow */}
        <button
          onClick={handleNextPhase}
          disabled={!isMyTurn}
          title={isLastPhase ? 'End turn' : 'Next phase'}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: !isMyTurn ? 'default' : 'pointer',
            color: !isMyTurn ? 'rgba(107, 78, 39, 0.3)' : 'rgba(232, 213, 163, 0.45)',
            fontSize: FZ.headline,
            fontFamily: 'serif',
            padding: '2px 6px',
            transition: 'color 0.2s',
            lineHeight: 1,
          }}
          onMouseEnter={(e) => { if (isMyTurn) e.currentTarget.style.color = '#e8d5a3'; }}
          onMouseLeave={(e) => { if (isMyTurn) e.currentTarget.style.color = 'rgba(232, 213, 163, 0.45)'; }}
        >
          &#x276F;
        </button>

        {/* End Turn button */}
        <button
          onClick={onEndTurn}
          disabled={!isMyTurn}
          title={isMyTurn ? 'End your turn' : "Wait for opponent's turn to end"}
          style={{
            marginLeft: 10,
            padding: '5px 12px',
            background: isMyTurn ? 'rgba(196, 149, 90, 0.15)' : 'transparent',
            border: `1px solid ${isMyTurn ? 'rgba(196, 149, 90, 0.45)' : 'rgba(107, 78, 39, 0.25)'}`,
            borderRadius: 4,
            cursor: isMyTurn ? 'pointer' : 'default',
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: FZ.ui,
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            color: isMyTurn ? '#e8d5a3' : 'rgba(196, 149, 90, 0.3)',
            transition: 'background 0.15s, border-color 0.15s, color 0.15s',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={(e) => {
            if (!isMyTurn) return;
            e.currentTarget.style.background = 'rgba(196, 149, 90, 0.28)';
            e.currentTarget.style.borderColor = 'rgba(196, 149, 90, 0.75)';
          }}
          onMouseLeave={(e) => {
            if (!isMyTurn) return;
            e.currentTarget.style.background = 'rgba(196, 149, 90, 0.15)';
            e.currentTarget.style.borderColor = 'rgba(196, 149, 90, 0.45)';
          }}
        >
          End Turn
        </button>
      </div>

      {/* ================================================================
          RIGHT — Concede (playing) or Play Again (finished)
          ================================================================ */}
      <div
        style={{
          justifySelf: 'end',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexShrink: 0,
          minWidth: 0,
        }}
      >
        {isFinished && onPlayAgain && (
          <button
            onClick={rematchPending ? undefined : onPlayAgain}
            disabled={rematchPending}
            style={{
              padding: '5px 12px',
              background: rematchPending ? 'rgba(107, 78, 39, 0.1)' : 'rgba(196, 149, 90, 0.15)',
              border: `1px solid ${rematchPending ? 'rgba(107, 78, 39, 0.25)' : 'rgba(196, 149, 90, 0.45)'}`,
              borderRadius: 4,
              cursor: rematchPending ? 'default' : 'pointer',
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: FZ.ui,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: rematchPending ? 'rgba(196, 149, 90, 0.35)' : '#e8d5a3',
              transition: 'background 0.15s, border-color 0.15s, color 0.15s',
              opacity: rematchPending ? 0.7 : 1,
            }}
            onMouseEnter={(e) => {
              if (rematchPending) return;
              e.currentTarget.style.background = 'rgba(196, 149, 90, 0.28)';
              e.currentTarget.style.borderColor = 'rgba(196, 149, 90, 0.75)';
            }}
            onMouseLeave={(e) => {
              if (rematchPending) return;
              e.currentTarget.style.background = 'rgba(196, 149, 90, 0.15)';
              e.currentTarget.style.borderColor = 'rgba(196, 149, 90, 0.45)';
            }}
          >
            {rematchPending ? 'Waiting...' : 'Play Again'}
          </button>
        )}
        {isFinished && !onPlayAgain && onBackToLobby && (
          <button
            onClick={onBackToLobby}
            style={{
              padding: '5px 12px',
              background: 'rgba(196, 149, 90, 0.15)',
              border: '1px solid rgba(196, 149, 90, 0.45)',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: FZ.ui,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: '#e8d5a3',
              transition: 'background 0.15s, border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(196, 149, 90, 0.28)';
              e.currentTarget.style.borderColor = 'rgba(196, 149, 90, 0.75)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(196, 149, 90, 0.15)';
              e.currentTarget.style.borderColor = 'rgba(196, 149, 90, 0.45)';
            }}
          >
            Back to Lobby
          </button>
        )}
        {!isFinished && disconnectTimeoutFired && onClaimVictory && (
          <button
            onClick={onClaimVictory}
            style={{
              padding: '5px 12px',
              background: 'rgba(180, 140, 60, 0.15)',
              border: '1px solid rgba(180, 140, 60, 0.5)',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: FZ.ui,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: '#d4b86a',
              fontWeight: 600,
              transition: 'background 0.15s, border-color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(180, 140, 60, 0.28)';
              e.currentTarget.style.borderColor = 'rgba(180, 140, 60, 0.75)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(180, 140, 60, 0.15)';
              e.currentTarget.style.borderColor = 'rgba(180, 140, 60, 0.5)';
            }}
          >
            Claim Victory
          </button>
        )}
        {!isFinished && !disconnectTimeoutFired && onConcede && (
          <button
            onClick={() => setShowConcedeConfirm(true)}
            style={{
              padding: '5px 12px',
              background: 'transparent',
              border: '1px solid rgba(180, 60, 60, 0.5)',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: FZ.ui,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: 'rgba(220, 120, 120, 0.75)',
              transition: 'background 0.15s, border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(60, 10, 10, 0.5)';
              e.currentTarget.style.borderColor = 'rgba(220, 80, 80, 0.6)';
              e.currentTarget.style.color = 'rgba(240, 150, 150, 0.9)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = 'rgba(180, 60, 60, 0.5)';
              e.currentTarget.style.color = 'rgba(220, 120, 120, 0.75)';
            }}
          >
            Concede
          </button>
        )}
      </div>

      {/* Concede confirmation modal */}
      {showConcedeConfirm && (
        <div
          onClick={() => setShowConcedeConfirm(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            bottom: 0,
            right: isLoupeVisible ? 'clamp(280px, 20vw, 380px)' : '36px',
            zIndex: 900,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(6, 4, 2, 0.7)',
            backdropFilter: 'blur(3px)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'rgba(14, 10, 6, 0.97)',
              border: '1px solid rgba(180, 60, 60, 0.3)',
              borderRadius: 10,
              padding: '32px 36px',
              textAlign: 'center',
              maxWidth: 340,
              width: '100%',
              boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(180, 60, 60, 0.08)',
            }}
          >
            <p style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: FZ.ui,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'rgba(220, 120, 120, 0.5)',
            }}>Concede</p>
            <h2 style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: FZ.headline,
              fontWeight: 700,
              color: '#e8d5a3',
              marginTop: 8,
              textShadow: '0 1px 4px rgba(0,0,0,0.5)',
            }}>Are you sure?</h2>
            <p style={{
              marginTop: 8,
              fontFamily: 'Georgia, serif',
              fontSize: FZ.bodyLg,
              color: 'rgba(196, 149, 90, 0.5)',
            }}>This will end the game and count as a loss.</p>

            <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
              <button
                onClick={() => setShowConcedeConfirm(false)}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  borderRadius: 4,
                  border: '1px solid rgba(107, 78, 39, 0.3)',
                  background: 'transparent',
                  color: 'rgba(196, 149, 90, 0.6)',
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: FZ.body,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowConcedeConfirm(false);
                  onConcede?.();
                }}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  borderRadius: 4,
                  border: '1px solid rgba(180, 60, 60, 0.45)',
                  background: 'rgba(180, 60, 60, 0.15)',
                  color: '#dc7878',
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: FZ.body,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                Concede
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Leave game confirmation modal */}
      {showLeaveConfirm && (
        <div
          onClick={() => setShowLeaveConfirm(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            bottom: 0,
            right: isLoupeVisible ? 'clamp(280px, 20vw, 380px)' : '36px',
            zIndex: 900,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(6, 4, 2, 0.7)',
            backdropFilter: 'blur(3px)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'rgba(14, 10, 6, 0.97)',
              border: '1px solid rgba(107, 78, 39, 0.3)',
              borderRadius: 10,
              padding: '32px 36px',
              textAlign: 'center',
              maxWidth: 340,
              width: '100%',
              boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(196, 149, 90, 0.08)',
            }}
          >
            <p style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: FZ.ui,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'rgba(196, 149, 90, 0.5)',
            }}>Leave Game</p>
            <h2 style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: FZ.headline,
              fontWeight: 700,
              color: '#e8d5a3',
              marginTop: 8,
              textShadow: '0 1px 4px rgba(0,0,0,0.5)',
            }}>Return to lobby?</h2>
            <p style={{
              marginTop: 8,
              fontFamily: 'Georgia, serif',
              fontSize: FZ.bodyLg,
              color: 'rgba(196, 149, 90, 0.5)',
            }}>This will end the game and count as a resignation.</p>

            <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
              <button
                onClick={() => setShowLeaveConfirm(false)}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  borderRadius: 4,
                  border: '1px solid rgba(107, 78, 39, 0.3)',
                  background: 'transparent',
                  color: 'rgba(196, 149, 90, 0.6)',
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: FZ.body,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowLeaveConfirm(false);
                  onConcede?.();
                  window.location.href = '/play';
                }}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  borderRadius: 4,
                  border: '1px solid rgba(180, 60, 60, 0.45)',
                  background: 'rgba(180, 60, 60, 0.15)',
                  color: '#dc7878',
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: FZ.body,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
