'use client';

import { useRouter } from 'next/navigation';
import { useGame } from '../state/GameContext';
import { PHASE_ORDER, GamePhase } from '../types';
import { motion } from 'framer-motion';
import { showGameToast } from './GameToast';

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
  const { state, advancePhase, regressPhase, endTurn } = useGame();
  const router = useRouter();
  const currentPhase = state.phase;
  const currentIdx = PHASE_ORDER.indexOf(currentPhase as GamePhase);
  const isFirstPhase = currentIdx <= 0;
  const isLastPhase = currentIdx >= PHASE_ORDER.length - 1;

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

  const HAND_LIMIT = 16;

  const handleEndTurn = () => {
    const handSize = state.zones.hand.length;
    const deckSize = state.zones.deck.length;
    const canDraw = Math.min(3, deckSize, HAND_LIMIT - handSize);
    endTurn();
    if (canDraw < 3 && handSize >= HAND_LIMIT - 2) {
      showGameToast(`Hand limit reached — only drew ${Math.max(0, canDraw)} card${canDraw === 1 ? '' : 's'}`);
    } else if (deckSize === 0) {
      showGameToast('Deck is empty — no cards drawn');
    } else if (deckSize < 3) {
      showGameToast(`Only ${deckSize} card${deckSize === 1 ? '' : 's'} left in deck`);
    }
  };

  const handleLogoClick = () => {
    if (!state.deckId) {
      router.push('/decklist/community');
      return;
    }
    router.push(`/decklist/${state.deckId}`);
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
      {/* Previous phase arrow */}
      <button
        onClick={regressPhase}
        disabled={isFirstPhase}
        title="Previous phase"
        style={{
          background: 'transparent',
          border: 'none',
          cursor: isFirstPhase ? 'default' : 'pointer',
          color: isFirstPhase ? '#4a3520' : '#8b6532',
          fontSize: 18,
          fontFamily: 'serif',
          padding: '2px 6px',
          transition: 'color 0.2s',
          lineHeight: 1,
        }}
        onMouseEnter={(e) => { if (!isFirstPhase) e.currentTarget.style.color = '#e8d5a3'; }}
        onMouseLeave={(e) => { if (!isFirstPhase) e.currentTarget.style.color = '#8b6532'; }}
      >
        &#x276E;
      </button>

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

      {/* Next phase arrow */}
      <button
        onClick={isLastPhase ? handleEndTurn : advancePhase}
        title={isLastPhase ? 'End turn' : 'Next phase'}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: '#8b6532',
          fontSize: 18,
          fontFamily: 'serif',
          padding: '2px 6px',
          transition: 'color 0.2s',
          lineHeight: 1,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = '#e8d5a3'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = '#8b6532'; }}
      >
        &#x276F;
      </button>

      {/* End Turn button */}
      <button
        onClick={handleEndTurn}
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

      {/* Left side: logo */}
      <button
        onClick={handleLogoClick}
        title="Back to deck"
        style={{
          position: 'absolute',
          left: 12,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <img
          src="/darkmode_redemptionccgapp.webp"
          alt="Back to deck"
          style={{
            height: 28,
            width: 'auto',
            opacity: 0.85,
            transition: 'opacity 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.85'; }}
        />
      </button>

      {/* Right side: turn counter */}
      <span
        style={{
          position: 'absolute',
          right: 12,
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

      {/* Arrow indicators between phases */}
      <style jsx>{`
        button:hover:not(:disabled) {
          color: #e8d5a3 !important;
        }
      `}</style>
    </div>
  );
}
