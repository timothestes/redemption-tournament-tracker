'use client';

import { PHASE_ORDER } from '@/app/goldfish/types';
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
}: TurnIndicatorProps) {
  const currentPhase: string = game?.currentPhase ?? 'draw';
  const turnNumber: number = game?.turnNumber ? Number(game.turnNumber) : 1;
  const currentIdx = PHASE_ORDER.indexOf(currentPhase as GamePhase);
  const isFirstPhase = currentIdx <= 0;
  const isLastPhase = currentIdx >= PHASE_ORDER.length - 1;

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
      style={{
        width: '100%',
        height: '100%',
        background: 'rgba(10, 8, 5, 0.96)',
        borderBottom: '1px solid rgba(107, 78, 39, 0.5)',
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 12,
        paddingRight: 12,
        gap: 0,
      }}
    >
      {/* ================================================================
          LEFT — Turn counter + whose turn it is
          ================================================================ */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          minWidth: 120,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 10,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'rgba(232, 213, 163, 0.55)',
            lineHeight: 1,
          }}
        >
          Turn{' '}
          <span style={{ color: '#e8d5a3', fontSize: 13, fontWeight: 700 }}>
            {turnNumber}
          </span>
        </span>
        <span
          style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 9,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: isMyTurn ? '#c4955a' : '#4a7ab5',
            lineHeight: 1,
            marginTop: 3,
          }}
        >
          {isMyTurn ? `${myName}'s turn (you)` : `${opponentName}'s turn`}
        </span>
      </div>

      {/* ================================================================
          CENTER — ‹ Arrow | Phase buttons | › Arrow (matches goldfish)
          ================================================================ */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
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
            fontSize: 18,
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

        {PHASE_ORDER.map((phase) => {
          const isActive = phase === currentPhase;
          const canClick = isMyTurn && !isActive;

          return (
            <button
              key={phase}
              onClick={() => canClick && onSetPhase(phase)}
              disabled={!isMyTurn}
              title={isMyTurn ? `Go to ${PHASE_LABELS[phase]}` : PHASE_LABELS[phase]}
              style={{
                position: 'relative',
                padding: '4px 10px',
                background: isActive ? 'rgba(196, 149, 90, 0.15)' : 'transparent',
                border: isActive ? '1px solid rgba(196, 149, 90, 0.45)' : '1px solid transparent',
                borderRadius: 20,
                cursor: canClick ? 'pointer' : 'default',
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                fontSize: 10,
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                color: isActive
                  ? '#e8d5a3'
                  : isMyTurn
                  ? 'rgba(232, 213, 163, 0.45)'
                  : 'rgba(150, 150, 160, 0.35)',
                transition: 'color 0.15s, background 0.15s, border-color 0.15s',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => {
                if (canClick) {
                  e.currentTarget.style.color = '#e8d5a3';
                  e.currentTarget.style.background = 'rgba(196, 149, 90, 0.08)';
                }
              }}
              onMouseLeave={(e) => {
                if (canClick) {
                  e.currentTarget.style.color = 'rgba(232, 213, 163, 0.45)';
                  e.currentTarget.style.background = 'transparent';
                }
              }}
            >
              {PHASE_LABELS[phase]}
              {isActive && (
                <span
                  style={{
                    position: 'absolute',
                    bottom: 2,
                    left: '15%',
                    right: '15%',
                    height: 2,
                    background: '#c4955a',
                    borderRadius: 1,
                    boxShadow: '0 0 6px rgba(196, 149, 90, 0.5)',
                    display: 'block',
                  }}
                />
              )}
            </button>
          );
        })}

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
            fontSize: 18,
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
      </div>

      {/* ================================================================
          RIGHT — Concede only (Draw/Roll/EndTurn moved to bottom toolbar)
          ================================================================ */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexShrink: 0,
          justifyContent: 'flex-end',
        }}
      >
        {onConcede && (
          <button
            onClick={() => {
              const confirmed = window.confirm('Are you sure you want to concede this game?');
              if (confirmed) onConcede();
            }}
            style={{
              padding: '5px 12px',
              background: 'transparent',
              border: '1px solid rgba(180, 60, 60, 0.35)',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 10,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: 'rgba(220, 120, 120, 0.6)',
              transition: 'background 0.15s, border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(60, 10, 10, 0.5)';
              e.currentTarget.style.borderColor = 'rgba(220, 80, 80, 0.6)';
              e.currentTarget.style.color = 'rgba(240, 150, 150, 0.9)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = 'rgba(180, 60, 60, 0.35)';
              e.currentTarget.style.color = 'rgba(220, 120, 120, 0.6)';
            }}
          >
            Concede
          </button>
        )}
      </div>
    </div>
  );
}
