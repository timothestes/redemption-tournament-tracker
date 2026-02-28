'use client';

import { useGame } from '../state/GameContext';
import { PHASE_ORDER, GamePhase } from '../types';
import { motion } from 'framer-motion';

const PHASE_LABELS: Record<GamePhase, string> = {
  setup: 'Setup',
  draw: 'Draw',
  upkeep: 'Upkeep',
  preparation: 'Preparation',
  battle: 'Battle',
  discard: 'Discard',
};

const PHASE_TIPS: Record<GamePhase, string> = {
  setup: 'Game is being set up',
  draw: 'Draw 3 cards from your deck',
  upkeep: 'Resolve upkeep effects',
  preparation: 'Play characters, fortresses, artifacts to territory',
  battle: 'Initiate and resolve battles',
  discard: 'Discard down to hand limit if needed',
};

export function PhaseBar() {
  const { state, advancePhase, endTurn } = useGame();
  const currentPhase = state.phase;

  const handlePhaseClick = (phase: GamePhase) => {
    if (phase === currentPhase) return;

    // Advance to next phase
    const currentIdx = PHASE_ORDER.indexOf(currentPhase as any);
    const targetIdx = PHASE_ORDER.indexOf(phase);

    if (targetIdx > currentIdx) {
      for (let i = currentIdx; i < targetIdx; i++) {
        advancePhase();
      }
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 40,
        background: '#2a1f12',
        borderBottom: '1px solid #6b4e27',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        zIndex: 100,
        padding: '0 16px',
      }}
    >
      {/* Turn counter */}
      <span
        style={{
          position: 'absolute',
          left: 16,
          fontFamily: 'var(--font-cinzel), Georgia, serif',
          fontSize: 12,
          letterSpacing: '0.06em',
          color: '#8b6532',
        }}
      >
        Turn{' '}
        <span style={{ color: '#e8d5a3', fontSize: 14, fontWeight: 'bold' }}>
          {state.turn}
        </span>
      </span>

      {PHASE_ORDER.map((phase) => {
        const isActive = phase === currentPhase;
        return (
          <button
            key={phase}
            onClick={() => handlePhaseClick(phase)}
            title={PHASE_TIPS[phase]}
            style={{
              position: 'relative',
              padding: '6px 16px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 12,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: isActive ? '#e8d5a3' : '#8b6532',
              transition: 'color 0.2s',
            }}
          >
            {PHASE_LABELS[phase]}
            {isActive && (
              <motion.div
                layoutId="phase-indicator"
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: '10%',
                  right: '10%',
                  height: 2,
                  background: '#c4955a',
                  borderRadius: 1,
                  boxShadow: '0 0 8px rgba(196,149,90,0.5)',
                }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            )}
          </button>
        );
      })}

      {/* End Turn button */}
      <button
        onClick={endTurn}
        style={{
          padding: '6px 16px',
          background: 'transparent',
          border: '1px solid #6b4e27',
          borderRadius: 4,
          cursor: 'pointer',
          fontFamily: 'var(--font-cinzel), Georgia, serif',
          fontSize: 11,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: '#c9b99a',
          marginLeft: 12,
        }}
      >
        End Turn
      </button>

      {/* Arrow indicators between phases */}
      <style jsx>{`
        button:hover {
          color: #e8d5a3 !important;
        }
      `}</style>
    </div>
  );
}
