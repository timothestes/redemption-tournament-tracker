'use client';

import { useGame } from '../state/GameContext';

export function GameHUD() {
  const { state } = useGame();
  const soulsRescued = state.zones['land-of-redemption'].length;

  if (!state.options.showTurnCounter) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(48px + env(safe-area-inset-top, 0px))',
        left: 'calc(12px + env(safe-area-inset-left, 0px))',
        display: 'flex',
        gap: 20,
        zIndex: 100,
        pointerEvents: 'none',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 9,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--gf-text-dim)',
          }}
        >
          Turn
        </div>
        <div
          style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 24,
            color: 'var(--gf-text-bright)',
            lineHeight: 1,
          }}
        >
          {state.turn}
        </div>
      </div>

      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 9,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--gf-text-dim)',
          }}
        >
          Souls
        </div>
        <div
          style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 24,
            color: 'var(--gf-gold)',
            lineHeight: 1,
          }}
        >
          {soulsRescued}
        </div>
      </div>
    </div>
  );
}
