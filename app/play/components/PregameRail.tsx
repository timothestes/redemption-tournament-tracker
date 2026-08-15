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
// The panel floats in the middle of the board (virtualToScreen, same idiom as
// BattleResolutionUI) rather than pinned to a viewport corner: its bottom edge
// rests just above the seam between the two halves. Everything the pre-game
// asks the player to click lives on their own half — star cards in the hand,
// Lost Souls in the Land of Bondage directly above it — so the panel stays out
// of that half entirely and settles into the empty opponent territory. See the
// mount site in MultiplayerCanvas for why the seam is one rect in both formats.

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

/** Gap in virtual px between the panel's bottom edge and the board's seam. */
const SEAM_CLEARANCE = 14;

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
  padding: '14px 20px',
  // Narrow enough that a sentence breaks into short, scannable lines.
  width: 'max-content',
  maxWidth: 'min(420px, 34vw)',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

// Prose. Cinzel has no true lowercase — every glyph is a capital — so it turns
// instructions into a wall of caps that has to be read letter by letter. Georgia
// carries the sentences; Cinzel stays on headings, names and buttons, the same
// split BattleResolutionUI uses. `balance` evens the line lengths so a sentence
// never strands one or two words on the last line.
const BODY: React.CSSProperties = {
  fontFamily: 'Georgia, serif',
  fontSize: 14,
  lineHeight: 1.5,
  color: 'rgba(232, 213, 163, 0.92)',
  textWrap: 'balance',
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
  handStars: Array<{ instanceId: bigint; cardName: string; imitatingName?: string }>;
  /** Submitted stars for the active seat, ascending by slot. */
  queue: Array<{ starId: bigint; cardInstanceId: bigint; resolved: boolean; cardName: string; imitatingName?: string }>;
  /** Lost Souls I control that carry ability text. */
  activatableSouls: Array<{ instanceId: bigint; cardName: string }>;
  /** True when I have submitted my star selection this window. */
  hasSubmitted: boolean;
  autoRouteLostSouls: boolean;
  /** Virtual x the panel centres on — the play area's midline. */
  anchorX: number;
  /** Virtual y the panel's BOTTOM edge rests above — the board's seam. */
  anchorBottomY: number;
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
  hasSubmitted, autoRouteLostSouls, anchorX, anchorBottomY, scale, offsetX, offsetY, selection,
  onSubmitStars, onResolveStar, onFinishSouls, onExecuteAbility, onHighlightCard,
}: PregameRailProps) {
  // The panel is translated back by half its width and all of its height, so it
  // stays centred on the midline with its bottom on the seam whatever the
  // content's size — the star step's height changes as the queue advances.
  const anchor = virtualToScreen(
    anchorX, anchorBottomY - SEAM_CLEARANCE, scale, offsetX, offsetY,
  );

  // The whole wrapper is click-through; only chips and buttons opt back in.
  // Konva hit-tests on its own canvas, so this never blocks board interaction.
  const wrapper = (children: React.ReactNode) => (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: RAIL_Z }}>
      <div style={{ position: 'absolute', left: anchor.x, top: anchor.y,
                    transform: 'translate(-50%, -100%)', ...PANEL }}>
        {children}
      </div>
    </div>
  );

  // `star` marks the headings that are about (Star) abilities — the same
  // hexagram the eligible cards wear in hand. The Lost Souls step never gets
  // it; that step isn't about stars.
  const heading = (text: string, star = false) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
                  color: 'rgba(232, 213, 163, 0.65)' }}>
      {star && <StarOfDavidIcon size={13} />}
      {text}
    </div>
  );

  if (!isMyWindow) {
    return wrapper(
      <>
        {heading('Pre-Game Phase')}
        <div style={BODY}>
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
          <div style={BODY}>
            {autoRouteLostSouls
              ? 'No Lost Souls with abilities to activate.'
              : 'Auto-routing is off — any Lost Souls you drew are still in your hand.'}
          </div>
        ) : (
          <>
            <div style={BODY}>
              Right-click a Lost Soul you control to activate its ability, then
              finish.
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
          <div style={BODY}>No star cards in hand.</div>
        ) : (
          // The picked cards carry a numbered gold badge in the hand itself, so
          // the panel no longer repeats them as name chips.
          <div style={BODY}>
            Click the star cards in your hand. They resolve in the order you
            pick them.
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
  if (!current) return wrapper(<>{heading('Pre-Game Phase · Stars', true)}<div style={BODY}>Resolving…</div></>);

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
      {/* The name only. The card's own text is a paragraph of small caps that
          dwarfed the panel, and the player is holding the card — they can read
          it there, or hover it. */}
      <div style={{ fontSize: 16, color: '#e8d5a3', lineHeight: 1.3 }}>
        {current.cardName}
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
