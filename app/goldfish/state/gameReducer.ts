import {
  GameState,
  GameAction,
  GameCard,
  ZoneId,
  PHASE_ORDER,
} from '../types';
import { buildInitialGameState } from './gameInitializer';
import { refillSoulDeck } from '@/app/shared/paragon/refill';

const MAX_HISTORY = 20;
const HAND_LIMIT = 16;

function isLostSoul(card: GameCard): boolean {
  return card.type === 'LS' || card.type === 'Lost Soul' || card.type.toLowerCase().includes('lost soul');
}

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function cloneZones(zones: GameState['zones']): GameState['zones'] {
  const cloned = {} as GameState['zones'];
  for (const key of Object.keys(zones) as ZoneId[]) {
    cloned[key] = zones[key].map(c => ({ ...c }));
  }
  return cloned;
}

function pushHistory(state: GameState): GameState[] {
  // Store a snapshot (without history to avoid nesting)
  const snapshot: GameState = {
    ...state,
    zones: cloneZones(state.zones),
    history: [],
  };
  const history = [...state.history, snapshot];
  if (history.length > MAX_HISTORY) {
    history.shift();
  }
  return history;
}

function findAndRemoveCard(
  zones: GameState['zones'],
  instanceId: string
): { card: GameCard; fromZone: ZoneId } | null {
  for (const zoneId of Object.keys(zones) as ZoneId[]) {
    const idx = zones[zoneId].findIndex(c => c.instanceId === instanceId);
    if (idx !== -1) {
      const [card] = zones[zoneId].splice(idx, 1);
      return { card, fromZone: zoneId };
    }
  }
  return null;
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  // Handle special meta-actions
  if (action.payload.value === '__UNDO__') {
    return undoAction(state);
  }
  if (action.payload.value === '__TOGGLE_SPREAD__') {
    return { ...state, isSpreadHand: !state.isSpreadHand };
  }
  if (action.type === 'RESET_GAME' && action.payload.value) {
    try {
      return JSON.parse(action.payload.value as string);
    } catch {
      return state;
    }
  }

  const history = pushHistory(state);
  const zones = cloneZones(state.zones);

  switch (action.type) {
    case 'MOVE_CARD': {
      const { cardInstanceId, toZone, toIndex, posX, posY } = action.payload;
      if (!cardInstanceId || !toZone) return state;

      const result = findAndRemoveCard(zones, cardInstanceId);
      if (!result) return state;

      // Tokens dropped into reserve/banish/discard/hand/deck are removed entirely
      const TOKEN_REMOVE_ZONES: ZoneId[] = ['reserve', 'banish', 'discard', 'hand', 'deck'];
      if (result.card.isToken && TOKEN_REMOVE_ZONES.includes(toZone)) {
        return { ...state, zones, history };
      }

      // Flip face-up only when the card is actually leaving the deck
      if (result.fromZone === 'deck' && toZone !== 'deck') {
        result.card.isFlipped = false;
      }
      result.card.zone = toZone;
      // Paragon: rescuing a Soul-Deck-origin card transfers ownership from
      // the shared sentinel to the rescuing player. Marker stays set.
      const movedFromSharedLob =
        result.fromZone === 'land-of-bondage' &&
        result.card.ownerId === 'shared' &&
        result.card.isSoulDeckOrigin === true;
      if (movedFromSharedLob) {
        result.card.ownerId = 'player1'; // goldfish: only player1 is the seat
      }
      // Store free-form position for territory only (LOB is auto-arranged)
      const FREE_FORM_ZONES: ZoneId[] = ['territory'];
      if (FREE_FORM_ZONES.includes(toZone) && posX !== undefined && posY !== undefined) {
        result.card.posX = posX;
        result.card.posY = posY;
      } else {
        result.card.posX = undefined;
        result.card.posY = undefined;
      }
      // Auto-detach on exit from territory. Clear this mover's equippedTo
      // (if any). For cards that pointed at this mover: normally just unlink,
      // but if the destination is Land of Bondage, auto-discard them (a warrior
      // going to LOB takes its weapons down with it).
      if (toZone !== 'territory') {
        if (result.card.equippedTo) {
          result.card.equippedTo = undefined;
        }
        for (const zoneId of Object.keys(zones) as ZoneId[]) {
          for (let i = 0; i < zones[zoneId].length; i++) {
            const other = zones[zoneId][i];
            if (other.equippedTo !== cardInstanceId) continue;
            if (toZone === 'land-of-bondage') {
              zones[zoneId].splice(i, 1);
              i--;
              zones.discard.push({
                ...other,
                zone: 'discard',
                equippedTo: undefined,
                posX: undefined,
                posY: undefined,
              });
            } else {
              zones[zoneId][i] = { ...other, equippedTo: undefined };
            }
          }
        }
      }
      if (toIndex !== undefined && toIndex >= 0) {
        zones[toZone].splice(toIndex, 0, result.card);
      } else {
        zones[toZone].push(result.card);
      }

      let finalZones = zones;
      const needsRefill =
        state.format === 'Paragon' &&
        result.fromZone === 'land-of-bondage' &&
        result.card.isSoulDeckOrigin === true &&
        toZone !== 'land-of-bondage';
      if (needsRefill) {
        finalZones = refillSoulDeck(zones);
      }
      return { ...state, zones: finalZones, history };
    }

    case 'DRAW_CARD': {
      if (zones.deck.length === 0) return state;
      if (zones.hand.length >= HAND_LIMIT && !state.options.autoRouteLostSouls) return state;

      const card = zones.deck.shift()!;

      if (state.options.autoRouteLostSouls && isLostSoul(card)) {
        card.zone = 'land-of-bondage';
        card.isFlipped = false;
        zones['land-of-bondage'].push(card);
        // Draw a replacement if deck has cards
        if (zones.deck.length > 0) {
          // Recursively handle — but we need to be careful about Lost Soul chains
          // For safety, do an iterative approach
          let replacement = zones.deck.shift();
          while (replacement && isLostSoul(replacement) && state.options.autoRouteLostSouls) {
            replacement.zone = 'land-of-bondage';
            replacement.isFlipped = false;
            zones['land-of-bondage'].push(replacement);
            replacement = zones.deck.length > 0 ? zones.deck.shift() : undefined;
          }
          if (replacement) {
            if (zones.hand.length >= HAND_LIMIT) {
              // Put it back
              zones.deck.unshift(replacement);
            } else {
              replacement.zone = 'hand';
              replacement.isFlipped = false;
              zones.hand.push(replacement);
            }
          }
        }
      } else if (zones.hand.length >= HAND_LIMIT) {
        // Hand full, put card back
        zones.deck.unshift(card);
        return state;
      } else {
        card.zone = 'hand';
        card.isFlipped = false;
        zones.hand.push(card);
      }

      return { ...state, zones, history };
    }

    case 'DRAW_MULTIPLE': {
      const count = action.payload.quantity || 3;
      let newState = { ...state, zones, history };
      for (let i = 0; i < count; i++) {
        if (newState.zones.deck.length === 0) break;
        if (newState.zones.hand.length >= HAND_LIMIT) break;
        newState = gameReducer(
          { ...newState, history: [] }, // avoid nested history
          { ...action, type: 'DRAW_CARD', payload: {} }
        );
        newState.history = history; // preserve the original history entry
      }
      return newState;
    }

    case 'SHUFFLE_DECK': {
      zones.deck = shuffleArray(zones.deck);
      return { ...state, zones, history };
    }

    case 'SHUFFLE_AND_MOVE_TO_TOP': {
      const { cardInstanceId } = action.payload;
      if (!cardInstanceId) return state;
      const result = findAndRemoveCard(zones, cardInstanceId);
      if (!result) return state;
      if (result.card.isToken) return { ...state, zones, history };
      zones.deck = shuffleArray(zones.deck);
      result.card.zone = 'deck';
      zones.deck.unshift(result.card);
      return { ...state, zones, history };
    }

    case 'SHUFFLE_AND_MOVE_TO_BOTTOM': {
      const { cardInstanceId } = action.payload;
      if (!cardInstanceId) return state;
      const result = findAndRemoveCard(zones, cardInstanceId);
      if (!result) return state;
      if (result.card.isToken) return { ...state, zones, history };
      zones.deck = shuffleArray(zones.deck);
      result.card.zone = 'deck';
      zones.deck.push(result.card);
      return { ...state, zones, history };
    }

    case 'ADD_COUNTER': {
      const { cardInstanceId, color = 'red' } = action.payload;
      if (!cardInstanceId) return state;
      for (const zoneId of Object.keys(zones) as ZoneId[]) {
        const idx = zones[zoneId].findIndex(c => c.instanceId === cardInstanceId);
        if (idx >= 0) {
          const card = zones[zoneId][idx];
          const existingIdx = card.counters.findIndex(c => c.color === color);
          const newCounters = existingIdx >= 0
            ? card.counters.map((c, i) => i === existingIdx ? { ...c, count: c.count + 1 } : c)
            : [...card.counters, { color, count: 1 }];
          zones[zoneId] = [...zones[zoneId]];
          zones[zoneId][idx] = { ...card, counters: newCounters };
          return { ...state, zones, history };
        }
      }
      return state;
    }

    case 'REMOVE_COUNTER': {
      const { cardInstanceId, color = 'red' } = action.payload;
      if (!cardInstanceId) return state;
      for (const zoneId of Object.keys(zones) as ZoneId[]) {
        const idx = zones[zoneId].findIndex(c => c.instanceId === cardInstanceId);
        if (idx >= 0) {
          const card = zones[zoneId][idx];
          const existing = card.counters.find(c => c.color === color);
          if (existing && existing.count > 0) {
            const newCounters = existing.count === 1
              ? card.counters.filter(c => c.color !== color)
              : card.counters.map(c => c.color === color ? { ...c, count: c.count - 1 } : c);
            zones[zoneId] = [...zones[zoneId]];
            zones[zoneId][idx] = { ...card, counters: newCounters };
          }
          return { ...state, zones, history };
        }
      }
      return state;
    }

    case 'MEEK_CARD': {
      const { cardInstanceId } = action.payload;
      if (!cardInstanceId) return state;
      for (const zoneId of Object.keys(zones) as ZoneId[]) {
        const card = zones[zoneId].find(c => c.instanceId === cardInstanceId);
        if (card) {
          card.isMeek = true;
          return { ...state, zones, history };
        }
      }
      return state;
    }

    case 'UNMEEK_CARD': {
      const { cardInstanceId } = action.payload;
      if (!cardInstanceId) return state;
      for (const zoneId of Object.keys(zones) as ZoneId[]) {
        const card = zones[zoneId].find(c => c.instanceId === cardInstanceId);
        if (card) {
          card.isMeek = false;
          return { ...state, zones, history };
        }
      }
      return state;
    }

    case 'FLIP_CARD': {
      const { cardInstanceId } = action.payload;
      if (!cardInstanceId) return state;
      for (const zoneId of Object.keys(zones) as ZoneId[]) {
        const card = zones[zoneId].find(c => c.instanceId === cardInstanceId);
        if (card) {
          card.isFlipped = !card.isFlipped;
          return { ...state, zones, history };
        }
      }
      return state;
    }

    case 'ADD_NOTE': {
      const { cardInstanceId, value } = action.payload;
      if (!cardInstanceId) return state;
      for (const zoneId of Object.keys(zones) as ZoneId[]) {
        const card = zones[zoneId].find(c => c.instanceId === cardInstanceId);
        if (card) {
          card.notes = String(value || '');
          return { ...state, zones, history };
        }
      }
      return state;
    }

    case 'ADVANCE_PHASE': {
      const currentIdx = PHASE_ORDER.indexOf(state.phase as any);
      if (currentIdx === -1 || currentIdx >= PHASE_ORDER.length - 1) {
        return state;
      }
      return { ...state, phase: PHASE_ORDER[currentIdx + 1], history };
    }

    case 'REGRESS_PHASE': {
      const currentIdx = PHASE_ORDER.indexOf(state.phase as any);
      if (currentIdx <= 0) {
        return state;
      }
      return { ...state, phase: PHASE_ORDER[currentIdx - 1], history };
    }

    case 'END_TURN': {
      // End turn: increment turn, reset to draw phase, and auto-draw 3 cards
      let newState: GameState = {
        ...state,
        zones,
        turn: state.turn + 1,
        phase: 'draw',
        drawnThisTurn: true,
        history,
      };
      // Draw 3 cards for the new turn
      for (let i = 0; i < 3; i++) {
        if (newState.zones.deck.length === 0) break;
        if (newState.zones.hand.length >= HAND_LIMIT) break;
        newState = gameReducer(
          { ...newState, history: [] },
          { ...action, type: 'DRAW_CARD', payload: {} }
        );
        newState.history = history;
        newState.drawnThisTurn = true;
      }
      if (newState.format === 'Paragon') {
        newState = { ...newState, zones: refillSoulDeck(newState.zones) };
      }
      return newState;
    }

    case 'MOVE_CARDS_BATCH': {
      const { cardInstanceIds, toZone, positions } = action.payload;
      if (!cardInstanceIds || !toZone) return state;

      const movedIds = new Set(cardInstanceIds);
      // Pre-compute per-card final destination. Weapons whose attached warrior
      // is also in this batch and going to LOB get redirected to discard — a
      // warrior heading to LOB takes its weapons down with it.
      const finalZoneById = new Map<string, ZoneId>();
      for (const id of cardInstanceIds) {
        let cardObj: GameCard | undefined;
        for (const zoneId of Object.keys(zones) as ZoneId[]) {
          const found = zones[zoneId].find(c => c.instanceId === id);
          if (found) { cardObj = found; break; }
        }
        if (!cardObj) continue;
        const redirected =
          toZone === 'land-of-bondage' &&
          !!cardObj.equippedTo &&
          movedIds.has(cardObj.equippedTo);
        finalZoneById.set(id, redirected ? 'discard' : toZone);
      }

      for (const instanceId of cardInstanceIds) {
        const result = findAndRemoveCard(zones, instanceId);
        if (!result) continue;
        const finalZone = finalZoneById.get(instanceId) ?? toZone;
        if (result.fromZone === 'deck' && finalZone !== 'deck') {
          result.card.isFlipped = false;
        }
        result.card.zone = finalZone;
        const wasSharedSoulFromLob =
          result.fromZone === 'land-of-bondage' &&
          result.card.ownerId === 'shared' &&
          result.card.isSoulDeckOrigin === true;
        if (wasSharedSoulFromLob) {
          result.card.ownerId = 'player1';
        }
        const pos = positions?.[instanceId];
        result.card.posX = finalZone === 'territory' ? pos?.posX : undefined;
        result.card.posY = finalZone === 'territory' ? pos?.posY : undefined;
        // Leaving territory — always unlink (batch grouping doesn't preserve
        // the attach the way it used to). If destination is LOB, any weapon
        // pointing at this mover that's NOT already in the batch auto-discards.
        if (finalZone !== 'territory') {
          if (result.card.equippedTo) {
            result.card.equippedTo = undefined;
          }
          for (const zoneId of Object.keys(zones) as ZoneId[]) {
            for (let i = 0; i < zones[zoneId].length; i++) {
              const other = zones[zoneId][i];
              if (other.equippedTo !== instanceId) continue;
              if (movedIds.has(other.instanceId)) {
                // Batch-member weapon — finalZoneById already routes it.
                zones[zoneId][i] = { ...other, equippedTo: undefined };
                continue;
              }
              if (finalZone === 'land-of-bondage') {
                zones[zoneId].splice(i, 1);
                i--;
                zones.discard.push({
                  ...other,
                  zone: 'discard',
                  equippedTo: undefined,
                  posX: undefined,
                  posY: undefined,
                });
              } else {
                zones[zoneId][i] = { ...other, equippedTo: undefined };
              }
            }
          }
        }
        zones[finalZone].push(result.card);
      }
      let finalZones = zones;
      if (state.format === 'Paragon') {
        // A soul-origin card may have left LoB as part of this batch; refill is idempotent.
        finalZones = refillSoulDeck(zones);
      }
      return { ...state, zones: finalZones, history };
    }

    case 'ADD_OPPONENT_LOST_SOUL': {
      const testament = (action.payload.value as string) === 'OT' ? 'OT' : 'NT';
      const cardName = testament === 'NT'
        ? 'Lost Soul Token "Harvest" [John 4:35]'
        : 'Lost Soul Token "Lost Souls" [Proverbs 2:16-17]';
      const cardImgFile = testament === 'NT'
        ? '/gameplay/nt_soul_token.png'
        : '/gameplay/ot_lost_soul.png';
      const opponentSoul: GameCard = {
        instanceId: crypto.randomUUID(),
        cardName,
        cardSet: testament === 'NT' ? 'GoC' : 'RR',
        cardImgFile,
        type: 'LS',
        brigade: '',
        strength: '',
        toughness: '',
        specialAbility: '',
        identifier: testament,
        reference: '',
        alignment: 'Neutral',
        isMeek: false,
        counters: [],
        isFlipped: false,
        isToken: true,
        zone: 'land-of-bondage',
        ownerId: 'player2',
        notes: '',
        posX: action.payload.posX,
        posY: action.payload.posY,
      };
      zones['land-of-bondage'].push(opponentSoul);
      return { ...state, zones, history };
    }

    case 'ADD_PLAYER_LOST_SOUL': {
      const soul: GameCard = {
        instanceId: crypto.randomUUID(),
        cardName: 'Lost Soul Token "Lost Souls" [Proverbs 2:16-17]',
        cardSet: 'RR',
        cardImgFile: '/gameplay/ot_lost_soul.png',
        type: 'LS',
        brigade: '',
        strength: '',
        toughness: '',
        specialAbility: '',
        identifier: 'OT',
        reference: '',
        alignment: 'Neutral',
        isMeek: false,
        counters: [],
        isFlipped: false,
        isToken: true,
        zone: 'land-of-redemption',
        ownerId: 'player1',
        notes: '',
      };
      zones['land-of-redemption'].push(soul);
      return { ...state, zones, history };
    }

    case 'REMOVE_OPPONENT_TOKEN': {
      const { cardInstanceId } = action.payload;
      if (!cardInstanceId) return state;
      findAndRemoveCard(zones, cardInstanceId);
      return { ...state, zones, history };
    }

    case 'REORDER_HAND': {
      const { cardInstanceIds } = action.payload;
      if (!cardInstanceIds || cardInstanceIds.length === 0) return state;

      // Build a map of instanceId → card for quick lookup
      const handMap = new Map<string, GameCard>();
      for (const card of zones.hand) {
        handMap.set(card.instanceId, card);
      }

      // Reorder hand to match the provided ID order
      const reordered: GameCard[] = [];
      for (const id of cardInstanceIds) {
        const card = handMap.get(id);
        if (card) {
          reordered.push(card);
          handMap.delete(id);
        }
      }
      // Append any cards not in the provided list (safety net)
      for (const card of handMap.values()) {
        reordered.push(card);
      }

      zones.hand = reordered;
      return { ...state, zones, history };
    }

    case 'REORDER_LOB': {
      const { cardInstanceIds } = action.payload;
      if (!cardInstanceIds || cardInstanceIds.length === 0) return state;

      const lobMap = new Map<string, GameCard>();
      for (const card of zones['land-of-bondage']) {
        lobMap.set(card.instanceId, card);
      }

      const reordered: GameCard[] = [];
      for (const id of cardInstanceIds) {
        const card = lobMap.get(id);
        if (card) {
          reordered.push(card);
          lobMap.delete(id);
        }
      }
      for (const card of lobMap.values()) {
        reordered.push(card);
      }

      zones['land-of-bondage'] = reordered;
      return { ...state, zones, history };
    }

    case 'ATTACH_CARD': {
      const { cardInstanceId, warriorInstanceId } = action.payload;
      if (!cardInstanceId || !warriorInstanceId) return state;
      const warrior = zones.territory.find(c => c.instanceId === warriorInstanceId);
      if (!warrior) return state;
      // Weapon may be in ANY zone (e.g. hand, territory). Pull it out, move
      // it into territory, and set equippedTo. Insert it in the territory
      // array immediately BEFORE the warrior so render order places it behind.
      const found = findAndRemoveCard(zones, cardInstanceId);
      if (!found) return state;
      const attachedWeapon: GameCard = {
        ...found.card,
        zone: 'territory',
        equippedTo: warriorInstanceId,
        posX: warrior.posX,
        posY: warrior.posY,
        isFlipped: false,
      };
      const warriorIdx = zones.territory.findIndex(c => c.instanceId === warriorInstanceId);
      if (warriorIdx >= 0) {
        zones.territory.splice(warriorIdx, 0, attachedWeapon);
      } else {
        zones.territory.push(attachedWeapon);
      }
      return { ...state, zones, history };
    }

    case 'DETACH_CARD': {
      const { cardInstanceId, posX, posY } = action.payload;
      if (!cardInstanceId) return state;
      // Remove the weapon wherever it is, then reinsert it into territory
      // immediately BEFORE its (former) warrior — this keeps it rendered
      // behind the warrior after the link is broken.
      let foundIdx = -1;
      let foundZone: ZoneId | null = null;
      for (const zoneId of Object.keys(zones) as ZoneId[]) {
        const idx = zones[zoneId].findIndex(c => c.instanceId === cardInstanceId);
        if (idx >= 0) { foundIdx = idx; foundZone = zoneId; break; }
      }
      if (foundIdx === -1 || !foundZone) return state;
      const weapon = zones[foundZone][foundIdx];
      const warriorId = weapon.equippedTo;
      const detached: GameCard = {
        ...weapon,
        equippedTo: undefined,
        posX: posX ?? weapon.posX,
        posY: posY ?? weapon.posY,
      };
      zones[foundZone].splice(foundIdx, 1);
      if (foundZone === 'territory' && warriorId) {
        const warriorIdxAfter = zones.territory.findIndex(c => c.instanceId === warriorId);
        if (warriorIdxAfter >= 0) {
          zones.territory.splice(warriorIdxAfter, 0, detached);
        } else {
          zones.territory.push(detached);
        }
      } else {
        zones[foundZone].splice(foundIdx, 0, detached);
      }
      return { ...state, zones, history };
    }

    default:
      return state;
  }
}

export function undoAction(state: GameState): GameState {
  if (state.history.length === 0) return state;
  const previous = state.history[state.history.length - 1];
  return {
    ...previous,
    history: state.history.slice(0, -1),
  };
}
