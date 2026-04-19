import spacetimedb from './schema';
export default spacetimedb;
import { DisconnectTimeout, setDisconnectTimeoutReducer, ChooseFirstTimeout, setChooseFirstTimeoutReducer, CleanupSchedule, setCleanupStaleGamesReducer } from './schema';
import { t, SenderError } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';
import { makeSeed, seededShuffle, seededDiceRoll, xorshift64, generateGameCode } from './utils';
import { getAbilitiesForCard, findTokenCard, type CardAbility } from './cardAbilities';

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
// ---------------------------------------------------------------------------
function compactHandIndices(ctx: any, gameId: bigint, playerId: bigint) {
  const handCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
    (c: any) => c.ownerId === playerId && c.zone === 'hand'
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
function compactLobIndices(ctx: any, gameId: bigint, playerId: bigint) {
  const lobCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
    (c: any) => c.ownerId === playerId && c.zone === 'land-of-bondage'
  );
  lobCards.sort((a: any, b: any) => (a.zoneIndex < b.zoneIndex ? -1 : a.zoneIndex > b.zoneIndex ? 1 : 0));
  for (let i = 0; i < lobCards.length; i++) {
    if (lobCards[i].zoneIndex !== BigInt(i)) {
      ctx.db.CardInstance.id.update({ ...lobCards[i], zoneIndex: BigInt(i) });
    }
  }
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
    deckPos++;

    // Check if auto-route lost souls
    const isLostSoul =
      player.autoRouteLostSouls &&
      (topCard.cardType === 'LS' || topCard.cardName.toLowerCase().includes('lost soul'));

    if (isLostSoul) {
      // Move to land-of-bondage
      ctx.db.CardInstance.id.update({
        ...topCard,
        zone: 'land-of-bondage',
        isFlipped: false,
        zoneIndex: BigInt(lobCount),
      });
      lobCount++;
      drawn++;
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
  // Insert 21 shared soul cards (ownerId = 0n sentinel)
  for (let i = 0; i < PARAGON_SOUL_DEFS.length; i++) {
    const def = PARAGON_SOUL_DEFS[i];
    ctx.db.CardInstance.insert({
      id: 0n,
      gameId: game.id,
      ownerId: 0n,
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

  const lob = gameCards.filter((c: any) => c.zone === 'land-of-bondage');
  const inPlayOrigin = lob.filter((c: any) => c.isSoulDeckOrigin === true).length;
  const needed = 3 - inPlayOrigin;
  if (needed <= 0) return;

  const soulDeck = gameCards
    .filter((c: any) => c.ownerId === 0n && c.zone === 'soul-deck')
    .sort((a: any, b: any) => (a.zoneIndex < b.zoneIndex ? -1 : a.zoneIndex > b.zoneIndex ? 1 : 0));
  if (soulDeck.length === 0) return;

  // LoB index assignment — continue after current highest
  let maxLobIdx = -1n;
  for (const c of lob) {
    if (c.zoneIndex > maxLobIdx) maxLobIdx = c.zoneIndex;
  }

  const take = Math.min(needed, soulDeck.length);
  for (let i = 0; i < take; i++) {
    maxLobIdx = maxLobIdx + 1n;
    ctx.db.CardInstance.id.update({
      ...soulDeck[i],
      zone: 'land-of-bondage',
      zoneIndex: maxLobIdx,
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
    console.log('[stdb-debug] create_game called — code:', code, 'sender:', ctx.sender.toHexString());
    // Validate code is not already in use by an active game
    for (const g of ctx.db.Game.game_code.filter(code)) {
      console.log('[stdb-debug] create_game — existing game with code:', String(g.id), 'status:', g.status);
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
      reserveRevealed: false,
      pendingDeckData: deckData,
      revealedCards: '',
    });

    // Log action
    console.log('[stdb-debug] create_game — SUCCESS — gameId:', String(game.id), 'status:', game.status);
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

    logAction(ctx, game.id, player.id, 'PREGAME_ROLL',
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

    logAction(ctx, gameId, player.id, 'PREGAME_ROLL',
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
    for (const timeout of ctx.db.ChooseFirstTimeout.iter()) {
      if (timeout.gameId === gameId) {
        ctx.db.ChooseFirstTimeout.scheduledId.delete(timeout.scheduledId);
      }
    }

    // Transition to revealing phase — show who goes first before starting
    const latestGame = ctx.db.Game.id.find(gameId);
    if (!latestGame) throw new SenderError('Game not found');
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
      let chosenName = 'Player ' + (Number(chosenSeat) + 1);
      for (const p of [...ctx.db.Player.player_game_id.filter(gameId)]) {
        if (p.seat === chosenSeat) {
          chosenName = p.displayName;
          break;
        }
      }

      // Paragon soul deck was initialized earlier, when the phase first
      // transitioned out of 'rolling' (see pregame_acknowledge_roll and
      // pregame_skip_to_reveal).

      ctx.db.Game.id.update({
        ...updatedGame,
        status: 'playing',
        pregamePhase: '',
        currentPhase: 'draw',
        turnNumber: 1n,
      });

      logAction(ctx, gameId, player.id, 'GAME_STARTED',
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
    if (game.status !== 'pregame') throw new SenderError('Game is not in pregame');
    if (game.pregamePhase !== 'deck_select') throw new SenderError('Not in deck select phase');

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

    // 1. Abandon waiting games older than 1 hour
    for (const game of [...ctx.db.Game.iter()]) {
      if (game.status === 'waiting' && (now - game.createdAt.microsSinceUnixEpoch) > ONE_HOUR_MICROS) {
        ctx.db.Game.id.update({ ...game, status: 'finished' });
      }
    }

    // 2. Abandon pregame games older than 30 minutes
    for (const game of [...ctx.db.Game.iter()]) {
      if (game.status === 'pregame' && (now - game.createdAt.microsSinceUnixEpoch) > THIRTY_MIN_MICROS) {
        ctx.db.Game.id.update({ ...game, status: 'finished' });
      }
    }

    // 3. Abandon playing games where both players disconnected, no recent activity
    for (const game of [...ctx.db.Game.iter()]) {
      if (game.status !== 'playing') continue;
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
    }

    // 4. Delete data for finished games older than 24 hours
    for (const game of [...ctx.db.Game.iter()]) {
      if (game.status !== 'finished') continue;
      if ((now - game.createdAt.microsSinceUnixEpoch) <= TWENTY_FOUR_HOURS_MICROS) continue;

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

    logAction(ctx, gameId, player.id, 'DRAW_MULTIPLE', JSON.stringify({ count: result.drawn.toString(), cards: result.cards }), game.turnNumber, game.currentPhase);
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

    // Tokens dropped into non-play zones are deleted, not moved.
    // Parallels the goldfish cleanup rule at gameReducer.ts:92. Runs BEFORE the
    // lost-soul redirect so tokens always delete (never redirect to LOB) even if
    // they happen to be lost-soul-typed.
    const TOKEN_REMOVE_ZONES = ['reserve', 'banish', 'discard', 'hand', 'deck'];
    if (card.isToken && TOKEN_REMOVE_ZONES.includes(toZone)) {
      ctx.db.CardInstance.id.delete(cardInstanceId);
      if (fromZone === 'hand') compactHandIndices(ctx, gameId, card.ownerId);
      if (fromZone === 'land-of-bondage') compactLobIndices(ctx, gameId, card.ownerId);
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

    // Lost souls sent to discard or reserve go to land-of-bondage instead
    const isLostSoul = card.cardType === 'LS' || card.cardName.toLowerCase().includes('lost soul');
    if (isLostSoul && (toZone === 'discard' || toZone === 'reserve' || toZone === 'banish')) {
      const lobIndex = BigInt(
        [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
          (c: any) => c.ownerId === card.ownerId && c.zone === 'land-of-bondage'
        ).length
      );
      ctx.db.CardInstance.id.update({
        ...card,
        zone: 'land-of-bondage',
        zoneIndex: lobIndex,
        posX: '',
        posY: '',
        isFlipped: false,
        ownerId: card.ownerId,
      });
      const actionWord = toZone === 'discard' ? 'discarded' : toZone === 'reserve' ? 'reserved' : 'banished';
      const redirectLogName = card.cardName;
      const redirectLogImg = card.cardImgFile;
      logAction(ctx, gameId, player.id, 'MOVE_CARD', JSON.stringify({ cardInstanceId: cardInstanceId.toString(), from: fromZone, to: 'land-of-bondage', cardName: redirectLogName, cardImgFile: redirectLogImg, redirected: actionWord }), game.turnNumber, game.currentPhase);
      // Compact hand indices if card left hand
      if (fromZone === 'hand') {
        compactHandIndices(ctx, gameId, card.ownerId);
      }
      // Compact LOB indices if card left LOB
      if (fromZone === 'land-of-bondage') {
        compactLobIndices(ctx, gameId, card.ownerId);
      }
      return;
    }

    // Moving to deck/soul-deck = face-down; leaving deck, reserve, or soul-deck = face-up; otherwise preserve
    const isFlipped = (toZone === 'deck' || toZone === 'soul-deck') ? true : (fromZone === 'deck' || fromZone === 'reserve' || fromZone === 'soul-deck') ? false : card.isFlipped;
    // Optionally transfer ownership (e.g. rescue lost soul, capture hero)
    let newOwnerId = targetOwnerId ? BigInt(targetOwnerId) : card.ownerId;
    // Paragon: dropping a soul-origin card back into the shared LoB resets ownership to the shared sentinel.
    if (
      targetOwnerId === '0' &&
      card.isSoulDeckOrigin === true &&
      toZone === 'land-of-bondage'
    ) {
      newOwnerId = 0n;
    }

    // Paragon: rescuing a shared soul transfers ownership to the acting seat.
    let resolvedOwnerId = newOwnerId;
    if (
      card.ownerId === 0n &&
      card.isSoulDeckOrigin === true &&
      card.zone === 'land-of-bondage' &&
      toZone !== 'land-of-bondage' &&
      toZone !== 'soul-deck'
    ) {
      resolvedOwnerId = player.id;
    }

    // For free-form zones (territory), auto-assign highest zoneIndex so new cards render on top
    let finalZoneIndex = zoneIndex ? BigInt(zoneIndex) : 0n;
    if (!zoneIndex && toZone !== 'deck' && toZone !== 'hand') {
      let maxIdx = -1n;
      for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
        if (c.ownerId === (newOwnerId) && c.zone === toZone && c.zoneIndex > maxIdx) {
          maxIdx = c.zoneIndex;
        }
      }
      finalZoneIndex = maxIdx + 1n;
    }
    if (!zoneIndex && toZone === 'hand') {
      finalZoneIndex = BigInt(
        [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
          (c: any) => c.ownerId === newOwnerId && c.zone === 'hand'
        ).length
      );
    }

    // Auto-unlink cascade: when the mover leaves its current zone, clear its
    // own equippedTo and cascade to any accessories pointing at it.
    //
    // Redemption rule: a warrior going from Territory to LOB drags its weapons
    // to Discard. All other host-leaves-zone cases (soul rescued from LOB,
    // same-zone reposition, etc.) just unlink accessories in place.
    const leavingZone = toZone !== fromZone;
    const clearEquippedOnMover = leavingZone && card.equippedToInstanceId !== 0n;
    ctx.db.CardInstance.id.update({
      ...card,
      zone: toZone,
      zoneIndex: finalZoneIndex,
      posX,
      posY,
      isFlipped,
      ownerId: resolvedOwnerId,
      equippedToInstanceId: clearEquippedOnMover ? 0n : card.equippedToInstanceId,
    });

    if (leavingZone) {
      const sendAccessoriesToDiscard =
        fromZone === 'territory' && toZone === 'land-of-bondage';
      const attachedAccessories = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
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
          ctx.db.CardInstance.id.update({
            ...accessory,
            zone: 'discard',
            zoneIndex: maxDiscardIdx + 1n,
            posX: '',
            posY: '',
            equippedToInstanceId: 0n,
          });
        } else {
          ctx.db.CardInstance.id.update({ ...accessory, equippedToInstanceId: 0n });
        }
      }
    }

    // Log when the card changes zones OR changes ownership (e.g. territory → opponent's territory)
    const ownerChanged = newOwnerId !== card.ownerId;
    if (fromZone !== toZone || ownerChanged) {
      // Hide card identity when moving from hand to hidden zones (deck/reserve) — hand contents are private
      const hideIdentity = isFlipped || (fromZone === 'hand' && (toZone === 'deck' || toZone === 'reserve'));
      const logName = hideIdentity ? 'a face-down card' : card.cardName;
      const logImg = hideIdentity ? '' : card.cardImgFile;
      logAction(ctx, gameId, player.id, 'MOVE_CARD', JSON.stringify({ cardInstanceId: cardInstanceId.toString(), from: fromZone, to: toZone, cardName: logName, cardImgFile: logImg, targetOwnerId: targetOwnerId || '' }), game.turnNumber, game.currentPhase);
      // Compact hand indices if card left hand
      if (fromZone === 'hand') {
        compactHandIndices(ctx, gameId, card.ownerId);
      }
      // Compact LOB indices if card left LOB
      if (fromZone === 'land-of-bondage') {
        compactLobIndices(ctx, gameId, card.ownerId);
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
    const movedCards: { name: string; img: string }[] = [];
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

    // Accessory cascade pre-pass: redirect accessories-whose-host-is-in-the-batch
    // to Discard only for the warrior→LOB case (host in Territory, batch going
    // to LOB). All other cross-zone scenarios let the accessory travel with
    // the batch (or unlink in place, handled below).
    //
    // We also capture each mover's original zone here so the post-pass cascade
    // can distinguish "actually left zone" from "same-zone reposition".
    const finalZoneById = new Map<string, string>();
    const originalZoneById = new Map<string, string>();
    for (const idStr of ids) {
      const c = ctx.db.CardInstance.id.find(BigInt(idStr));
      if (!c) continue;
      originalZoneById.set(idStr, c.zone);
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

      // Hide card identity when moving from hand to hidden zones (deck/reserve) — hand contents are private
      const hideIdentity = isFlipped || (card.zone === 'hand' && (toZone === 'deck' || toZone === 'reserve'));
      const logName = hideIdentity ? 'a face-down card' : card.cardName;
      const logImg = hideIdentity ? '' : card.cardImgFile;
      cards.push({ name: logName, img: logImg });
      if (sourceOwnerId === null && card.ownerId !== player.id) {
        sourceOwnerId = card.ownerId;
      }
      const cardOwnerChanged = newOwnerId !== null && newOwnerId !== card.ownerId;
      if (card.zone !== toZone || cardOwnerChanged) {
        movedCards.push({ name: logName, img: logImg });
        if (card.zone === 'hand') {
          handCompactOwners.add(card.ownerId);
        }
        if (card.zone === 'land-of-bondage') {
          lobCompactOwners.add(card.ownerId);
        }
      }

      // Lost souls sent to discard or reserve go to land-of-bondage instead
      const isLostSoul = card.cardType === 'LS' || card.cardName.toLowerCase().includes('lost soul');
      if (isLostSoul && (toZone === 'discard' || toZone === 'reserve' || toZone === 'banish')) {
        const lobIndex = BigInt(
          [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
            (c: any) => c.ownerId === card.ownerId && c.zone === 'land-of-bondage'
          ).length
        );
        ctx.db.CardInstance.id.update({
          ...card,
          zone: 'land-of-bondage',
          zoneIndex: lobIndex,
          posX: '',
          posY: '',
          isFlipped: false,
          ownerId: card.ownerId,
        });
        redirectedLostSouls.push({ name: logName, img: logImg });
        continue;
      }

      const rawPos = posMap[idStr] || { posX: '', posY: '' };
      // Ensure posX/posY are strings — client may send numbers via JSON positions map
      const pos = { posX: String(rawPos.posX ?? ''), posY: String(rawPos.posY ?? '') };
      const cardOwnerId = newOwnerId ?? card.ownerId;
      const cardFinalZone = finalZoneById.get(idStr) ?? toZone;
      // Paragon: rescuing a shared soul transfers ownership to the acting seat.
      let resolvedCardOwnerId = cardOwnerId;
      if (
        card.ownerId === 0n &&
        card.isSoulDeckOrigin === true &&
        card.zone === 'land-of-bondage' &&
        cardFinalZone !== 'land-of-bondage' &&
        cardFinalZone !== 'soul-deck'
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
      const leavingZone = cardFinalZone !== card.zone;

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
      }

      // Clear pos when redirected (the client-supplied coords were for `toZone`, not discard)
      const finalPosX = cardFinalZone === toZone ? pos.posX : '';
      const finalPosY = cardFinalZone === toZone ? pos.posY : '';

      ctx.db.CardInstance.id.update({
        ...card,
        zone: cardFinalZone,
        zoneIndex: finalZoneIndex,
        posX: finalPosX,
        posY: finalPosY,
        isFlipped,
        ownerId: resolvedCardOwnerId,
        equippedToInstanceId: leavingZone ? 0n : card.equippedToInstanceId,
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
      if (moverFinalZone === originalZone) continue;
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
          ctx.db.CardInstance.id.update({
            ...accessory,
            zone: 'discard',
            zoneIndex: maxDiscardIdx + 1n,
            posX: '',
            posY: '',
            equippedToInstanceId: 0n,
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
      case 'custom':
        throw new SenderError('Custom abilities are dispatched by the client, not this reducer');
    }
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

    // Move card to deck (card keeps its ownerId — it goes into that player's deck)
    const deckOwnerId = card.ownerId;
    ctx.db.CardInstance.id.update({
      ...card,
      zone: 'deck',
      isFlipped: true,
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

    // Compact hand indices after cards were removed from hand
    compactHandIndices(ctx, gameId, player.id);

    const destLabel = toZone === 'deck' ? `deck (${deckPosition})` : toZone;
    logAction(ctx, gameId, player.id, 'RANDOM_HAND_TO_ZONE',
      JSON.stringify({ cards: movedNames, destination: destLabel, count: actualCount }),
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
    if (card.ownerId !== player.id) throw new SenderError('Not your card');

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

    // Collect card details for the log BEFORE mutating
    const exchangedCards: { name: string; img: string; fromZone: string }[] = [];
    for (const idStr of ids) {
      const card = ctx.db.CardInstance.id.find(BigInt(idStr));
      if (card) exchangedCards.push({ name: card.cardName, img: card.cardImgFile, fromZone: card.zone });
    }

    // Move all cards to deck, flipped
    for (const idStr of ids) {
      const cardId = BigInt(idStr);
      const card = ctx.db.CardInstance.id.find(cardId);
      if (card) {
        ctx.db.CardInstance.id.update({ ...card, zone: 'deck', isFlipped: true });
      }
    }

    // Shuffle deck
    const deckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
      (c: any) => c.ownerId === player.id && c.zone === 'deck'
    );

    const newRngCounter = game.rngCounter + 1n;
    ctx.db.Game.id.update({ ...game, rngCounter: newRngCounter });

    const seed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, player.id, newRngCounter);

    const indices = deckCards.map((_: any, idx: number) => idx);
    seededShuffle(indices, seed);

    for (let i = 0; i < deckCards.length; i++) {
      ctx.db.CardInstance.id.update({
        ...deckCards[i],
        zoneIndex: BigInt(indices[i]),
      });
    }

    // Compact hand indices before drawing replacements so new cards get correct indices
    compactHandIndices(ctx, gameId, player.id);

    // Draw same number of replacement cards
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

    // Validate exchange cards exist, belong to this game, and are owned by the player
    for (const idStr of exchangeIds) {
      const card = ctx.db.CardInstance.id.find(BigInt(idStr));
      if (!card) throw new SenderError('Exchange card not found: ' + idStr);
      if (card.gameId !== gameId) throw new SenderError('Card not in this game: ' + idStr);
      if (card.ownerId !== player.id) throw new SenderError('Card not owned by player: ' + idStr);
    }

    // Validate replacement cards exist, are in deck, and belong to the player
    for (const move of moves) {
      const card = ctx.db.CardInstance.id.find(BigInt(move.cardId));
      if (!card) throw new SenderError('Replacement card not found: ' + move.cardId);
      if (card.gameId !== gameId) throw new SenderError('Card not in this game: ' + move.cardId);
      if (card.ownerId !== player.id) throw new SenderError('Card not owned by player: ' + move.cardId);
      if (card.zone !== 'deck') throw new SenderError('Replacement card not in deck: ' + move.cardId);
    }

    // Collect card details for the log BEFORE mutating
    const exchangedCards: { name: string; img: string; fromZone: string }[] = [];
    for (const idStr of exchangeIds) {
      const card = ctx.db.CardInstance.id.find(BigInt(idStr));
      if (card) exchangedCards.push({ name: card.cardName, img: card.cardImgFile, fromZone: card.zone });
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

    // Step 2: Move exchange cards to deck (face down)
    for (const idStr of exchangeIds) {
      const card = ctx.db.CardInstance.id.find(BigInt(idStr));
      if (!card) continue;
      const fromZone = card.zone;
      ctx.db.CardInstance.id.update({ ...card, zone: 'deck', isFlipped: true, posX: '', posY: '' });
      // Compact hand/LOB if needed
      if (fromZone === 'hand') {
        compactHandIndices(ctx, gameId, player.id);
      }
      if (fromZone === 'land-of-bondage') {
        compactLobIndices(ctx, gameId, player.id);
      }
    }

    // Step 3: Shuffle deck
    const deckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
      (c: any) => c.ownerId === player.id && c.zone === 'deck'
    );
    const newRngCounter = game.rngCounter + 1n;
    ctx.db.Game.id.update({ ...game, rngCounter: newRngCounter });
    const seed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, player.id, newRngCounter);
    const indices = deckCards.map((_: any, idx: number) => idx);
    seededShuffle(indices, seed);
    for (let i = 0; i < deckCards.length; i++) {
      ctx.db.CardInstance.id.update({
        ...deckCards[i],
        zoneIndex: BigInt(indices[i]),
      });
    }

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

    // Shift all existing deck cards' zoneIndex += 1
    const deckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
      (c: any) => c.ownerId === player.id && c.zone === 'deck'
    );

    for (const dc of deckCards) {
      ctx.db.CardInstance.id.update({ ...dc, zoneIndex: dc.zoneIndex + 1n });
    }

    // Update the target card: zone = 'deck', zoneIndex = 0n
    const updatedCard = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!updatedCard) throw new SenderError('Card not found');
    ctx.db.CardInstance.id.update({
      ...updatedCard,
      zone: 'deck',
      zoneIndex: 0n,
      isFlipped: true,
    });

    // Compact hand indices if card left hand
    if (fromZone === 'hand') {
      compactHandIndices(ctx, gameId, card.ownerId);
    }
    // Compact LOB indices if card left LOB
    if (fromZone === 'land-of-bondage') {
      compactLobIndices(ctx, gameId, card.ownerId);
    }

    // Hide card identity when moving from hand — hand contents are private
    const hideIdentity = card.isFlipped || fromZone === 'hand';
    const topLogName = hideIdentity ? 'a face-down card' : card.cardName;
    const topLogImg = hideIdentity ? '' : card.cardImgFile;
    logAction(ctx, gameId, player.id, 'MOVE_TO_TOP_OF_DECK', JSON.stringify({ cardInstanceId: cardInstanceId.toString(), cardName: topLogName, cardImgFile: topLogImg, targetOwnerId: card.ownerId.toString() }), game.turnNumber, game.currentPhase);
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

    // Find max zoneIndex among player's deck cards
    const deckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
      (c: any) => c.ownerId === player.id && c.zone === 'deck'
    );

    let maxIndex = -1n;
    for (const dc of deckCards) {
      if (dc.zoneIndex > maxIndex) {
        maxIndex = dc.zoneIndex;
      }
    }

    ctx.db.CardInstance.id.update({
      ...card,
      zone: 'deck',
      zoneIndex: maxIndex + 1n,
      isFlipped: true,
    });

    // Compact hand indices if card left hand
    if (fromZone === 'hand') {
      compactHandIndices(ctx, gameId, card.ownerId);
    }
    // Compact LOB indices if card left LOB
    if (fromZone === 'land-of-bondage') {
      compactLobIndices(ctx, gameId, card.ownerId);
    }

    // Hide card identity when moving from hand — hand contents are private
    const hideIdentity = card.isFlipped || fromZone === 'hand';
    const bottomLogName = hideIdentity ? 'a face-down card' : card.cardName;
    const bottomLogImg = hideIdentity ? '' : card.cardImgFile;
    logAction(ctx, gameId, player.id, 'MOVE_TO_BOTTOM_OF_DECK', JSON.stringify({ cardInstanceId: cardInstanceId.toString(), cardName: bottomLogName, cardImgFile: bottomLogImg, targetOwnerId: card.ownerId.toString() }), game.turnNumber, game.currentPhase);
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
    ctx.db.Player.id.update({ ...player, handRevealed: revealed });

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
// Reducer: reveal_cards — broadcast revealed card IDs to all players
// ---------------------------------------------------------------------------
export const reveal_cards = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardIds: t.string(), // JSON array of card instance ID strings
  },
  (ctx, { gameId, cardIds }) => {
    const player = findPlayerBySender(ctx, gameId);
    ctx.db.Player.id.update({ ...player, revealedCards: cardIds });

    const game = ctx.db.Game.id.find(gameId);
    logAction(
      ctx,
      gameId,
      player.id,
      'REVEAL_CARDS',
      cardIds,
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
  console.log('[stdb-debug] clientConnected:', ctx.sender.toHexString());
  // Find all player rows for this identity and set connected
  for (const player of ctx.db.Player.iter()) {
    if (player.identity.toHexString() === ctx.sender.toHexString()) {
      const game = ctx.db.Game.id.find(player.gameId);
      console.log('[stdb-debug] clientConnected — player:', String(player.id), 'game:', String(player.gameId), 'gameStatus:', game?.status);
      ctx.db.Player.id.update({ ...player, isConnected: true });

      // Cancel any pending disconnect timeouts for this player
      for (const timeout of ctx.db.DisconnectTimeout.iter()) {
        if (timeout.playerId === player.id) {
          ctx.db.DisconnectTimeout.scheduledId.delete(timeout.scheduledId);
        }
      }

      // Reset disconnectTimeoutFired if it was set
      if (game && game.disconnectTimeoutFired) {
        ctx.db.Game.id.update({ ...game, disconnectTimeoutFired: false });
      }
    }
  }

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
  },
  (ctx, { gameId, count }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');

    const player = findPlayerBySender(ctx, gameId);
    logAction(ctx, gameId, player.id, 'LOOK_AT_TOP', String(count), game.turnNumber, game.currentPhase);
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
  },
  (ctx, { gameId, requestId, cardInstanceId, toZone, posX, posY }) => {
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

    // For free-form zones, auto-assign highest zoneIndex so new cards render on top
    let finalZoneIndex = 0n;
    if (toZone !== 'deck' && toZone !== 'hand') {
      let maxIdx = -1n;
      for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
        if (c.ownerId === card.ownerId && c.zone === toZone && c.zoneIndex > maxIdx) {
          maxIdx = c.zoneIndex;
        }
      }
      finalZoneIndex = maxIdx + 1n;
    }

    ctx.db.CardInstance.id.update({
      ...card,
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
  console.log('[stdb-debug] clientDisconnected:', ctx.sender.toHexString());
  // Find all player rows for this identity and set disconnected
  for (const player of ctx.db.Player.iter()) {
    if (player.identity.toHexString() === ctx.sender.toHexString()) {
      const gameForPlayer = ctx.db.Game.id.find(player.gameId);
      console.log('[stdb-debug] clientDisconnected — player:', String(player.id), 'game:', String(player.gameId), 'gameStatus:', gameForPlayer?.status);
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
  }
});
