import spacetimedb from './schema';
export default spacetimedb;
import { DisconnectTimeout, setDisconnectTimeoutReducer } from './schema';
import { t, SenderError } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';
import { makeSeed, seededShuffle, seededDiceRoll, xorshift64, generateGameCode } from './utils';

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
// Helper: drawCardsForPlayer
// ---------------------------------------------------------------------------
function drawCardsForPlayer(ctx: any, game: any, player: any, count: number): number {
  let drawn = 0;

  for (let i = 0; i < count; i++) {
    // Find top card in deck (lowest zoneIndex)
    let topCard: any = null;
    for (const card of ctx.db.CardInstance.card_instance_game_id.filter(game.id)) {
      if (card.ownerId === player.id && card.zone === 'deck') {
        if (topCard === null || card.zoneIndex < topCard.zoneIndex) {
          topCard = card;
        }
      }
    }

    if (!topCard) break; // No more cards in deck

    // Check if auto-route lost souls
    const isLostSoul =
      player.autoRouteLostSouls &&
      (topCard.cardType === 'LS' || topCard.cardName.toLowerCase().includes('lost soul'));

    if (isLostSoul) {
      // Move to land-of-bondage
      const lobIndex = BigInt(
        [...ctx.db.CardInstance.card_instance_game_id.filter(game.id)].filter(
          (c: any) => c.ownerId === player.id && c.zone === 'land-of-bondage'
        ).length
      );
      ctx.db.CardInstance.id.update({
        ...topCard,
        zone: 'land-of-bondage',
        isFlipped: false,
        zoneIndex: lobIndex,
      });
      drawn++;
      // Draw a replacement — extend the loop
      count++;
    } else {
      // Move to hand
      const handIndex = BigInt(
        [...ctx.db.CardInstance.card_instance_game_id.filter(game.id)].filter(
          (c: any) => c.ownerId === player.id && c.zone === 'hand'
        ).length
      );
      ctx.db.CardInstance.id.update({
        ...topCard,
        zone: 'hand',
        isFlipped: false,
        zoneIndex: handIndex,
      });
      drawn++;
    }
  }

  return drawn;
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
      zone: 'deck',
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
      notes: '',
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
// Reducer: create_game
// ---------------------------------------------------------------------------
export const create_game = spacetimedb.reducer(
  {
    code: t.string(),
    deckId: t.string(),
    displayName: t.string(),
    format: t.string(),
    supabaseUserId: t.string(),
    deckData: t.string(),
    isPublic: t.bool(),
    lobbyMessage: t.string(),
  },
  (ctx, { code, deckId, displayName, format, supabaseUserId, deckData, isPublic, lobbyMessage }) => {
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
    });

    // Insert player row with pending deck data (cards loaded later during pregame)
    const player = ctx.db.Player.insert({
      id: 0n,
      gameId: game.id,
      identity: ctx.sender,
      seat: 0n,
      deckId,
      displayName,
      supabaseUserId,
      isConnected: true,
      autoRouteLostSouls: true,
      pendingDeckData: deckData,
    });

    // Log action
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
    supabaseUserId: t.string(),
    deckData: t.string(),
  },
  (ctx, { code, deckId, displayName, supabaseUserId, deckData }) => {
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

    // Insert player (seat=1) with pending deck data (cards loaded later during pregame)
    const player = ctx.db.Player.insert({
      id: 0n,
      gameId: game.id,
      identity: ctx.sender,
      seat: 1n,
      deckId,
      displayName,
      supabaseUserId,
      isConnected: true,
      autoRouteLostSouls: true,
      pendingDeckData: deckData,
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
    ctx.db.Game.id.update({
      ...gameBeforeUpdate,
      status: 'pregame',
      pregamePhase: 'rolling',
      rollResult0: BigInt(r0),
      rollResult1: BigInt(r1),
      rollWinner: winner,
      rngCounter: gameBeforeUpdate.rngCounter + 1n,
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

    // Cards were already loaded in pregame_ready — just start the game
    const latestGame = ctx.db.Game.id.find(gameId);
    if (!latestGame) throw new SenderError('Game not found');
    ctx.db.Game.id.update({
      ...latestGame,
      status: 'playing',
      pregamePhase: '',
      currentTurn: chosenSeat,
      currentPhase: 'draw',
      turnNumber: 1n,
    });

    logAction(ctx, gameId, player.id, 'GAME_STARTED',
      JSON.stringify({ chosenSeat: chosenSeat.toString(), chosenBy: player.displayName }),
      1n, 'draw');
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
);

// Wire the scheduled reducer to the schema's forward reference
setDisconnectTimeoutReducer(handle_disconnect_timeout);

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
    const newTurnNumber = game.turnNumber + 1n;

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

    drawCardsForPlayer(ctx, game, player, Number(count));

    logAction(ctx, gameId, player.id, 'DRAW_MULTIPLE', JSON.stringify({ count: count.toString() }), game.turnNumber, game.currentPhase);
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
  },
  (ctx, { gameId, cardInstanceId, toZone, zoneIndex, posX, posY }) => {
    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.ownerId !== player.id) throw new SenderError('Not your card');

    const fromZone = card.zone;
    const isFlipped = toZone === 'deck';

    ctx.db.CardInstance.id.update({
      ...card,
      zone: toZone,
      zoneIndex: zoneIndex ? BigInt(zoneIndex) : 0n,
      posX,
      posY,
      isFlipped,
    });

    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    logAction(ctx, gameId, player.id, 'MOVE_CARD', JSON.stringify({ cardInstanceId: cardInstanceId.toString(), from: fromZone, to: toZone }), game.turnNumber, game.currentPhase);
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
  },
  (ctx, { gameId, cardInstanceIds, toZone, positions }) => {
    const player = findPlayerBySender(ctx, gameId);

    const ids: string[] = JSON.parse(cardInstanceIds);
    const posMap: Record<string, { posX: string; posY: string }> = JSON.parse(positions);

    for (const idStr of ids) {
      const cardId = BigInt(idStr);
      const card = ctx.db.CardInstance.id.find(cardId);
      if (!card) throw new SenderError('Card not found: ' + idStr);
      if (card.ownerId !== player.id) throw new SenderError('Not your card: ' + idStr);

      const pos = posMap[idStr] || { posX: '', posY: '' };
      const isFlipped = toZone === 'deck';

      ctx.db.CardInstance.id.update({
        ...card,
        zone: toZone,
        posX: pos.posX,
        posY: pos.posY,
        isFlipped,
      });
    }

    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    logAction(ctx, gameId, player.id, 'MOVE_CARDS_BATCH', JSON.stringify({ count: ids.length, toZone }), game.turnNumber, game.currentPhase);
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
    if (card.ownerId !== player.id) throw new SenderError('Not your card');

    // Move card to deck
    ctx.db.CardInstance.id.update({
      ...card,
      zone: 'deck',
      isFlipped: true,
    });

    // Now shuffle entire deck (same logic as shuffle_deck)
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

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

    logAction(ctx, gameId, player.id, 'SHUFFLE_INTO_DECK', JSON.stringify({ cardInstanceId: cardInstanceId.toString() }), game.turnNumber, game.currentPhase);
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
    if (card.ownerId !== player.id) throw new SenderError('Not your card');

    ctx.db.CardInstance.id.update({ ...card, isMeek: true });

    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    logAction(ctx, gameId, player.id, 'MEEK', JSON.stringify({ cardInstanceId: cardInstanceId.toString() }), game.turnNumber, game.currentPhase);
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
    if (card.ownerId !== player.id) throw new SenderError('Not your card');

    ctx.db.CardInstance.id.update({ ...card, isMeek: false });

    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    logAction(ctx, gameId, player.id, 'UNMEEK', JSON.stringify({ cardInstanceId: cardInstanceId.toString() }), game.turnNumber, game.currentPhase);
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
    if (card.ownerId !== player.id) throw new SenderError('Not your card');

    ctx.db.CardInstance.id.update({ ...card, isFlipped: !card.isFlipped });

    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    logAction(ctx, gameId, player.id, 'FLIP', JSON.stringify({ cardInstanceId: cardInstanceId.toString(), isFlipped: !card.isFlipped }), game.turnNumber, game.currentPhase);
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
    if (card.ownerId !== player.id) throw new SenderError('Not your card');

    ctx.db.CardInstance.id.update({ ...card, posX, posY });
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
    if (card.ownerId !== player.id) throw new SenderError('Not your card');

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

    logAction(ctx, gameId, player.id, 'ADD_COUNTER', JSON.stringify({ cardInstanceId: cardInstanceId.toString(), color }), game.turnNumber, game.currentPhase);
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
    if (card.ownerId !== player.id) throw new SenderError('Not your card');

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

    logAction(ctx, gameId, player.id, 'REMOVE_COUNTER', JSON.stringify({ cardInstanceId: cardInstanceId.toString(), color }), game.turnNumber, game.currentPhase);
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

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.ownerId !== player.id) throw new SenderError('Not your card');

    ctx.db.CardInstance.id.update({ ...card, notes: text });
    // No logAction
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
      if (card.ownerId !== player.id) throw new SenderError('Not your card: ' + idStr);
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

    // Draw same number of replacement cards
    const latestGame = ctx.db.Game.id.find(gameId);
    if (latestGame) {
      drawCardsForPlayer(ctx, latestGame, player, ids.length);
    }

    logAction(ctx, gameId, player.id, 'EXCHANGE', JSON.stringify({ count: ids.length }), game.turnNumber, game.currentPhase);
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
    if (card.ownerId !== player.id) throw new SenderError('Not your card');

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

    logAction(ctx, gameId, player.id, 'MOVE_TO_TOP_OF_DECK', JSON.stringify({ cardInstanceId: cardInstanceId.toString() }), game.turnNumber, game.currentPhase);
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
    if (card.ownerId !== player.id) throw new SenderError('Not your card');

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

    logAction(ctx, gameId, player.id, 'MOVE_TO_BOTTOM_OF_DECK', JSON.stringify({ cardInstanceId: cardInstanceId.toString() }), game.turnNumber, game.currentPhase);
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
  },
  (ctx, { gameId, testament, posX, posY }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');

    const player = findPlayerBySender(ctx, gameId);

    const isNT = testament === 'NT';
    const cardName = isNT
      ? 'Lost Soul Token "Harvest" [John 4:35]'
      : 'Lost Soul Token "Lost Souls" [Proverbs 2:16-17]';
    const cardSet = isNT ? 'GoC' : 'RR';
    const cardImgFile = isNT ? '/gameplay/nt_soul_token.png' : '/gameplay/ot_lost_soul.png';

    ctx.db.CardInstance.insert({
      id: 0n,
      gameId,
      ownerId: player.id,
      zone: 'land-of-bondage',
      zoneIndex: 0n,
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
      notes: '',
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
    if (card.ownerId !== player.id) throw new SenderError('Not your card');
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
// Lifecycle: clientConnected
// ---------------------------------------------------------------------------
spacetimedb.clientConnected((ctx) => {
  // Find all player rows for this identity and set connected
  for (const player of ctx.db.Player.iter()) {
    if (player.identity.toHexString() === ctx.sender.toHexString()) {
      ctx.db.Player.id.update({ ...player, isConnected: true });

      // Cancel any pending disconnect timeouts for this player
      for (const timeout of ctx.db.DisconnectTimeout.iter()) {
        if (timeout.playerId === player.id) {
          ctx.db.DisconnectTimeout.scheduledId.delete(timeout.scheduledId);
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Lifecycle: clientDisconnected
// ---------------------------------------------------------------------------
spacetimedb.clientDisconnected((ctx) => {
  // Find all player rows for this identity and set disconnected
  for (const player of ctx.db.Player.iter()) {
    if (player.identity.toHexString() === ctx.sender.toHexString()) {
      ctx.db.Player.id.update({ ...player, isConnected: false });

      // If game is in waiting or pregame, cancel immediately — no state to preserve
      const gameForPlayer = ctx.db.Game.id.find(player.gameId);
      if (gameForPlayer && (gameForPlayer.status === 'waiting' || gameForPlayer.status === 'pregame')) {
        ctx.db.Game.id.update({ ...gameForPlayer, status: 'finished' });
        logAction(
          ctx,
          player.gameId,
          player.id,
          gameForPlayer.status === 'waiting' ? 'LOBBY_DISCONNECT' : 'PREGAME_DISCONNECT',
          JSON.stringify({ reason: 'player_disconnected' }),
          0n,
          gameForPlayer.status
        );
        continue; // Skip scheduling timeout — game is cancelled
      }

      // Schedule a disconnect timeout (5 minutes)
      const futureTime = ctx.timestamp.microsSinceUnixEpoch + 300_000_000n;
      ctx.db.DisconnectTimeout.insert({
        scheduledId: 0n,
        scheduledAt: ScheduleAt.time(futureTime),
        gameId: player.gameId,
        playerId: player.id,
      });
    }
  }
});
