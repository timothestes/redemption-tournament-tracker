/**
 * Tap-to-move state machine.
 *
 * On touch, drag is a poor primary mechanic: cards render around 45-60px, a
 * fingertip covers ~44px, and a destination may be off-screen once the camera
 * can pan. So the primary flow is: tap a card to arm it, then tap a
 * destination. Drag remains available for fine free-form placement.
 *
 * Two distinct commit paths, deliberately:
 *   - tapZone            -> drops at the tapped point (position matters for
 *                           equipping and battle placement)
 *   - tapDestinationChip -> drops into an auto-arranged slot, and works even
 *                           when the destination is off-screen. This is what
 *                           makes cross-side movement independent of the camera.
 */

import type { ZoneId } from '@/app/shared/types/gameCard';

export type ZoneOwner = 'my' | 'opponent' | 'shared';

export type TapMoveState =
  | { kind: 'idle' }
  | {
      kind: 'armed';
      cardId: string;
      sourceZone: ZoneId;
      sourceOwner: ZoneOwner;
      /** Which side a board tap may commit into. Zones tile the whole board,
       *  so without this ANY stray tap while armed was a commit — including
       *  into opponent territory, revealing a hand card. Defaults to 'my' on
       *  arm; a tap on the other side's zone re-targets this instead of
       *  committing (the rail's segmented control mirrors and drives it). */
      side: ZoneOwner;
    };

export type TapMoveEvent =
  | { type: 'tapCard'; cardId: string; zone: ZoneId; owner: ZoneOwner }
  | { type: 'tapZone'; zone: ZoneId; owner: ZoneOwner; point: { x: number; y: number } }
  | { type: 'tapDestinationChip'; zone: ZoneId; owner: ZoneOwner }
  | { type: 'setSide'; side: ZoneOwner }
  | { type: 'tapEmpty' }
  | { type: 'cancel' };

export interface CommitMove {
  cardId: string;
  toZone: ZoneId;
  toOwner: ZoneOwner;
  /** Virtual-space drop point, or null to let auto-arrange place the card. */
  atPoint: { x: number; y: number } | null;
}

export interface TapMoveResult {
  state: TapMoveState;
  commit: CommitMove | null;
}

const IDLE: TapMoveState = { kind: 'idle' };

export function tapMoveReducer(state: TapMoveState, event: TapMoveEvent): TapMoveResult {
  switch (event.type) {
    case 'cancel':
    case 'tapEmpty':
      return { state: IDLE, commit: null };

    case 'tapCard': {
      // Tapping the armed card again is a disarm - the natural undo gesture.
      if (state.kind === 'armed' && state.cardId === event.cardId) {
        return { state: IDLE, commit: null };
      }
      return {
        state: {
          kind: 'armed',
          cardId: event.cardId,
          sourceZone: event.zone,
          sourceOwner: event.owner,
          side: 'my',
        },
        commit: null,
      };
    }

    case 'setSide': {
      if (state.kind !== 'armed') return { state, commit: null };
      return { state: { ...state, side: event.side }, commit: null };
    }

    case 'tapZone': {
      if (state.kind !== 'armed') return { state, commit: null };
      // Dropping a card back where it came from is a no-op, not a move.
      if (state.sourceZone === event.zone && state.sourceOwner === event.owner) {
        return { state: IDLE, commit: null };
      }
      // A tap on the OTHER side's zone re-targets the rail instead of
      // committing — stays armed, moves nothing; a second tap in that zone
      // commits normally. Shared zones (Paragon LoB / soul deck) always
      // commit: a shared zone can't be "the wrong side". The battle band is
      // effectively shared space too (findZoneAtPosition reports it as 'my'),
      // so it bypasses the gate — "arm, tap band" must stay a one-tap attack
      // regardless of which side the rail is pointed at.
      if (event.zone !== 'battle' && event.owner !== 'shared' && event.owner !== state.side) {
        return { state: { ...state, side: event.owner }, commit: null };
      }
      return {
        state: IDLE,
        commit: {
          cardId: state.cardId,
          toZone: event.zone,
          toOwner: event.owner,
          atPoint: event.point,
        },
      };
    }

    case 'tapDestinationChip': {
      if (state.kind !== 'armed') return { state, commit: null };
      return {
        state: IDLE,
        commit: {
          cardId: state.cardId,
          toZone: event.zone,
          toOwner: event.owner,
          atPoint: null,
        },
      };
    }

    default:
      return { state, commit: null };
  }
}

/** Zones a player can send a card to on their own side. */
const MY_DESTINATIONS: ZoneId[] = [
  'territory', 'hand', 'reserve', 'discard', 'deck',
  'land-of-redemption', 'banish', 'land-of-bondage',
];

/** Zones a player can send a card to on the opponent's side. Sandbox rules
 *  already permit all of these - see findZoneAtPosition in MultiplayerCanvas,
 *  whose opponent sidebar loop also accepts deck and reserve. */
const OPPONENT_DESTINATIONS: ZoneId[] = [
  'territory', 'land-of-bondage', 'land-of-redemption', 'discard', 'banish',
  'hand', 'deck', 'reserve',
];

/** Paragon-only shared zones. */
const SHARED_DESTINATIONS: ZoneId[] = ['land-of-bondage', 'soul-deck'];

/**
 * Zones pulled to the front of the rail for a Lost Soul.
 *
 * The rail is one horizontally scrolling row that fits about five chips, and a
 * Lost Soul only ever goes two places in real play — into a Land of Bondage,
 * or out of one into a Land of Redemption on a rescue. Both sat at positions 6
 * and 8 of the default order, off the right edge.
 *
 * Which of the two leads depends on where the soul is now: a soul sitting in a
 * Land of Bondage is nearly always about to be rescued, and anywhere else it
 * is nearly always on its way into bondage.
 */
function lostSoulPriority(sourceZone: ZoneId): ZoneId[] {
  return sourceZone === 'land-of-bondage'
    ? ['land-of-redemption', 'land-of-bondage']
    : ['land-of-bondage', 'land-of-redemption'];
}

/** Stable partial sort: `priority` zones first, in the order given; everything
 *  else keeps its original relative order. */
function prioritize(
  dests: Array<{ zone: ZoneId; owner: ZoneOwner }>,
  priority: ZoneId[],
): Array<{ zone: ZoneId; owner: ZoneOwner }> {
  const rank = (z: ZoneId) => {
    const i = priority.indexOf(z);
    return i === -1 ? priority.length : i;
  };
  return dests
    .map((d, i) => ({ d, i }))
    .sort((a, b) => rank(a.d.zone) - rank(b.d.zone) || a.i - b.i)
    .map(({ d }) => d);
}

export interface DestinationOptions {
  /** The armed card is a Lost Soul — reorder the rail around bondage/rescue. */
  isLostSoul?: boolean;
}

/**
 * Destinations offered in the rail. 'battle' is deliberately excluded - the
 * Field of Battle is phase-driven and only reachable while a battle is open,
 * so it stays on the existing drop path rather than the rail.
 */
export function legalDestinations(
  sourceZone: ZoneId,
  sourceOwner: ZoneOwner,
  format: 'T1' | 'T2' | 'Paragon',
  opts: DestinationOptions = {},
): Array<{ zone: ZoneId; owner: ZoneOwner }> {
  const out: Array<{ zone: ZoneId; owner: ZoneOwner }> = [];

  // Paragon collapses each seat's Land of Bondage to a zero-height placeholder
  // and renders a single shared LoB instead. Offering the per-seat zone would
  // send the card somewhere that does not render - recoverable only by Undo.
  const perSeatLobHidden = format === 'Paragon';
  const keep = (zone: ZoneId) => !(perSeatLobHidden && zone === 'land-of-bondage');

  for (const zone of MY_DESTINATIONS) if (keep(zone)) out.push({ zone, owner: 'my' });
  for (const zone of OPPONENT_DESTINATIONS) if (keep(zone)) out.push({ zone, owner: 'opponent' });
  if (format === 'Paragon') {
    for (const zone of SHARED_DESTINATIONS) out.push({ zone, owner: 'shared' });
  }

  const legal = out.filter((d) => !(d.zone === sourceZone && d.owner === sourceOwner));
  return opts.isLostSoul ? prioritize(legal, lostSoulPriority(sourceZone)) : legal;
}
