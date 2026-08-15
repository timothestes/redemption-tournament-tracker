'use client';

// REG Pre-Game Phase rail (steps 2 and 3): star reveals, then Lost Soul
// activation. A DOM overlay above the Konva canvas that MUST NOT block board
// interaction — star abilities manipulate decks, hands and zones, so drag,
// right-click, the toolbar, deck-search and every modal stay fully usable while
// the rail is on screen. The wrapper is pointer-events: none and only chips and
// buttons opt back in; Konva hit-tests on its own canvas element, so a
// click-through DOM overlay never intercepts board clicks. Same technique as
// BattleResolutionUI.tsx.
//
// The panel is centred in the player's own territory (virtualToScreen, same
// idiom as BattleResolutionUI) rather than pinned to a viewport corner. That
// zone is the only large area free in BOTH pre-game steps: the star step is
// driven by clicking cards in the hand, and the souls step by right-clicking
// souls in the Land of Bondage — the row directly above the hand — so anchoring
// to either would cover the very cards the step asks the player to click. Both
// territories are empty during the pre-game, in Standard and Paragon alike.

import {
  getEffectiveAbilities,
  abilityLabel,
  DEFAULT_ABILITY_SOURCE_ZONES,
} from '@/lib/cards/cardAbilities';
import { virtualToScreen } from '@/app/shared/layout/virtualCanvas';
import StarOfDavidIcon from './StarOfDavidIcon';
import type { ZoneRect } from '../layout/multiplayerLayout';

// Sits below ZoneBrowseModal's overlay (z 500) so a deck/reserve browse opened
// from a star ability is never covered, and above the canvas. BattleResolutionUI
// uses 600, which would float over that modal — deliberately not copied.
const RAIL_Z = 450;

const PANEL: React.CSSProperties = {
  // The panel body itself stays click-through — only its chips and buttons opt
  // back in.
  pointerEvents: 'none',
  textAlign: 'center',
  alignItems: 'center',
  background: 'rgba(10, 8, 5, 0.94)',
  border: '1px solid rgba(196, 149, 90, 0.45)',
  borderRadius: 6,
  boxShadow: '0 6px 20px rgba(0, 0, 0, 0.6)',
  color: '#e8d5a3',
  fontFamily: 'var(--font-cinzel), Georgia, serif',
  padding: '10px 12px',
  maxWidth: 'min(560px, 46vw)',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const CHIP = (selected: boolean): React.CSSProperties => ({
  pointerEvents: 'auto',
  cursor: 'pointer',
  padding: '3px 8px',
  borderRadius: 12,
  fontSize: 11,
  whiteSpace: 'nowrap',
  border: `1px solid ${selected ? '#c4955a' : 'rgba(196, 149, 90, 0.35)'}`,
  background: selected ? 'rgba(196, 149, 90, 0.22)' : 'transparent',
  color: selected ? '#e8d5a3' : 'rgba(232, 213, 163, 0.6)',
});

const ACTION: React.CSSProperties = {
  pointerEvents: 'auto',
  cursor: 'pointer',
  padding: '5px 12px',
  borderRadius: 4,
  fontSize: 11,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  border: '1px solid #c4955a',
  background: 'rgba(196, 149, 90, 0.18)',
  color: '#e8d5a3',
};

interface PregameRailProps {
  step: 'stars' | 'souls';
  isMyWindow: boolean;
  opponentName: string;
  /** Star cards in my hand — the rail only needs to know whether I have any. */
  handStars: Array<{ instanceId: bigint; cardName: string; specialAbility: string; imitatingName?: string }>;
  /** Submitted stars for the active seat, ascending by slot. */
  queue: Array<{ starId: bigint; cardInstanceId: bigint; resolved: boolean; cardName: string; specialAbility: string; imitatingName?: string }>;
  /** Lost Souls I control that carry ability text. */
  activatableSouls: Array<{ instanceId: bigint; cardName: string }>;
  /** True when I have submitted my star selection this window. */
  hasSubmitted: boolean;
  autoRouteLostSouls: boolean;
  /** My territory zone (virtual coords) — the panel centres in it. */
  territoryRect: ZoneRect;
  scale: number;
  offsetX: number;
  offsetY: number;
  /** Star cards I've clicked in hand, in pick order. Owned by MultiplayerCanvas
   *  so the hand's order badges and this panel's submit button agree. */
  selection: bigint[];
  onSubmitStars: (ids: bigint[]) => void;
  onResolveStar: (starId: bigint) => void;
  onFinishSouls: () => void;
  onExecuteAbility: (instanceId: bigint, abilityIndex: number) => void;
  onHighlightCard: (instanceId: bigint) => void;
}

export default function PregameRail({
  step, isMyWindow, opponentName, handStars, queue, activatableSouls,
  hasSubmitted, autoRouteLostSouls, territoryRect, scale, offsetX, offsetY, selection,
  onSubmitStars, onResolveStar, onFinishSouls, onExecuteAbility, onHighlightCard,
}: PregameRailProps) {
  // Anchor point = the centre of my territory. The panel is translated back by
  // half its own size so it stays centred whatever the content's height.
  const anchor = virtualToScreen(
    territoryRect.x + territoryRect.width / 2,
    territoryRect.y + territoryRect.height / 2,
    scale, offsetX, offsetY,
  );

  // The whole wrapper is click-through; only chips and buttons opt back in.
  // Konva hit-tests on its own canvas, so this never blocks board interaction.
  const wrapper = (children: React.ReactNode) => (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: RAIL_Z }}>
      <div style={{ position: 'absolute', left: anchor.x, top: anchor.y,
                    transform: 'translate(-50%, -50%)', ...PANEL }}>
        {children}
      </div>
    </div>
  );

  // `star` marks the headings that are about (Star) abilities — the same
  // hexagram the eligible cards wear in hand. The Lost Souls step never gets
  // it; that step isn't about stars.
  const heading = (text: string, star = false) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5,
                  fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
                  color: 'rgba(232, 213, 163, 0.55)' }}>
      {star && <StarOfDavidIcon size={12} />}
      {text}
    </div>
  );

  if (!isMyWindow) {
    return wrapper(
      <>
        {heading('Pre-Game Phase')}
        <div style={{ fontSize: 12 }}>
          {step === 'stars'
            ? `Waiting for ${opponentName} to reveal stars…`
            : `Waiting for ${opponentName} to activate Lost Souls…`}
        </div>
        {queue.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {queue.map((s) => (
              <span key={s.starId.toString()} style={CHIP(!s.resolved)}>
                {s.resolved ? '✓ ' : ''}{s.cardName}
              </span>
            ))}
          </div>
        )}
      </>,
    );
  }

  if (step === 'souls') {
    return wrapper(
      <>
        {heading('Pre-Game Phase · Lost Souls')}
        {activatableSouls.length === 0 ? (
          <div style={{ fontSize: 12 }}>
            {autoRouteLostSouls
              ? 'No Lost Souls with abilities to activate.'
              : 'Auto-routing is off — any Lost Souls you drew are still in your hand.'}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12 }}>
              Activate abilities on the Lost Souls you control, then finish.
              Right-click a soul for its abilities.
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {activatableSouls.map((s) => (
                <span key={s.instanceId.toString()} style={CHIP(false)}
                      onClick={() => onHighlightCard(s.instanceId)}>
                  {s.cardName}
                </span>
              ))}
            </div>
          </>
        )}
        <button style={ACTION} onClick={onFinishSouls}>Done</button>
      </>,
    );
  }

  if (!hasSubmitted) {
    return wrapper(
      <>
        {heading('Pre-Game Phase · Stars', true)}
        {handStars.length === 0 ? (
          <div style={{ fontSize: 12 }}>No star cards in hand.</div>
        ) : (
          // The picked cards carry a numbered gold badge in the hand itself, so
          // the panel no longer repeats them as name chips.
          <div style={{ fontSize: 12 }}>
            Click the star cards in your hand to reveal them. They resolve in the
            order you pick them.
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          {selection.length > 0 && (
            <button style={ACTION} onClick={() => onSubmitStars(selection)}>
              Reveal {selection.length} star{selection.length === 1 ? '' : 's'}
            </button>
          )}
          <button style={ACTION} onClick={() => onSubmitStars([])}>No stars</button>
        </div>
      </>,
    );
  }

  const current = queue.find((s) => !s.resolved);
  if (!current) return wrapper(<>{heading('Pre-Game Phase · Stars', true)}<div style={{ fontSize: 12 }}>Resolving…</div></>);

  // Map the UNFILTERED ability list and disable out-of-zone entries. Both the
  // client dispatcher and the server index the full array, so filtering first
  // would dispatch the wrong ability. Mirrors CardContextMenu.
  const abilities = getEffectiveAbilities({
    cardName: current.cardName,
    imitatingName: current.imitatingName,
  });

  return wrapper(
    <>
      {heading('Pre-Game Phase · Stars', true)}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6,
                    fontSize: 13, color: '#e8d5a3' }}>
        <StarOfDavidIcon size={13} />
        {current.cardName}
      </div>
      <div style={{ fontSize: 11, color: 'rgba(232, 213, 163, 0.75)', lineHeight: 1.4 }}>
        {current.specialAbility}
      </div>
      {abilities.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {abilities.map((ability, index) => {
            const allowed = ability.sourceZones ?? DEFAULT_ABILITY_SOURCE_ZONES;
            const disabled = !allowed.includes('hand');
            return (
              <button
                key={index}
                disabled={disabled}
                title={disabled ? 'This ability cannot be used from hand' : undefined}
                style={{ ...ACTION, opacity: disabled ? 0.4 : 1,
                         cursor: disabled ? 'not-allowed' : 'pointer' }}
                onClick={() => !disabled && onExecuteAbility(current.cardInstanceId, index)}
              >
                {abilityLabel(ability)}
              </button>
            );
          })}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button style={ACTION} onClick={() => onResolveStar(current.starId)}>Resolved →</button>
        <span style={{ fontSize: 10, color: 'rgba(232, 213, 163, 0.5)' }}>
          {queue.filter((s) => s.resolved).length + 1} of {queue.length}
        </span>
      </div>
    </>,
  );
}
