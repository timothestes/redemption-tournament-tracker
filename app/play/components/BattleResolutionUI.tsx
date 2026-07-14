'use client';

// Battle Zone resolution buttons + confirm summary (design spec §8, Task 13),
// plus the awaiting-soul chooser dialog / waiting pill (Task 14). HTML
// overlay, positioned band-relative via the dual-corner virtualToScreen
// pattern the brigade-mismatch toast established (MultiplayerCanvas.tsx
// ~7517-7576) — the row is anchored just BELOW the band's bottom-right
// corner (not inside it) specifically so it never collides with that toast,
// which occupies the band's own bottom-right corner. Mounted from
// MultiplayerCanvas (not client.tsx) because it needs band geometry +
// scale/offsets, which only exist there.
//
// battleState === 'active' and 'awaiting-soul' are mutually exclusive, so
// the resolution-button row and the awaiting-soul pill/modal safely reuse
// the same anchor geometry below.

import { useEffect, useState } from 'react';
import { virtualToScreen } from '@/app/shared/layout/virtualCanvas';
import { summarizeAutoReturn, type BattleCardLike } from '../lib/battleMath';
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
   *  (spec §7 / server surrender_soul: T1 defender picks, T2 & Paragon attacker picks)
   *  and whether a "Done" affordance stays up after a pick (T2 only). */
  format: DeckFormat;
  /** Display names for the pill/modal copy — real player names, not "You"/"Opponent",
   *  so the text reads correctly for spectators too. */
  myPlayerName: string;
  opponentPlayerName: string;
  /** Every card currently in the battle band (both owners) — feeds the confirm summary. */
  cards: BattleCardLike[];
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
  /** Both Claim Victory and Battle Lost dispatch the same server reducer (resolve_battle) —
   *  the server decides win/loss from caller identity, not from which button was pressed. */
  onResolveBattle: () => void;
  onEndBattle: () => void;
  onSurrenderSoul: (cardInstanceId: bigint) => void;
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
  onRequestEndBattle,
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
  onEndBattle: () => void;
  /** Opens the shared confirm-summary dialog for End Battle (spec §7 escape
   *  hatch) — used by the non-chooser player's pill-side button below.
   *  Distinct from `onEndBattle` (a bare dispatch, used only by the
   *  chooser's own "no souls left" button above) so this path always goes
   *  through the confirm dialog first. */
  onRequestEndBattle: () => void;
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
            justifyContent: 'flex-end',
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
              onClick={onRequestEndBattle}
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

            {format === 'T2' && (
              <button
                onClick={onEndBattle}
                style={{
                  marginTop: 16,
                  alignSelf: 'center',
                  padding: '8px 20px',
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
                Done
              </button>
            )}
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
  cards,
  eligibleSouls,
  siteAttachedSoulIds,
  forgeResolver,
  onResolveBattle,
  onEndBattle,
  onSurrenderSoul,
}: BattleResolutionUIProps) {
  const [confirmAction, setConfirmAction] = useState<ResolutionAction | null>(null);
  // Guards against a double-fire from a fast repeat click while the pick is
  // in flight (self-review requirement, Task 14). Resets whenever the
  // eligible-souls set changes shape (a successful surrender drops the
  // picked card from it) or the battle state moves on — covers both the T2
  // "pick another" loop and a fresh awaiting-soul reopening after reconnect.
  const [pendingSoulId, setPendingSoulId] = useState<bigint | null>(null);
  useEffect(() => {
    setPendingSoulId(null);
  }, [eligibleSouls, battleState]);

  // Dual-corner virtualToScreen (width only, height is CSS content-driven) —
  // same idiom as the brigade toast. Anchored just BELOW the band's bottom
  // edge (not inside it) so it never collides with that toast's corner,
  // which lives inside the band's own bottom-right. battleState 'active' and
  // 'awaiting-soul' are mutually exclusive, so the resolution-button row and
  // the awaiting-soul pill safely share this anchor.
  const rowVirtualWidth = 300;
  const topLeft = virtualToScreen(band.x + band.width - rowVirtualWidth - 8, band.y + band.height + 6, scale, offsetX, offsetY);
  const right = virtualToScreen(band.x + band.width - 8, band.y + band.height + 6, scale, offsetX, offsetY);

  // Shared End Battle confirm dispatch + dialog — used by BOTH the
  // active-state button row and the awaiting-soul non-chooser escape hatch
  // (spec §7), so every End Battle click funnels through the same
  // confirm-summary dialog rather than a bare dispatch.
  const dispatch = (action: ResolutionAction) => {
    setConfirmAction(null);
    if (action === 'end-battle') onEndBattle();
    else onResolveBattle();
  };

  const confirmDialog = confirmAction && (
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
  );

  if (battleState === 'awaiting-soul') {
    return (
      <>
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
          onRequestEndBattle={() => setConfirmAction('end-battle')}
        />
        {confirmDialog}
      </>
    );
  }

  if (battleState !== 'active' || isSpectator) return null;

  const isAttacker = mySeat !== '' && mySeat === attackerSeat;
  const isDefender = mySeat !== '' && attackerSeat !== '' && mySeat !== attackerSeat;

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

      {confirmDialog}
    </>
  );
}
