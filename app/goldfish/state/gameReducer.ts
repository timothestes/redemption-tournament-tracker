import {
  GameState,
  GameAction,
  GameCard,
  ZoneId,
  PHASE_ORDER,
} from '../types';
import { buildInitialGameState } from './gameInitializer';
import { refillSoulDeck } from '@/app/shared/paragon/refill';
import {
  type CardAbility,
  getAbilitiesForCard,
  resolveTokenCard,
} from '@/lib/cards/cardAbilities';

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

function spawnTokenInState(
  state: GameState,
  source: GameCard,
  ability: Extract<CardAbility, { type: 'spawn_token' }>,
  history: GameState[],
): GameState {
  // Phase 1 — validate. Any failure returns state unchanged.
  // resolveTokenCard checks SPECIAL_TOKEN_CARDS first (handcrafted lost-soul
  // tokens under public/gameplay/) then falls back to findCard() for tokens
  // that exist in the generated CARDS dataset.
  const tokenData = resolveTokenCard(ability.tokenName);
  if (!tokenData) {
    console.warn('[cardAbilities] unknown token', ability.tokenName);
    return state;
  }
  const count = ability.count ?? 1;
  if (count < 1) return state;

  // Always spawn tokens in Territory by default — it's the visible main play
  // area and cards in LoR/LoB strips can't lay out free-form. A registry
  // entry can override via ability.defaultZone (e.g., for tokens that
  // thematically belong in LoB).
  const targetZone: ZoneId = ability.defaultZone ?? 'territory';

  // Stagger each token relative to the source's position IF the source is
  // already in territory. Otherwise use a reasonable default near the
  // center-ish area so tokens appear together and visible.
  const STAGGER_X = 55;
  const STAGGER_Y = 15;
  const sourceInTerritory = source.zone === 'territory';
  const sourcePosX =
    typeof source.posX === 'number'
      ? source.posX
      : typeof source.posX === 'string' && source.posX !== ''
        ? Number(source.posX)
        : NaN;
  const sourcePosY =
    typeof source.posY === 'number'
      ? source.posY
      : typeof source.posY === 'string' && source.posY !== ''
        ? Number(source.posY)
        : NaN;
  const baseX = sourceInTerritory && Number.isFinite(sourcePosX) ? sourcePosX : 200;
  const baseY = sourceInTerritory && Number.isFinite(sourcePosY) ? sourcePosY : 200;

  // Phase 2 — build all new cards in memory. No state mutation yet.
  const newCards: GameCard[] = Array.from({ length: count }, (_, i) => ({
    instanceId: crypto.randomUUID(),
    cardName: tokenData.name,
    cardSet: tokenData.set,
    cardImgFile: tokenData.imgFile,
    type: tokenData.type,
    brigade: tokenData.brigade ?? '',
    strength: tokenData.strength ?? '',
    toughness: tokenData.toughness ?? '',
    specialAbility: tokenData.specialAbility ?? '',
    identifier: tokenData.identifier ?? '',
    reference: tokenData.reference ?? '',
    alignment: tokenData.alignment ?? '',
    isMeek: false,
    counters: [],
    isFlipped: false,
    isToken: true,
    zone: targetZone,
    ownerId: source.ownerId,
    notes: '',
    posX: targetZone === 'territory' ? baseX + (i + 1) * STAGGER_X : undefined,
    posY: targetZone === 'territory' ? baseY + (i + 1) * STAGGER_Y : undefined,
  }));

  // Phase 3 — commit in a single shallow clone.
  const zones = cloneZones(state.zones);
  zones[targetZone] = [...zones[targetZone], ...newCards];
  return { ...state, zones, history };
}

function setCardOutlineInState(
  state: GameState,
  source: GameCard,
  ability: Extract<CardAbility, { type: 'set_card_outline' }>,
  history: GameState[],
): GameState {
  // Re-picking the same color clears it (mutually-exclusive toggle); picking
  // the other color switches.
  const next: GameCard['outlineColor'] =
    source.outlineColor === ability.color ? undefined : ability.color;

  const zones = cloneZones(state.zones);
  for (const key of Object.keys(zones) as ZoneId[]) {
    const idx = zones[key].findIndex(c => c.instanceId === source.instanceId);
    if (idx !== -1) {
      zones[key][idx] = { ...zones[key][idx], outlineColor: next };
      break;
    }
  }
  return { ...state, zones, history };
}

function shuffleAndDrawInState(
  state: GameState,
  _ownerId: string,
  shuffleCount: number,
  drawCount: number,
  history: GameState[],
): GameState {
  // Phase 1 — validate.
  if (shuffleCount < 0 || drawCount < 0) return state;

  // Phase 2 — build new zones in memory.
  const zones = cloneZones(state.zones);

  // Pick up to shuffleCount random hand cards. Hand shortage: shuffle all.
  const actualShuffle = Math.min(shuffleCount, zones.hand.length);
  const handIndices = zones.hand.map((_c, i) => i);
  // Fisher-Yates partial shuffle — indices at the tail are the picks.
  for (let i = handIndices.length - 1; i > handIndices.length - 1 - actualShuffle && i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [handIndices[i], handIndices[j]] = [handIndices[j], handIndices[i]];
  }
  const pickedSet = new Set(handIndices.slice(handIndices.length - actualShuffle));
  const picked: GameCard[] = [];
  const remainingHand: GameCard[] = [];
  zones.hand.forEach((card, i) => {
    if (pickedSet.has(i)) {
      picked.push({ ...card, zone: 'deck', isFlipped: true });
    } else {
      remainingHand.push(card);
    }
  });
  zones.hand = remainingHand;

  // Merge picked cards into deck and reshuffle entire deck.
  const mergedDeck = [...zones.deck, ...picked];
  zones.deck = shuffleArray(mergedDeck);

  // Phase 3 — draw up to drawCount, respecting auto-route Lost Souls and hand limit.
  // Short-deck draws as many as possible.
  for (let i = 0; i < drawCount; i++) {
    if (zones.deck.length === 0) break;
    if (zones.hand.length >= HAND_LIMIT && !state.options.autoRouteLostSouls) break;

    let card = zones.deck.shift()!;
    // Auto-route consecutive Lost Souls if the option is on.
    while (state.options.autoRouteLostSouls && isLostSoul(card)) {
      card.zone = 'land-of-bondage';
      card.isFlipped = false;
      zones['land-of-bondage'].push(card);
      if (zones.deck.length === 0) { card = undefined as unknown as GameCard; break; }
      card = zones.deck.shift()!;
    }
    if (!card) break;

    if (zones.hand.length >= HAND_LIMIT) {
      zones.deck.unshift(card); // put back — no room
      break;
    }
    card.zone = 'hand';
    card.isFlipped = false;
    zones.hand.push(card);
  }

  return { ...state, zones, history };
}

function drawBottomOfDeckInState(
  state: GameState,
  _source: GameCard,
  ability: Extract<CardAbility, { type: 'draw_bottom_of_deck' }>,
  history: GameState[],
): GameState {
  if (ability.count < 1) return state;
  if (state.zones.deck.length === 0) return state;

  const zones = cloneZones(state.zones);
  const n = Math.min(ability.count, zones.deck.length);
  const taken = zones.deck.slice(zones.deck.length - n).map(c => ({
    ...c,
    zone: 'hand' as ZoneId,
    isFlipped: false,
    posX: undefined,
    posY: undefined,
  }));
  zones.deck = zones.deck.slice(0, zones.deck.length - n);
  zones.hand = [...zones.hand, ...taken];

  return { ...state, zones, history };
}

function reserveTopOfDeckInState(
  state: GameState,
  _source: GameCard,
  ability: Extract<CardAbility, { type: 'reserve_top_of_deck' }>,
  history: GameState[],
): GameState {
  // Phase 1 — validate.
  if (ability.count < 1) return state;
  if (state.zones.deck.length === 0) return state;

  // Phase 2 — build new zones. Top of deck is zones.deck[0] (matches shift()
  // usage in shuffleAndDrawInState and drawCard).
  const zones = cloneZones(state.zones);
  const n = Math.min(ability.count, zones.deck.length);
  const taken = zones.deck.slice(0, n).map(c => ({
    ...c,
    zone: 'reserve' as ZoneId,
    // Face-down: player didn't look at the card. Matches the initial reserve
    // state (see buildInitialGameState / insertCardsShuffleDraw in the server).
    isFlipped: true,
    posX: undefined,
    posY: undefined,
  }));
  zones.deck = zones.deck.slice(n);
  zones.reserve = [...taken, ...zones.reserve];

  return { ...state, zones, history };
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
      // Paragon: revealing a card from the Soul Deck flips it face-up as it leaves.
      if (result.fromZone === 'soul-deck' && toZone !== 'soul-deck') {
        result.card.isFlipped = false;
      }
      result.card.zone = toZone;
      // Per-card hand reveals are ephemeral — clear when the card changes zone.
      if (result.fromZone !== toZone) {
        result.card.revealUntil = undefined;
      }
      // Counters, text notes, and the Three Woes Choose Good/Evil outline are
      // in-play state — drop them whenever the card leaves Territory or Land
      // of Bondage for any other zone.
      if (
        result.fromZone !== toZone &&
        (result.fromZone === 'territory' || result.fromZone === 'land-of-bondage')
      ) {
        result.card.counters = [];
        result.card.notes = '';
        result.card.outlineColor = undefined;
      }
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
              const leavingPlay =
                zoneId === 'territory' || zoneId === 'land-of-bondage';
              zones[zoneId].splice(i, 1);
              i--;
              zones.discard.push({
                ...other,
                zone: 'discard',
                equippedTo: undefined,
                posX: undefined,
                posY: undefined,
                counters: leavingPlay ? [] : other.counters,
                notes: leavingPlay ? '' : other.notes,
                outlineColor: leavingPlay ? undefined : other.outlineColor,
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
        toZone === 'land-of-redemption';
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

    case 'SHUFFLE_SOUL_DECK': {
      zones['soul-deck'] = shuffleArray(zones['soul-deck']);
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
      result.card.revealUntil = undefined;
      if (result.fromZone === 'territory' || result.fromZone === 'land-of-bondage') {
        result.card.counters = [];
        result.card.notes = '';
        result.card.outlineColor = undefined;
      }
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
      result.card.revealUntil = undefined;
      if (result.fromZone === 'territory' || result.fromZone === 'land-of-bondage') {
        result.card.counters = [];
        result.card.notes = '';
        result.card.outlineColor = undefined;
      }
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

      let anyRescue = false;
      for (const instanceId of cardInstanceIds) {
        const result = findAndRemoveCard(zones, instanceId);
        if (!result) continue;
        const finalZone = finalZoneById.get(instanceId) ?? toZone;
        if (result.fromZone === 'deck' && finalZone !== 'deck') {
          result.card.isFlipped = false;
        }
        if (result.fromZone === 'soul-deck' && finalZone !== 'soul-deck') {
          result.card.isFlipped = false;
        }
        result.card.zone = finalZone;
        if (result.fromZone !== finalZone) {
          result.card.revealUntil = undefined;
        }
        if (
          result.fromZone !== finalZone &&
          (result.fromZone === 'territory' || result.fromZone === 'land-of-bondage')
        ) {
          result.card.counters = [];
          result.card.notes = '';
          result.card.outlineColor = undefined;
        }
        const wasSharedSoulFromLob =
          result.fromZone === 'land-of-bondage' &&
          result.card.ownerId === 'shared' &&
          result.card.isSoulDeckOrigin === true;
        if (wasSharedSoulFromLob) {
          result.card.ownerId = 'player1';
        }
        if (
          result.fromZone === 'land-of-bondage' &&
          result.card.isSoulDeckOrigin === true &&
          finalZone === 'land-of-redemption'
        ) {
          anyRescue = true;
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
                const leavingPlay =
                  zoneId === 'territory' || zoneId === 'land-of-bondage';
                zones[zoneId].splice(i, 1);
                i--;
                zones.discard.push({
                  ...other,
                  zone: 'discard',
                  equippedTo: undefined,
                  posX: undefined,
                  posY: undefined,
                  counters: leavingPlay ? [] : other.counters,
                  notes: leavingPlay ? '' : other.notes,
                  outlineColor: leavingPlay ? undefined : other.outlineColor,
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
      if (state.format === 'Paragon' && anyRescue) {
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

    case 'EXECUTE_CARD_ABILITY': {
      const { cardInstanceId, abilityIndex } = action.payload;
      if (!cardInstanceId || abilityIndex === undefined) return state;

      // Locate the source across all zones.
      let source: GameCard | undefined;
      for (const zone of Object.values(state.zones)) {
        const found = zone.find(c => c.instanceId === cardInstanceId);
        if (found) { source = found; break; }
      }
      if (!source) return state;

      // Abilities only fire when the source card is in play. Matches the
      // CardContextMenu gate — a malformed dispatch from elsewhere still
      // no-ops here rather than leaving weird state. Includes Land of
      // Redemption so resting Heroes can trigger abilities.
      const ABILITY_SOURCE_ZONES: ZoneId[] = ['territory', 'land-of-bondage', 'land-of-redemption'];
      if (!ABILITY_SOURCE_ZONES.includes(source.zone)) return state;

      // Registry keys match GameCard.cardName (includes the set suffix for the
      // v1 cards, e.g., "Two Possessed (GoC)"). The card's identifier field is
      // a taxonomy descriptor ("Generic, Demon", etc.) and is NOT unique enough
      // to key the registry.
      const ability = getAbilitiesForCard(source.cardName)[abilityIndex];
      if (!ability) return state;

      switch (ability.type) {
        case 'spawn_token':
          return spawnTokenInState(state, source, ability, history);
        case 'shuffle_and_draw':
          // Reserved for future — v1 ships spawn_token only.
          return state;
        case 'all_players_shuffle_and_draw':
          // Goldfish is single-player — apply to the card's owner only.
          return shuffleAndDrawInState(state, source.ownerId, ability.shuffleCount, ability.drawCount, history);
        case 'reveal_own_deck':
        case 'look_at_own_deck':
        case 'look_at_opponent_deck':
        case 'discard_opponent_deck':
        case 'reserve_opponent_deck':
          // Modal-driven or opponent-required — GoldfishCanvas intercepts, or
          // the effect is multiplayer-only. No-op here.
          return state;
        case 'reserve_top_of_deck':
          return reserveTopOfDeckInState(state, source, ability, history);
        case 'draw_bottom_of_deck':
          return drawBottomOfDeckInState(state, source, ability, history);
        case 'set_card_outline':
          return setCardOutlineInState(state, source, ability, history);
        case 'custom':
          // Custom abilities are dispatched client-side in multiplayer and
          // never reach the goldfish reducer in v1. No-op defensively.
          return state;
        default: {
          const _exhaustive: never = ability;
          return state;
        }
      }
    }

    case 'REVEAL_CARD_IN_HAND': {
      const { cardInstanceId, value } = action.payload;
      if (!cardInstanceId || typeof value !== 'number') return state;
      // Only reveal cards that are actually in hand — silently no-op otherwise.
      const idx = zones.hand.findIndex(c => c.instanceId === cardInstanceId);
      if (idx === -1) return state;
      zones.hand = [...zones.hand];
      zones.hand[idx] = { ...zones.hand[idx], revealUntil: value };
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
