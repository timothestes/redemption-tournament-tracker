import {
  GameState,
  GameAction,
  GameCard,
  ZoneId,
  PHASE_ORDER,
} from '../types';
import { buildInitialGameState } from './gameInitializer';

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

      result.card.zone = toZone;
      // Flip face-up when moving out of deck
      if (toZone !== 'deck') {
        result.card.isFlipped = false;
      }
      // Store free-form position for territory and land-of-bondage
      const FREE_FORM_ZONES: ZoneId[] = ['territory', 'land-of-bondage'];
      if (FREE_FORM_ZONES.includes(toZone) && posX !== undefined && posY !== undefined) {
        result.card.posX = posX;
        result.card.posY = posY;
      } else {
        result.card.posX = undefined;
        result.card.posY = undefined;
      }
      if (toIndex !== undefined && toIndex >= 0) {
        zones[toZone].splice(toIndex, 0, result.card);
      } else {
        zones[toZone].push(result.card);
      }

      return { ...state, zones, history };
    }

    case 'DRAW_CARD': {
      if (zones.deck.length === 0) return state;
      if (zones.hand.length >= HAND_LIMIT && !state.options.autoRouteLostSouls) return state;

      const card = zones.deck.shift()!;

      if (state.options.autoRouteLostSouls && isLostSoul(card)) {
        // TODO: animate Lost Soul sliding to Land of Bondage with golden glow flash
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
      // Shuffle remaining deck cards, then place this card on top
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
      // Shuffle remaining deck cards, then place this card on bottom
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
      return newState;
    }

    case 'MOVE_CARDS_BATCH': {
      const { cardInstanceIds, toZone, positions } = action.payload;
      if (!cardInstanceIds || !toZone) return state;

      for (const instanceId of cardInstanceIds) {
        const result = findAndRemoveCard(zones, instanceId);
        if (!result) continue;
        result.card.zone = toZone;
        if (toZone !== 'deck') {
          result.card.isFlipped = false;
        }
        const pos = positions?.[instanceId];
        result.card.posX = pos?.posX;
        result.card.posY = pos?.posY;
        zones[toZone].push(result.card);
      }
      return { ...state, zones, history };
    }

    case 'ADD_OPPONENT_LOST_SOUL': {
      const opponentSoul: GameCard = {
        instanceId: crypto.randomUUID(),
        cardName: 'Lost Soul (Opponent)',
        cardSet: '',
        cardImgFile: '',
        type: 'LS',
        brigade: '',
        strength: '',
        toughness: '',
        specialAbility: '',
        identifier: '',
        alignment: 'Neutral',
        isMeek: false,
        counters: [],
        isFlipped: true,
        zone: 'land-of-bondage',
        ownerId: 'player2',
        notes: '',
      };
      zones['land-of-bondage'].push(opponentSoul);
      return { ...state, zones, history };
    }

    case 'REMOVE_OPPONENT_TOKEN': {
      const { cardInstanceId } = action.payload;
      if (!cardInstanceId) return state;
      findAndRemoveCard(zones, cardInstanceId);
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
