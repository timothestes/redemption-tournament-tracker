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
        top: 48,
        left: 12,
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
            color: '#8b6532',
          }}
        >
          Turn
        </div>
        <div
          style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 24,
            color: '#e8d5a3',
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
            color: '#8b6532',
          }}
        >
          Souls
        </div>
        <div
          style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 24,
            color: '#f0c060',
            lineHeight: 1,
          }}
        >
          {soulsRescued}
        </div>
      </div>
    </div>
  );
}
