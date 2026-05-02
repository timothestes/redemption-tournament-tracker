import spacetimedb from './schema';
export default spacetimedb;
import { DisconnectTimeout, setDisconnectTimeoutReducer, ChooseFirstTimeout, setChooseFirstTimeoutReducer, CleanupSchedule, setCleanupStaleGamesReducer } from './schema';
import { t, SenderError } from 'spacetimedb/server';
import { ScheduleAt, Timestamp } from 'spacetimedb';
import { makeSeed, seededShuffle, seededDiceRoll, xorshift64, generateGameCode } from './utils';
import { getAbilitiesForCard, findTokenCard, type CardAbility } from './cardAbilities';

// Auto-reveal duration for cards that land in a hand via a move whose log
// payload reveals the card identity (cross-player moves, face-up moves, etc.).
// Briefly flashes the card face-up in the recipient's hand so the receiver
// sees what they got without scanning the chat log.
const AUTO_REVEAL_HAND_MICROS = 10_000_000n; // 10 seconds

// Maximum cards a player may hold in hand. Mirrors the client-side cap used
// in goldfish/multiplayer UIs (HAND_LIMIT). Auto-draws stop short of this.
const HAND_LIMIT = 16;

// ---------------------------------------------------------------------------
// Helper: logAction
// ---------------------------------------------------------------------------
function logAction(
  ctx: any,
  gameId: bigint,
  playerId: bigint,
  actionType: string,
  payload: string,
  turnNumber: bigint,
  phase: string
) {
  ctx.db.GameAction.insert({
    id: 0n,
    gameId,
    playerId,
    actionType,
    payload,
    turnNumber,
    phase,
    timestamp: ctx.timestamp,
  });
}

// ---------------------------------------------------------------------------
// Helper: normalizeFormat
// Maps any deck-format string (e.g. "Type 1", "t2", "Paragon Type 1",
// "Multi-player") to the canonical "T1" | "T2" | "Paragon" used by game rules.
// Mirrors client-side `formatDeckType` in app/play/components/DeckPickerCard.tsx.
// ---------------------------------------------------------------------------
function normalizeFormat(format: string): 'T1' | 'T2' | 'Paragon' {
  const fmt = (format || '').toLowerCase();
  if (fmt.includes('paragon')) return 'Paragon';
  if (fmt.includes('type 2') || fmt.includes('multi') || fmt === 't2') return 'T2';
  return 'T1';
}

// ---------------------------------------------------------------------------
// Helper: findPlayerBySender
// ---------------------------------------------------------------------------
function findPlayerBySender(ctx: any, gameId: bigint) {
  for (const player of ctx.db.Player.player_game_id.filter(gameId)) {
    if (player.identity.toHexString() === ctx.sender.toHexString()) {
      return player;
    }
  }
  throw new SenderError('Player not found in this game');
}

// ---------------------------------------------------------------------------
// Helper: canSenderActOnCard
// Normal cards: only the owner can act. Shared cards (ownerId = 0n) in a
// Paragon game can be acted on by either seat when the card is in a shared
// zone (land-of-bondage or soul-deck). Prevents cross-seat interference with
// player-owned cards while allowing both players to interact with the Soul
// Deck and shared LoB.
//
// TODO: The current move-type reducers (move_card, move_cards_batch) already
// permit any-player moves, so this helper is not yet called. It is retained
// to satisfy the spec's broader requirement (design.md L111) that every
// reducer authorizing on ownership gain a shared-card branch. Known future
// consumers — wire up when shared-card interaction is needed for each:
//   - attach_card            (enhancer/weapon attach to a shared soul)
//   - detach_card            (weapon detach)
//   - reorder_hand           (own-hand only; may not need shared branch)
//   - reorder_lob            (BOTH players reorder shared LoB)
//   - add_card_note          (annotate shared LoB souls, e.g. "Negated")
//   - exchange_cards         (deck exchange affecting shared state)
// ---------------------------------------------------------------------------
function canSenderActOnCard(game: any, card: any, player: any): boolean {
  if (card.ownerId === player.id) return true;
  if (card.ownerId !== 0n) return false;
  const fmt = normalizeFormat(game.format);
  if (fmt !== 'Paragon') return false;
  return card.zone === 'land-of-bondage' || card.zone === 'soul-deck';
}

// ---------------------------------------------------------------------------
// Helper: compactHandIndices
// After a card leaves the hand, re-index remaining hand cards to close gaps
// so zoneIndex values are always sequential: 0, 1, 2, ...
//
// `gameCardsHint` lets callers reuse a single CardInstance materialization
// across multiple operations in the same reducer (saves a full filter scan).
// `excludeId` skips the just-moved card whose row in the hint still shows
// `zone === 'hand'` because the hint was captured before the move.
// ---------------------------------------------------------------------------
function compactHandIndices(
  ctx: any,
  gameId: bigint,
  playerId: bigint,
  gameCardsHint?: any[],
  excludeId?: bigint,
) {
  const allCards = gameCardsHint ?? [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)];
  const handCards = allCards.filter(
    (c: any) => c.ownerId === playerId && c.zone === 'hand' && (excludeId === undefined || c.id !== excludeId)
  );
  // Sort by current zoneIndex to preserve order
  handCards.sort((a: any, b: any) => (a.zoneIndex < b.zoneIndex ? -1 : a.zoneIndex > b.zoneIndex ? 1 : 0));
  // Re-index sequentially
  for (let i = 0; i < handCards.length; i++) {
    if (handCards[i].zoneIndex !== BigInt(i)) {
      ctx.db.CardInstance.id.update({ ...handCards[i], zoneIndex: BigInt(i) });
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: compactLobIndices
// After a card leaves the LOB, re-index remaining LOB cards to close gaps
// so zoneIndex values are always sequential: 0, 1, 2, ...
// ---------------------------------------------------------------------------
function compactLobIndices(
  ctx: any,
  gameId: bigint,
  playerId: bigint,
  gameCardsHint?: any[],
  excludeId?: bigint,
) {
  // Paragon shared LoB (ownerId=0n) intentionally keeps sparse zoneIndices so
  // that when a soul is rescued, its slot stays empty until refill places a
  // new soul there — preventing the other souls from visually shifting.
  if (playerId === 0n) return;
  const allCards = gameCardsHint ?? [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)];
  const lobCards = allCards.filter(
    (c: any) => c.ownerId === playerId && c.zone === 'land-of-bondage' && (excludeId === undefined || c.id !== excludeId)
  );
  lobCards.sort((a: any, b: any) => (a.zoneIndex < b.zoneIndex ? -1 : a.zoneIndex > b.zoneIndex ? 1 : 0));
  for (let i = 0; i < lobCards.length; i++) {
    if (lobCards[i].zoneIndex !== BigInt(i)) {
      ctx.db.CardInstance.id.update({ ...lobCards[i], zoneIndex: BigInt(i) });
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: clearCountersIfLeavingPlay
// Counters reflect in-play state (damage, charges, generic markers). When a
// card leaves Territory or Land of Bondage for any other zone, drop all
// CardCounter rows for it so they don't follow the card into deck/hand/discard
// or persist when it later returns to play.
// ---------------------------------------------------------------------------
function clearCountersIfLeavingPlay(ctx: any, cardId: bigint, fromZone: string, toZone: string) {
  if (fromZone === toZone) return;
  if (fromZone !== 'territory' && fromZone !== 'land-of-bondage') return;
  for (const counter of [...ctx.db.CardCounter.card_counter_card_instance_id.filter(cardId)]) {
    ctx.db.CardCounter.id.delete(counter.id);
  }
}

// ---------------------------------------------------------------------------
// Helper: leavePlayFieldOverrides
// Player-attached annotations (notes, Three Woes Choose Good/Evil outline) and
// the meek conversion are in-play state and shouldn't ride along when the card
// leaves Territory or Land of Bondage. Returns the override map to spread into
// a CardInstance update; preserves the existing values for moves that aren't
// leave-play.
// ---------------------------------------------------------------------------
function leavePlayFieldOverrides(card: any, fromZone: string, toZone: string): { notes: string; outlineColor: string; isMeek: boolean } {
  const leaving =
    fromZone !== toZone && (fromZone === 'territory' || fromZone === 'land-of-bondage');
  return {
    notes: leaving ? '' : card.notes,
    outlineColor: leaving ? '' : card.outlineColor,
    isMeek: leaving ? false : card.isMeek,
  };
}

// ---------------------------------------------------------------------------
// Helper: drawCardsForPlayer
// ---------------------------------------------------------------------------
interface DrawnCardInfo {
  name: string;
  img: string;
}

interface DrawResult {
  drawn: number;
  cards: DrawnCardInfo[];
}

function drawCardsForPlayer(ctx: any, game: any, player: any, count: number): DrawResult {
  // One upfront scan: collect this player's cards, build sorted deck + zone counts
  const playerCards = [...ctx.db.CardInstance.card_instance_game_id.filter(game.id)].filter(
    (c: any) => c.ownerId === player.id
  );

  // Build sorted deck cards (ascending by zoneIndex — first element is top of deck)
  const deckCards = playerCards
    .filter((c: any) => c.zone === 'deck')
    .sort((a: any, b: any) => (a.zoneIndex < b.zoneIndex ? -1 : a.zoneIndex > b.zoneIndex ? 1 : 0));

  // Track current hand and LOB counts for zoneIndex assignment
  let handCount = playerCards.filter((c: any) => c.zone === 'hand').length;
  let lobCount = playerCards.filter((c: any) => c.zone === 'land-of-bondage').length;

  let drawn = 0;
  let deckPos = 0; // Pointer into sorted deckCards
  const drawnCards: DrawnCardInfo[] = [];

  for (let i = 0; i < count; i++) {
    if (deckPos >= deckCards.length) break; // No more cards in deck

    const topCard = deckCards[deckPos];

    // Check if auto-route lost souls
    const isLostSoul =
      player.autoRouteLostSouls &&
      (topCard.cardType === 'LS' || topCard.cardName.toLowerCase().includes('lost soul'));

    // Hand-size cap: stop drawing when the next card would land in hand and
    // hand is already full. Lost Souls auto-route to LOB, so they don't take
    // a hand slot and keep flowing.
    if (!isLostSoul && handCount >= HAND_LIMIT) break;

    deckPos++;

    if (isLostSoul) {
      // Move to land-of-bondage. Auto-routed Lost Souls don't count toward
      // `drawn` — by the rules, a card that never enters hand wasn't drawn.
      ctx.db.CardInstance.id.update({
        ...topCard,
        zone: 'land-of-bondage',
        isFlipped: false,
        zoneIndex: BigInt(lobCount),
      });
      lobCount++;
      logAction(ctx, game.id, player.id, 'MOVE_CARD', JSON.stringify({ cardInstanceId: topCard.id.toString(), from: 'deck', to: 'land-of-bondage', cardName: topCard.cardName, cardImgFile: topCard.cardImgFile, redirected: 'drew' }), game.turnNumber, game.currentPhase);
      // Draw a replacement — extend the loop
      count++;
    } else {
      // Move to hand
      ctx.db.CardInstance.id.update({
        ...topCard,
        zone: 'hand',
        isFlipped: false,
        zoneIndex: BigInt(handCount),
      });
      handCount++;
      drawn++;
      drawnCards.push({ name: topCard.cardName, img: topCard.cardImgFile });
    }
  }

  return { drawn, cards: drawnCards };
}

// ---------------------------------------------------------------------------
// Helper: insertCardsShuffleDraw (shared between create_game and join_game)
// ---------------------------------------------------------------------------
function insertCardsShuffleDraw(
  ctx: any,
  game: any,
  player: any,
  deckData: string
) {
  const cards: any[] = JSON.parse(deckData);

  // Insert card_instance rows
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    ctx.db.CardInstance.insert({
      id: 0n,
      gameId: game.id,
      ownerId: player.id,
      originalOwnerId: player.id,
      zone: card.isReserve ? 'reserve' : 'deck',
      zoneIndex: BigInt(i),
      posX: '',
      posY: '',
      isMeek: false,
      isFlipped: true,
      cardName: card.cardName || '',
      cardSet: card.cardSet || '',
      cardImgFile: card.cardImgFile || '',
      cardType: card.cardType || '',
      brigade: card.brigade || '',
      strength: card.strength || '',
      toughness: card.toughness || '',
      alignment: card.alignment || '',
      identifier: card.identifier || '',
      specialAbility: card.specialAbility || '',
      reference: card.reference || '',
      notes: '',
      equippedToInstanceId: 0n,
      isSoulDeckOrigin: false,
      isToken: false,
      revealExpiresAt: undefined,
      revealStartedAt: undefined,
      outlineColor: '',
    });
  }

  // Shuffle deck using seeded PRNG
  const shuffleSeed = makeSeed(
    ctx.timestamp.microsSinceUnixEpoch,
    game.id,
    player.id,
    game.rngCounter
  );

  // Collect deck cards
  const deckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(game.id)].filter(
    (c: any) => c.ownerId === player.id && c.zone === 'deck'
  );

  // Create shuffled indices
  const indices = deckCards.map((_: any, idx: number) => idx);
  seededShuffle(indices, shuffleSeed);

  // Update zoneIndex for each card
  for (let i = 0; i < deckCards.length; i++) {
    ctx.db.CardInstance.id.update({
      ...deckCards[i],
      zoneIndex: BigInt(indices[i]),
    });
  }

  // Increment rng counter
  const updatedGame = ctx.db.Game.id.find(game.id);
  ctx.db.Game.id.update({ ...updatedGame, rngCounter: updatedGame.rngCounter + 1n });

  // Draw opening hand (8 cards)
  const latestGame = ctx.db.Game.id.find(game.id);
  drawCardsForPlayer(ctx, latestGame, player, 8);
}

// ---------------------------------------------------------------------------
// Helper: initializeSoulDeck (Paragon only)
// Seeds 21 shared soul cards into 'soul-deck', then reveals 3 to
// 'land-of-bondage' face-up. Uses the game's seeded PRNG for shuffle.
// ---------------------------------------------------------------------------
// Unique tag XOR'd into the soul-deck shuffle seed so it cannot collide
// with any player-keyed seed regardless of future Player id allocation.
const SOUL_DECK_SEED_TAG = 0xDEADBEEFCAFEBABEn;

// NOTE: This mirrors PARAGON_SOULS in app/shared/paragon/soulDeck.ts —
// keep the two in sync. The server module compiles independently of the
// Next.js app and cannot import from app/shared. If the identifier
// convention or image path shape changes, update both files.
const PARAGON_SOUL_DEFS: Array<{ identifier: string; cardName: string; cardImgFile: string }> =
  Array.from({ length: 21 }, (_, i) => {
    const padded = String(i + 1).padStart(2, '0');
    return {
      identifier: `paragon-soul-${padded}`,
      cardName: `Lost Soul ${padded}`,
      cardImgFile: `/paragon-souls/Lost Soul ${padded}.png`,
    };
  });

function initializeSoulDeck(ctx: any, game: any) {
  // Idempotence: if any shared soul cards already exist for this game, skip.
  // Lets multiple pregame hook points call this safely (rolling → choosing,
  // choose-first fallback, game-start fallback) without doubling the pile.
  const existing = [...ctx.db.CardInstance.card_instance_game_id.filter(game.id)].filter(
    (c: any) => c.ownerId === 0n && (c.zone === 'soul-deck' || c.zone === 'land-of-bondage')
  );
  if (existing.length > 0) return;

  // Insert 21 shared soul cards (ownerId = 0n sentinel)
  for (let i = 0; i < PARAGON_SOUL_DEFS.length; i++) {
    const def = PARAGON_SOUL_DEFS[i];
    ctx.db.CardInstance.insert({
      id: 0n,
      gameId: game.id,
      ownerId: 0n,
      originalOwnerId: 0n,
      zone: 'soul-deck',
      zoneIndex: BigInt(i),
      posX: '',
      posY: '',
      isMeek: false,
      isFlipped: true,
      cardName: def.cardName,
      cardSet: 'ParagonSoul',
      cardImgFile: def.cardImgFile,
      cardType: 'Lost Soul',
      brigade: '',
      strength: '',
      toughness: '',
      alignment: 'Evil',
      identifier: def.identifier,
      specialAbility: '',
      reference: '',
      notes: '',
      equippedToInstanceId: 0n,
      isSoulDeckOrigin: true,
      isToken: false,
      revealExpiresAt: undefined,
      revealStartedAt: undefined,
      outlineColor: '',
    });
  }

  // Shuffle soul deck using seeded PRNG (same pattern as insertCardsShuffleDraw)
  const shuffleSeed = makeSeed(
    ctx.timestamp.microsSinceUnixEpoch,
    game.id,
    0n,
    game.rngCounter
  ) ^ SOUL_DECK_SEED_TAG;
  const soulCards = [...ctx.db.CardInstance.card_instance_game_id.filter(game.id)].filter(
    (c: any) => c.ownerId === 0n && c.zone === 'soul-deck'
  );
  const indices = soulCards.map((_: any, idx: number) => idx);
  seededShuffle(indices, shuffleSeed);
  for (let i = 0; i < soulCards.length; i++) {
    ctx.db.CardInstance.id.update({ ...soulCards[i], zoneIndex: BigInt(indices[i]) });
  }

  // Bump rngCounter after PRNG use
  const latestGame = ctx.db.Game.id.find(game.id);
  ctx.db.Game.id.update({ ...latestGame, rngCounter: latestGame.rngCounter + 1n });

  // Reveal top 3 shuffled cards into land-of-bondage (face-up)
  const shuffledSoulCards = [...ctx.db.CardInstance.card_instance_game_id.filter(game.id)]
    .filter((c: any) => c.ownerId === 0n && c.zone === 'soul-deck')
    .sort((a: any, b: any) => (a.zoneIndex < b.zoneIndex ? -1 : a.zoneIndex > b.zoneIndex ? 1 : 0));

  for (let i = 0; i < 3 && i < shuffledSoulCards.length; i++) {
    ctx.db.CardInstance.id.update({
      ...shuffledSoulCards[i],
      zone: 'land-of-bondage',
      zoneIndex: BigInt(i),
      isFlipped: false,
    });
  }

  // Re-index remaining soul-deck cards to 0..N-1
  const remainingSoulDeck = [...ctx.db.CardInstance.card_instance_game_id.filter(game.id)]
    .filter((c: any) => c.ownerId === 0n && c.zone === 'soul-deck')
    .sort((a: any, b: any) => (a.zoneIndex < b.zoneIndex ? -1 : a.zoneIndex > b.zoneIndex ? 1 : 0));
  for (let i = 0; i < remainingSoulDeck.length; i++) {
    if (remainingSoulDeck[i].zoneIndex !== BigInt(i)) {
      ctx.db.CardInstance.id.update({ ...remainingSoulDeck[i], zoneIndex: BigInt(i) });
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: refillSoulDeck (server-side, Paragon only)
// Mirrors the goldfish client helper — tops up the shared LoB to 3
// soul-origin souls from the soul-deck. Ignores captured characters and
// LS tokens already in LoB (they don't count toward the rule of 3).
// ---------------------------------------------------------------------------
function refillSoulDeck(ctx: any, gameId: bigint) {
  const gameCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)];

  const sharedLob = gameCards.filter(
    (c: any) => c.ownerId === 0n && c.zone === 'land-of-bondage' && c.isSoulDeckOrigin === true
  );
  const needed = 3 - sharedLob.length;
  if (needed <= 0) return;

  const soulDeck = gameCards
    .filter((c: any) => c.ownerId === 0n && c.zone === 'soul-deck')
    .sort((a: any, b: any) => (a.zoneIndex < b.zoneIndex ? -1 : a.zoneIndex > b.zoneIndex ? 1 : 0));
  if (soulDeck.length === 0) return;

  // Slot-preserving refill: find which of the three canonical slots (0, 1, 2)
  // are currently empty and fill those specific slots so remaining souls keep
  // their visual positions.
  const occupied = new Set<bigint>(sharedLob.map((c: any) => c.zoneIndex));
  const emptySlots: bigint[] = [];
  for (let i = 0n; i < 3n; i++) {
    if (!occupied.has(i)) emptySlots.push(i);
  }

  const take = Math.min(needed, soulDeck.length, emptySlots.length);
  for (let i = 0; i < take; i++) {
    ctx.db.CardInstance.id.update({
      ...soulDeck[i],
      zone: 'land-of-bondage',
      zoneIndex: emptySlots[i],
      isFlipped: false,
    });
  }

  // Re-index remaining soul-deck cards to close gaps
  const remaining = soulDeck.slice(take);
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].zoneIndex !== BigInt(i)) {
      ctx.db.CardInstance.id.update({ ...remaining[i], zoneIndex: BigInt(i) });
    }
  }
}

// ---------------------------------------------------------------------------
// Reducer: create_game
// ---------------------------------------------------------------------------
export const create_game = spacetimedb.reducer(
  {
    code: t.string(),
    deckId: t.string(),
    displayName: t.string(),
    paragon: t.string(),
    format: t.string(),
    supabaseUserId: t.string(),
    deckData: t.string(),
    isPublic: t.bool(),
    lobbyMessage: t.string(),
  },
  (ctx, { code, deckId, displayName, paragon, format, supabaseUserId, deckData, isPublic, lobbyMessage }) => {
    // Validate code is not already in use by an active game
    for (const g of ctx.db.Game.game_code.filter(code)) {
      if (g.status !== 'finished') {
        throw new SenderError('Game code already in use');
      }
    }

    // Insert game row
    const game = ctx.db.Game.insert({
      id: 0n,
      code,
      status: 'waiting',
      currentTurn: 0n,
      currentPhase: 'draw',
      turnNumber: 0n,
      format,
      rngCounter: 1n,
      lastDiceRoll: '',
      createdAt: ctx.timestamp,
      createdBy: ctx.sender,
      isPublic,
      lobbyMessage,
      createdByName: displayName,
      pregamePhase: '',
      pregameReady0: false,
      pregameReady1: false,
      rollWinner: '',
      rollResult0: 0n,
      rollResult1: 0n,
      rematchRequestedBy: '',
      rematchDeckId0: '',
      rematchDeckData0: '',
      rematchDeckId1: '',
      rematchDeckData1: '',
      rematchParagon0: '',
      rematchParagon1: '',
      rematchResponse: '',
      rematchCode: '',
      disconnectTimeoutFired: false,
      choosingDeadlineMicros: 0n,
      playingStartedAtMicros: 0n,
    });

    // Insert player row with pending deck data (cards loaded later during pregame)
    const player = ctx.db.Player.insert({
      id: 0n,
      gameId: game.id,
      identity: ctx.sender,
      seat: 0n,
      deckId,
      displayName,
      paragon,
      supabaseUserId,
      isConnected: true,
      autoRouteLostSouls: true,
      handRevealed: false,
      handRevealSnapshot: '',
      reserveRevealed: false,
      pendingDeckData: deckData,
      revealedCards: '',
    });

    logAction(ctx, game.id, player.id, 'GAME_CREATED', JSON.stringify({ code }), 0n, 'draw');
  }
);

// ---------------------------------------------------------------------------
// Reducer: join_game
// ---------------------------------------------------------------------------
export const join_game = spacetimedb.reducer(
  {
    code: t.string(),
    deckId: t.string(),
    displayName: t.string(),
    paragon: t.string(),
    format: t.string(),
    supabaseUserId: t.string(),
    deckData: t.string(),
  },
  (ctx, { code, deckId, displayName, paragon, format, supabaseUserId, deckData }) => {
    // Find game by code
    let game: any = null;
    for (const g of ctx.db.Game.game_code.filter(code)) {
      if (g.status === 'waiting') {
        game = g;
        break;
      }
    }
    if (!game) {
      throw new SenderError('No waiting game found with that code');
    }

    // Reject join if the creator has disconnected — the game is effectively dead
    const creator = [...ctx.db.Player.player_game_id.filter(game.id)]
      .find((p: any) => p.seat === 0n);
    if (creator && !creator.isConnected) {
      ctx.db.Game.id.update({ ...game, status: 'finished' });
      throw new SenderError('No waiting game found with that code');
    }

    // Prevent a player from joining their own game
    if (creator && creator.supabaseUserId === supabaseUserId) {
      throw new SenderError('You cannot join your own game');
    }

    // Reject format mismatch (T1 can't join a Paragon game, etc.)
    const joinerFormat = normalizeFormat(format);
    const gameFormat = normalizeFormat(game.format);
    if (joinerFormat !== gameFormat) {
      throw new SenderError(
        `Deck format (${joinerFormat}) does not match game format (${gameFormat})`
      );
    }

    // Insert player (seat=1) with pending deck data (cards loaded later during pregame)
    const player = ctx.db.Player.insert({
      id: 0n,
      gameId: game.id,
      identity: ctx.sender,
      seat: 1n,
      deckId,
      displayName,
      paragon,
      supabaseUserId,
      isConnected: true,
      autoRouteLostSouls: true,
      handRevealed: false,
      handRevealSnapshot: '',
      reserveRevealed: false,
      pendingDeckData: deckData,
      revealedCards: '',
    });

    // Log join
    logAction(ctx, game.id, player.id, 'PLAYER_JOINED', '', 0n, 'pregame');

    // Load decks for both players
    const allPlayers: any[] = [...ctx.db.Player.player_game_id.filter(game.id)];
    for (const p of allPlayers) {
      if (!p.pendingDeckData || p.pendingDeckData === '') {
        throw new SenderError('Player ' + p.displayName + ' has no deck data');
      }
    }

    // Insert cards, shuffle, and draw opening hand for both players
    for (const p of allPlayers) {
      const currentGame = ctx.db.Game.id.find(game.id);
      if (!currentGame) throw new SenderError('Game not found');
      insertCardsShuffleDraw(ctx, currentGame, p, p.pendingDeckData);
      const latestPlayer = ctx.db.Player.id.find(p.id);
      if (latestPlayer) {
        ctx.db.Player.id.update({ ...latestPlayer, pendingDeckData: '' });
      }
    }

    // Paragon: populate the shared soul deck + 3 LoB souls at the same
    // moment player hands are dealt (idempotent).
    const gameForSoulInit = ctx.db.Game.id.find(game.id);
    if (gameForSoulInit && normalizeFormat(gameForSoulInit.format) === 'Paragon') {
      initializeSoulDeck(ctx, gameForSoulInit);
    }

    // Roll dice to determine who chooses first player
    const gameAfterCards = ctx.db.Game.id.find(game.id);
    if (!gameAfterCards) throw new SenderError('Game not found');
    const seed = makeSeed(
      ctx.timestamp.microsSinceUnixEpoch,
      game.id,
      0n,
      gameAfterCards.rngCounter
    );
    const rng = xorshift64(seed);

    let r0: number, r1: number;
    do {
      r0 = Number(rng.next() % 20n) + 1;
      r1 = Number(rng.next() % 20n) + 1;
    } while (r0 === r1);

    const winner = r0 > r1 ? '0' : '1';

    const gameBeforeUpdate = ctx.db.Game.id.find(game.id);
    if (!gameBeforeUpdate) throw new SenderError('Game not found');
    const CHOOSE_DEADLINE_MICROS = 30_000_000n; // 30 seconds from now
    ctx.db.Game.id.update({
      ...gameBeforeUpdate,
      status: 'pregame',
      pregamePhase: 'rolling',
      rollResult0: BigInt(r0),
      rollResult1: BigInt(r1),
      rollWinner: winner,
      rngCounter: gameBeforeUpdate.rngCounter + 1n,
      choosingDeadlineMicros: ctx.timestamp.microsSinceUnixEpoch + CHOOSE_DEADLINE_MICROS,
    });

    const winnerSeat = winner === '0' ? 0n : 1n;
    let winnerPlayerId = player.id;
    for (const p of [...ctx.db.Player.player_game_id.filter(game.id)]) {
      if (p.seat === winnerSeat) { winnerPlayerId = p.id; break; }
    }
    logAction(ctx, game.id, winnerPlayerId, 'PREGAME_ROLL',
      JSON.stringify({ result0: r0, result1: r1, winner }),
      0n, 'pregame');
  }
);

// ===========================================================================
// Pregame ceremony reducers
// ===========================================================================

// ---------------------------------------------------------------------------
// Reducer: pregame_ready
// ---------------------------------------------------------------------------
export const pregame_ready = spacetimedb.reducer(
  {
    gameId: t.u64(),
    ready: t.bool(),
  },
  (ctx, { gameId, ready }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'pregame') throw new SenderError('Game is not in pregame');
    if (game.pregamePhase !== 'deck_select') throw new SenderError('Not in deck select phase');

    const player = findPlayerBySender(ctx, gameId);

    const updates: any = { ...game };
    if (player.seat === 0n) {
      updates.pregameReady0 = ready;
    } else {
      updates.pregameReady1 = ready;
    }
    ctx.db.Game.id.update(updates);

    logAction(ctx, gameId, player.id, 'PREGAME_READY',
      JSON.stringify({ seat: player.seat.toString(), ready }),
      0n, 'pregame');

    if (!ready) return;

    const latestGame = ctx.db.Game.id.find(gameId);
    if (!latestGame) return;
    if (!latestGame.pregameReady0 || !latestGame.pregameReady1) return;

    // Both ready — load decks for both players first
    const allPlayers: any[] = [...ctx.db.Player.player_game_id.filter(gameId)];
    for (const p of allPlayers) {
      if (!p.pendingDeckData || p.pendingDeckData === '') {
        throw new SenderError('Player ' + p.displayName + ' has no deck data');
      }
      try { JSON.parse(p.pendingDeckData); } catch {
        throw new SenderError('Invalid deck data for ' + p.displayName);
      }
    }

    // Insert cards, shuffle, and draw opening hand for both players
    for (const p of allPlayers) {
      const currentGame = ctx.db.Game.id.find(gameId);
      if (!currentGame) throw new SenderError('Game not found');
      insertCardsShuffleDraw(ctx, currentGame, p, p.pendingDeckData);
      const latestPlayer = ctx.db.Player.id.find(p.id);
      if (latestPlayer) {
        ctx.db.Player.id.update({ ...latestPlayer, pendingDeckData: '' });
      }
    }

    // Paragon: populate the shared soul deck + 3 LoB souls at the same
    // moment player hands are dealt (idempotent — rematch-safe).
    const gameForSoulInit = ctx.db.Game.id.find(gameId);
    if (gameForSoulInit && normalizeFormat(gameForSoulInit.format) === 'Paragon') {
      initializeSoulDeck(ctx, gameForSoulInit);
    }

    // Now roll dice using single PRNG instance
    const gameAfterCards = ctx.db.Game.id.find(gameId);
    if (!gameAfterCards) return;
    const seed = makeSeed(
      ctx.timestamp.microsSinceUnixEpoch,
      gameId,
      0n,
      gameAfterCards.rngCounter
    );
    const rng = xorshift64(seed);

    let r0: number, r1: number;
    do {
      r0 = Number(rng.next() % 20n) + 1;
      r1 = Number(rng.next() % 20n) + 1;
    } while (r0 === r1);

    const winner = r0 > r1 ? '0' : '1';

    const CHOOSE_DEADLINE_MICROS = 30_000_000n;
    const gameBeforeRoll = ctx.db.Game.id.find(gameId);
    if (!gameBeforeRoll) return;
    ctx.db.Game.id.update({
      ...gameBeforeRoll,
      pregameReady0: false,
      pregameReady1: false,
      pregamePhase: 'rolling',
      rollResult0: BigInt(r0),
      rollResult1: BigInt(r1),
      rollWinner: winner,
      rngCounter: gameBeforeRoll.rngCounter + 1n,
      choosingDeadlineMicros: ctx.timestamp.microsSinceUnixEpoch + CHOOSE_DEADLINE_MICROS,
    });

    const winnerSeat = winner === '0' ? 0n : 1n;
    let winnerPlayerId = player.id;
    for (const p of [...ctx.db.Player.player_game_id.filter(gameId)]) {
      if (p.seat === winnerSeat) { winnerPlayerId = p.id; break; }
    }
    logAction(ctx, gameId, winnerPlayerId, 'PREGAME_ROLL',
      JSON.stringify({ result0: r0, result1: r1, winner }),
      0n, 'pregame');
  }
);

// ---------------------------------------------------------------------------
// Reducer: pregame_acknowledge_roll
// ---------------------------------------------------------------------------
export const pregame_acknowledge_roll = spacetimedb.reducer(
  {
    gameId: t.u64(),
  },
  (ctx, { gameId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'pregame') throw new SenderError('Game is not in pregame');
    if (game.pregamePhase !== 'rolling') throw new SenderError('Not in rolling phase');

    const player = findPlayerBySender(ctx, gameId);

    const updates: any = { ...game };
    if (player.seat === 0n) {
      updates.pregameReady0 = true;
    } else {
      updates.pregameReady1 = true;
    }
    ctx.db.Game.id.update(updates);

    const latestGame = ctx.db.Game.id.find(gameId);
    if (!latestGame) return;
    if (!latestGame.pregameReady0 || !latestGame.pregameReady1) return;

    ctx.db.Game.id.update({
      ...latestGame,
      pregamePhase: 'choosing',
    });

    // Paragon: populate the shared soul deck + 3 LoB souls now (instead of
    // at game-start) so they're already visible when the "choosing" / "reveal"
    // overlay dismisses.
    if (normalizeFormat(latestGame.format) === 'Paragon') {
      initializeSoulDeck(ctx, latestGame);
    }

    // Schedule server-side timeout — auto-choose if winner doesn't pick in 30s
    const CHOOSE_TIMEOUT_MICROS = 30_000_000n; // 30 seconds
    const futureTime = ctx.timestamp.microsSinceUnixEpoch + CHOOSE_TIMEOUT_MICROS;
    ctx.db.ChooseFirstTimeout.insert({
      scheduledId: 0n,
      scheduledAt: ScheduleAt.time(futureTime),
      gameId,
    });
  }
);

// ---------------------------------------------------------------------------
// Reducer: pregame_choose_first
// ---------------------------------------------------------------------------
export const pregame_choose_first = spacetimedb.reducer(
  {
    gameId: t.u64(),
    chosenSeat: t.u64(),
  },
  (ctx, { gameId, chosenSeat }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'pregame') throw new SenderError('Game is not in pregame');
    if (game.pregamePhase !== 'choosing') throw new SenderError('Not in choosing phase');
    if (chosenSeat !== 0n && chosenSeat !== 1n) throw new SenderError('Invalid seat');

    const player = findPlayerBySender(ctx, gameId);
    if (player.seat.toString() !== game.rollWinner) {
      throw new SenderError('Only the roll winner can choose');
    }

    // Cancel the server-side choose timeout
    for (const timeout of ctx.db.ChooseFirstTimeout.choose_first_timeout_game_id.filter(gameId)) {
      ctx.db.ChooseFirstTimeout.scheduledId.delete(timeout.scheduledId);
    }

    // Transition to revealing phase — show who goes first before starting
    const latestGame = ctx.db.Game.id.find(gameId);
    if (!latestGame) throw new SenderError('Game not found');
    // Paragon fallback: ensure soul deck is populated for games that missed
    // the acknowledge-roll init hook (idempotent).
    if (normalizeFormat(latestGame.format) === 'Paragon') {
      initializeSoulDeck(ctx, latestGame);
    }
    ctx.db.Game.id.update({
      ...latestGame,
      pregamePhase: 'revealing',
      currentTurn: chosenSeat,
      pregameReady0: false,
      pregameReady1: false,
    });
  }
);

// ---------------------------------------------------------------------------
// Reducer: pregame_acknowledge_first
// ---------------------------------------------------------------------------
export const pregame_acknowledge_first = spacetimedb.reducer(
  {
    gameId: t.u64(),
  },
  (ctx, { gameId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'pregame') throw new SenderError('Game is not in pregame');
    if (game.pregamePhase !== 'revealing') throw new SenderError('Not in revealing phase');

    const player = findPlayerBySender(ctx, gameId);

    // If already playing (other player beat us to it), just return
    const freshGame = ctx.db.Game.id.find(gameId);
    if (freshGame && freshGame.status === 'playing') return;

    // Mark this player as having acknowledged
    const isSeat0 = player.seat === 0n;
    const updatedGame = {
      ...game,
      pregameReady0: isSeat0 ? true : game.pregameReady0,
      pregameReady1: isSeat0 ? game.pregameReady1 : true,
    };

    const bothReady = updatedGame.pregameReady0 && updatedGame.pregameReady1;

    if (bothReady) {
      // Both players acknowledged — start the game
      const chosenSeat = game.currentTurn;
      const winnerSeat = game.rollWinner === '0' ? 0n : 1n;
      let chosenName = 'Player ' + (Number(chosenSeat) + 1);
      let winnerPlayerId = player.id;
      for (const p of [...ctx.db.Player.player_game_id.filter(gameId)]) {
        if (p.seat === chosenSeat) chosenName = p.displayName;
        if (p.seat === winnerSeat) winnerPlayerId = p.id;
      }

      // Paragon: soul deck is normally initialized earlier in the pregame
      // (see pregame_acknowledge_roll and pregame_skip_to_reveal). Call
      // again here as a final fallback; initializeSoulDeck is idempotent.
      if (normalizeFormat(game.format) === 'Paragon') {
        initializeSoulDeck(ctx, game);
      }

      ctx.db.Game.id.update({
        ...updatedGame,
        status: 'playing',
        pregamePhase: '',
        currentPhase: 'draw',
        turnNumber: 1n,
        playingStartedAtMicros: ctx.timestamp.microsSinceUnixEpoch,
      });

      logAction(ctx, gameId, winnerPlayerId, 'GAME_STARTED',
        JSON.stringify({ chosenSeat: chosenSeat.toString(), chosenName }),
        1n, 'draw');
    } else {
      // Only one player acknowledged so far — wait for the other
      ctx.db.Game.id.update(updatedGame);
    }
  }
);

// ---------------------------------------------------------------------------
// Reducer: pregame_skip_to_reveal
// Roll winner can acknowledge the roll AND choose who goes first in one step,
// skipping the choosing phase entirely. Both players' roll acknowledgments
// are force-set so the phase transition is immediate.
// ---------------------------------------------------------------------------
export const pregame_skip_to_reveal = spacetimedb.reducer(
  {
    gameId: t.u64(),
    chosenSeat: t.u64(),
  },
  (ctx, { gameId, chosenSeat }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'pregame') throw new SenderError('Game is not in pregame');
    if (game.pregamePhase !== 'rolling') throw new SenderError('Not in rolling phase');
    if (chosenSeat !== 0n && chosenSeat !== 1n) throw new SenderError('Invalid seat');

    const player = findPlayerBySender(ctx, gameId);
    if (player.seat.toString() !== game.rollWinner) {
      throw new SenderError('Only the roll winner can choose');
    }

    // Skip rolling acknowledgment + choosing phase → go straight to revealing
    const latestGame = ctx.db.Game.id.find(gameId);
    if (!latestGame) throw new SenderError('Game not found');
    ctx.db.Game.id.update({
      ...latestGame,
      pregamePhase: 'revealing',
      currentTurn: chosenSeat,
      pregameReady0: false,
      pregameReady1: false,
    });

    // Paragon: populate the shared soul deck + 3 LoB souls now so they're
    // already visible when the reveal overlay dismisses.
    if (normalizeFormat(latestGame.format) === 'Paragon') {
      initializeSoulDeck(ctx, latestGame);
    }
  }
);

// ---------------------------------------------------------------------------
// Reducer: pregame_change_deck
// ---------------------------------------------------------------------------
export const pregame_change_deck = spacetimedb.reducer(
  {
    gameId: t.u64(),
    deckId: t.string(),
    deckData: t.string(),
  },
  (ctx, { gameId, deckId, deckData }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    // Allow swap while waiting for opponent (status='waiting') OR during the
    // pregame deck-select phase. Both states are pre-shuffle, so swapping
    // pendingDeckData is safe.
    if (game.status !== 'pregame' && game.status !== 'waiting') {
      throw new SenderError('Game is not in pregame');
    }
    if (game.status === 'pregame' && game.pregamePhase !== 'deck_select') {
      throw new SenderError('Not in deck select phase');
    }

    const player = findPlayerBySender(ctx, gameId);

    const isReady = player.seat === 0n ? game.pregameReady0 : game.pregameReady1;
    if (isReady) throw new SenderError('Cannot change deck while ready');

    try {
      const parsed = JSON.parse(deckData);
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('not array or empty');
    } catch {
      throw new SenderError('Invalid deck data');
    }

    ctx.db.Player.id.update({ ...player, deckId, pendingDeckData: deckData });

    logAction(ctx, gameId, player.id, 'PREGAME_DECK_CHANGE',
      JSON.stringify({ seat: player.seat.toString(), newDeckId: deckId }),
      0n, 'pregame');
  }
);

// ===========================================================================
// Rematch reducers
// ===========================================================================

// ---------------------------------------------------------------------------
// Reducer: request_rematch
// ---------------------------------------------------------------------------
export const request_rematch = spacetimedb.reducer(
  {
    gameId: t.u64(),
    deckId: t.string(),
    deckData: t.string(),
    paragon: t.string(),
    format: t.string(),
  },
  (ctx, { gameId, deckId, deckData, paragon, format }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'finished') throw new SenderError('Game is not finished');
    if (game.rematchRequestedBy !== '') throw new SenderError('Rematch already requested');

    const player = findPlayerBySender(ctx, gameId);

    // Reject rematch with a deck in a different format than the original game
    const requesterFormat = normalizeFormat(format);
    const gameFormat = normalizeFormat(game.format);
    if (requesterFormat !== gameFormat) {
      throw new SenderError(
        `Rematch deck format (${requesterFormat}) must match original game format (${gameFormat})`
      );
    }

    // Validate deck data
    try {
      const parsed = JSON.parse(deckData);
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error();
    } catch {
      throw new SenderError('Invalid deck data');
    }

    const updates: any = { ...game, rematchRequestedBy: player.seat.toString() };
    if (player.seat === 0n) {
      updates.rematchDeckId0 = deckId;
      updates.rematchDeckData0 = deckData;
      updates.rematchParagon0 = paragon;
    } else {
      updates.rematchDeckId1 = deckId;
      updates.rematchDeckData1 = deckData;
      updates.rematchParagon1 = paragon;
    }
    ctx.db.Game.id.update(updates);

    logAction(ctx, gameId, player.id, 'REMATCH_REQUESTED',
      JSON.stringify({ seat: player.seat.toString() }),
      game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: respond_rematch
// ---------------------------------------------------------------------------
export const respond_rematch = spacetimedb.reducer(
  {
    gameId: t.u64(),
    accepted: t.bool(),
    deckId: t.string(),
    deckData: t.string(),
    paragon: t.string(),
    format: t.string(),
  },
  (ctx, { gameId, accepted, deckId, deckData, paragon, format }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'finished') throw new SenderError('Game is not finished');
    if (game.rematchRequestedBy === '') throw new SenderError('No rematch requested');
    if (game.rematchResponse !== '') throw new SenderError('Already responded');

    const player = findPlayerBySender(ctx, gameId);
    if (player.seat.toString() === game.rematchRequestedBy) {
      throw new SenderError('Cannot respond to your own rematch request');
    }

    if (accepted) {
      // Reject rematch acceptance with a format-mismatched deck
      const responderFormat = normalizeFormat(format);
      const gameFormat = normalizeFormat(game.format);
      if (responderFormat !== gameFormat) {
        throw new SenderError(
          `Rematch deck format (${responderFormat}) must match original game format (${gameFormat})`
        );
      }

      // Validate deck data
      try {
        const parsed = JSON.parse(deckData);
        if (!Array.isArray(parsed) || parsed.length === 0) throw new Error();
      } catch {
        throw new SenderError('Invalid deck data');
      }

      // Store responder's deck data
      const updates: any = { ...game, rematchResponse: 'accepted' };
      if (player.seat === 0n) {
        updates.rematchDeckId0 = deckId;
        updates.rematchDeckData0 = deckData;
        updates.rematchParagon0 = paragon;
      } else {
        updates.rematchDeckId1 = deckId;
        updates.rematchDeckData1 = deckData;
        updates.rematchParagon1 = paragon;
      }
      ctx.db.Game.id.update(updates);

      // ---- Reset the game in-place ----

      // 1. Delete all existing cards and counters
      for (const card of [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)]) {
        // Delete counters for this card
        for (const counter of [...ctx.db.CardCounter.card_counter_card_instance_id.filter(card.id)]) {
          ctx.db.CardCounter.id.delete(counter.id);
        }
        ctx.db.CardInstance.id.delete(card.id);
      }

      // 2. Update players with new deck data
      const allPlayers: any[] = [...ctx.db.Player.player_game_id.filter(gameId)];
      for (const p of allPlayers) {
        const latestGame = ctx.db.Game.id.find(gameId);
        if (!latestGame) throw new SenderError('Game not found');
        const newDeckId = p.seat === 0n ? latestGame.rematchDeckId0 : latestGame.rematchDeckId1;
        const newDeckData = p.seat === 0n ? latestGame.rematchDeckData0 : latestGame.rematchDeckData1;
        const newParagon = p.seat === 0n ? latestGame.rematchParagon0 : latestGame.rematchParagon1;
        ctx.db.Player.id.update({ ...p, deckId: newDeckId, paragon: newParagon, pendingDeckData: '' });

        // 3. Insert new cards, shuffle, draw opening hand
        const currentGame = ctx.db.Game.id.find(gameId);
        if (!currentGame) throw new SenderError('Game not found');
        insertCardsShuffleDraw(ctx, currentGame, p, newDeckData);
      }

      // 4. Roll dice for first player
      const gameAfterCards = ctx.db.Game.id.find(gameId);
      if (!gameAfterCards) throw new SenderError('Game not found');
      const seed = makeSeed(
        ctx.timestamp.microsSinceUnixEpoch,
        gameId,
        0n,
        gameAfterCards.rngCounter
      );
      const rng = xorshift64(seed);

      let r0: number, r1: number;
      do {
        r0 = Number(rng.next() % 20n) + 1;
        r1 = Number(rng.next() % 20n) + 1;
      } while (r0 === r1);

      const winner = r0 > r1 ? '0' : '1';

      // 5. Reset game to pregame/rolling
      const CHOOSE_DEADLINE_MICROS = 30_000_000n;
      const gameBeforeReset = ctx.db.Game.id.find(gameId);
      if (!gameBeforeReset) throw new SenderError('Game not found');
      ctx.db.Game.id.update({
        ...gameBeforeReset,
        status: 'pregame',
        pregamePhase: 'rolling',
        currentTurn: 0n,
        currentPhase: 'draw',
        turnNumber: 0n,
        lastDiceRoll: '',
        pregameReady0: false,
        pregameReady1: false,
        rollResult0: BigInt(r0),
        rollResult1: BigInt(r1),
        rollWinner: winner,
        rngCounter: gameBeforeReset.rngCounter + 1n,
        rematchRequestedBy: '',
        rematchDeckId0: '',
        rematchDeckData0: '',
        rematchDeckId1: '',
        rematchDeckData1: '',
        rematchParagon0: '',
        rematchParagon1: '',
        rematchResponse: '',
        rematchCode: '',
        choosingDeadlineMicros: ctx.timestamp.microsSinceUnixEpoch + CHOOSE_DEADLINE_MICROS,
        playingStartedAtMicros: 0n,
      });

      logAction(ctx, gameId, player.id, 'REMATCH_STARTED',
        JSON.stringify({ result0: r0, result1: r1, winner }),
        0n, 'pregame');
    } else {
      // Decline — clear all rematch fields so either player can re-initiate
      ctx.db.Game.id.update({
        ...game,
        rematchRequestedBy: '',
        rematchDeckId0: '',
        rematchDeckData0: '',
        rematchDeckId1: '',
        rematchDeckData1: '',
        rematchParagon0: '',
        rematchParagon1: '',
        rematchResponse: '',
        rematchCode: '',
      });
      logAction(ctx, gameId, player.id, 'REMATCH_DECLINED',
        JSON.stringify({ seat: player.seat.toString() }),
        game.turnNumber, game.currentPhase);
    }
  }
);

// ---------------------------------------------------------------------------
// Reducer: join_as_spectator
// ---------------------------------------------------------------------------
export const join_as_spectator = spacetimedb.reducer(
  {
    code: t.string(),
    displayName: t.string(),
  },
  (ctx, { code, displayName }) => {
    // Find game by code
    let game: any = null;
    for (const g of ctx.db.Game.game_code.filter(code)) {
      game = g;
      break;
    }
    if (!game) {
      throw new SenderError('No game found with that code');
    }

    ctx.db.Spectator.insert({
      id: 0n,
      gameId: game.id,
      identity: ctx.sender,
      displayName,
    });
  }
);

// ---------------------------------------------------------------------------
// Reducer: leave_game
// ---------------------------------------------------------------------------
export const leave_game = spacetimedb.reducer(
  {
    gameId: t.u64(),
  },
  (ctx, { gameId }) => {
    // Try to find as player first
    for (const player of ctx.db.Player.player_game_id.filter(gameId)) {
      if (player.identity.toHexString() === ctx.sender.toHexString()) {
        ctx.db.Player.id.update({ ...player, isConnected: false });

        // If the game is still in the lobby (waiting), finish it immediately
        // so it disappears from the lobby list right away.
        const game = ctx.db.Game.id.find(gameId);
        if (game && game.status === 'waiting') {
          ctx.db.Game.id.update({ ...game, status: 'finished' });
        }
        return;
      }
    }

    // Try to find as spectator
    for (const spectator of ctx.db.Spectator.spectator_game_id.filter(gameId)) {
      if (spectator.identity.toHexString() === ctx.sender.toHexString()) {
        ctx.db.Spectator.id.delete(spectator.id);
        return;
      }
    }

    throw new SenderError('Not a participant in this game');
  }
);

// ---------------------------------------------------------------------------
// Reducer: register_presence
// Called by the client whenever the game page is mounted AND the WebSocket
// is connected — initially and after every reconnect. Revives isConnected,
// cancels any pending DisconnectTimeout, and clears disconnectTimeoutFired.
// Silent no-op if the sender isn't in the game or the game is finished; this
// is the explicit signal that replaces the old blanket revive in
// clientConnected (which used to keep orphaned lobbies alive whenever the
// creator hit any other page on the site).
// ---------------------------------------------------------------------------
export const register_presence = spacetimedb.reducer(
  {
    gameId: t.u64(),
  },
  (ctx, { gameId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game || game.status === 'finished') return;

    for (const player of ctx.db.Player.player_game_id.filter(gameId)) {
      if (player.identity.toHexString() !== ctx.sender.toHexString()) continue;

      if (!player.isConnected) {
        ctx.db.Player.id.update({ ...player, isConnected: true });
      }

      for (const timeout of ctx.db.DisconnectTimeout.disconnect_timeout_player_id.filter(player.id)) {
        ctx.db.DisconnectTimeout.scheduledId.delete(timeout.scheduledId);
      }

      if (game.disconnectTimeoutFired) {
        ctx.db.Game.id.update({ ...game, disconnectTimeoutFired: false });
      }
      return;
    }
  }
);

// ---------------------------------------------------------------------------
// Reducer: resign_game
// ---------------------------------------------------------------------------
export const resign_game = spacetimedb.reducer(
  {
    gameId: t.u64(),
  },
  (ctx, { gameId }) => {
    const player = findPlayerBySender(ctx, gameId);

    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    ctx.db.Game.id.update({ ...game, status: 'finished' });

    logAction(
      ctx,
      gameId,
      player.id,
      'RESIGN',
      JSON.stringify({ resignedBy: player.displayName }),
      game.turnNumber,
      game.currentPhase
    );
  }
);

// ---------------------------------------------------------------------------
// Reducer: update_lobby_message
// ---------------------------------------------------------------------------
export const update_lobby_message = spacetimedb.reducer(
  {
    gameId: t.u64(),
    message: t.string(),
  },
  (ctx, { gameId, message }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'waiting') throw new SenderError('Game is not in waiting state');
    if (game.createdBy.toHexString() !== ctx.sender.toHexString()) {
      throw new SenderError('Only the game creator can update the lobby message');
    }
    ctx.db.Game.id.update({ ...game, lobbyMessage: message.slice(0, 100) });
  }
);

// ---------------------------------------------------------------------------
// Scheduled reducer: handle_disconnect_timeout
// ---------------------------------------------------------------------------
export const handle_disconnect_timeout = spacetimedb.reducer(
  { arg: DisconnectTimeout.rowType },
  (ctx, { arg }) => {
    const player = ctx.db.Player.id.find(arg.playerId);
    if (!player) return;

    // Only act if player is still disconnected
    if (!player.isConnected) {
      const game = ctx.db.Game.id.find(arg.gameId);
      if (game && game.status !== 'finished') {
        if (game.status === 'playing') {
          // Active game: set flag so remaining player can claim victory
          ctx.db.Game.id.update({ ...game, disconnectTimeoutFired: true });
          logAction(
            ctx,
            arg.gameId,
            arg.playerId,
            'DISCONNECT_TIMEOUT_WARNING',
            JSON.stringify({ reason: 'disconnect_timeout' }),
            game.turnNumber,
            game.currentPhase
          );
        } else {
          // Waiting/pregame: end game immediately
          ctx.db.Game.id.update({ ...game, status: 'finished' });
          logAction(
            ctx,
            arg.gameId,
            arg.playerId,
            'TIMEOUT',
            JSON.stringify({ reason: 'disconnect_timeout' }),
            game.turnNumber,
            game.currentPhase
          );
        }
      }
    }
  }
);

// Wire the scheduled reducer to the schema's forward reference
setDisconnectTimeoutReducer(handle_disconnect_timeout);

// ---------------------------------------------------------------------------
// Reducer: claim_timeout_victory
// Called by the remaining connected player after disconnectTimeoutFired is set
// ---------------------------------------------------------------------------
export const claim_timeout_victory = spacetimedb.reducer(
  { gameId: t.u64() },
  (ctx, { gameId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');
    if (!game.disconnectTimeoutFired) throw new SenderError('Disconnect timeout has not fired');

    const player = findPlayerBySender(ctx, gameId);
    if (!player.isConnected) throw new SenderError('Only the connected player can claim victory');

    ctx.db.Game.id.update({ ...game, status: 'finished', disconnectTimeoutFired: false });
    logAction(ctx, gameId, player.id, 'TIMEOUT', JSON.stringify({ reason: 'claimed_by_opponent' }), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Scheduled reducer: handle_choose_first_timeout
// If the roll winner hasn't chosen in time, auto-select them to go first.
// ---------------------------------------------------------------------------
export const handle_choose_first_timeout = spacetimedb.reducer(
  { arg: ChooseFirstTimeout.rowType },
  (ctx, { arg }) => {
    const game = ctx.db.Game.id.find(arg.gameId);
    if (!game) return;

    // Only act if game is still in choosing phase
    if (game.status !== 'pregame' || game.pregamePhase !== 'choosing') return;

    // Auto-choose: roll winner goes first
    const winnerSeat = BigInt(game.rollWinner);
    ctx.db.Game.id.update({
      ...game,
      pregamePhase: 'revealing',
      currentTurn: winnerSeat,
      pregameReady0: false,
      pregameReady1: false,
    });
  }
);

setChooseFirstTimeoutReducer(handle_choose_first_timeout);

// ---------------------------------------------------------------------------
// Scheduled reducer: cleanup_stale_games
// ---------------------------------------------------------------------------
const FIVE_MIN_MICROS = 300_000_000n;
const ONE_HOUR_MICROS = 3_600_000_000n;
const THIRTY_MIN_MICROS = 1_800_000_000n;
const TWENTY_FOUR_HOURS_MICROS = 86_400_000_000n;

export const cleanup_stale_games = spacetimedb.reducer(
  { arg: CleanupSchedule.rowType },
  (ctx, { arg }) => {
    const now = ctx.timestamp.microsSinceUnixEpoch;

    // Always reschedule first — if cleanup logic throws, the chain must not break
    ctx.db.CleanupSchedule.insert({
      scheduledId: 0n,
      scheduledAt: ScheduleAt.time(now + ONE_HOUR_MICROS),
    });

    // Single scan — branch on status. Previously we scanned Game four times;
    // merging keeps one sequential pass and the same semantics (a waiting
    // game >24h old becomes 'finished' here and is eligible for deletion in
    // the same pass because we re-check status per row).
    for (const game of [...ctx.db.Game.iter()]) {
      const age = now - game.createdAt.microsSinceUnixEpoch;

      // 1. Abandon waiting games older than 1 hour
      if (game.status === 'waiting' && age > ONE_HOUR_MICROS) {
        ctx.db.Game.id.update({ ...game, status: 'finished' });
        continue;
      }

      // 2. Abandon pregame games older than 30 minutes
      if (game.status === 'pregame' && age > THIRTY_MIN_MICROS) {
        ctx.db.Game.id.update({ ...game, status: 'finished' });
        continue;
      }

      // 3. Abandon playing games where both players disconnected, no recent activity
      if (game.status === 'playing') {
        const players = [...ctx.db.Player.player_game_id.filter(game.id)];
        const allDisconnected = players.length > 0 && players.every((p: any) => !p.isConnected);
        if (!allDisconnected) continue;

        let latestActionTime = 0n;
        for (const action of ctx.db.GameAction.game_action_game_id.filter(game.id)) {
          const actionTime = action.timestamp.microsSinceUnixEpoch;
          if (actionTime > latestActionTime) latestActionTime = actionTime;
        }
        if (latestActionTime === 0n) latestActionTime = game.createdAt.microsSinceUnixEpoch;

        if ((now - latestActionTime) > THIRTY_MIN_MICROS) {
          ctx.db.Game.id.update({ ...game, status: 'finished' });
        }
        continue;
      }

      // 4. Delete data for finished games older than 24 hours
      if (game.status !== 'finished') continue;
      if (age <= TWENTY_FOUR_HOURS_MICROS) continue;

      const gameId = game.id;

      for (const card of [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)]) {
        for (const counter of [...ctx.db.CardCounter.card_counter_card_instance_id.filter(card.id)]) {
          ctx.db.CardCounter.id.delete(counter.id);
        }
        ctx.db.CardInstance.id.delete(card.id);
      }
      for (const action of [...ctx.db.GameAction.game_action_game_id.filter(gameId)]) {
        ctx.db.GameAction.id.delete(action.id);
      }
      for (const msg of [...ctx.db.ChatMessage.chat_message_game_id.filter(gameId)]) {
        ctx.db.ChatMessage.id.delete(msg.id);
      }
      for (const spec of [...ctx.db.Spectator.spectator_game_id.filter(gameId)]) {
        ctx.db.Spectator.id.delete(spec.id);
      }
      for (const req of [...ctx.db.ZoneSearchRequest.zone_search_request_game_id.filter(gameId)]) {
        ctx.db.ZoneSearchRequest.id.delete(req.id);
      }
      for (const player of [...ctx.db.Player.player_game_id.filter(gameId)]) {
        ctx.db.Player.id.delete(player.id);
      }
      ctx.db.Game.id.delete(gameId);
    }
  }
);

setCleanupStaleGamesReducer(cleanup_stale_games);

// ===========================================================================
// Turn / Phase reducers
// ===========================================================================

// ---------------------------------------------------------------------------
// Reducer: set_phase
// ---------------------------------------------------------------------------
export const set_phase = spacetimedb.reducer(
  {
    gameId: t.u64(),
    phase: t.string(),
  },
  (ctx, { gameId, phase }) => {
    const player = findPlayerBySender(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    if (player.seat !== game.currentTurn) {
      throw new SenderError('Not your turn');
    }

    const validPhases = ['draw', 'upkeep', 'preparation', 'battle', 'discard'];
    if (!validPhases.includes(phase)) {
      throw new SenderError('Invalid phase: ' + phase);
    }

    ctx.db.Game.id.update({ ...game, currentPhase: phase });

    logAction(ctx, gameId, player.id, 'SET_PHASE', JSON.stringify({ phase }), game.turnNumber, phase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: end_turn
// ---------------------------------------------------------------------------
export const end_turn = spacetimedb.reducer(
  {
    gameId: t.u64(),
  },
  (ctx, { gameId }) => {
    const player = findPlayerBySender(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    if (player.seat !== game.currentTurn) {
      throw new SenderError('Not your turn');
    }

    const nextSeat = game.currentTurn === 0n ? 1n : 0n;
    // Only increment the turn number when both players have gone (seat 1 finishes → back to seat 0)
    const newTurnNumber = nextSeat === 0n ? game.turnNumber + 1n : game.turnNumber;

    ctx.db.Game.id.update({
      ...game,
      currentTurn: nextSeat,
      currentPhase: 'draw',
      turnNumber: newTurnNumber,
    });

    // Find the new active player
    let newActivePlayer: any = null;
    for (const p of ctx.db.Player.player_game_id.filter(gameId)) {
      if (p.seat === nextSeat) {
        newActivePlayer = p;
        break;
      }
    }

    if (newActivePlayer) {
      const latestGame = ctx.db.Game.id.find(gameId);
      drawCardsForPlayer(ctx, latestGame, newActivePlayer, 3);
    }

    // Paragon: refill the shared LoB back to 3 at the start of the new turn.
    if (normalizeFormat(game.format) === 'Paragon') {
      refillSoulDeck(ctx, gameId);
    }

    logAction(ctx, gameId, player.id, 'END_TURN', JSON.stringify({ newTurn: newTurnNumber.toString() }), newTurnNumber, 'draw');
  }
);

// ===========================================================================
// Card action reducers
// ===========================================================================

// ---------------------------------------------------------------------------
// Reducer: draw_card
// ---------------------------------------------------------------------------
export const draw_card = spacetimedb.reducer(
  {
    gameId: t.u64(),
  },
  (ctx, { gameId }) => {
    const player = findPlayerBySender(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    drawCardsForPlayer(ctx, game, player, 1);

    logAction(ctx, gameId, player.id, 'DRAW', '', game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: draw_multiple
// ---------------------------------------------------------------------------
export const draw_multiple = spacetimedb.reducer(
  {
    gameId: t.u64(),
    count: t.u64(),
  },
  (ctx, { gameId, count }) => {
    const player = findPlayerBySender(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const result = drawCardsForPlayer(ctx, game, player, Number(count));

    // If every card was an auto-routed Lost Soul, the per-card MOVE_CARD logs
    // already tell the story — skip the redundant "drew 0 cards" entry.
    if (result.drawn > 0) {
      logAction(ctx, gameId, player.id, 'DRAW_MULTIPLE', JSON.stringify({ count: result.drawn.toString(), cards: result.cards }), game.turnNumber, game.currentPhase);
    }
  }
);

// ---------------------------------------------------------------------------
// Reducer: move_card
// ---------------------------------------------------------------------------
export const move_card = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
    toZone: t.string(),
    zoneIndex: t.string(),
    posX: t.string(),
    posY: t.string(),
    targetOwnerId: t.string(),
  },
  (ctx, { gameId, cardInstanceId, toZone, zoneIndex, posX, posY, targetOwnerId }) => {
    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    // Allow moves by either player (cards move between zones during battles/captures)
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');

    const fromZone = card.zone;
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    // Materialize the game's CardInstance rows once. Reused for the various
    // zoneIndex / accessory / hand-count lookups below instead of issuing a
    // fresh `[...filter(gameId)]` per branch. The compact helpers also accept
    // this snapshot via `gameCardsHint`. Snapshot is taken pre-mutation, so
    // any helper that runs after the main update must pass `excludeId` so the
    // moved card's stale (pre-move) zone is ignored.
    const gameCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)];

    // Tokens dropped into non-play zones are deleted, not moved.
    // Parallels the goldfish cleanup rule at gameReducer.ts:92. Runs BEFORE the
    // lost-soul redirect so tokens always delete (never redirect to LOB) even if
    // they happen to be lost-soul-typed.
    const TOKEN_REMOVE_ZONES = ['reserve', 'banish', 'discard', 'hand', 'deck'];
    if (card.isToken && TOKEN_REMOVE_ZONES.includes(toZone)) {
      for (const counter of [...ctx.db.CardCounter.card_counter_card_instance_id.filter(cardInstanceId)]) {
        ctx.db.CardCounter.id.delete(counter.id);
      }
      ctx.db.CardInstance.id.delete(cardInstanceId);
      if (fromZone === 'hand') compactHandIndices(ctx, gameId, card.ownerId, gameCards, cardInstanceId);
      if (fromZone === 'land-of-bondage') compactLobIndices(ctx, gameId, card.ownerId, gameCards, cardInstanceId);
      logAction(
        ctx, gameId, player.id, 'MOVE_CARD',
        JSON.stringify({
          cardInstanceId: cardInstanceId.toString(),
          from: fromZone,
          to: toZone,
          cardName: card.cardName,
          cardImgFile: card.cardImgFile,
          tokenCleanup: true,
        }),
        game.turnNumber, game.currentPhase,
      );
      return;
    }

    // Home zones = private per-player piles. When a card heads home without an
    // explicit targetOwnerId, route to its original owner so taken opponent
    // cards return to the opponent's piles, not the controller's.
    const HOME_ZONES = ['deck', 'discard', 'reserve', 'banish', 'hand', 'land-of-bondage'];
    const homeOwnerId = card.originalOwnerId !== 0n ? card.originalOwnerId : card.ownerId;

    // Lost souls sent to discard or reserve go to land-of-bondage instead
    const isLostSoul = card.cardType === 'LS' || card.cardName.toLowerCase().includes('lost soul');
    if (isLostSoul && (toZone === 'discard' || toZone === 'reserve' || toZone === 'banish')) {
      // A drop on the actor's own pile routes home; an explicit drop on
      // someone else's pile honors the caller's choice.
      const droppedOnOwnZone = !targetOwnerId || BigInt(targetOwnerId) === player.id;
      const lobOwnerId = droppedOnOwnZone ? homeOwnerId : BigInt(targetOwnerId);
      const lobIndex = BigInt(
        gameCards.filter(
          (c: any) => c.ownerId === lobOwnerId && c.zone === 'land-of-bondage'
        ).length
      );
      clearCountersIfLeavingPlay(ctx, card.id, fromZone, 'land-of-bondage');
      ctx.db.CardInstance.id.update({
        ...card,
        zone: 'land-of-bondage',
        zoneIndex: lobIndex,
        posX: '',
        posY: '',
        isFlipped: false,
        ownerId: lobOwnerId,
        ...leavePlayFieldOverrides(card, fromZone, 'land-of-bondage'),
      });
      const actionWord = toZone === 'discard' ? 'discarded' : toZone === 'reserve' ? 'reserved' : 'banished';
      const redirectLogName = card.cardName;
      const redirectLogImg = card.cardImgFile;
      logAction(ctx, gameId, player.id, 'MOVE_CARD', JSON.stringify({ cardInstanceId: cardInstanceId.toString(), from: fromZone, to: 'land-of-bondage', cardName: redirectLogName, cardImgFile: redirectLogImg, redirected: actionWord }), game.turnNumber, game.currentPhase);
      // Compact hand indices if card left hand
      if (fromZone === 'hand') {
        compactHandIndices(ctx, gameId, card.ownerId, gameCards, cardInstanceId);
      }
      // Compact LOB indices if card left LOB
      if (fromZone === 'land-of-bondage') {
        compactLobIndices(ctx, gameId, card.ownerId, gameCards, cardInstanceId);
      }
      return;
    }

    // Moving to deck/soul-deck = face-down; leaving deck, reserve, or soul-deck = face-up; otherwise preserve
    const isFlipped = (toZone === 'deck' || toZone === 'soul-deck') ? true : (fromZone === 'deck' || fromZone === 'reserve' || fromZone === 'soul-deck') ? false : card.isFlipped;
    // Optionally transfer ownership (e.g. rescue lost soul, capture hero).
    // For private home zones, route to the original owner so opponent-owned
    // cards return to their real owner's piles even when the actor dropped
    // them on their own zone (e.g. banishing a captured opponent card on my
    // banish pile sends it to the opponent's banish). An explicit drop on
    // someone else's zone (targetOwnerId ≠ actor) still wins, so "give to
    // opponent's hand" works as intended.
    // Explicit LoB drops are unambiguous user intent — the player dragged the
    // card onto a specific seat's LoB. Honor targetOwnerId without applying
    // home-routing, which would otherwise redirect opponent-owned cards back
    // to the opponent's LoB even when the user dropped on their own.
    const isExplicitLobDrop =
      toZone === 'land-of-bondage' && !!targetOwnerId;

    let newOwnerId: bigint;
    if (isExplicitLobDrop) {
      newOwnerId = BigInt(targetOwnerId);
    } else if (HOME_ZONES.includes(toZone)) {
      const droppedOnOwnZone = !targetOwnerId || BigInt(targetOwnerId) === player.id;
      newOwnerId = droppedOnOwnZone ? homeOwnerId : BigInt(targetOwnerId);
    } else if (targetOwnerId) {
      newOwnerId = BigInt(targetOwnerId);
    } else {
      newOwnerId = card.ownerId;
    }
    // Paragon: dropping a soul-origin card back into the shared LoB resets ownership to the shared sentinel.
    if (
      targetOwnerId === '0' &&
      card.isSoulDeckOrigin === true &&
      toZone === 'land-of-bondage'
    ) {
      newOwnerId = 0n;
    }

    // Paragon: rescuing a shared soul transfers ownership. Default to the
    // acting seat (self-rescue), but honor an explicit targetOwnerId when the
    // caller dragged the soul into a specific player's zone (e.g. opponent's
    // LoR or opponent's Territory).
    let resolvedOwnerId = newOwnerId;
    if (
      card.ownerId === 0n &&
      card.isSoulDeckOrigin === true &&
      card.zone === 'land-of-bondage' &&
      toZone !== 'land-of-bondage' &&
      toZone !== 'soul-deck' &&
      !targetOwnerId
    ) {
      resolvedOwnerId = player.id;
    }

    // For free-form zones (territory), auto-assign highest zoneIndex so new cards render on top
    let finalZoneIndex = zoneIndex ? BigInt(zoneIndex) : 0n;
    if (!zoneIndex && toZone !== 'deck' && toZone !== 'hand') {
      let maxIdx = -1n;
      for (const c of gameCards) {
        if (c.ownerId === (newOwnerId) && c.zone === toZone && c.zoneIndex > maxIdx) {
          maxIdx = c.zoneIndex;
        }
      }
      finalZoneIndex = maxIdx + 1n;
    }

    // Paragon shared LoB: zoneIndexes are slot-preserving (gaps stay open so
    // remaining souls don't shift when one is rescued). Override the simple
    // maxIdx+1 assignment above to find the first empty slot in [0..2] first,
    // only falling back to maxIdx+1 when the canonical slots are all occupied.
    if (!zoneIndex && toZone === 'land-of-bondage' && newOwnerId === 0n) {
      const sharedLob = gameCards.filter(
        (c: any) => c.ownerId === 0n && c.zone === 'land-of-bondage' && c.id !== cardInstanceId
      );
      const occupied = new Set<bigint>(sharedLob.map((c: any) => c.zoneIndex));
      let chosen: bigint | null = null;
      for (let i = 0n; i < 3n; i++) {
        if (!occupied.has(i)) { chosen = i; break; }
      }
      if (chosen === null) {
        let maxIdx = -1n;
        for (const c of sharedLob) {
          if (c.zoneIndex > maxIdx) maxIdx = c.zoneIndex;
        }
        chosen = maxIdx + 1n;
      }
      finalZoneIndex = chosen;
    }
    if (!zoneIndex && toZone === 'hand') {
      finalZoneIndex = BigInt(
        gameCards.filter(
          (c: any) => c.ownerId === newOwnerId && c.zone === 'hand'
        ).length
      );
    }

    // Paragon: inserting into the soul deck at a specific index shifts the
    // existing shared soul-deck cards at that index and above up by 1 — same
    // semantics as move_card_to_top_of_deck. Without this, a "topdeck" would
    // duplicate index 0 and a later "draw top" would pull an arbitrary card.
    if (toZone === 'soul-deck' && zoneIndex) {
      const insertIdx = BigInt(zoneIndex);
      const soulDeckCards = gameCards.filter(
        (c: any) => c.ownerId === 0n && c.zone === 'soul-deck' && c.id !== cardInstanceId
      );
      for (const sc of soulDeckCards) {
        if (sc.zoneIndex >= insertIdx) {
          ctx.db.CardInstance.id.update({ ...sc, zoneIndex: sc.zoneIndex + 1n });
        }
      }
    }

    // Auto-unlink cascade: when the mover leaves its current zone, clear its
    // own equippedTo and cascade to any accessories pointing at it.
    //
    // Redemption rule: a warrior going from Territory to LOB drags its weapons
    // to Discard. All other host-leaves-zone cases (soul rescued from LOB,
    // same-zone reposition, etc.) just unlink accessories in place.
    const leavingZone = toZone !== fromZone || resolvedOwnerId !== card.ownerId;
    const clearEquippedOnMover = leavingZone && card.equippedToInstanceId !== 0n;

    // Cards landing in a hand via an identity-revealing move (cross-player
    // takes, face-up tutors, etc.) flash face-up briefly. Mirrors the same
    // hideIdentity rule used for the log below so the visual reveal matches
    // the log entry.
    const isCrossPlayerMove = player.id !== card.ownerId || player.id !== newOwnerId;
    const hideIdentity = !isCrossPlayerMove && (isFlipped ||
      (fromZone === 'hand' && (toZone === 'deck' || toZone === 'reserve') && player.id === card.ownerId));
    const autoReveal = toZone === 'hand' && fromZone !== 'hand' && !hideIdentity;
    const newRevealExpiresAt = autoReveal
      ? new Timestamp(ctx.timestamp.microsSinceUnixEpoch + AUTO_REVEAL_HAND_MICROS)
      : undefined;
    const newRevealStartedAt = autoReveal ? ctx.timestamp : undefined;

    clearCountersIfLeavingPlay(ctx, card.id, fromZone, toZone);
    ctx.db.CardInstance.id.update({
      ...card,
      zone: toZone,
      zoneIndex: finalZoneIndex,
      posX,
      posY,
      isFlipped,
      ownerId: resolvedOwnerId,
      equippedToInstanceId: clearEquippedOnMover ? 0n : card.equippedToInstanceId,
      revealExpiresAt: newRevealExpiresAt,
      revealStartedAt: newRevealStartedAt,
      ...leavePlayFieldOverrides(card, fromZone, toZone),
    });

    if (leavingZone) {
      const sendAccessoriesToDiscard =
        fromZone === 'territory' && toZone === 'land-of-bondage';
      const attachedAccessories = gameCards.filter(
        (c: any) => c.equippedToInstanceId === cardInstanceId
      );
      for (const accessory of attachedAccessories) {
        if (sendAccessoriesToDiscard) {
          // Warrior dragged to LOB — weapons go to Discard.
          let maxDiscardIdx = -1n;
          for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
            if (c.ownerId === accessory.ownerId && c.zone === 'discard' && c.zoneIndex > maxDiscardIdx) {
              maxDiscardIdx = c.zoneIndex;
            }
          }
          clearCountersIfLeavingPlay(ctx, accessory.id, accessory.zone, 'discard');
          ctx.db.CardInstance.id.update({
            ...accessory,
            zone: 'discard',
            zoneIndex: maxDiscardIdx + 1n,
            posX: '',
            posY: '',
            equippedToInstanceId: 0n,
            revealExpiresAt: undefined,
      revealStartedAt: undefined,
            ...leavePlayFieldOverrides(accessory, accessory.zone, 'discard'),
          });
        } else {
          ctx.db.CardInstance.id.update({ ...accessory, equippedToInstanceId: 0n });
        }
      }
    }

    // Log when the card changes zones OR changes ownership (e.g. territory → opponent's territory)
    const ownerChanged = newOwnerId !== card.ownerId;
    if (fromZone !== toZone || ownerChanged) {
      // hideIdentity (computed above) decides whether the log reveals the
      // card name. Same flag drives the auto-reveal in hand.
      const logName = hideIdentity ? 'a face-down card' : card.cardName;
      const logImg = hideIdentity ? '' : card.cardImgFile;
      logAction(ctx, gameId, player.id, 'MOVE_CARD', JSON.stringify({ cardInstanceId: cardInstanceId.toString(), from: fromZone, to: toZone, cardName: logName, cardImgFile: logImg, targetOwnerId: resolvedOwnerId.toString() }), game.turnNumber, game.currentPhase);
      // Compact hand indices if card left hand
      if (fromZone === 'hand') {
        compactHandIndices(ctx, gameId, card.ownerId, gameCards, cardInstanceId);
      }
      // Compact LOB indices if card left LOB
      if (fromZone === 'land-of-bondage') {
        compactLobIndices(ctx, gameId, card.ownerId, gameCards, cardInstanceId);
      }
    }

    // Paragon: refill the shared LoB only when a soul-origin card is rescued
    // into a land-of-redemption. Drag-back, soul-deck round-trips, and other
    // destinations leave the LoB short and do not refill.
    const triggeredRefill =
      normalizeFormat(game.format) === 'Paragon' &&
      card.isSoulDeckOrigin === true &&
      card.zone === 'land-of-bondage' &&
      toZone === 'land-of-redemption';
    if (triggeredRefill) {
      refillSoulDeck(ctx, game.id);
    }
  }
);

// ---------------------------------------------------------------------------
// Reducer: move_cards_batch
// ---------------------------------------------------------------------------
export const move_cards_batch = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceIds: t.string(),
    toZone: t.string(),
    positions: t.string(),
    targetOwnerId: t.string(),
    fromSource: t.string(),
  },
  (ctx, { gameId, cardInstanceIds, toZone, positions, targetOwnerId, fromSource }) => {
    const player = findPlayerBySender(ctx, gameId);

    const ids: string[] = JSON.parse(cardInstanceIds);
    const posMap: Record<string, { posX: string; posY: string }> = positions ? JSON.parse(positions) : {};
    const newOwnerId = targetOwnerId ? BigInt(targetOwnerId) : null;
    const batchIdSet = new Set(ids.map((s) => BigInt(s)));
    const cards: { name: string; img: string }[] = [];
    const movedCards: { name: string; img: string; from: string }[] = [];
    const redirectedLostSouls: { name: string; img: string }[] = [];
    // If cards being moved belong to someone other than the actor (e.g. the
    // requester is acting on the opponent's deck through an approved request),
    // record that owner so the log can say "from X's deck" instead of just
    // "from top of deck".
    let sourceOwnerId: bigint | null = null;
    const handCompactOwners = new Set<bigint>(); // Track owners whose hand needs compaction
    const lobCompactOwners = new Set<bigint>(); // Track owners whose LOB needs compaction
    // Paragon: track whether any card in this batch was a soul-origin card
    // rescued from the shared LoB into a land-of-redemption. Only those rescues
    // trigger a soul-deck refill.
    let anyRescueToLor = false;

    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    // When drawing from the acting player's own deck into hand, we need to
    // replicate the top-of-deck auto-route behavior: a drawn Lost Soul (with
    // autoRouteLostSouls on) is redirected to Land of Bondage and a replacement
    // is pulled from the same end of the deck. `needsReplacementSupport` gates
    // the extra bookkeeping below.
    const needsReplacementSupport =
      toZone === 'hand' &&
      (fromSource === 'top-of-deck' || fromSource === 'bottom-of-deck' || fromSource === 'random-from-deck');
    let replacementDeckPool: any[] = [];
    const usedReplacementIds = new Set<bigint>(ids.map((s) => BigInt(s)));
    if (needsReplacementSupport) {
      replacementDeckPool = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)]
        .filter((c: any) => c.ownerId === player.id && c.zone === 'deck')
        .sort((a: any, b: any) => (a.zoneIndex < b.zoneIndex ? -1 : a.zoneIndex > b.zoneIndex ? 1 : 0));
    }
    const pickReplacementId = (): string | null => {
      if (!needsReplacementSupport) return null;
      // Bottom-of-deck walks from the highest zoneIndex down; top-of-deck and
      // random (best-effort) walk from the lowest. All three skip cards already
      // consumed by the batch or by earlier replacements.
      if (fromSource === 'bottom-of-deck') {
        for (let i = replacementDeckPool.length - 1; i >= 0; i--) {
          const candidate = replacementDeckPool[i];
          if (!usedReplacementIds.has(candidate.id)) {
            usedReplacementIds.add(candidate.id);
            return candidate.id.toString();
          }
        }
      } else {
        for (let i = 0; i < replacementDeckPool.length; i++) {
          const candidate = replacementDeckPool[i];
          if (!usedReplacementIds.has(candidate.id)) {
            usedReplacementIds.add(candidate.id);
            return candidate.id.toString();
          }
        }
      }
      return null;
    };

    // Accessory cascade pre-pass: redirect accessories-whose-host-is-in-the-batch
    // to Discard only for the warrior→LOB case (host in Territory, batch going
    // to LOB). All other cross-zone scenarios let the accessory travel with
    // the batch (or unlink in place, handled below).
    //
    // We also capture each mover's original zone here so the post-pass cascade
    // can distinguish "actually left zone" from "same-zone reposition".
    const finalZoneById = new Map<string, string>();
    const originalZoneById = new Map<string, string>();
    const originalOwnerById = new Map<string, bigint>();
    for (const idStr of ids) {
      const c = ctx.db.CardInstance.id.find(BigInt(idStr));
      if (!c) continue;
      originalZoneById.set(idStr, c.zone);
      originalOwnerById.set(idStr, c.ownerId);
      const redirected =
        c.zone === 'territory' &&
        toZone === 'land-of-bondage' &&
        c.equippedToInstanceId !== 0n &&
        batchIdSet.has(c.equippedToInstanceId);
      finalZoneById.set(idStr, redirected ? 'discard' : toZone);
    }

    // For free-form zones (territory), pre-compute the current max zoneIndex
    // so new cards render on top of existing ones. Each card in the batch
    // gets an incrementing index starting from maxIdx + 1.
    const isFreeFormTarget = toZone !== 'deck' && toZone !== 'hand';
    // Auto-fan counter: when cards are dropped into territory without explicit
    // positions (e.g. batch moves from search/browse modals), stagger them so
    // they don't pile on top of each other at the zone origin.
    let autoFanIndex = 0;
    let nextFreeFormIndex = 0n;
    if (isFreeFormTarget) {
      let maxIdx = -1n;
      // Determine the owner we'll compute max against (use first card's resolved owner)
      let resolvedOwner = newOwnerId;
      if (resolvedOwner === null) {
        const firstCard = ctx.db.CardInstance.id.find(BigInt(ids[0]));
        resolvedOwner = firstCard ? firstCard.ownerId : 0n;
      }
      for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
        if (c.ownerId === resolvedOwner && c.zone === toZone && c.zoneIndex > maxIdx) {
          maxIdx = c.zoneIndex;
        }
      }
      nextFreeFormIndex = maxIdx + 1n;
    }

    for (const idStr of ids) {
      const cardId = BigInt(idStr);
      const card = ctx.db.CardInstance.id.find(cardId);
      if (!card) throw new SenderError('Card not found: ' + idStr);
      // Allow moves by either player in the game (cards move between zones during battles)
      if (card.gameId !== gameId) throw new SenderError('Card not in this game: ' + idStr);

      // Moving to deck/soul-deck = face-down; leaving deck, reserve, or soul-deck = face-up; otherwise preserve
      const isFlipped = (toZone === 'deck' || toZone === 'soul-deck') ? true : (card.zone === 'deck' || card.zone === 'reserve' || card.zone === 'soul-deck') ? false : card.isFlipped;

      // Hide card identity only when the owner moves their own hand card to a
      // hidden zone. Cross-player moves (sender ≠ source owner or sender ≠
      // destination owner) reveal the card — both players witness the move
      // on-screen, so the log should match.
      const cardNewOwnerId = newOwnerId ?? card.ownerId;
      const isCrossPlayerMove = player.id !== card.ownerId || player.id !== cardNewOwnerId;
      const hideIdentity = !isCrossPlayerMove && (isFlipped ||
        (card.zone === 'hand' && (toZone === 'deck' || toZone === 'reserve') && player.id === card.ownerId));
      const logName = hideIdentity ? 'a face-down card' : card.cardName;
      const logImg = hideIdentity ? '' : card.cardImgFile;
      cards.push({ name: logName, img: logImg });
      if (sourceOwnerId === null && card.ownerId !== player.id) {
        sourceOwnerId = card.ownerId;
      }
      const cardOwnerChanged = newOwnerId !== null && newOwnerId !== card.ownerId;
      if (card.zone !== toZone || cardOwnerChanged) {
        movedCards.push({ name: logName, img: logImg, from: card.zone });
        if (card.zone === 'hand') {
          handCompactOwners.add(card.ownerId);
        }
        if (card.zone === 'land-of-bondage') {
          lobCompactOwners.add(card.ownerId);
        }
      }

      // Home zones = private per-player piles. Route to original owner when
      // no explicit target is set so taken opponent cards return home.
      const HOME_ZONES = ['deck', 'discard', 'reserve', 'banish', 'hand', 'land-of-bondage'];
      const homeOwnerId = card.originalOwnerId !== 0n ? card.originalOwnerId : card.ownerId;

      // Lost souls sent to discard or reserve go to land-of-bondage instead
      const isLostSoul = card.cardType === 'LS' || card.cardName.toLowerCase().includes('lost soul');
      if (isLostSoul && (toZone === 'discard' || toZone === 'reserve' || toZone === 'banish')) {
        const droppedOnOwnZone = newOwnerId === null || newOwnerId === player.id;
        const lobOwnerId = droppedOnOwnZone ? homeOwnerId : newOwnerId;
        const lobIndex = BigInt(
          [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
            (c: any) => c.ownerId === lobOwnerId && c.zone === 'land-of-bondage'
          ).length
        );
        clearCountersIfLeavingPlay(ctx, card.id, card.zone, 'land-of-bondage');
        ctx.db.CardInstance.id.update({
          ...card,
          zone: 'land-of-bondage',
          zoneIndex: lobIndex,
          posX: '',
          posY: '',
          isFlipped: false,
          ownerId: lobOwnerId,
          ...leavePlayFieldOverrides(card, card.zone, 'land-of-bondage'),
        });
        redirectedLostSouls.push({ name: logName, img: logImg });
        continue;
      }

      // Drawing a Lost Soul from your own deck routes it to Land of Bondage
      // and pulls a replacement from the same end of the deck — same rule as
      // top-of-deck auto-route in drawCardsForPlayer.
      if (
        isLostSoul &&
        needsReplacementSupport &&
        card.zone === 'deck' &&
        card.ownerId === player.id &&
        player.autoRouteLostSouls
      ) {
        const lobIndex = BigInt(
          [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
            (c: any) => c.ownerId === homeOwnerId && c.zone === 'land-of-bondage'
          ).length
        );
        ctx.db.CardInstance.id.update({
          ...card,
          zone: 'land-of-bondage',
          zoneIndex: lobIndex,
          posX: '',
          posY: '',
          isFlipped: false,
          ownerId: homeOwnerId,
        });
        redirectedLostSouls.push({ name: logName, img: logImg });
        // Queue a replacement from the same end of the deck. Append to `ids`
        // so the main loop processes it with the rest of the batch; seed the
        // pre-pass maps since the replacement wasn't in the original ids.
        const replacementId = pickReplacementId();
        if (replacementId) {
          const replacementBig = BigInt(replacementId);
          const replacementCard = ctx.db.CardInstance.id.find(replacementBig);
          if (replacementCard) {
            batchIdSet.add(replacementBig);
            originalZoneById.set(replacementId, replacementCard.zone);
            originalOwnerById.set(replacementId, replacementCard.ownerId);
            finalZoneById.set(replacementId, toZone);
            ids.push(replacementId);
          }
        }
        continue;
      }

      const rawPos = posMap[idStr] || { posX: '', posY: '' };
      // Ensure posX/posY are strings — client may send numbers via JSON positions map
      const pos = { posX: String(rawPos.posX ?? ''), posY: String(rawPos.posY ?? '') };
      // Same home-zone routing rule as the single move_card reducer: a drop on
      // the actor's own home pile sends captured cards to their original
      // owner's pile. Explicit drops on someone else's zone (newOwnerId set
      // and not the actor) still win.
      // Explicit LoB drop: honor the target seat (mirror of move_card). The
      // user dragged the card onto a specific player's LoB, so home-routing
      // shouldn't override that choice.
      const isExplicitLobDrop =
        toZone === 'land-of-bondage' && newOwnerId !== null;
      let cardOwnerId: bigint;
      if (isExplicitLobDrop) {
        cardOwnerId = newOwnerId!;
      } else if (HOME_ZONES.includes(toZone)) {
        const droppedOnOwnZone = newOwnerId === null || newOwnerId === player.id;
        cardOwnerId = droppedOnOwnZone ? homeOwnerId : newOwnerId;
      } else {
        cardOwnerId = newOwnerId ?? card.ownerId;
      }
      const cardFinalZone = finalZoneById.get(idStr) ?? toZone;
      // Paragon: rescuing a shared soul transfers ownership. Default to the
      // acting seat, but honor an explicit targetOwnerId when the caller
      // dragged the soul into a specific player's zone.
      let resolvedCardOwnerId = cardOwnerId;
      if (
        card.ownerId === 0n &&
        card.isSoulDeckOrigin === true &&
        card.zone === 'land-of-bondage' &&
        cardFinalZone !== 'land-of-bondage' &&
        cardFinalZone !== 'soul-deck' &&
        !targetOwnerId
      ) {
        resolvedCardOwnerId = player.id;
      }
      // Paragon: track rescues-to-LoR so we only refill the shared soul deck
      // when a rescue actually occurred. Drag-backs, soul-deck round-trips,
      // and other destinations must not trigger a refill.
      if (
        card.isSoulDeckOrigin === true &&
        card.zone === 'land-of-bondage' &&
        cardFinalZone === 'land-of-redemption'
      ) {
        anyRescueToLor = true;
      }
      // Paragon: dropping a soul-origin card back into the shared LoB resets ownership to the shared sentinel.
      if (
        targetOwnerId === '0' &&
        card.isSoulDeckOrigin === true &&
        cardFinalZone === 'land-of-bondage'
      ) {
        resolvedCardOwnerId = 0n;
      }
      // Clear the attach pointer only when the mover is actually leaving its
      // current zone. Same-zone reposition preserves the link (both Territory
      // warriors and LOB souls can shuffle within their zone without losing
      // attached accessories).
      const leavingZone =
        cardFinalZone !== card.zone || resolvedCardOwnerId !== card.ownerId;
      // An accessory travelling with its host in the same batch keeps its link —
      // otherwise a warrior-with-weapon group move across ownership boundaries
      // would strip the weapon off mid-flight.
      const hostInBatch =
        card.equippedToInstanceId !== 0n && batchIdSet.has(card.equippedToInstanceId);

      // Auto-fan: if dropping into territory without an explicit position,
      // stagger the card in a small grid so multi-card modal moves don't stack
      // at the zone origin. Positions are normalized 0–1 within the zone.
      if (cardFinalZone === 'territory' && pos.posX === '' && pos.posY === '') {
        const cardsPerRow = 10;
        const col = autoFanIndex % cardsPerRow;
        const row = Math.floor(autoFanIndex / cardsPerRow);
        pos.posX = String(0.03 + col * 0.04 + row * 0.02);
        pos.posY = String(0.05 + row * 0.28);
        autoFanIndex += 1;
      }

      // For hand zone, assign sequential zoneIndex (count of existing hand cards for this owner)
      const handZoneIndex = cardFinalZone === 'hand' ? BigInt(
        [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
          (c: any) => c.ownerId === cardOwnerId && c.zone === 'hand'
        ).length
      ) : card.zoneIndex;

      // Determine the zoneIndex for this card:
      // - hand: use computed sequential index
      // - free-form zones (territory): assign incrementing index so cards render on top
      // - redirected to discard (equip cascade): compute discard max + 1
      // - Paragon shared LoB: slot-preserving — fill the first empty slot in [0..2]
      // - other zones: preserve existing zoneIndex
      let finalZoneIndex = card.zoneIndex;
      if (cardFinalZone === 'hand') {
        finalZoneIndex = handZoneIndex;
      } else if (cardFinalZone !== toZone) {
        // Redirected (weapon → discard). Compute max zoneIndex for the
        // redirected owner's discard and put the weapon after it.
        let maxDiscardIdx = -1n;
        for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
          if (c.ownerId === cardOwnerId && c.zone === 'discard' && c.zoneIndex > maxDiscardIdx) {
            maxDiscardIdx = c.zoneIndex;
          }
        }
        finalZoneIndex = maxDiscardIdx + 1n;
      } else if (isFreeFormTarget) {
        // Assign ascending zoneIndex for free-form zones — both cross-zone moves
        // and same-zone repositioning — so moved cards render on top for all clients.
        finalZoneIndex = nextFreeFormIndex;
        nextFreeFormIndex += 1n;
      } else if (cardFinalZone === 'land-of-bondage' && resolvedCardOwnerId === 0n) {
        // Shared LoB slot assignment: find the first empty slot in [0..2].
        const sharedLob = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
          (c: any) => c.ownerId === 0n && c.zone === 'land-of-bondage' && c.id !== cardId
        );
        const occupied = new Set<bigint>(sharedLob.map((c: any) => c.zoneIndex));
        let chosen: bigint | null = null;
        for (let i = 0n; i < 3n; i++) {
          if (!occupied.has(i)) { chosen = i; break; }
        }
        if (chosen === null) {
          let maxIdx = -1n;
          for (const c of sharedLob) {
            if (c.zoneIndex > maxIdx) maxIdx = c.zoneIndex;
          }
          chosen = maxIdx + 1n;
        }
        finalZoneIndex = chosen;
      }

      // Clear pos when redirected (the client-supplied coords were for `toZone`, not discard)
      const finalPosX = cardFinalZone === toZone ? pos.posX : '';
      const finalPosY = cardFinalZone === toZone ? pos.posY : '';

      // Mirror move_card's auto-reveal: cards landing in a hand via an
      // identity-revealing move flash face-up briefly. Uses cardFinalZone (not
      // toZone) so a redirect to LOB never triggers the reveal.
      const autoReveal = cardFinalZone === 'hand' && card.zone !== 'hand' && !hideIdentity;
      const newRevealExpiresAt = autoReveal
        ? new Timestamp(ctx.timestamp.microsSinceUnixEpoch + AUTO_REVEAL_HAND_MICROS)
        : undefined;
      const newRevealStartedAt = autoReveal ? ctx.timestamp : undefined;

      clearCountersIfLeavingPlay(ctx, card.id, card.zone, cardFinalZone);
      ctx.db.CardInstance.id.update({
        ...card,
        zone: cardFinalZone,
        zoneIndex: finalZoneIndex,
        posX: finalPosX,
        posY: finalPosY,
        isFlipped,
        ownerId: resolvedCardOwnerId,
        equippedToInstanceId: leavingZone && !hostInBatch ? 0n : card.equippedToInstanceId,
        revealExpiresAt: newRevealExpiresAt,
        revealStartedAt: newRevealStartedAt,
        ...leavePlayFieldOverrides(card, card.zone, cardFinalZone),
      });
    }

    // Accessory cascade post-pass: for each mover that actually changed zone,
    // cascade to non-batch accessories pointing at it. Warriors going
    // Territory → LOB drag their weapons to Discard; all other host-leaves-zone
    // cases (soul rescued from LOB, etc.) just unlink in place.
    for (const idStr of ids) {
      const moverId = BigInt(idStr);
      const moverFinalZone = finalZoneById.get(idStr) ?? toZone;
      const originalZone = originalZoneById.get(idStr);
      if (originalZone === undefined) continue;
      // Refetch the mover to learn its post-update owner — cascade must fire
      // when ownership changed between territories (same zone name) so stranded
      // accessories don't keep pointing at a host in another player's zone.
      const postMover = ctx.db.CardInstance.id.find(moverId);
      const originalOwner = originalOwnerById.get(idStr);
      const ownerChanged =
        postMover != null &&
        originalOwner !== undefined &&
        postMover.ownerId !== originalOwner;
      if (moverFinalZone === originalZone && !ownerChanged) continue;
      const sendToDiscard =
        originalZone === 'territory' && moverFinalZone === 'land-of-bondage';
      const nonBatchAccessories = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
        (c: any) => c.equippedToInstanceId === moverId && !batchIdSet.has(c.id)
      );
      for (const accessory of nonBatchAccessories) {
        if (sendToDiscard) {
          let maxDiscardIdx = -1n;
          for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
            if (c.ownerId === accessory.ownerId && c.zone === 'discard' && c.zoneIndex > maxDiscardIdx) {
              maxDiscardIdx = c.zoneIndex;
            }
          }
          clearCountersIfLeavingPlay(ctx, accessory.id, accessory.zone, 'discard');
          ctx.db.CardInstance.id.update({
            ...accessory,
            zone: 'discard',
            zoneIndex: maxDiscardIdx + 1n,
            posX: '',
            posY: '',
            equippedToInstanceId: 0n,
            revealExpiresAt: undefined,
      revealStartedAt: undefined,
            ...leavePlayFieldOverrides(accessory, accessory.zone, 'discard'),
          });
        } else {
          ctx.db.CardInstance.id.update({ ...accessory, equippedToInstanceId: 0n });
        }
      }
    }

    // Only log if cards actually changed zones (not just repositioned within the same zone)
    if (movedCards.length > 0 || redirectedLostSouls.length > 0) {
      logAction(ctx, gameId, player.id, 'MOVE_CARDS_BATCH', JSON.stringify({ count: movedCards.length, toZone, cards: movedCards, redirectedLostSouls, targetOwnerId: targetOwnerId || '', fromSource: fromSource || '', sourceOwnerId: sourceOwnerId !== null ? sourceOwnerId.toString() : '' }), game.turnNumber, game.currentPhase);
    }

    // Compact hand indices for any owners whose hand had cards removed
    for (const ownerId of handCompactOwners) {
      compactHandIndices(ctx, gameId, ownerId);
    }
    // Compact LOB indices for any owners whose LOB had cards removed
    for (const ownerId of lobCompactOwners) {
      compactLobIndices(ctx, gameId, ownerId);
    }

    // Paragon: only refill when this batch actually rescued a soul-origin
    // card into a land-of-redemption. Other destinations leave the LoB short.
    if (normalizeFormat(game.format) === 'Paragon' && anyRescueToLor) {
      refillSoulDeck(ctx, game.id);
    }
  }
);

// ---------------------------------------------------------------------------
// Helper: setCardOutlineImpl
// Called by execute_card_ability when ability.type === 'set_card_outline'.
// Re-picking the same color clears it (mutually-exclusive cycle); picking the
// other color switches.
// ---------------------------------------------------------------------------
function setCardOutlineImpl(
  ctx: any,
  source: any,
  ability: Extract<CardAbility, { type: 'set_card_outline' }>,
  player: any,
  gameId: bigint,
) {
  const next = source.outlineColor === ability.color ? '' : ability.color;
  ctx.db.CardInstance.id.update({ ...source, outlineColor: next });

  const game = ctx.db.Game.id.find(gameId);
  if (game) {
    logAction(
      ctx,
      gameId,
      player.id,
      'SET_CARD_OUTLINE',
      JSON.stringify({
        cardName: source.cardName,
        cardInstanceId: source.id.toString(),
        color: next,
      }),
      game.turnNumber,
      game.currentPhase,
    );
  }
}

// ---------------------------------------------------------------------------
// Helper: spawnTokenImpl
// Called by execute_card_ability when ability.type === 'spawn_token'.
// Validates, computes target zone + zoneIndex, then inserts token CardInstance
// rows. SpacetimeDB rolls back the whole reducer if any insert throws.
// ---------------------------------------------------------------------------
function spawnTokenImpl(
  ctx: any,
  source: any, // CardInstance row
  ability: Extract<CardAbility, { type: 'spawn_token' }>,
  player: any, // Player row
  gameId: bigint,
) {
  // Phase 1 — validate token exists in card data.
  const tokenData = findTokenCard(ability.tokenName);
  if (!tokenData) throw new SenderError(`Unknown token '${ability.tokenName}'`);

  const count = ability.count ?? 1;
  if (count < 1) throw new SenderError('Invalid count');

  // Phase 2 — compute target zone. Always Territory by default — it's the
  // visible main play area. Registry can override via ability.defaultZone.
  const targetZone = ability.defaultZone ?? 'territory';

  // Compute starting zoneIndex based on existing cards for (targetZone, ownerId).
  let maxIdx = -1n;
  for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
    if (c.ownerId === source.ownerId && c.zone === targetZone && c.zoneIndex > maxIdx) {
      maxIdx = c.zoneIndex;
    }
  }

  // Stagger each token relative to the source IF the source is already in
  // territory (so tokens appear next to their source card). Otherwise use a
  // sensible default position. Multiplayer uses NORMALIZED 0–1 coordinates
  // (NOT pixel coords like goldfish) — the client scales them to the zone's
  // pixel size at render time. Card width is roughly 10% of territory width,
  // so ~0.05 between centers leaves each card visibly distinct.
  const STAGGER_X = 0.05;
  const STAGGER_Y = 0.03;
  const sourceInTerritory = source.zone === 'territory';
  const sourcePosX = source.posX ? Number(source.posX) : NaN;
  const sourcePosY = source.posY ? Number(source.posY) : NaN;
  const baseX = sourceInTerritory && Number.isFinite(sourcePosX) ? sourcePosX : 0.3;
  const baseY = sourceInTerritory && Number.isFinite(sourcePosY) ? sourcePosY : 0.4;

  // Phase 3 — all-or-nothing inserts. SpacetimeDB rolls back the whole
  // reducer if any insert throws.
  for (let i = 0; i < count; i++) {
    maxIdx += 1n;
    const posX = targetZone === 'territory' ? String(baseX + (i + 1) * STAGGER_X) : '';
    const posY = targetZone === 'territory' ? String(baseY + (i + 1) * STAGGER_Y) : '';
    ctx.db.CardInstance.insert({
      id: 0n,
      gameId,
      ownerId: source.ownerId,
      originalOwnerId: source.ownerId,
      zone: targetZone,
      zoneIndex: maxIdx,
      posX,
      posY,
      isMeek: false,
      isFlipped: false,
      isToken: true,
      isSoulDeckOrigin: false,
      equippedToInstanceId: 0n,
      notes: '',
      cardName: tokenData.name,
      cardSet: tokenData.set,
      cardImgFile: tokenData.imgFile,
      cardType: tokenData.cardType,
      brigade: tokenData.brigade,
      strength: tokenData.strength,
      toughness: tokenData.toughness,
      alignment: tokenData.alignment,
      identifier: tokenData.identifier,
      specialAbility: tokenData.specialAbility,
      reference: tokenData.reference,
      revealExpiresAt: undefined,
      revealStartedAt: undefined,
      outlineColor: '',
    });
  }

  const game = ctx.db.Game.id.find(gameId);
  if (game) {
    logAction(
      ctx, gameId, player.id, 'SPAWN_TOKEN',
      JSON.stringify({
        sourceInstanceId: source.id.toString(),
        sourceCardName: source.cardName,
        sourceCardImgFile: source.cardImgFile,
        tokenName: tokenData.name,
        tokenImgFile: tokenData.imgFile,
        count,
        targetZone,
      }),
      game.turnNumber, game.currentPhase,
    );
  }
}

// ---------------------------------------------------------------------------
// Helper: shuffleAndDrawForPlayerImpl
// Moves up to `shuffleCount` random cards from player's hand into their deck,
// reshuffles the whole deck with a seeded PRNG, then draws `drawCount`.
// Short-hand (< shuffleCount) shuffles all of hand. Short deck draws as many
// as possible. Emits a single SHUFFLE_AND_DRAW log entry for the action.
// ---------------------------------------------------------------------------
function shuffleAndDrawForPlayerImpl(
  ctx: any,
  gameId: bigint,
  targetPlayer: any, // Player row — whose hand/deck to shuffle + draw
  shuffleCount: number,
  drawCount: number,
): { shuffled: number; drawn: number } {
  if (shuffleCount < 0 || drawCount < 0) {
    throw new SenderError('Invalid shuffle/draw counts');
  }

  const game = ctx.db.Game.id.find(gameId);
  if (!game) throw new SenderError('Game not found');

  // Collect target's hand
  const handCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
    (c: any) => c.ownerId === targetPlayer.id && c.zone === 'hand'
  );

  // Hand shortage: shuffle whatever we have (could be 0).
  const actualShuffle = Math.min(shuffleCount, handCards.length);

  // Seeded PRNG for shuffle selection
  const rngCounter1 = game.rngCounter + 1n;
  ctx.db.Game.id.update({ ...game, rngCounter: rngCounter1 });
  const pickSeed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, targetPlayer.id, rngCounter1);
  const pickRng = xorshift64(pickSeed);

  // Fisher-Yates partial shuffle to pick random hand indices
  const indices = handCards.map((_: any, i: number) => i);
  for (let i = indices.length - 1; i > indices.length - 1 - actualShuffle && i > 0; i--) {
    const j = Number(pickRng.next() % BigInt(i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const pickedCards = indices.slice(indices.length - actualShuffle).map((i: number) => handCards[i]);

  // Move picked hand cards to deck (temporary zoneIndex — will be overwritten
  // by the reshuffle pass below).
  for (const card of pickedCards) {
    ctx.db.CardInstance.id.update({
      ...card,
      zone: 'deck',
      zoneIndex: 0n,
      posX: '',
      posY: '',
      isFlipped: true,
    });
  }

  // Reshuffle the entire deck
  const latestGame = ctx.db.Game.id.find(gameId);
  if (!latestGame) throw new SenderError('Game disappeared mid-reducer');
  const rngCounter2 = latestGame.rngCounter + 1n;
  ctx.db.Game.id.update({ ...latestGame, rngCounter: rngCounter2 });

  const allDeckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
    (c: any) => c.ownerId === targetPlayer.id && c.zone === 'deck'
  );
  const shuffleIndices = allDeckCards.map((_: any, idx: number) => idx);
  const shuffleSeed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, targetPlayer.id, rngCounter2);
  seededShuffle(shuffleIndices, shuffleSeed);
  for (let i = 0; i < allDeckCards.length; i++) {
    ctx.db.CardInstance.id.update({ ...allDeckCards[i], zoneIndex: BigInt(shuffleIndices[i]) });
  }

  compactHandIndices(ctx, gameId, targetPlayer.id);

  // Draw — short-deck draws as many as possible (drawCardsForPlayer handles it).
  const drawGame = ctx.db.Game.id.find(gameId);
  if (!drawGame) throw new SenderError('Game disappeared mid-reducer');
  const drawResult = drawCardsForPlayer(ctx, drawGame, targetPlayer, drawCount);

  const finalGame = ctx.db.Game.id.find(gameId);
  if (finalGame) {
    logAction(
      ctx, gameId, targetPlayer.id, 'SHUFFLE_AND_DRAW',
      JSON.stringify({
        shuffled: actualShuffle,
        requestedShuffle: shuffleCount,
        drawn: drawResult.drawn,
        requestedDraw: drawCount,
      }),
      finalGame.turnNumber, finalGame.currentPhase,
    );
  }

  return { shuffled: actualShuffle, drawn: drawResult.drawn };
}

// ---------------------------------------------------------------------------
// Helper: reserveTopOfDeckImpl
// Moves the top `count` cards of the acting player's deck into their reserve.
// "Top" is defined by ascending zoneIndex (same convention as drawCardsForPlayer).
// Cards enter reserve face-down — the player didn't look at them.
// ---------------------------------------------------------------------------
function reserveTopOfDeckImpl(
  ctx: any,
  source: any,
  ability: Extract<CardAbility, { type: 'reserve_top_of_deck' }>,
  player: any,
  gameId: bigint,
) {
  if (ability.count < 1) throw new SenderError('Invalid count');

  const game = ctx.db.Game.id.find(gameId);
  if (!game) throw new SenderError('Game not found');

  const playerCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
    (c: any) => c.ownerId === player.id
  );
  const deckCards = playerCards
    .filter((c: any) => c.zone === 'deck')
    .sort((a: any, b: any) => (a.zoneIndex < b.zoneIndex ? -1 : a.zoneIndex > b.zoneIndex ? 1 : 0));

  if (deckCards.length === 0) return;

  const reserveCards = playerCards.filter((c: any) => c.zone === 'reserve');
  const n = Math.min(ability.count, deckCards.length);

  // Shift existing reserve cards' zoneIndex up by n so the new arrivals
  // occupy slots [0..n-1] — matches "top of deck" semantics in
  // move_card_to_top_of_deck.
  for (const rc of reserveCards) {
    ctx.db.CardInstance.id.update({ ...rc, zoneIndex: rc.zoneIndex + BigInt(n) });
  }

  const movedCards: { name: string; img: string }[] = [];
  for (let i = 0; i < n; i++) {
    const top = deckCards[i];
    ctx.db.CardInstance.id.update({
      ...top,
      zone: 'reserve',
      zoneIndex: BigInt(i),
      posX: '',
      posY: '',
      isFlipped: true,
    });
    movedCards.push({ name: top.cardName, img: top.cardImgFile });
  }

  logAction(
    ctx, gameId, player.id, 'RESERVE_TOP_OF_DECK',
    JSON.stringify({
      count: n,
      requested: ability.count,
      sourceCardName: source.cardName,
      sourceCardImgFile: source.cardImgFile,
      cards: movedCards,
    }),
    game.turnNumber, game.currentPhase,
  );
}

// ---------------------------------------------------------------------------
// Helper: drawBottomOfDeckImpl
// Moves the bottom `count` cards of the acting player's deck into their hand.
// "Bottom" is defined by descending zoneIndex (inverse of drawCardsForPlayer).
// Does not apply auto-route Lost Souls — the card text is a literal draw from
// bottom.
// ---------------------------------------------------------------------------
function drawBottomOfDeckImpl(
  ctx: any,
  source: any,
  ability: Extract<CardAbility, { type: 'draw_bottom_of_deck' }>,
  player: any,
  gameId: bigint,
) {
  if (ability.count < 1) throw new SenderError('Invalid count');

  const game = ctx.db.Game.id.find(gameId);
  if (!game) throw new SenderError('Game not found');

  const playerCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
    (c: any) => c.ownerId === player.id
  );
  const deckCards = playerCards
    .filter((c: any) => c.zone === 'deck')
    .sort((a: any, b: any) => (a.zoneIndex < b.zoneIndex ? -1 : a.zoneIndex > b.zoneIndex ? 1 : 0));

  if (deckCards.length === 0) return;

  let handCount = playerCards.filter((c: any) => c.zone === 'hand').length;
  const n = Math.min(ability.count, deckCards.length);

  const bottom = deckCards.slice(deckCards.length - n);
  const movedCards: { name: string; img: string }[] = [];
  for (const card of bottom) {
    ctx.db.CardInstance.id.update({
      ...card,
      zone: 'hand',
      zoneIndex: BigInt(handCount),
      posX: '',
      posY: '',
      isFlipped: false,
    });
    handCount++;
    movedCards.push({ name: card.cardName, img: card.cardImgFile });
  }

  logAction(
    ctx, gameId, player.id, 'DRAW_BOTTOM_OF_DECK',
    JSON.stringify({
      count: n,
      requested: ability.count,
      sourceCardName: source.cardName,
      sourceCardImgFile: source.cardImgFile,
      cards: movedCards,
    }),
    game.turnNumber, game.currentPhase,
  );
}

// ---------------------------------------------------------------------------
// Reducer: execute_card_ability
//
// Server-authoritative dispatch for per-card custom abilities defined in the
// shared CARD_ABILITIES registry. Client sends only (gameId, cardInstanceId,
// abilityIndex); the server re-reads the registry by the source card's
// identifier and dispatches. validate → compute → write ordering ensures no
// row is inserted until every precondition has passed.
// ---------------------------------------------------------------------------
export const execute_card_ability = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
    abilityIndex: t.u64(),
  },
  (ctx, { gameId, cardInstanceId, abilityIndex }) => {
    // Phase 1 — validate.
    const player = findPlayerBySender(ctx, gameId);

    const source = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!source) throw new SenderError('Card not found');
    if (source.gameId !== gameId) throw new SenderError('Card not in this game');
    if (source.ownerId !== player.id) throw new SenderError('Not your card');

    // Abilities only fire when the source card is in play. Matches the
    // client-side menu gate but the server enforces independently.
    // LoR included so resting Heroes (Angel of the Harvest, etc.) can spawn.
    const ABILITY_SOURCE_ZONES = ['territory', 'land-of-bondage', 'land-of-redemption'];
    if (!ABILITY_SOURCE_ZONES.includes(source.zone)) {
      throw new SenderError('Source card must be in play');
    }

    // Registry keys match cardName (e.g., "Two Possessed (GoC)"). The
    // identifier field is a taxonomy descriptor and is not unique enough.
    const abilities = getAbilitiesForCard(source.cardName);
    const ability = abilities[Number(abilityIndex)];
    if (!ability) throw new SenderError('No such ability');

    // Phase 2 — dispatch.
    switch (ability.type) {
      case 'spawn_token':
        return spawnTokenImpl(ctx, source, ability, player, gameId);
      case 'shuffle_and_draw':
        throw new SenderError('shuffle_and_draw not yet implemented');
      case 'all_players_shuffle_and_draw': {
        // Caster effect applies immediately. Opponent effect requires consent
        // (inserts a ZoneSearchRequest with action='shuffle_and_draw' — the
        // caster's client fires opponent_shuffle_and_draw on approval).
        shuffleAndDrawForPlayerImpl(ctx, gameId, player, ability.shuffleCount, ability.drawCount);

        const allPlayers = [...ctx.db.Player.player_game_id.filter(gameId)];
        const opponent = allPlayers.find((p: any) => p.id !== player.id);
        if (opponent) {
          // Don't stack requests if the caster already has one pending.
          for (const req of ctx.db.ZoneSearchRequest.zone_search_request_game_id.filter(gameId)) {
            if (req.requesterId === player.id && req.status === 'pending') {
              throw new SenderError('You already have a pending request');
            }
          }
          ctx.db.ZoneSearchRequest.insert({
            id: 0n,
            gameId,
            requesterId: player.id,
            targetPlayerId: opponent.id,
            zone: 'deck',
            status: 'pending',
            createdAt: ctx.timestamp,
            action: 'shuffle_and_draw',
            actionParams: JSON.stringify({
              shuffleCount: ability.shuffleCount,
              drawCount: ability.drawCount,
            }),
          });
        }
        return;
      }
      case 'reveal_own_deck':
        throw new SenderError('reveal_own_deck is dispatched by the client, not this reducer');
      case 'look_at_own_deck':
        throw new SenderError('look_at_own_deck is dispatched by the client, not this reducer');
      case 'look_at_opponent_deck':
        throw new SenderError('look_at_opponent_deck is dispatched by the client, not this reducer');
      case 'discard_opponent_deck':
        throw new SenderError('discard_opponent_deck is dispatched by the client, not this reducer');
      case 'reserve_opponent_deck':
        throw new SenderError('reserve_opponent_deck is dispatched by the client, not this reducer');
      case 'reserve_top_of_deck':
        return reserveTopOfDeckImpl(ctx, source, ability, player, gameId);
      case 'draw_bottom_of_deck':
        return drawBottomOfDeckImpl(ctx, source, ability, player, gameId);
      case 'set_card_outline':
        return setCardOutlineImpl(ctx, source, ability, player, gameId);
      case 'custom':
        throw new SenderError('Custom abilities are dispatched by the client, not this reducer');
    }
  },
);

// ---------------------------------------------------------------------------
// Helper: moveLostSoulToLor
// Shared implementation for surrender_lost_soul and rescue_lost_soul. Moves a
// Lost Soul from a Land of Bondage into a target player's Land of Redemption,
// transferring ownership, clearing in-play state, unlinking any accessories,
// compacting source LoB indices, and refilling the shared Soul Deck when a
// Paragon shared soul is rescued. Mirrors move_card's land-of-redemption path.
// ---------------------------------------------------------------------------
function moveLostSoulToLor(
  ctx: any,
  gameId: bigint,
  card: any,
  targetOwnerId: bigint,
  game: any,
) {
  const fromZone = card.zone;
  const sourceOwnerId = card.ownerId;

  // Highest zoneIndex + 1 in the target's LoR so the rescued soul stacks on top.
  let maxIdx = -1n;
  for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
    if (c.ownerId === targetOwnerId && c.zone === 'land-of-redemption' && c.zoneIndex > maxIdx) {
      maxIdx = c.zoneIndex;
    }
  }
  const finalZoneIndex = maxIdx + 1n;

  clearCountersIfLeavingPlay(ctx, card.id, fromZone, 'land-of-redemption');
  ctx.db.CardInstance.id.update({
    ...card,
    zone: 'land-of-redemption',
    zoneIndex: finalZoneIndex,
    posX: '',
    posY: '',
    isFlipped: false,
    ownerId: targetOwnerId,
    equippedToInstanceId: card.equippedToInstanceId !== 0n ? 0n : card.equippedToInstanceId,
    revealExpiresAt: undefined,
    revealStartedAt: undefined,
    ...leavePlayFieldOverrides(card, fromZone, 'land-of-redemption'),
  });

  // Defensive cascade: any accessories still pointing at this soul lose their link.
  for (const accessory of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
    if (accessory.equippedToInstanceId === card.id) {
      ctx.db.CardInstance.id.update({ ...accessory, equippedToInstanceId: 0n });
    }
  }

  if (fromZone === 'land-of-bondage') {
    compactLobIndices(ctx, gameId, sourceOwnerId);
  }

  const triggeredRefill =
    normalizeFormat(game.format) === 'Paragon' &&
    card.isSoulDeckOrigin === true &&
    fromZone === 'land-of-bondage' &&
    sourceOwnerId === 0n;
  if (triggeredRefill) {
    refillSoulDeck(ctx, gameId);
  }
}

// ---------------------------------------------------------------------------
// Reducer: surrender_lost_soul
// Sends a Lost Soul from the actor's (or shared Paragon) Land of Bondage to
// the opponent's Land of Redemption, transferring ownership. Logs a distinct
// SURRENDER_LOST_SOUL action so the chat reads "surrendered X" rather than
// the generic move text.
// ---------------------------------------------------------------------------
export const surrender_lost_soul = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
  },
  (ctx, { gameId, cardInstanceId }) => {
    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');

    const isLostSoul = card.cardType === 'LS' || card.cardType === 'TOKEN_LS' || card.cardName.toLowerCase().includes('lost soul');
    if (!isLostSoul) throw new SenderError('Card is not a Lost Soul');
    if (card.zone !== 'land-of-bondage') throw new SenderError('Card must be in Land of Bondage');

    // Surrender is allowed when the soul is yours OR it's a shared Paragon soul.
    const isShared = card.ownerId === 0n;
    if (!isShared && card.ownerId !== player.id) {
      throw new SenderError('You can only surrender your own Lost Souls');
    }

    const opponent = [...ctx.db.Player.player_game_id.filter(gameId)].find(
      (p: any) => p.id !== player.id,
    );
    if (!opponent) throw new SenderError('Opponent not found');

    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const fromOwnerId = card.ownerId;
    moveLostSoulToLor(ctx, gameId, card, opponent.id, game);

    logAction(
      ctx, gameId, player.id, 'SURRENDER_LOST_SOUL',
      JSON.stringify({
        cardInstanceId: cardInstanceId.toString(),
        cardName: card.cardName,
        cardImgFile: card.cardImgFile,
        fromOwnerId: fromOwnerId.toString(),
        targetOwnerId: opponent.id.toString(),
      }),
      game.turnNumber, game.currentPhase,
    );
  },
);

// ---------------------------------------------------------------------------
// Reducer: rescue_lost_soul
// Sends a Lost Soul from the opponent's (or shared Paragon) Land of Bondage
// to the actor's Land of Redemption, transferring ownership. Logs a distinct
// RESCUE_LOST_SOUL action so the chat reads "rescued X".
// ---------------------------------------------------------------------------
export const rescue_lost_soul = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
  },
  (ctx, { gameId, cardInstanceId }) => {
    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');

    const isLostSoul = card.cardType === 'LS' || card.cardType === 'TOKEN_LS' || card.cardName.toLowerCase().includes('lost soul');
    if (!isLostSoul) throw new SenderError('Card is not a Lost Soul');
    if (card.zone !== 'land-of-bondage') throw new SenderError('Card must be in Land of Bondage');

    // Rescue applies to opponent souls or shared Paragon souls — never your own.
    const isShared = card.ownerId === 0n;
    if (!isShared && card.ownerId === player.id) {
      throw new SenderError('You cannot rescue your own Lost Souls');
    }

    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const fromOwnerId = card.ownerId;
    moveLostSoulToLor(ctx, gameId, card, player.id, game);

    logAction(
      ctx, gameId, player.id, 'RESCUE_LOST_SOUL',
      JSON.stringify({
        cardInstanceId: cardInstanceId.toString(),
        cardName: card.cardName,
        cardImgFile: card.cardImgFile,
        fromOwnerId: fromOwnerId.toString(),
        targetOwnerId: player.id.toString(),
      }),
      game.turnNumber, game.currentPhase,
    );
  },
);

// ---------------------------------------------------------------------------
// Reducer: attach_card
// Generic "attach accessory to host" — supports warrior+weapon in Territory
// and soul+site in Land of Bondage. Parameter names stay `weaponInstanceId` /
// `warriorInstanceId` for backward compatibility with existing client calls,
// but semantically they are accessory/host.
//
// The accessory ends up in the host's zone with equippedToInstanceId pointing
// at the host. In Territory it inherits the host's position (render layer
// derives offsets); in LOB the positions are cleared (auto-arranged).
// Enforces one-accessory-per-host server-side.
// ---------------------------------------------------------------------------
export const attach_card = spacetimedb.reducer(
  {
    gameId: t.u64(),
    weaponInstanceId: t.u64(),
    warriorInstanceId: t.u64(),
  },
  (ctx, { gameId, weaponInstanceId, warriorInstanceId }) => {
    const player = findPlayerBySender(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const accessory = ctx.db.CardInstance.id.find(weaponInstanceId);
    const host = ctx.db.CardInstance.id.find(warriorInstanceId);
    if (!accessory || !host) throw new SenderError('Card not found');
    if (accessory.gameId !== gameId || host.gameId !== gameId) {
      throw new SenderError('Card not in this game');
    }
    if (accessory.ownerId !== player.id || host.ownerId !== player.id) {
      throw new SenderError('Cannot attach opponent cards');
    }
    if (weaponInstanceId === warriorInstanceId) {
      throw new SenderError('Cannot attach a card to itself');
    }

    // Determine the "natural" zone where this attachment lives:
    //   - Sites attach to souls in Land of Bondage.
    //   - Weapons attach to warriors in Territory.
    // We infer from the accessory's cardType: any type containing "site" or
    // "city" → LOB; otherwise → Territory (the weapon+warrior case). Both
    // cards end up in the natural zone, even if one of them had to move from
    // somewhere else (e.g. soul in Territory being dragged onto site in LOB).
    const accessoryType = accessory.cardType.toLowerCase();
    const accessoryIsSite =
      accessoryType.includes('site') || accessoryType.includes('city');
    const attachZone: string = accessoryIsSite ? 'land-of-bondage' : 'territory';

    // Host must be coming from a sensible zone (Territory, LOB, Hand, Reserve,
    // LOR). We'll move the host to the attach zone if it's not already there.
    const validSourceZones = new Set([
      'territory',
      'land-of-bondage',
      'land-of-redemption',
      'hand',
      'reserve',
    ]);
    if (!validSourceZones.has(host.zone)) {
      throw new SenderError('Host not in a valid zone to attach');
    }

    // Cap at one accessory per host (UI enforces this too; server is the source of truth).
    const existing = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
      (c: any) => c.equippedToInstanceId === warriorInstanceId && c.id !== weaponInstanceId
    );
    if (existing.length >= 1) {
      throw new SenderError('Host already has an accessory attached');
    }

    const accessoryFromZone = accessory.zone;
    const hostFromZone = host.zone;
    const compactOwners = {
      hand: new Set<bigint>(),
      lob: new Set<bigint>(),
    };

    // Move the HOST to the attach zone if it's not there yet.
    if (hostFromZone !== attachZone) {
      let hostMaxIdx = -1n;
      for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
        if (c.ownerId === player.id && c.zone === attachZone && c.zoneIndex > hostMaxIdx) {
          hostMaxIdx = c.zoneIndex;
        }
      }
      const hostInheritPos = attachZone === 'territory';
      ctx.db.CardInstance.id.update({
        ...host,
        zone: attachZone,
        zoneIndex: hostMaxIdx + 1n,
        posX: hostInheritPos ? host.posX : '',
        posY: hostInheritPos ? host.posY : '',
        isFlipped: false,
      });
      if (hostFromZone === 'hand') compactOwners.hand.add(player.id);
      if (hostFromZone === 'land-of-bondage') compactOwners.lob.add(player.id);
    }

    // Move the ACCESSORY to the attach zone (inheriting host's position in
    // Territory; cleared in LOB).
    let accMaxIdx = -1n;
    for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
      if (c.ownerId === player.id && c.zone === attachZone && c.zoneIndex > accMaxIdx) {
        accMaxIdx = c.zoneIndex;
      }
    }
    const inheritPos = attachZone === 'territory';
    // Re-read host in case we just updated it, to get fresh posX/posY.
    const hostNow = ctx.db.CardInstance.id.find(warriorInstanceId);
    const hostPosX = hostNow?.posX ?? host.posX;
    const hostPosY = hostNow?.posY ?? host.posY;
    ctx.db.CardInstance.id.update({
      ...accessory,
      zone: attachZone,
      zoneIndex: accMaxIdx + 1n,
      posX: inheritPos ? hostPosX : '',
      posY: inheritPos ? hostPosY : '',
      isFlipped: false,
      equippedToInstanceId: warriorInstanceId,
    });
    if (accessoryFromZone === 'hand') compactOwners.hand.add(player.id);
    if (accessoryFromZone === 'land-of-bondage' && attachZone !== 'land-of-bondage') {
      compactOwners.lob.add(player.id);
    }

    for (const ownerId of compactOwners.hand) compactHandIndices(ctx, gameId, ownerId);
    for (const ownerId of compactOwners.lob) compactLobIndices(ctx, gameId, ownerId);

    // Log the host move (if any) and the accessory move (if any) as MOVE_CARD
    // entries so the action log stays consistent with normal moves.
    if (hostFromZone !== attachZone) {
      logAction(
        ctx,
        gameId,
        player.id,
        'MOVE_CARD',
        JSON.stringify({
          cardInstanceId: warriorInstanceId.toString(),
          from: hostFromZone,
          to: attachZone,
          cardName: host.cardName,
          cardImgFile: host.cardImgFile,
        }),
        game.turnNumber,
        game.currentPhase
      );
    }
    if (accessoryFromZone !== attachZone) {
      logAction(
        ctx,
        gameId,
        player.id,
        'MOVE_CARD',
        JSON.stringify({
          cardInstanceId: weaponInstanceId.toString(),
          from: accessoryFromZone,
          to: attachZone,
          cardName: accessory.cardName,
          cardImgFile: accessory.cardImgFile,
        }),
        game.turnNumber,
        game.currentPhase
      );
    }
  }
);

// ---------------------------------------------------------------------------
// Reducer: detach_card
// Break the equip link on a weapon. The weapon stays in its current zone
// (typically Territory) at the client-supplied position, which lets the UI
// keep the weapon visually in place after the link is severed.
// ---------------------------------------------------------------------------
export const detach_card = spacetimedb.reducer(
  {
    gameId: t.u64(),
    weaponInstanceId: t.u64(),
    posX: t.string(),
    posY: t.string(),
  },
  (ctx, { gameId, weaponInstanceId, posX, posY }) => {
    const player = findPlayerBySender(ctx, gameId);

    const weapon = ctx.db.CardInstance.id.find(weaponInstanceId);
    if (!weapon) throw new SenderError('Card not found');
    if (weapon.gameId !== gameId) throw new SenderError('Card not in this game');
    if (weapon.ownerId !== player.id) throw new SenderError('Not your card');

    ctx.db.CardInstance.id.update({
      ...weapon,
      equippedToInstanceId: 0n,
      posX: posX || weapon.posX,
      posY: posY || weapon.posY,
    });
  }
);

// ---------------------------------------------------------------------------
// Reducer: reorder_hand
// ---------------------------------------------------------------------------
export const reorder_hand = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardIds: t.string(), // JSON array of card instance IDs as strings, in desired order
  },
  (ctx, { gameId, cardIds }) => {
    const player = findPlayerBySender(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const ids: string[] = JSON.parse(cardIds);

    for (let i = 0; i < ids.length; i++) {
      const cardId = BigInt(ids[i]);
      const card = ctx.db.CardInstance.id.find(cardId);
      if (!card) continue;
      if (card.gameId !== gameId) continue;
      if (card.ownerId !== player.id) continue; // Only reorder own cards
      if (card.zone !== 'hand') continue; // Only reorder hand cards
      ctx.db.CardInstance.id.update({ ...card, zoneIndex: BigInt(i) });
    }

  }
);

// ---------------------------------------------------------------------------
// Reducer: reorder_lob
// ---------------------------------------------------------------------------
export const reorder_lob = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardIds: t.string(), // JSON array of card instance IDs as strings, in desired order
  },
  (ctx, { gameId, cardIds }) => {
    const player = findPlayerBySender(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const ids: string[] = JSON.parse(cardIds);

    for (let i = 0; i < ids.length; i++) {
      const cardId = BigInt(ids[i]);
      const card = ctx.db.CardInstance.id.find(cardId);
      if (!card) continue;
      if (card.gameId !== gameId) continue;
      if (card.ownerId !== player.id) continue; // Only reorder own cards
      if (card.zone !== 'land-of-bondage') continue; // Only reorder LOB cards
      ctx.db.CardInstance.id.update({ ...card, zoneIndex: BigInt(i) });
    }

    logAction(ctx, gameId, player.id, 'REORDER_LOB', JSON.stringify({ count: ids.length }), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: shuffle_deck
// ---------------------------------------------------------------------------
export const shuffle_deck = spacetimedb.reducer(
  {
    gameId: t.u64(),
  },
  (ctx, { gameId }) => {
    const player = findPlayerBySender(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    // Get all player's deck cards
    const deckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
      (c: any) => c.ownerId === player.id && c.zone === 'deck'
    );

    // Increment rng counter and create seed
    const newRngCounter = game.rngCounter + 1n;
    ctx.db.Game.id.update({ ...game, rngCounter: newRngCounter });

    const seed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, player.id, newRngCounter);

    // Shuffle zoneIndex values
    const indices = deckCards.map((_: any, idx: number) => idx);
    seededShuffle(indices, seed);

    for (let i = 0; i < deckCards.length; i++) {
      ctx.db.CardInstance.id.update({
        ...deckCards[i],
        zoneIndex: BigInt(indices[i]),
      });
    }

    logAction(ctx, gameId, player.id, 'SHUFFLE', '', game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: shuffle_soul_deck
// Paragon-only. Shuffles all shared soul-deck cards (ownerId=0n) in a single
// seeded pass. Either seat may invoke it (the Soul Deck is shared). Mirrors
// goldfish's client-side SHUFFLE_SOUL_DECK action but runs authoritatively.
// ---------------------------------------------------------------------------
export const shuffle_soul_deck = spacetimedb.reducer(
  {
    gameId: t.u64(),
  },
  (ctx, { gameId }) => {
    // Still require the sender to be a player in the game (stops drive-bys), but
    // either seat is authorized since the Soul Deck is shared.
    const player = findPlayerBySender(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (normalizeFormat(game.format) !== 'Paragon') {
      throw new SenderError('Soul Deck only exists in Paragon format');
    }

    const soulCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
      (c: any) => c.ownerId === 0n && c.zone === 'soul-deck'
    );
    if (soulCards.length === 0) return;

    const newRngCounter = game.rngCounter + 1n;
    ctx.db.Game.id.update({ ...game, rngCounter: newRngCounter });

    const seed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, 0n, newRngCounter);
    const indices = soulCards.map((_: any, idx: number) => idx);
    seededShuffle(indices, seed);

    for (let i = 0; i < soulCards.length; i++) {
      ctx.db.CardInstance.id.update({
        ...soulCards[i],
        zoneIndex: BigInt(indices[i]),
      });
    }

    logAction(ctx, gameId, player.id, 'SHUFFLE_SOUL_DECK', '', game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: shuffle_card_into_deck
// ---------------------------------------------------------------------------
export const shuffle_card_into_deck = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
  },
  (ctx, { gameId, cardInstanceId }) => {
    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');

    const fromZone = card.zone;

    // Route into the original owner's deck so a taken opponent card
    // shuffles back into the opponent's deck, not the controller's.
    const deckOwnerId = card.originalOwnerId !== 0n ? card.originalOwnerId : card.ownerId;
    ctx.db.CardInstance.id.update({
      ...card,
      zone: 'deck',
      ownerId: deckOwnerId,
      isFlipped: true,
      revealExpiresAt: undefined,
      revealStartedAt: undefined,
    });

    // Now shuffle the deck owner's entire deck (same logic as shuffle_deck)
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const deckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
      (c: any) => c.ownerId === deckOwnerId && c.zone === 'deck'
    );

    const newRngCounter = game.rngCounter + 1n;
    ctx.db.Game.id.update({ ...game, rngCounter: newRngCounter });

    const seed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, deckOwnerId, newRngCounter);

    const indices = deckCards.map((_: any, idx: number) => idx);
    seededShuffle(indices, seed);

    for (let i = 0; i < deckCards.length; i++) {
      ctx.db.CardInstance.id.update({
        ...deckCards[i],
        zoneIndex: BigInt(indices[i]),
      });
    }

    // Compact hand indices if card left hand
    if (fromZone === 'hand') {
      compactHandIndices(ctx, gameId, deckOwnerId);
    }
    // Compact LOB indices if card left LOB
    if (fromZone === 'land-of-bondage') {
      compactLobIndices(ctx, gameId, deckOwnerId);
    }

    logAction(ctx, gameId, player.id, 'SHUFFLE_INTO_DECK', JSON.stringify({ cardInstanceId: cardInstanceId.toString(), cardName: card.cardName, cardImgFile: card.cardImgFile, deckOwnerId: deckOwnerId.toString() }), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: random_hand_to_zone
// ---------------------------------------------------------------------------
export const random_hand_to_zone = spacetimedb.reducer(
  {
    gameId: t.u64(),
    count: t.u64(),
    toZone: t.string(),
    deckPosition: t.string(),
  },
  (ctx, { gameId, count, toZone, deckPosition }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in progress');

    const player = findPlayerBySender(ctx, gameId);

    const handCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
      (c: any) => c.ownerId === player.id && c.zone === 'hand'
    );

    if (handCards.length === 0) throw new SenderError('No cards in hand');
    const actualCount = Math.min(Number(count), handCards.length);

    // Use seeded PRNG to pick random cards
    const newRngCounter = game.rngCounter + 1n;
    ctx.db.Game.id.update({ ...game, rngCounter: newRngCounter });
    const seed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, player.id, newRngCounter);
    const rng = xorshift64(seed);

    // Fisher-Yates partial shuffle to select random indices
    const indices = handCards.map((_: any, i: number) => i);
    for (let i = indices.length - 1; i > indices.length - 1 - actualCount && i > 0; i--) {
      const j = Number(rng.next() % BigInt(i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    const pickedCards = indices.slice(indices.length - actualCount).map((i: number) => handCards[i]);

    // Get max deck zoneIndex for bottom placement
    let maxDeckIndex = 0n;
    if (toZone === 'deck') {
      for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
        if (c.ownerId === player.id && c.zone === 'deck' && c.zoneIndex > maxDeckIndex) {
          maxDeckIndex = c.zoneIndex;
        }
      }
    }

    const movedCards: { name: string; img: string }[] = [];
    for (let i = 0; i < pickedCards.length; i++) {
      const card = pickedCards[i];
      movedCards.push({ name: card.cardName, img: card.cardImgFile });

      let newZoneIndex = 0n;
      if (toZone === 'deck') {
        if (deckPosition === 'top') {
          newZoneIndex = BigInt(-(i + 1));
        } else if (deckPosition === 'bottom') {
          newZoneIndex = maxDeckIndex + BigInt(i + 1);
        }
      }

      ctx.db.CardInstance.id.update({
        ...card,
        zone: toZone,
        zoneIndex: newZoneIndex,
        posX: '',
        posY: '',
        revealExpiresAt: undefined,
      revealStartedAt: undefined,
      });
    }

    // If shuffle into deck, shuffle entire deck
    if (toZone === 'deck' && deckPosition === 'shuffle') {
      const latestGame = ctx.db.Game.id.find(gameId);
      if (!latestGame) return;
      const shuffleRng = latestGame.rngCounter + 1n;
      ctx.db.Game.id.update({ ...latestGame, rngCounter: shuffleRng });

      const allDeckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
        (c: any) => c.ownerId === player.id && c.zone === 'deck'
      );
      const shuffleIndices = allDeckCards.map((_: any, idx: number) => idx);
      const shuffleSeed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, player.id, shuffleRng);
      seededShuffle(shuffleIndices, shuffleSeed);
      for (let i = 0; i < allDeckCards.length; i++) {
        ctx.db.CardInstance.id.update({ ...allDeckCards[i], zoneIndex: BigInt(shuffleIndices[i]) });
      }
    }

    // Compact hand indices after cards were removed from hand
    compactHandIndices(ctx, gameId, player.id);

    const destLabel = toZone === 'deck' ? `deck (${deckPosition})` : toZone;
    logAction(ctx, gameId, player.id, 'RANDOM_HAND_TO_ZONE',
      JSON.stringify({ cards: movedCards, destination: destLabel, count: actualCount }),
      game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: random_opponent_hand_to_zone
// Authorised via an approved ZoneSearchRequest — the requester moves random
// cards from the target's hand to a destination zone. Mirrors random_hand_to_zone
// but operates on the request's targetPlayerId.
// ---------------------------------------------------------------------------
export const random_opponent_hand_to_zone = spacetimedb.reducer(
  {
    gameId: t.u64(),
    requestId: t.u64(),
    count: t.u64(),
    toZone: t.string(),
    deckPosition: t.string(),
  },
  (ctx, { gameId, requestId, count, toZone, deckPosition }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in progress');

    const player = findPlayerBySender(ctx, gameId);

    const req = ctx.db.ZoneSearchRequest.id.find(requestId);
    if (!req) throw new SenderError('Search request not found');
    if (req.gameId !== gameId) throw new SenderError('Request not in this game');
    if (req.requesterId !== player.id) throw new SenderError('Not your search request');
    if (req.status !== 'approved') throw new SenderError('Search request not approved');

    const targetId = req.targetPlayerId;

    const handCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
      (c: any) => c.ownerId === targetId && c.zone === 'hand'
    );

    if (handCards.length === 0) throw new SenderError('Target has no cards in hand');
    const actualCount = Math.min(Number(count), handCards.length);

    const newRngCounter = game.rngCounter + 1n;
    ctx.db.Game.id.update({ ...game, rngCounter: newRngCounter });
    const seed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, targetId, newRngCounter);
    const rng = xorshift64(seed);

    const indices = handCards.map((_: any, i: number) => i);
    for (let i = indices.length - 1; i > indices.length - 1 - actualCount && i > 0; i--) {
      const j = Number(rng.next() % BigInt(i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    const pickedCards = indices.slice(indices.length - actualCount).map((i: number) => handCards[i]);

    let maxDeckIndex = 0n;
    if (toZone === 'deck') {
      for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
        if (c.ownerId === targetId && c.zone === 'deck' && c.zoneIndex > maxDeckIndex) {
          maxDeckIndex = c.zoneIndex;
        }
      }
    }

    for (let i = 0; i < pickedCards.length; i++) {
      const card = pickedCards[i];

      let newZoneIndex = 0n;
      if (toZone === 'deck') {
        if (deckPosition === 'top') {
          newZoneIndex = BigInt(-(i + 1));
        } else if (deckPosition === 'bottom') {
          newZoneIndex = maxDeckIndex + BigInt(i + 1);
        }
      }

      ctx.db.CardInstance.id.update({
        ...card,
        zone: toZone,
        zoneIndex: newZoneIndex,
        posX: '',
        posY: '',
        isFlipped: toZone === 'deck' || toZone === 'reserve' ? true : card.isFlipped,
        revealExpiresAt: undefined,
      revealStartedAt: undefined,
      });
    }

    if (toZone === 'deck' && deckPosition === 'shuffle') {
      const latestGame = ctx.db.Game.id.find(gameId);
      if (!latestGame) return;
      const shuffleRng = latestGame.rngCounter + 1n;
      ctx.db.Game.id.update({ ...latestGame, rngCounter: shuffleRng });

      const allDeckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
        (c: any) => c.ownerId === targetId && c.zone === 'deck'
      );
      const shuffleIndices = allDeckCards.map((_: any, idx: number) => idx);
      const shuffleSeed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, targetId, shuffleRng);
      seededShuffle(shuffleIndices, shuffleSeed);
      for (let i = 0; i < allDeckCards.length; i++) {
        ctx.db.CardInstance.id.update({ ...allDeckCards[i], zoneIndex: BigInt(shuffleIndices[i]) });
      }
    }

    compactHandIndices(ctx, gameId, targetId);

    const destLabel = toZone === 'deck' ? `deck (${deckPosition})` : toZone;
    logAction(ctx, gameId, player.id, 'RANDOM_OPPONENT_HAND_TO_ZONE',
      JSON.stringify({ destination: destLabel, count: actualCount, targetPlayerId: targetId.toString() }),
      game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: opponent_shuffle_and_draw
// Authorised via an approved ZoneSearchRequest (action='shuffle_and_draw').
// Applies a shuffle-N-and-draw-N effect to the target player (opponent of the
// caster). Used by the Mayhem ability after opponent consent.
// ---------------------------------------------------------------------------
export const opponent_shuffle_and_draw = spacetimedb.reducer(
  {
    gameId: t.u64(),
    requestId: t.u64(),
    shuffleCount: t.u64(),
    drawCount: t.u64(),
  },
  (ctx, { gameId, requestId, shuffleCount, drawCount }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in progress');

    const player = findPlayerBySender(ctx, gameId);

    const req = ctx.db.ZoneSearchRequest.id.find(requestId);
    if (!req) throw new SenderError('Search request not found');
    if (req.gameId !== gameId) throw new SenderError('Request not in this game');
    if (req.requesterId !== player.id) throw new SenderError('Not your search request');
    if (req.status !== 'approved') throw new SenderError('Search request not approved');

    const allPlayers = [...ctx.db.Player.player_game_id.filter(gameId)];
    const target = allPlayers.find((p: any) => p.id === req.targetPlayerId);
    if (!target) throw new SenderError('Target player not found');

    shuffleAndDrawForPlayerImpl(ctx, gameId, target, Number(shuffleCount), Number(drawCount));
  }
);

// ---------------------------------------------------------------------------
// Reducer: random_reserve_to_zone
// ---------------------------------------------------------------------------
export const random_reserve_to_zone = spacetimedb.reducer(
  {
    gameId: t.u64(),
    count: t.u64(),
    toZone: t.string(),
    deckPosition: t.string(),
  },
  (ctx, { gameId, count, toZone, deckPosition }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in progress');

    const player = findPlayerBySender(ctx, gameId);

    const reserveCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
      (c: any) => c.ownerId === player.id && c.zone === 'reserve'
    );

    if (reserveCards.length === 0) throw new SenderError('No cards in reserve');
    const actualCount = Math.min(Number(count), reserveCards.length);

    // Use seeded PRNG to pick random cards
    const newRngCounter = game.rngCounter + 1n;
    ctx.db.Game.id.update({ ...game, rngCounter: newRngCounter });
    const seed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, player.id, newRngCounter);
    const rng = xorshift64(seed);

    // Fisher-Yates partial shuffle to select random indices
    const indices = reserveCards.map((_: any, i: number) => i);
    for (let i = indices.length - 1; i > indices.length - 1 - actualCount && i > 0; i--) {
      const j = Number(rng.next() % BigInt(i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    const pickedCards = indices.slice(indices.length - actualCount).map((i: number) => reserveCards[i]);

    // Get max deck zoneIndex for bottom placement
    let maxDeckIndex = 0n;
    if (toZone === 'deck') {
      for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
        if (c.ownerId === player.id && c.zone === 'deck' && c.zoneIndex > maxDeckIndex) {
          maxDeckIndex = c.zoneIndex;
        }
      }
    }

    const movedNames: string[] = [];
    for (let i = 0; i < pickedCards.length; i++) {
      const card = pickedCards[i];
      movedNames.push(card.cardName);

      let newZoneIndex = 0n;
      if (toZone === 'deck') {
        if (deckPosition === 'top') {
          newZoneIndex = BigInt(-(i + 1));
        } else if (deckPosition === 'bottom') {
          newZoneIndex = maxDeckIndex + BigInt(i + 1);
        }
      }

      ctx.db.CardInstance.id.update({
        ...card,
        zone: toZone,
        zoneIndex: newZoneIndex,
        posX: '',
        posY: '',
      });
    }

    // If shuffle into deck, shuffle entire deck
    if (toZone === 'deck' && deckPosition === 'shuffle') {
      const latestGame = ctx.db.Game.id.find(gameId);
      if (!latestGame) return;
      const shuffleRng = latestGame.rngCounter + 1n;
      ctx.db.Game.id.update({ ...latestGame, rngCounter: shuffleRng });

      const allDeckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
        (c: any) => c.ownerId === player.id && c.zone === 'deck'
      );
      const shuffleIndices = allDeckCards.map((_: any, idx: number) => idx);
      const shuffleSeed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, player.id, shuffleRng);
      seededShuffle(shuffleIndices, shuffleSeed);
      for (let i = 0; i < allDeckCards.length; i++) {
        ctx.db.CardInstance.id.update({ ...allDeckCards[i], zoneIndex: BigInt(shuffleIndices[i]) });
      }
    }

    const destLabel = toZone === 'deck' ? `deck (${deckPosition})` : toZone;
    logAction(ctx, gameId, player.id, 'RANDOM_RESERVE_TO_ZONE',
      JSON.stringify({ cards: movedNames, destination: destLabel, count: actualCount }),
      game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: reload_deck
// ---------------------------------------------------------------------------
export const reload_deck = spacetimedb.reducer(
  {
    gameId: t.u64(),
    deckId: t.string(),
    deckData: t.string(),
    paragon: t.string(),
  },
  (ctx, { gameId, deckId, deckData, paragon }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing' && game.status !== 'finished') throw new SenderError('Game is not in progress');

    const player = findPlayerBySender(ctx, gameId);

    // Validate deck data
    try { JSON.parse(deckData); } catch {
      throw new SenderError('Invalid deck data');
    }

    // 1. Delete all card instances and counters for this player
    for (const card of [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)]) {
      if (card.ownerId !== player.id) continue;
      for (const counter of [...ctx.db.CardCounter.card_counter_card_instance_id.filter(card.id)]) {
        ctx.db.CardCounter.id.delete(counter.id);
      }
      ctx.db.CardInstance.id.delete(card.id);
    }

    // 2. Update player's deck ID and paragon so the ParagonDrawer refreshes
    ctx.db.Player.id.update({ ...player, deckId, paragon });

    // 3. Insert new cards, shuffle, draw opening hand (reuses existing helper)
    const currentGame = ctx.db.Game.id.find(gameId);
    if (!currentGame) throw new SenderError('Game not found');
    insertCardsShuffleDraw(ctx, currentGame, player, deckData);

    logAction(ctx, gameId, player.id, 'RELOAD_DECK',
      JSON.stringify({ deckId }),
      game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: meek_card
// ---------------------------------------------------------------------------
export const meek_card = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
  },
  (ctx, { gameId, cardInstanceId }) => {
    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');

    ctx.db.CardInstance.id.update({ ...card, isMeek: true });

    if (card.zone === 'hand') return;

    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    logAction(ctx, gameId, player.id, 'MEEK', JSON.stringify({ cardInstanceId: cardInstanceId.toString(), cardName: card.cardName, cardImgFile: card.cardImgFile }), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: unmeek_card
// ---------------------------------------------------------------------------
export const unmeek_card = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
  },
  (ctx, { gameId, cardInstanceId }) => {
    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');

    ctx.db.CardInstance.id.update({ ...card, isMeek: false });

    if (card.zone === 'hand') return;

    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    logAction(ctx, gameId, player.id, 'UNMEEK', JSON.stringify({ cardInstanceId: cardInstanceId.toString(), cardName: card.cardName, cardImgFile: card.cardImgFile }), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: flip_card
// ---------------------------------------------------------------------------
export const flip_card = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
  },
  (ctx, { gameId, cardInstanceId }) => {
    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');

    ctx.db.CardInstance.id.update({ ...card, isFlipped: !card.isFlipped });

    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const newFlipped = !card.isFlipped;
    const flipPayload: Record<string, string | boolean> = { cardInstanceId: cardInstanceId.toString(), isFlipped: newFlipped };
    if (!newFlipped) {
      // Flipping face-up — include card identity
      flipPayload.cardName = card.cardName;
      flipPayload.cardImgFile = card.cardImgFile;
    }
    logAction(ctx, gameId, player.id, 'FLIP', JSON.stringify(flipPayload), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: reveal_card_in_hand
// ---------------------------------------------------------------------------
// Temporarily reveals a single hand card to opponents/spectators for a fixed
// duration. Server-authoritative via reveal_expires_at; clients compare the
// timestamp against their local clock. Clears automatically whenever a
// move-out-of-hand reducer runs.
export const reveal_card_in_hand = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
  },
  (ctx, { gameId, cardInstanceId }) => {
    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');
    if (card.ownerId !== player.id) throw new SenderError('Not your card');
    if (card.zone !== 'hand') throw new SenderError('Card must be in hand');

    // Fixed 30 second duration. Timestamps use microseconds since Unix epoch.
    const THIRTY_SECONDS_MICROS = 30_000_000n;
    const expiresAtMicros =
      ctx.timestamp.microsSinceUnixEpoch + THIRTY_SECONDS_MICROS;

    ctx.db.CardInstance.id.update({
      ...card,
      revealExpiresAt: new Timestamp(expiresAtMicros),
      revealStartedAt: ctx.timestamp,
    });

    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    const payload = {
      cardInstanceId: cardInstanceId.toString(),
      cardName: card.cardName,
      cardImgFile: card.cardImgFile,
      expiresAtMicros: expiresAtMicros.toString(),
    };
    logAction(ctx, gameId, player.id, 'REVEAL_CARD', JSON.stringify(payload), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: update_card_position
// ---------------------------------------------------------------------------
export const update_card_position = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
    posX: t.string(),
    posY: t.string(),
  },
  (ctx, { gameId, cardInstanceId, posX, posY }) => {
    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');

    // Bump zoneIndex to max + 1 so repositioned card renders on top for all clients
    let maxIdx = -1n;
    for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
      if (c.ownerId === card.ownerId && c.zone === card.zone && c.zoneIndex > maxIdx) {
        maxIdx = c.zoneIndex;
      }
    }
    ctx.db.CardInstance.id.update({ ...card, posX, posY, zoneIndex: maxIdx + 1n });
    // No logAction — too noisy
  }
);

// ---------------------------------------------------------------------------
// Reducer: add_counter
// ---------------------------------------------------------------------------
export const add_counter = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
    color: t.string(),
  },
  (ctx, { gameId, cardInstanceId, color }) => {
    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');

    // Find existing counter for this card+color
    let existingCounter: any = null;
    for (const counter of ctx.db.CardCounter.card_counter_card_instance_id.filter(cardInstanceId)) {
      if (counter.color === color) {
        existingCounter = counter;
        break;
      }
    }

    if (existingCounter) {
      ctx.db.CardCounter.id.update({ ...existingCounter, count: existingCounter.count + 1n });
    } else {
      ctx.db.CardCounter.insert({
        id: 0n,
        cardInstanceId,
        color,
        count: 1n,
      });
    }

    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    logAction(ctx, gameId, player.id, 'ADD_COUNTER', JSON.stringify({ cardInstanceId: cardInstanceId.toString(), color, cardName: card.cardName, cardImgFile: card.cardImgFile }), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: remove_counter
// ---------------------------------------------------------------------------
export const remove_counter = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
    color: t.string(),
  },
  (ctx, { gameId, cardInstanceId, color }) => {
    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');

    let existingCounter: any = null;
    for (const counter of ctx.db.CardCounter.card_counter_card_instance_id.filter(cardInstanceId)) {
      if (counter.color === color) {
        existingCounter = counter;
        break;
      }
    }

    if (!existingCounter) throw new SenderError('No counter of that color found');

    if (existingCounter.count <= 1n) {
      ctx.db.CardCounter.id.delete(existingCounter.id);
    } else {
      ctx.db.CardCounter.id.update({ ...existingCounter, count: existingCounter.count - 1n });
    }

    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    logAction(ctx, gameId, player.id, 'REMOVE_COUNTER', JSON.stringify({ cardInstanceId: cardInstanceId.toString(), color, cardName: card.cardName, cardImgFile: card.cardImgFile }), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: set_note
// ---------------------------------------------------------------------------
export const set_note = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
    text: t.string(),
  },
  (ctx, { gameId, cardInstanceId, text }) => {
    const player = findPlayerBySender(ctx, gameId);

    const trimmed = text.trim();
    if (trimmed.length > 40) throw new SenderError('Note too long (max 40 chars)');

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');

    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const previousNote = card.notes;
    ctx.db.CardInstance.id.update({ ...card, notes: trimmed });

    logAction(
      ctx,
      gameId,
      player.id,
      'SET_NOTE',
      JSON.stringify({
        cardInstanceId: cardInstanceId.toString(),
        cardName: card.cardName,
        cardImgFile: card.cardImgFile,
        note: trimmed,
        previousNote,
      }),
      game.turnNumber,
      game.currentPhase,
    );
  }
);

// ---------------------------------------------------------------------------
// Reducer: exchange_cards
// ---------------------------------------------------------------------------
export const exchange_cards = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceIds: t.string(),
  },
  (ctx, { gameId, cardInstanceIds }) => {
    const player = findPlayerBySender(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const ids: string[] = JSON.parse(cardInstanceIds);

    // Validate ownership of each card
    for (const idStr of ids) {
      const cardId = BigInt(idStr);
      const card = ctx.db.CardInstance.id.find(cardId);
      if (!card) throw new SenderError('Card not found: ' + idStr);
      if (card.gameId !== gameId) throw new SenderError('Card not in this game: ' + idStr);
    }

    // Collect card details for the log BEFORE mutating. Each card's home
    // owner is captured so taken opponent cards log as going to the opponent's
    // deck, not the actor's.
    const exchangedCards: { name: string; img: string; fromZone: string; deckOwnerId: string }[] = [];
    const affectedDeckOwners = new Set<bigint>();
    for (const idStr of ids) {
      const card = ctx.db.CardInstance.id.find(BigInt(idStr));
      if (!card) continue;
      const deckOwnerId = card.originalOwnerId !== 0n ? card.originalOwnerId : card.ownerId;
      exchangedCards.push({ name: card.cardName, img: card.cardImgFile, fromZone: card.zone, deckOwnerId: deckOwnerId.toString() });
      affectedDeckOwners.add(deckOwnerId);
    }

    // Move all cards to their home-owner's deck, flipped
    for (const idStr of ids) {
      const cardId = BigInt(idStr);
      const card = ctx.db.CardInstance.id.find(cardId);
      if (!card) continue;
      const deckOwnerId = card.originalOwnerId !== 0n ? card.originalOwnerId : card.ownerId;
      const fromZone = card.zone;
      clearCountersIfLeavingPlay(ctx, card.id, fromZone, 'deck');
      ctx.db.CardInstance.id.update({
        ...card,
        zone: 'deck',
        ownerId: deckOwnerId,
        isFlipped: true,
        ...leavePlayFieldOverrides(card, fromZone, 'deck'),
      });
    }

    // Shuffle every deck that received a card (acting player's deck always,
    // plus any opponent decks when taken cards are exchanged back).
    let rngCounter = game.rngCounter;
    for (const deckOwnerId of affectedDeckOwners) {
      rngCounter += 1n;
      const deckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
        (c: any) => c.ownerId === deckOwnerId && c.zone === 'deck'
      );
      const seed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, deckOwnerId, rngCounter);
      const indices = deckCards.map((_: any, idx: number) => idx);
      seededShuffle(indices, seed);
      for (let i = 0; i < deckCards.length; i++) {
        ctx.db.CardInstance.id.update({
          ...deckCards[i],
          zoneIndex: BigInt(indices[i]),
        });
      }
    }
    ctx.db.Game.id.update({ ...game, rngCounter });

    // Compact hand indices before drawing replacements so new cards get correct indices
    compactHandIndices(ctx, gameId, player.id);

    // Draw same number of replacement cards from the ACTING player's deck
    const latestGame = ctx.db.Game.id.find(gameId);
    if (latestGame) {
      drawCardsForPlayer(ctx, latestGame, player, ids.length);
    }

    logAction(ctx, gameId, player.id, 'EXCHANGE', JSON.stringify({ count: ids.length, cards: exchangedCards }), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: exchange_from_deck — atomic pick-specific-cards exchange
// Unlike exchange_cards (which draws random replacements), this lets the
// player choose which deck cards to swap in and where they go.
// ---------------------------------------------------------------------------
export const exchange_from_deck = spacetimedb.reducer(
  {
    gameId: t.u64(),
    exchangeCardIds: t.string(),   // JSON array of card instance IDs being sent to deck
    replacementMoves: t.string(),  // JSON array of { cardId: string, toZone: string, posX: string, posY: string }
  },
  (ctx, { gameId, exchangeCardIds, replacementMoves }) => {
    const player = findPlayerBySender(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');

    const exchangeIds: string[] = JSON.parse(exchangeCardIds);
    const moves: { cardId: string; toZone: string; posX: string; posY: string }[] = JSON.parse(replacementMoves);

    if (exchangeIds.length === 0) throw new SenderError('No cards to exchange');
    if (moves.length !== exchangeIds.length) throw new SenderError('Must pick same number of replacements as cards being exchanged');

    // Validate exchange cards exist and belong to this game. Ownership check
    // is relaxed — captured opponent cards (card.ownerId === player) pass,
    // and so do cards still under original ownership (which home-routes below).
    for (const idStr of exchangeIds) {
      const card = ctx.db.CardInstance.id.find(BigInt(idStr));
      if (!card) throw new SenderError('Exchange card not found: ' + idStr);
      if (card.gameId !== gameId) throw new SenderError('Card not in this game: ' + idStr);
    }

    // Validate replacement cards exist, are in deck, and belong to the player.
    // Replacements always come from the ACTING player's own deck.
    for (const move of moves) {
      const card = ctx.db.CardInstance.id.find(BigInt(move.cardId));
      if (!card) throw new SenderError('Replacement card not found: ' + move.cardId);
      if (card.gameId !== gameId) throw new SenderError('Card not in this game: ' + move.cardId);
      if (card.ownerId !== player.id) throw new SenderError('Card not owned by player: ' + move.cardId);
      if (card.zone !== 'deck') throw new SenderError('Replacement card not in deck: ' + move.cardId);
    }

    // Collect card details for the log BEFORE mutating. Each exchanged card
    // records its home-owner so taken opponent cards log as going to the
    // opponent's deck.
    const exchangedCards: { name: string; img: string; fromZone: string; deckOwnerId: string }[] = [];
    const affectedDeckOwners = new Set<bigint>();
    for (const idStr of exchangeIds) {
      const card = ctx.db.CardInstance.id.find(BigInt(idStr));
      if (!card) continue;
      const deckOwnerId = card.originalOwnerId !== 0n ? card.originalOwnerId : card.ownerId;
      exchangedCards.push({ name: card.cardName, img: card.cardImgFile, fromZone: card.zone, deckOwnerId: deckOwnerId.toString() });
      affectedDeckOwners.add(deckOwnerId);
    }
    const receivedCards: { name: string; img: string }[] = [];
    for (const move of moves) {
      const card = ctx.db.CardInstance.id.find(BigInt(move.cardId));
      if (card) receivedCards.push({ name: card.cardName, img: card.cardImgFile });
    }

    // Step 1: Move replacement cards from deck to their target zones
    for (const move of moves) {
      const card = ctx.db.CardInstance.id.find(BigInt(move.cardId));
      if (!card) continue;

      // Assign zoneIndex for the target zone
      let finalZoneIndex = 0n;
      if (move.toZone !== 'deck' && move.toZone !== 'hand') {
        let maxIdx = -1n;
        for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
          if (c.ownerId === player.id && c.zone === move.toZone && c.zoneIndex > maxIdx) {
            maxIdx = c.zoneIndex;
          }
        }
        finalZoneIndex = maxIdx + 1n;
      }
      if (move.toZone === 'hand') {
        finalZoneIndex = BigInt(
          [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
            (c: any) => c.ownerId === player.id && c.zone === 'hand'
          ).length
        );
      }

      ctx.db.CardInstance.id.update({
        ...card,
        zone: move.toZone,
        zoneIndex: finalZoneIndex,
        posX: move.posX,
        posY: move.posY,
        isFlipped: false, // Coming from deck = face up
      });
    }

    // Step 2: Move exchange cards to their home-owner's deck (face down)
    for (const idStr of exchangeIds) {
      const card = ctx.db.CardInstance.id.find(BigInt(idStr));
      if (!card) continue;
      const fromZone = card.zone;
      const fromOwner = card.ownerId;
      const deckOwnerId = card.originalOwnerId !== 0n ? card.originalOwnerId : card.ownerId;
      clearCountersIfLeavingPlay(ctx, card.id, fromZone, 'deck');
      ctx.db.CardInstance.id.update({
        ...card,
        zone: 'deck',
        ownerId: deckOwnerId,
        isFlipped: true,
        posX: '',
        posY: '',
        ...leavePlayFieldOverrides(card, fromZone, 'deck'),
      });
      // Compact hand/LOB against the card's PRE-move owner (that's the pile the card left)
      if (fromZone === 'hand') {
        compactHandIndices(ctx, gameId, fromOwner);
      }
      if (fromZone === 'land-of-bondage') {
        compactLobIndices(ctx, gameId, fromOwner);
      }
    }

    // Step 3: Shuffle every deck that received a card — player's deck (it lost
    // replacements) plus any opponent decks (they received taken cards back).
    affectedDeckOwners.add(player.id);
    let rngCounter = game.rngCounter;
    for (const deckOwnerId of affectedDeckOwners) {
      rngCounter += 1n;
      const deckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
        (c: any) => c.ownerId === deckOwnerId && c.zone === 'deck'
      );
      const seed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, deckOwnerId, rngCounter);
      const indices = deckCards.map((_: any, idx: number) => idx);
      seededShuffle(indices, seed);
      for (let i = 0; i < deckCards.length; i++) {
        ctx.db.CardInstance.id.update({
          ...deckCards[i],
          zoneIndex: BigInt(indices[i]),
        });
      }
    }
    ctx.db.Game.id.update({ ...game, rngCounter });

    logAction(ctx, gameId, player.id, 'EXCHANGE', JSON.stringify({ count: exchangeIds.length, cards: exchangedCards, received: receivedCards }), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: move_card_to_top_of_deck
// ---------------------------------------------------------------------------
export const move_card_to_top_of_deck = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
  },
  (ctx, { gameId, cardInstanceId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');

    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');

    const fromZone = card.zone;

    // Route to the card's original owner's deck so a taken opponent card
    // topdecks to the opponent's deck, not the acting player's.
    const homeOwnerId = card.originalOwnerId !== 0n ? card.originalOwnerId : card.ownerId;

    // Shift all existing deck cards' zoneIndex += 1 (in the target deck)
    const deckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
      (c: any) => c.ownerId === homeOwnerId && c.zone === 'deck'
    );

    for (const dc of deckCards) {
      ctx.db.CardInstance.id.update({ ...dc, zoneIndex: dc.zoneIndex + 1n });
    }

    // Update the target card: zone = 'deck', zoneIndex = 0n, owner = home
    const updatedCard = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!updatedCard) throw new SenderError('Card not found');
    clearCountersIfLeavingPlay(ctx, updatedCard.id, fromZone, 'deck');
    ctx.db.CardInstance.id.update({
      ...updatedCard,
      zone: 'deck',
      zoneIndex: 0n,
      ownerId: homeOwnerId,
      isFlipped: true,
      revealExpiresAt: undefined,
      revealStartedAt: undefined,
      ...leavePlayFieldOverrides(updatedCard, fromZone, 'deck'),
    });

    // Compact hand indices if card left hand
    if (fromZone === 'hand') {
      compactHandIndices(ctx, gameId, card.ownerId);
    }
    // Compact LOB indices if card left LOB
    if (fromZone === 'land-of-bondage') {
      compactLobIndices(ctx, gameId, card.ownerId);
    }

    // Hide card identity only when the owner moves their own hand card.
    // Cross-player moves reveal the card (both players already know it).
    const hideIdentity = card.isFlipped || (fromZone === 'hand' && player.id === card.ownerId);
    const topLogName = hideIdentity ? 'a face-down card' : card.cardName;
    const topLogImg = hideIdentity ? '' : card.cardImgFile;
    logAction(ctx, gameId, player.id, 'MOVE_TO_TOP_OF_DECK', JSON.stringify({ cardInstanceId: cardInstanceId.toString(), cardName: topLogName, cardImgFile: topLogImg, targetOwnerId: homeOwnerId.toString() }), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: move_card_to_bottom_of_deck
// ---------------------------------------------------------------------------
export const move_card_to_bottom_of_deck = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
  },
  (ctx, { gameId, cardInstanceId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');

    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');

    const fromZone = card.zone;

    // Route to the card's original owner's deck so a taken opponent card
    // bottom-decks to the opponent's deck, not the acting player's.
    const homeOwnerId = card.originalOwnerId !== 0n ? card.originalOwnerId : card.ownerId;

    // Find max zoneIndex among target deck's cards
    const deckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
      (c: any) => c.ownerId === homeOwnerId && c.zone === 'deck'
    );

    let maxIndex = -1n;
    for (const dc of deckCards) {
      if (dc.zoneIndex > maxIndex) {
        maxIndex = dc.zoneIndex;
      }
    }

    clearCountersIfLeavingPlay(ctx, card.id, fromZone, 'deck');
    ctx.db.CardInstance.id.update({
      ...card,
      zone: 'deck',
      zoneIndex: maxIndex + 1n,
      ownerId: homeOwnerId,
      isFlipped: true,
      revealExpiresAt: undefined,
      revealStartedAt: undefined,
      ...leavePlayFieldOverrides(card, fromZone, 'deck'),
    });

    // Compact hand indices if card left hand
    if (fromZone === 'hand') {
      compactHandIndices(ctx, gameId, card.ownerId);
    }
    // Compact LOB indices if card left LOB
    if (fromZone === 'land-of-bondage') {
      compactLobIndices(ctx, gameId, card.ownerId);
    }

    // Hide card identity only when the owner moves their own hand card.
    // Cross-player moves reveal the card (both players already know it).
    const hideIdentity = card.isFlipped || (fromZone === 'hand' && player.id === card.ownerId);
    const bottomLogName = hideIdentity ? 'a face-down card' : card.cardName;
    const bottomLogImg = hideIdentity ? '' : card.cardImgFile;
    logAction(ctx, gameId, player.id, 'MOVE_TO_BOTTOM_OF_DECK', JSON.stringify({ cardInstanceId: cardInstanceId.toString(), cardName: bottomLogName, cardImgFile: bottomLogImg, targetOwnerId: homeOwnerId.toString() }), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: spawn_lost_soul
// ---------------------------------------------------------------------------
export const spawn_lost_soul = spacetimedb.reducer(
  {
    gameId: t.u64(),
    testament: t.string(),
    posX: t.string(),
    posY: t.string(),
    targetPlayerId: t.string(), // "" = self, otherwise player ID to spawn in their LOB
  },
  (ctx, { gameId, testament, posX, posY, targetPlayerId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');

    const player = findPlayerBySender(ctx, gameId);

    // Determine owner: self, target player, or shared sentinel (Paragon shared LoB).
    let ownerId = player.id;
    if (targetPlayerId === '0') {
      // Paragon: spawn into the shared Land of Bondage.
      ownerId = 0n;
    } else if (targetPlayerId) {
      const target = ctx.db.Player.id.find(BigInt(targetPlayerId));
      if (!target) throw new SenderError('Target player not found');
      if (target.gameId !== gameId) throw new SenderError('Target player not in this game');
      ownerId = target.id;
    }

    const isNT = testament === 'NT';
    const cardName = isNT
      ? 'Lost Soul Token "Harvest" [John 4:35]'
      : 'Lost Soul Token "Lost Souls" [Proverbs 2:16-17]';
    const cardSet = isNT ? 'GoC' : 'RR';
    const cardImgFile = isNT ? '/gameplay/nt_soul_token.png' : '/gameplay/ot_lost_soul.png';

    // Place at the end (rightmost) of existing LOB cards
    const lobIndex = BigInt(
      [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
        (c: any) => c.ownerId === ownerId && c.zone === 'land-of-bondage'
      ).length
    );

    ctx.db.CardInstance.insert({
      id: 0n,
      gameId,
      ownerId,
      originalOwnerId: ownerId,
      zone: 'land-of-bondage',
      zoneIndex: lobIndex,
      posX,
      posY,
      isMeek: false,
      isFlipped: false,
      cardName,
      cardSet,
      cardImgFile,
      cardType: 'TOKEN_LS',
      brigade: '',
      strength: '',
      toughness: '',
      alignment: '',
      identifier: '',
      specialAbility: '',
      reference: '',
      notes: '',
      equippedToInstanceId: 0n,
      isSoulDeckOrigin: false,
      isToken: true,
      revealExpiresAt: undefined,
      revealStartedAt: undefined,
      outlineColor: '',
    });

    logAction(ctx, gameId, player.id, 'SPAWN_LOST_SOUL', JSON.stringify({ testament }), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: remove_token
// ---------------------------------------------------------------------------
export const remove_token = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
  },
  (ctx, { gameId, cardInstanceId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');
    if (!card.cardType.startsWith('TOKEN_')) throw new SenderError('Card is not a token');

    ctx.db.CardInstance.id.delete(cardInstanceId);

    logAction(ctx, gameId, player.id, 'REMOVE_TOKEN', JSON.stringify({ cardInstanceId: cardInstanceId.toString() }), game.turnNumber, game.currentPhase);
  }
);

// ===========================================================================
// Utility reducers
// ===========================================================================

// ---------------------------------------------------------------------------
// Reducer: roll_dice
// ---------------------------------------------------------------------------
export const roll_dice = spacetimedb.reducer(
  {
    gameId: t.u64(),
    sides: t.u64(),
  },
  (ctx, { gameId, sides }) => {
    const player = findPlayerBySender(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const newRngCounter = game.rngCounter + 1n;
    const seed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, player.id, newRngCounter);
    const result = seededDiceRoll(Number(sides), seed);

    const rollData = JSON.stringify({ result, sides: Number(sides), rollerId: player.id.toString() });

    ctx.db.Game.id.update({ ...game, rngCounter: newRngCounter, lastDiceRoll: rollData });

    logAction(ctx, gameId, player.id, 'ROLL_DICE', rollData, game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: send_chat
// ---------------------------------------------------------------------------
export const send_chat = spacetimedb.reducer(
  {
    gameId: t.u64(),
    text: t.string(),
  },
  (ctx, { gameId, text }) => {
    // Try to find as player first
    let senderId: bigint | null = null;

    for (const player of ctx.db.Player.player_game_id.filter(gameId)) {
      if (player.identity.toHexString() === ctx.sender.toHexString()) {
        senderId = player.id;
        break;
      }
    }

    // If not a player, try spectator
    if (senderId === null) {
      for (const spectator of ctx.db.Spectator.spectator_game_id.filter(gameId)) {
        if (spectator.identity.toHexString() === ctx.sender.toHexString()) {
          senderId = spectator.id;
          break;
        }
      }
    }

    if (senderId === null) {
      throw new SenderError('Not a participant in this game');
    }

    ctx.db.ChatMessage.insert({
      id: 0n,
      gameId,
      senderId,
      text,
      sentAt: ctx.timestamp,
    });
  }
);

// ---------------------------------------------------------------------------
// Reducer: set_player_option
// ---------------------------------------------------------------------------
export const set_player_option = spacetimedb.reducer(
  {
    gameId: t.u64(),
    optionName: t.string(),
    value: t.string(),
  },
  (ctx, { gameId, optionName, value }) => {
    const player = findPlayerBySender(ctx, gameId);

    if (optionName === 'autoRouteLostSouls') {
      ctx.db.Player.id.update({ ...player, autoRouteLostSouls: value === 'true' });
    }
  }
);

// ---------------------------------------------------------------------------
// Reducer: toggle_reveal_hand
// ---------------------------------------------------------------------------
export const toggle_reveal_hand = spacetimedb.reducer(
  {
    gameId: t.u64(),
    revealed: t.bool(),
  },
  (ctx, { gameId, revealed }) => {
    const player = findPlayerBySender(ctx, gameId);

    // Snapshot the current hand when revealing; clear when hiding. Cards drawn
    // after the reveal are not in the snapshot, so they render face-down.
    let snapshot = '[]';
    if (revealed) {
      const handIds: string[] = [];
      for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
        if (c.ownerId === player.id && c.zone === 'hand') {
          handIds.push(c.id.toString());
        }
      }
      snapshot = JSON.stringify(handIds);
    }

    ctx.db.Player.id.update({ ...player, handRevealed: revealed, handRevealSnapshot: snapshot });

    const game = ctx.db.Game.id.find(gameId);
    logAction(
      ctx,
      gameId,
      player.id,
      revealed ? 'REVEAL_HAND' : 'HIDE_HAND',
      '',
      game ? game.currentTurn : 0n,
      game ? game.currentPhase : 'draw',
    );
  }
);

// ---------------------------------------------------------------------------
// Reducer: toggle_reveal_reserve
// ---------------------------------------------------------------------------
export const toggle_reveal_reserve = spacetimedb.reducer(
  {
    gameId: t.u64(),
    revealed: t.bool(),
  },
  (ctx, { gameId, revealed }) => {
    const player = findPlayerBySender(ctx, gameId);
    ctx.db.Player.id.update({ ...player, reserveRevealed: revealed });

    const game = ctx.db.Game.id.find(gameId);
    logAction(
      ctx,
      gameId,
      player.id,
      revealed ? 'REVEAL_RESERVE' : 'HIDE_RESERVE',
      '',
      game ? game.currentTurn : 0n,
      game ? game.currentPhase : 'draw',
    );
  }
);

// ---------------------------------------------------------------------------
// Reducer: reveal_cards — broadcast revealed card IDs to all players.
// `context` is an optional JSON string carrying metadata (e.g. source card
// name + position + count for ability-triggered reveals). When present, the
// log payload wraps cardIds + context; when empty, logs cardIds directly for
// backward compatibility with the deck-menu "Reveal Top N" flow.
// ---------------------------------------------------------------------------
export const reveal_cards = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardIds: t.string(), // JSON array of card instance ID strings
    context: t.string(), // optional JSON object string; '' when omitted
  },
  (ctx, { gameId, cardIds, context }) => {
    const player = findPlayerBySender(ctx, gameId);
    ctx.db.Player.id.update({ ...player, revealedCards: cardIds });

    let logPayload = cardIds;
    if (context) {
      try {
        logPayload = JSON.stringify({ cardIds: JSON.parse(cardIds), context: JSON.parse(context) });
      } catch {
        // Malformed context — fall back to raw cardIds so the log still renders.
      }
    }

    const game = ctx.db.Game.id.find(gameId);
    logAction(
      ctx,
      gameId,
      player.id,
      'REVEAL_CARDS',
      logPayload,
      game ? game.currentTurn : 0n,
      game ? game.currentPhase : 'draw',
    );
  }
);

// ---------------------------------------------------------------------------
// Reducer: clear_revealed_cards — dismiss the reveal
// ---------------------------------------------------------------------------
export const clear_revealed_cards = spacetimedb.reducer(
  {
    gameId: t.u64(),
  },
  (ctx, { gameId }) => {
    const player = findPlayerBySender(ctx, gameId);
    ctx.db.Player.id.update({ ...player, revealedCards: '' });
  }
);

// ---------------------------------------------------------------------------
// Lifecycle: clientConnected
// ---------------------------------------------------------------------------
export const onConnect = spacetimedb.clientConnected((ctx) => {
  // Presence is revived explicitly by register_presence from the game page.
  // Reviving isConnected here would revive rows in every game the identity
  // ever joined, keeping orphaned lobbies alive whenever the creator hit any
  // other page on the site.

  // Seed cleanup schedule if none exists
  const existingCleanup = [...ctx.db.CleanupSchedule.iter()];
  if (existingCleanup.length === 0) {
    ctx.db.CleanupSchedule.insert({
      scheduledId: 0n,
      scheduledAt: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch + ONE_HOUR_MICROS),
    });
  }
});

// ---------------------------------------------------------------------------
// Reducer: log_search_deck (logs when a player searches their own deck)
// ---------------------------------------------------------------------------
export const log_search_deck = spacetimedb.reducer(
  {
    gameId: t.u64(),
  },
  (ctx, { gameId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');

    const player = findPlayerBySender(ctx, gameId);
    logAction(ctx, gameId, player.id, 'SEARCH_OWN_DECK', '', game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: log_look_at_top (logs when a player privately looks at top N cards)
// ---------------------------------------------------------------------------
export const log_look_at_top = spacetimedb.reducer(
  {
    gameId: t.u64(),
    count: t.u64(),
    sourceCardName: t.string(),
    position: t.string(),
  },
  (ctx, { gameId, count, sourceCardName, position }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');

    const player = findPlayerBySender(ctx, gameId);
    const payload = (sourceCardName || position)
      ? JSON.stringify({
          count: Number(count),
          ...(sourceCardName ? { sourceCardName } : {}),
          position: position || 'top',
        })
      : String(count);
    logAction(ctx, gameId, player.id, 'LOOK_AT_TOP', payload, game.turnNumber, game.currentPhase);
  }
);

// ===========================================================================
// Zone Search reducers
// ===========================================================================

// ---------------------------------------------------------------------------
// Reducer: request_zone_search
// ---------------------------------------------------------------------------
export const request_zone_search = spacetimedb.reducer(
  {
    gameId: t.u64(),
    zone: t.string(),
  },
  (ctx, { gameId, zone }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');

    const player = findPlayerBySender(ctx, gameId);

    if (!['deck', 'hand', 'reserve', 'hand-reveal', 'action-priority'].includes(zone)) {
      throw new SenderError('Invalid zone for search: ' + zone);
    }

    const allPlayers = [...ctx.db.Player.player_game_id.filter(gameId)];
    const opponent = allPlayers.find(p => p.id !== player.id);
    if (!opponent) throw new SenderError('Opponent not found');

    for (const req of ctx.db.ZoneSearchRequest.zone_search_request_game_id.filter(gameId)) {
      if (req.requesterId === player.id && req.status === 'pending') {
        throw new SenderError('You already have a pending search request');
      }
    }

    ctx.db.ZoneSearchRequest.insert({
      id: 0n,
      gameId,
      requesterId: player.id,
      targetPlayerId: opponent.id,
      zone,
      status: 'pending',
      createdAt: ctx.timestamp,
      action: '',
      actionParams: '',
    });

    logAction(ctx, gameId, player.id, 'REQUEST_ZONE_SEARCH', JSON.stringify({ zone, targetName: opponent.displayName }), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: request_opponent_action
// Creates a pending ZoneSearchRequest tagged with an `action` (e.g.
// 'shuffle_deck', 'draw_deck_top') and JSON params. The requester waits for
// approval and then fires the corresponding reducer client-side.
// ---------------------------------------------------------------------------
export const request_opponent_action = spacetimedb.reducer(
  {
    gameId: t.u64(),
    action: t.string(),
    actionParams: t.string(),
  },
  (ctx, { gameId, action, actionParams }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');

    const player = findPlayerBySender(ctx, gameId);

    if (!action) throw new SenderError('action required');

    const allPlayers = [...ctx.db.Player.player_game_id.filter(gameId)];
    const opponent = allPlayers.find(p => p.id !== player.id);
    if (!opponent) throw new SenderError('Opponent not found');

    for (const req of ctx.db.ZoneSearchRequest.zone_search_request_game_id.filter(gameId)) {
      if (req.requesterId === player.id && req.status === 'pending') {
        throw new SenderError('You already have a pending request');
      }
    }

    ctx.db.ZoneSearchRequest.insert({
      id: 0n,
      gameId,
      requesterId: player.id,
      targetPlayerId: opponent.id,
      zone: 'deck',
      status: 'pending',
      createdAt: ctx.timestamp,
      action,
      actionParams,
    });

    logAction(ctx, gameId, player.id, 'REQUEST_OPPONENT_ACTION', JSON.stringify({ action, actionParams, targetName: opponent.displayName }), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: approve_zone_search
// ---------------------------------------------------------------------------
export const approve_zone_search = spacetimedb.reducer(
  {
    gameId: t.u64(),
    requestId: t.u64(),
  },
  (ctx, { gameId, requestId }) => {
    const player = findPlayerBySender(ctx, gameId);
    const req = ctx.db.ZoneSearchRequest.id.find(requestId);
    if (!req) throw new SenderError('Request not found');
    if (req.gameId !== gameId) throw new SenderError('Request not in this game');
    if (req.targetPlayerId !== player.id) throw new SenderError('Only the target player can approve');
    if (req.status !== 'pending') throw new SenderError('Request is not pending');

    ctx.db.ZoneSearchRequest.id.update({ ...req, status: 'approved' });

    const game = ctx.db.Game.id.find(gameId);
    // Suppress the approval log for action requests — the action itself will
    // log a specific entry (e.g. "discarded X"), which is clearer than a
    // generic "allowed deck search" line.
    if (game && !req.action) {
      logAction(ctx, gameId, player.id, 'APPROVE_ZONE_SEARCH', JSON.stringify({ zone: req.zone }), game.turnNumber, game.currentPhase);
    }
  }
);

// ---------------------------------------------------------------------------
// Reducer: deny_zone_search
// ---------------------------------------------------------------------------
export const deny_zone_search = spacetimedb.reducer(
  {
    gameId: t.u64(),
    requestId: t.u64(),
  },
  (ctx, { gameId, requestId }) => {
    const player = findPlayerBySender(ctx, gameId);
    const req = ctx.db.ZoneSearchRequest.id.find(requestId);
    if (!req) throw new SenderError('Request not found');
    if (req.gameId !== gameId) throw new SenderError('Request not in this game');
    if (req.targetPlayerId !== player.id) throw new SenderError('Only the target player can deny');
    if (req.status !== 'pending') throw new SenderError('Request is not pending');

    const game = ctx.db.Game.id.find(gameId);
    const zone = req.zone;
    ctx.db.ZoneSearchRequest.id.delete(requestId);

    logAction(ctx, gameId, player.id, 'DENY_ZONE_SEARCH', JSON.stringify({ zone }), game ? game.turnNumber : 0n, game ? game.currentPhase : 'draw');
  }
);

// ---------------------------------------------------------------------------
// Reducer: complete_zone_search
// ---------------------------------------------------------------------------
export const complete_zone_search = spacetimedb.reducer(
  {
    gameId: t.u64(),
    requestId: t.u64(),
    shuffled: t.bool(),
  },
  (ctx, { gameId, requestId, shuffled }) => {
    const player = findPlayerBySender(ctx, gameId);
    const req = ctx.db.ZoneSearchRequest.id.find(requestId);
    if (!req) throw new SenderError('Request not found');
    if (req.gameId !== gameId) throw new SenderError('Request not in this game');
    if (req.requesterId !== player.id) throw new SenderError('Only the requester can complete');
    if (req.status !== 'approved') throw new SenderError('Request is not approved');

    const game = ctx.db.Game.id.find(gameId);
    const allPlayers = [...ctx.db.Player.player_game_id.filter(gameId)];
    const opponent = allPlayers.find(p => p.id !== player.id);
    const targetName = opponent ? opponent.displayName : 'opponent';

    // If the requester elected to shuffle on close (deck-only), shuffle the
    // target's deck inline so the whole action emits a single log entry.
    if (shuffled && req.zone === 'deck' && game) {
      const targetId = req.targetPlayerId;
      const deckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
        (c: any) => c.ownerId === targetId && c.zone === 'deck'
      );
      const newRngCounter = game.rngCounter + 1n;
      ctx.db.Game.id.update({ ...game, rngCounter: newRngCounter });
      const seed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, targetId, newRngCounter);
      const indices = deckCards.map((_: any, idx: number) => idx);
      seededShuffle(indices, seed);
      for (let i = 0; i < deckCards.length; i++) {
        ctx.db.CardInstance.id.update({
          ...deckCards[i],
          zoneIndex: BigInt(indices[i]),
        });
      }
    }

    const wasAction = !!req.action;
    ctx.db.ZoneSearchRequest.id.delete(requestId);

    // Suppress the "finished searching..." completion log for action requests —
    // the executing reducer (move_cards_batch, shuffle_opponent_deck, etc.)
    // already logs the action it performed.
    if (game && !wasAction) {
      logAction(ctx, gameId, player.id, 'COMPLETE_ZONE_SEARCH', JSON.stringify({ zone: req.zone, targetName, shuffled }), game.turnNumber, game.currentPhase);
    }
  }
);

// ---------------------------------------------------------------------------
// Reducer: move_opponent_card
// ---------------------------------------------------------------------------
export const move_opponent_card = spacetimedb.reducer(
  {
    gameId: t.u64(),
    requestId: t.u64(),
    cardInstanceId: t.u64(),
    toZone: t.string(),
    posX: t.string(),
    posY: t.string(),
    newOwnerId: t.string(),
  },
  (ctx, { gameId, requestId, cardInstanceId, toZone, posX, posY, newOwnerId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const player = findPlayerBySender(ctx, gameId);

    const req = ctx.db.ZoneSearchRequest.id.find(requestId);
    if (!req) throw new SenderError('Search request not found');
    if (req.gameId !== gameId) throw new SenderError('Request not in this game');
    if (req.requesterId !== player.id) throw new SenderError('Not your search request');
    if (req.status !== 'approved') throw new SenderError('Search request not approved');

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');

    const fromZone = card.zone;
    // Moving to deck/soul-deck = face-down; leaving deck, reserve, or soul-deck = face-up; otherwise preserve
    const isFlipped = (toZone === 'deck' || toZone === 'soul-deck') ? true : (fromZone === 'deck' || fromZone === 'reserve' || fromZone === 'soul-deck') ? false : card.isFlipped;

    // Determine final owner: if newOwnerId is provided (non-empty) and differs
    // from current owner, reassign. This handles the "take from opponent's deck
    // to my territory" case — the card should end up owned by the player whose
    // zone it was dropped into.
    let finalOwnerId = card.ownerId;
    if (newOwnerId && newOwnerId.length > 0) {
      const parsedOwnerId = BigInt(newOwnerId);
      const targetOwner = ctx.db.Player.id.find(parsedOwnerId);
      if (!targetOwner) throw new SenderError('Target owner not found');
      if (targetOwner.gameId !== gameId) throw new SenderError('Target owner not in this game');
      finalOwnerId = parsedOwnerId;
    }

    // For free-form zones, auto-assign highest zoneIndex so new cards render on top
    let finalZoneIndex = 0n;
    if (toZone !== 'deck' && toZone !== 'hand') {
      let maxIdx = -1n;
      for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
        if (c.ownerId === finalOwnerId && c.zone === toZone && c.zoneIndex > maxIdx) {
          maxIdx = c.zoneIndex;
        }
      }
      finalZoneIndex = maxIdx + 1n;
    }

    ctx.db.CardInstance.id.update({
      ...card,
      ownerId: finalOwnerId,
      zone: toZone,
      zoneIndex: finalZoneIndex,
      posX,
      posY,
      isFlipped,
    });

    // Compact hand indices if card left hand
    if (fromZone === 'hand') {
      compactHandIndices(ctx, gameId, card.ownerId);
    }
    // Compact LOB indices if card left LOB
    if (fromZone === 'land-of-bondage') {
      compactLobIndices(ctx, gameId, card.ownerId);
    }

    // Look up card owner's display name for richer log messages
    const cardOwner = ctx.db.Player.id.find(card.ownerId);
    const cardOwnerName = cardOwner ? cardOwner.displayName : 'opponent';

    logAction(ctx, gameId, player.id, 'MOVE_OPPONENT_CARD',
      JSON.stringify({
        requestId: requestId.toString(),
        cardInstanceId: cardInstanceId.toString(),
        from: fromZone,
        to: toZone,
        cardName: card.cardName,
        cardImgFile: card.cardImgFile,
        cardOwnerName,
        cardOwnerId: card.ownerId.toString(),
      }),
      game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: shuffle_opponent_deck
// Authorised via an approved ZoneSearchRequest — the requester can shuffle the
// target's deck (useful after browsing it, to randomise order they memorised).
// ---------------------------------------------------------------------------
export const shuffle_opponent_deck = spacetimedb.reducer(
  {
    gameId: t.u64(),
    requestId: t.u64(),
  },
  (ctx, { gameId, requestId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const player = findPlayerBySender(ctx, gameId);

    const req = ctx.db.ZoneSearchRequest.id.find(requestId);
    if (!req) throw new SenderError('Search request not found');
    if (req.gameId !== gameId) throw new SenderError('Request not in this game');
    if (req.requesterId !== player.id) throw new SenderError('Not your search request');
    if (req.status !== 'approved') throw new SenderError('Search request not approved');

    const targetId = req.targetPlayerId;

    // Gather all of the target's deck cards and shuffle their zoneIndex values.
    const deckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
      (c: any) => c.ownerId === targetId && c.zone === 'deck'
    );

    const newRngCounter = game.rngCounter + 1n;
    ctx.db.Game.id.update({ ...game, rngCounter: newRngCounter });

    const seed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, targetId, newRngCounter);

    const indices = deckCards.map((_: any, idx: number) => idx);
    seededShuffle(indices, seed);

    for (let i = 0; i < deckCards.length; i++) {
      ctx.db.CardInstance.id.update({
        ...deckCards[i],
        zoneIndex: BigInt(indices[i]),
      });
    }

    logAction(ctx, gameId, player.id, 'SHUFFLE_OPPONENT_DECK',
      JSON.stringify({ requestId: requestId.toString(), targetPlayerId: targetId.toString() }),
      game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Lifecycle: clientDisconnected
// ---------------------------------------------------------------------------
export const onDisconnect = spacetimedb.clientDisconnected((ctx) => {
  // Find all player rows for this identity and set disconnected
  for (const player of ctx.db.Player.player_identity.filter(ctx.sender)) {
    const gameForPlayer = ctx.db.Game.id.find(player.gameId);
    ctx.db.Player.id.update({ ...player, isConnected: false });

    // For waiting and pregame, use a 30-second grace window — long enough to survive
    // WebSocket reconnections and page refreshes. The client proactively
    // calls leave_game on navigation, so this is only a fallback for
    // crashes/network drops.
    // For playing games, use the normal 5-minute timeout.
    const timeoutMicros = gameForPlayer && gameForPlayer.status === 'playing'
      ? 300_000_000n  // 5 minutes for active games
      : 30_000_000n;  // 30 seconds for waiting and pregame
    const futureTime = ctx.timestamp.microsSinceUnixEpoch + timeoutMicros;
    ctx.db.DisconnectTimeout.insert({
      scheduledId: 0n,
      scheduledAt: ScheduleAt.time(futureTime),
      gameId: player.gameId,
      playerId: player.id,
    });
  }
});
