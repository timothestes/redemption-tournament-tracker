'use client';

// Battle Zone resolution buttons (design spec §8, Task 13), plus the
// awaiting-soul chooser dialog / waiting pill (Task 14). HTML overlay,
// positioned band-relative via the dual-corner virtualToScreen pattern the
// brigade-mismatch toast established (MultiplayerCanvas.tsx ~7517-7576) —
// the row is anchored just BELOW the band's bottom-LEFT corner (not
// inside it, and not the right corner — product direction, PR #197,
// previously overlapped the sidebar's Territory pile), clear of the
// brigade-mismatch toast, which occupies the band's own bottom-right
// corner. Mounted from MultiplayerCanvas (not client.tsx) because it needs
// band geometry + scale/offsets, which only exist there.
//
// battleState === 'active' and 'awaiting-soul' are mutually exclusive, so
// the resolution-button row and the awaiting-soul pill/modal safely reuse
// the same anchor geometry below.
//
// Every resolution action (Win Battle / Battle Lost / End Battle)
// dispatches its reducer IMMEDIATELY on click — no confirm dialog (product
// direction: the confirm-summary step was cut). The post-battle summary is
// now a transient toast fired by the caller (MultiplayerCanvas) once the
// battle actually closes, not a pre-dispatch confirmation here.

import { useEffect, useState } from 'react';
import { virtualToScreen } from '@/app/shared/layout/virtualCanvas';
import type { ZoneRect } from '../layout/multiplayerLayout';
import type { CardInstance } from '@/lib/spacetimedb/module_bindings/types';
import type { DeckFormat } from '@/lib/deck-format';
import { resolveCardImageUrl, type ForgeResolverMap } from '../utils/forgeResolver';

type ResolutionAction = 'claim-victory' | 'battle-lost' | 'end-battle';

interface BattleResolutionUIProps {
  /** Battle band rect (virtual coords). Caller gates mounting on this being present. */
  band: ZoneRect;
  scale: number;
  offsetX: number;
  offsetY: number;
  /** '' | 'active' | 'awaiting-soul' — 'active' shows buttons, 'awaiting-soul' shows the
   *  Task 14 chooser modal (chooser) / waiting pill (everyone else, incl. spectators). */
  battleState: string;
  /** Real seats for both players — for spectators these are seat0/seat1 (the actual
   *  players' seats), NOT "which seat is the viewer": spectators pass isSpectator=true
   *  separately so this component never treats a spectator as a participant. */
  mySeat: string;
  opponentSeat: string;
  attackerSeat: string;
  /** True for the spectator viewer. Spectators never see resolution buttons or the
   *  awaiting-soul picker — only the waiting pill. */
  isSpectator: boolean;
  /** Deck format (normalizeDeckFormat mirror) — drives the awaiting-soul chooser rule
   *  (spec §7 / server surrender_soul: T1 defender picks, T2 & Paragon attacker picks). */
  format: DeckFormat;
  /** Display names for the pill/modal copy — real player names, not "You"/"Opponent",
   *  so the text reads correctly for spectators too. */
  myPlayerName: string;
  opponentPlayerName: string;
  /** Lost Souls at stake for the current battle (server's battleStakesLobLostSouls,
   *  mirrored client-side — see MultiplayerCanvas's stakesLostSoulRows). Only meaningful
   *  while battleState === 'awaiting-soul'. */
  eligibleSouls: CardInstance[];
  /** Stakes-soul ids (stringified) that have a Site attached — derived by the caller
   *  from the ACCESSORY rows' equippedToInstanceId links (a soul's own field is always
   *  0n; see siteAttachedSoulIds in battleMath). Drives the "⚑ in Site" badge. */
  siteAttachedSoulIds: Set<string>;
  /** Forge card-art resolver, for Forge playtest games. */
  forgeResolver?: ForgeResolverMap | null;
  /** Both Win Battle and Battle Lost dispatch the same server reducer (resolve_battle) —
   *  the server decides win/loss from caller identity, not from which button was pressed. */
  onResolveBattle: () => void;
  onEndBattle: () => void;
  onSurrenderSoul: (cardInstanceId: bigint) => void;
}

const BUTTON_COPY: Record<ResolutionAction, { label: string }> = {
  'claim-victory': { label: '⚑ Win Battle' },
  'battle-lost': { label: '🏳 Battle Lost' },
  'end-battle': { label: '↩ End Battle' },
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
 * Task 14: awaiting-soul UI. Chooser (spec §7: T1 defender / T2 & Paragon
 * attacker — mirrors the server's surrender_soul permission check exactly)
 * sees a compact centered picker of the souls at stake; everyone else
 * (non-chooser + every spectator) sees a status pill near the band, never
 * the picker. No opaque full-screen backdrop — the picker's own bounds are
 * kept small (max-height + scroll) specifically so it doesn't block the
 * chooser's view of the band behind it (spec §8).
 */
function AwaitingSoulUI({
  topLeft,
  right,
  mySeat,
  opponentSeat,
  attackerSeat,
  isSpectator,
  format,
  myPlayerName,
  opponentPlayerName,
  eligibleSouls,
  siteAttachedSoulIds,
  forgeResolver,
  pendingSoulId,
  setPendingSoulId,
  onSurrenderSoul,
  onEndBattle,
}: {
  topLeft: { x: number; y: number };
  right: { x: number; y: number };
  mySeat: string;
  opponentSeat: string;
  attackerSeat: string;
  isSpectator: boolean;
  format: DeckFormat;
  myPlayerName: string;
  opponentPlayerName: string;
  eligibleSouls: CardInstance[];
  siteAttachedSoulIds: Set<string>;
  forgeResolver?: ForgeResolverMap | null;
  pendingSoulId: bigint | null;
  setPendingSoulId: (id: bigint | null) => void;
  onSurrenderSoul: (cardInstanceId: bigint) => void;
  /** Bare dispatch (no confirm) — used by both the chooser's own "no souls
   *  left" button above and the non-chooser's escape-hatch button below. */
  onEndBattle: () => void;
}) {
  // Chooser derivation (spec §7 / server surrender_soul guard): T1 → the
  // defender picks which of their own souls to give up; T2 & Paragon → the
  // attacker picks which to take. mySeat/opponentSeat are the REAL seats of
  // both players (even for the spectator viewer — see BattleResolutionUIProps
  // doc), so this comparison is safe on its own; isSpectator is what stops a
  // spectator from ever being treated as the chooser.
  const defenderSeat = attackerSeat === mySeat ? opponentSeat : attackerSeat === opponentSeat ? mySeat : '';
  const chooserSeat = format === 'T1' ? defenderSeat : attackerSeat;
  const isChooser = !isSpectator && mySeat !== '' && mySeat === chooserSeat;
  const chooserName = chooserSeat === mySeat ? myPlayerName : chooserSeat === opponentSeat ? opponentPlayerName : 'Player';

  if (!isChooser) {
    // Spec §7 escape hatch: the server's end_battle reducer deliberately
    // accepts either player from 'awaiting-soul', but only the chooser had
    // a way to reach it — a stalling-but-connected chooser otherwise
    // stranded the non-chooser with nothing to click. Spectators (also
    // caught by !isChooser) still get the pill only, no button.
    return (
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 600 }}>
        <div
          style={{
            position: 'absolute',
            left: topLeft.x,
            top: topLeft.y,
            width: right.x - topLeft.x,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            gap: 8,
            pointerEvents: 'auto',
          }}
        >
          <span
            style={{
              padding: '6px 14px',
              background: 'rgba(14, 10, 6, 0.75)',
              border: '1px solid rgba(107, 78, 39, 0.4)',
              borderRadius: 6,
              color: 'rgba(196, 149, 90, 0.8)',
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.03em',
              whiteSpace: 'nowrap',
              boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
            }}
          >
            Waiting for {chooserName} to choose a soul…
          </span>
          {!isSpectator && (
            <ResolutionButton
              label={BUTTON_COPY['end-battle'].label}
              tone="neutral"
              onClick={onEndBattle}
            />
          )}
        </div>
      </div>
    );
  }

  const title = chooserSeat === attackerSeat ? 'Choose a Lost Soul to rescue' : 'Choose a Lost Soul to surrender';

  const handlePick = (cardId: bigint) => {
    if (pendingSoulId !== null) return;
    setPendingSoulId(cardId);
    onSurrenderSoul(cardId);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 900,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          pointerEvents: 'auto',
          background: 'rgba(14, 10, 6, 0.97)',
          border: '1px solid rgba(107, 78, 39, 0.3)',
          borderRadius: 10,
          padding: '20px 24px',
          textAlign: 'center',
          maxWidth: 420,
          width: '90vw',
          maxHeight: '60vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(196, 149, 90, 0.08)',
        }}
      >
        <h2
          style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 18,
            fontWeight: 700,
            color: '#e8d5a3',
            textShadow: '0 1px 4px rgba(0,0,0,0.5)',
            flexShrink: 0,
          }}
        >
          {title}
        </h2>

        {eligibleSouls.length === 0 ? (
          <>
            <p
              style={{
                marginTop: 16,
                fontFamily: 'Georgia, serif',
                fontSize: 13,
                color: 'rgba(196, 149, 90, 0.75)',
              }}
            >
              No Lost Souls remain to surrender.
            </p>
            <button
              onClick={onEndBattle}
              style={{
                marginTop: 16,
                alignSelf: 'center',
                padding: '10px 16px',
                borderRadius: 4,
                border: '1px solid rgba(107, 78, 39, 0.4)',
                background: 'rgba(107, 78, 39, 0.15)',
                color: 'rgba(196, 149, 90, 0.9)',
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              ↩ End Battle
            </button>
          </>
        ) : (
          <>
            <div
              style={{
                marginTop: 16,
                overflowY: 'auto',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))',
                gap: 10,
              }}
            >
              {eligibleSouls.map((soul) => {
                const imageUrl = resolveCardImageUrl(soul.cardImgFile, forgeResolver);
                // Attachment link lives on the ACCESSORY row (the Site), not
                // the soul — the caller pre-derives membership; see
                // siteAttachedSoulIds in battleMath.
                const isSiteAttached = siteAttachedSoulIds.has(String(soul.id));
                const disabled = pendingSoulId !== null;
                return (
                  <button
                    key={String(soul.id)}
                    onClick={() => handlePick(soul.id)}
                    disabled={disabled}
                    style={{
                      position: 'relative',
                      padding: 0,
                      border: pendingSoulId === soul.id ? '2px solid rgba(196, 149, 90, 0.8)' : '1px solid rgba(107, 78, 39, 0.4)',
                      borderRadius: 4,
                      background: 'transparent',
                      cursor: disabled ? 'default' : 'pointer',
                      opacity: disabled && pendingSoulId !== soul.id ? 0.4 : 1,
                      overflow: 'hidden',
                      lineHeight: 0,
                    }}
                  >
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={soul.cardName}
                        draggable={false}
                        style={{ width: '100%', display: 'block' }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          aspectRatio: '1/1.4',
                          background: '#1e1610',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'rgba(196, 149, 90, 0.6)',
                          fontSize: 9,
                          padding: 4,
                          textAlign: 'center',
                        }}
                      >
                        {soul.cardName}
                      </div>
                    )}
                    {isSiteAttached && (
                      <span
                        style={{
                          position: 'absolute',
                          bottom: 2,
                          left: 2,
                          right: 2,
                          padding: '1px 3px',
                          background: 'rgba(6, 4, 2, 0.85)',
                          border: '1px solid rgba(196, 149, 90, 0.5)',
                          borderRadius: 3,
                          color: '#e8d5a3',
                          fontSize: 8,
                          fontWeight: 700,
                          letterSpacing: '0.03em',
                        }}
                      >
                        ⚑ in Site
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function BattleResolutionUI({
  band,
  scale,
  offsetX,
  offsetY,
  battleState,
  mySeat,
  opponentSeat,
  attackerSeat,
  isSpectator,
  format,
  myPlayerName,
  opponentPlayerName,
  eligibleSouls,
  siteAttachedSoulIds,
  forgeResolver,
  onResolveBattle,
  onEndBattle,
  onSurrenderSoul,
}: BattleResolutionUIProps) {
  // Guards against a double-fire from a fast repeat click while the pick is
  // in flight (self-review requirement, Task 14). Resets whenever the
  // eligible-souls set changes shape (e.g. the defender reloads decks away
  // the last surrenderable soul mid-pick) or the battle state moves on — a
  // fresh awaiting-soul reopening after reconnect.
  const [pendingSoulId, setPendingSoulId] = useState<bigint | null>(null);
  useEffect(() => {
    setPendingSoulId(null);
  }, [eligibleSouls, battleState]);

  // Dual-corner virtualToScreen (width only, height is CSS content-driven) —
  // same idiom as the brigade toast. Anchored just BELOW the band's bottom
  // LEFT edge (product direction, PR #197 — previously the right edge,
  // which overlapped the sidebar's Territory pile at narrower viewports).
  // battleState 'active' and 'awaiting-soul' are mutually exclusive, so the
  // resolution-button row and the awaiting-soul pill safely share this
  // anchor.
  const rowVirtualWidth = 300;
  const topLeft = virtualToScreen(band.x + 8, band.y + band.height + 6, scale, offsetX, offsetY);
  const right = virtualToScreen(band.x + 8 + rowVirtualWidth, band.y + band.height + 6, scale, offsetX, offsetY);

  if (battleState === 'awaiting-soul') {
    return (
      <AwaitingSoulUI
        topLeft={topLeft}
        right={right}
        mySeat={mySeat}
        opponentSeat={opponentSeat}
        attackerSeat={attackerSeat}
        isSpectator={isSpectator}
        format={format}
        myPlayerName={myPlayerName}
        opponentPlayerName={opponentPlayerName}
        eligibleSouls={eligibleSouls}
        siteAttachedSoulIds={siteAttachedSoulIds}
        forgeResolver={forgeResolver}
        pendingSoulId={pendingSoulId}
        setPendingSoulId={setPendingSoulId}
        onSurrenderSoul={onSurrenderSoul}
        onEndBattle={onEndBattle}
      />
    );
  }

  if (battleState !== 'active' || isSpectator) return null;

  const isAttacker = mySeat !== '' && mySeat === attackerSeat;
  const isDefender = mySeat !== '' && attackerSeat !== '' && mySeat !== attackerSeat;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 600 }}>
      <div
        style={{
          position: 'absolute',
          left: topLeft.x,
          top: topLeft.y,
          width: right.x - topLeft.x,
          display: 'flex',
          justifyContent: 'flex-start',
          gap: 8,
          pointerEvents: 'auto',
        }}
      >
        {isAttacker && (
          <ResolutionButton label={BUTTON_COPY['claim-victory'].label} tone="gold" onClick={onResolveBattle} />
        )}
        {isDefender && (
          <ResolutionButton label={BUTTON_COPY['battle-lost'].label} tone="red" onClick={onResolveBattle} />
        )}
        <ResolutionButton label={BUTTON_COPY['end-battle'].label} tone="neutral" onClick={onEndBattle} />
      </div>
    </div>
  );
}
