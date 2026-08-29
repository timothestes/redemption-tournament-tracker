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
  | { kind: 'armed'; cardId: string; sourceZone: ZoneId; sourceOwner: ZoneOwner };

export type TapMoveEvent =
  | { type: 'tapCard'; cardId: string; zone: ZoneId; owner: ZoneOwner }
  | { type: 'tapZone'; zone: ZoneId; owner: ZoneOwner; point: { x: number; y: number } }
  | { type: 'tapDestinationChip'; zone: ZoneId; owner: ZoneOwner }
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
        },
        commit: null,
      };
    }

    case 'tapZone': {
      if (state.kind !== 'armed') return { state, commit: null };
      // Dropping a card back where it came from is a no-op, not a move.
      if (state.sourceZone === event.zone && state.sourceOwner === event.owner) {
        return { state: IDLE, commit: null };
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
 *  already permit all of these - see findZoneAtPosition in MultiplayerCanvas. */
const OPPONENT_DESTINATIONS: ZoneId[] = [
  'territory', 'land-of-bondage', 'land-of-redemption', 'discard', 'banish', 'hand',
];

/** Paragon-only shared zones. */
const SHARED_DESTINATIONS: ZoneId[] = ['land-of-bondage', 'soul-deck'];

/**
 * Destinations offered in the rail. 'battle' is deliberately excluded - the
 * Field of Battle is phase-driven and only reachable while a battle is open,
 * so it stays on the existing drop path rather than the rail.
 */
export function legalDestinations(
  sourceZone: ZoneId,
  sourceOwner: ZoneOwner,
  format: 'T1' | 'T2' | 'Paragon',
): Array<{ zone: ZoneId; owner: ZoneOwner }> {
  const out: Array<{ zone: ZoneId; owner: ZoneOwner }> = [];

  for (const zone of MY_DESTINATIONS) out.push({ zone, owner: 'my' });
  for (const zone of OPPONENT_DESTINATIONS) out.push({ zone, owner: 'opponent' });
  if (format === 'Paragon') {
    for (const zone of SHARED_DESTINATIONS) out.push({ zone, owner: 'shared' });
  }

  return out.filter((d) => !(d.zone === sourceZone && d.owner === sourceOwner));
}
