'use client';

// Battle Zone resolution buttons + confirm summary (design spec §8, Task 13).
// HTML overlay, positioned band-relative via the dual-corner virtualToScreen
// pattern the brigade-mismatch toast established (MultiplayerCanvas.tsx
// ~7517-7576) — the row is anchored just BELOW the band's bottom-right
// corner (not inside it) specifically so it never collides with that toast,
// which occupies the band's own bottom-right corner. Mounted from
// MultiplayerCanvas (not client.tsx) because it needs band geometry +
// scale/offsets, which only exist there.
//
// The soul-surrender dialog for `awaiting-soul` is Task 14's — this
// component only gates on `battleState === 'active'` and renders nothing
// during `awaiting-soul` (all three buttons hidden, per spec §8).

import { useState } from 'react';
import { virtualToScreen } from '@/app/shared/layout/virtualCanvas';
import { summarizeAutoReturn, type BattleCardLike } from '../lib/battleMath';
import type { ZoneRect } from '../layout/multiplayerLayout';

type ResolutionAction = 'claim-victory' | 'battle-lost' | 'end-battle';

interface BattleResolutionUIProps {
  /** Battle band rect (virtual coords). Caller gates mounting on this being present. */
  band: ZoneRect;
  scale: number;
  offsetX: number;
  offsetY: number;
  /** '' | 'active' | 'awaiting-soul' — only 'active' shows buttons. */
  battleState: string;
  /** My seat ('0' | '1' | '') and the current attacker's seat. */
  mySeat: string;
  attackerSeat: string;
  /** Every card currently in the battle band (both owners) — feeds the confirm summary. */
  cards: BattleCardLike[];
  /** Both Claim Victory and Battle Lost dispatch the same server reducer (resolve_battle) —
   *  the server decides win/loss from caller identity, not from which button was pressed. */
  onResolveBattle: () => void;
  onEndBattle: () => void;
}

const BUTTON_COPY: Record<ResolutionAction, { label: string; dialogTitle: string }> = {
  'claim-victory': { label: '⚑ Claim Victory', dialogTitle: 'Claim Victory?' },
  'battle-lost': { label: '🏳 Battle Lost', dialogTitle: 'Battle Lost?' },
  'end-battle': { label: '↩ End Battle', dialogTitle: 'End Battle?' },
};

type Tone = 'gold' | 'red' | 'neutral';

const TONE_STYLE: Record<Tone, { border: string; bg: string; bgHover: string; color: string }> = {
  gold: { border: 'rgba(196, 149, 90, 0.5)', bg: 'rgba(196, 149, 90, 0.15)', bgHover: 'rgba(196, 149, 90, 0.3)', color: '#e8d5a3' },
  red: { border: 'rgba(180, 60, 60, 0.5)', bg: 'rgba(60, 10, 10, 0.35)', bgHover: 'rgba(60, 10, 10, 0.55)', color: '#dc7878' },
  neutral: { border: 'rgba(107, 78, 39, 0.4)', bg: 'rgba(14, 10, 6, 0.6)', bgHover: 'rgba(107, 78, 39, 0.25)', color: 'rgba(196, 149, 90, 0.8)' },
};

function ResolutionButton({ label, tone, onClick }: { label: string; tone: Tone; onClick: () => void }) {
  const t = TONE_STYLE[tone];
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px',
        background: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: 6,
        color: t.color,
        fontFamily: 'var(--font-cinzel), Georgia, serif',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.05em',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
        transition: 'background 0.15s, border-color 0.15s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = t.bgHover; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = t.bg; }}
    >
      {label}
    </button>
  );
}

/**
 * "N characters → territory · N enhancements → discard · N souls → Land of
 * Bondage · N weapons stay attached · kept in play: X, Y" — zero segments
 * omitted, names comma-joined. `summarizeAutoReturn` already excludes
 * equipped accessories from the enhancement/discard counts (weaponsAttached
 * is its own bucket), so weapons are never double-counted here.
 */
function summaryText(cards: BattleCardLike[]): string {
  const s = summarizeAutoReturn(cards);
  const segments: string[] = [];
  if (s.toTerritory > 0) segments.push(`${s.toTerritory} character${s.toTerritory === 1 ? '' : 's'} → territory`);
  if (s.toDiscard > 0) segments.push(`${s.toDiscard} enhancement${s.toDiscard === 1 ? '' : 's'} → discard`);
  if (s.toLandOfBondage > 0) segments.push(`${s.toLandOfBondage} soul${s.toLandOfBondage === 1 ? '' : 's'} → Land of Bondage`);
  if (s.weaponsAttached > 0) segments.push(`${s.weaponsAttached} weapon${s.weaponsAttached === 1 ? '' : 's'} stay attached`);
  if (s.keptInPlay.length > 0) segments.push(`kept in play: ${s.keptInPlay.join(', ')}`);
  return segments.length > 0 ? segments.join(' · ') : 'Nothing in the band to auto-return.';
}

export default function BattleResolutionUI({
  band,
  scale,
  offsetX,
  offsetY,
  battleState,
  mySeat,
  attackerSeat,
  cards,
  onResolveBattle,
  onEndBattle,
}: BattleResolutionUIProps) {
  const [confirmAction, setConfirmAction] = useState<ResolutionAction | null>(null);

  // Task 14 owns awaiting-soul UI; all three buttons hide (spec §8). Caller
  // already gates mounting on status==='playing' && battleActive — this is
  // the awaiting-soul-specific half of that gate.
  if (battleState !== 'active') return null;

  const isAttacker = mySeat !== '' && mySeat === attackerSeat;
  const isDefender = mySeat !== '' && attackerSeat !== '' && mySeat !== attackerSeat;

  // Dual-corner virtualToScreen (width only, height is CSS content-driven) —
  // same idiom as the brigade toast. Anchored just BELOW the band's bottom
  // edge (not inside it) so it never collides with that toast's corner,
  // which lives inside the band's own bottom-right.
  const rowVirtualWidth = 300;
  const topLeft = virtualToScreen(band.x + band.width - rowVirtualWidth - 8, band.y + band.height + 6, scale, offsetX, offsetY);
  const right = virtualToScreen(band.x + band.width - 8, band.y + band.height + 6, scale, offsetX, offsetY);

  const dispatch = (action: ResolutionAction) => {
    setConfirmAction(null);
    if (action === 'end-battle') onEndBattle();
    else onResolveBattle();
  };

  return (
    <>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 600 }}>
        <div
          style={{
            position: 'absolute',
            left: topLeft.x,
            top: topLeft.y,
            width: right.x - topLeft.x,
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            pointerEvents: 'auto',
          }}
        >
          {isAttacker && (
            <ResolutionButton label={BUTTON_COPY['claim-victory'].label} tone="gold" onClick={() => setConfirmAction('claim-victory')} />
          )}
          {isDefender && (
            <ResolutionButton label={BUTTON_COPY['battle-lost'].label} tone="red" onClick={() => setConfirmAction('battle-lost')} />
          )}
          <ResolutionButton label={BUTTON_COPY['end-battle'].label} tone="neutral" onClick={() => setConfirmAction('end-battle')} />
        </div>
      </div>

      {confirmAction && (
        <div
          onClick={() => setConfirmAction(null)}
          style={{
            position: 'fixed',
            inset: 0,
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
              padding: '28px 32px',
              textAlign: 'center',
              maxWidth: 380,
              width: '100%',
              boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(196, 149, 90, 0.08)',
            }}
          >
            <p
              style={{
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                fontSize: 11,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: 'rgba(196, 149, 90, 0.5)',
              }}
            >
              Battle Resolution
            </p>
            <h2
              style={{
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                fontSize: 20,
                fontWeight: 700,
                color: '#e8d5a3',
                marginTop: 8,
                textShadow: '0 1px 4px rgba(0,0,0,0.5)',
              }}
            >
              {BUTTON_COPY[confirmAction].dialogTitle}
            </h2>
            <p
              style={{
                marginTop: 12,
                fontFamily: 'Georgia, serif',
                fontSize: 13,
                lineHeight: 1.5,
                color: 'rgba(196, 149, 90, 0.75)',
              }}
            >
              {summaryText(cards)}
            </p>

            <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
              <button
                onClick={() => setConfirmAction(null)}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  borderRadius: 4,
                  border: '1px solid rgba(107, 78, 39, 0.3)',
                  background: 'transparent',
                  color: 'rgba(196, 149, 90, 0.6)',
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => dispatch(confirmAction)}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  borderRadius: 4,
                  border: `1px solid ${TONE_STYLE[confirmAction === 'battle-lost' ? 'red' : confirmAction === 'end-battle' ? 'neutral' : 'gold'].border}`,
                  background: TONE_STYLE[confirmAction === 'battle-lost' ? 'red' : confirmAction === 'end-battle' ? 'neutral' : 'gold'].bg,
                  color: TONE_STYLE[confirmAction === 'battle-lost' ? 'red' : confirmAction === 'end-battle' ? 'neutral' : 'gold'].color,
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
