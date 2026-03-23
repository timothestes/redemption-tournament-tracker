import spacetimedb from './schema';
import { DisconnectTimeout, setDisconnectTimeoutReducer } from './schema';
import { t, SenderError } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';
import { makeSeed, seededShuffle, generateGameCode } from './utils';

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
    deckId: t.string(),
    displayName: t.string(),
    format: t.string(),
    supabaseUserId: t.string(),
    deckData: t.string(),
  },
  (ctx, { deckId, displayName, format, supabaseUserId, deckData }) => {
    // Generate game code
    const codeSeed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, 0n, 0n, 0n);
    let code = generateGameCode(codeSeed);

    // Check uniqueness among active games, regenerate if collision
    let attempts = 0;
    let collision = true;
    while (collision && attempts < 10) {
      collision = false;
      for (const g of ctx.db.Game.game_code.filter(code)) {
        if (g.status !== 'finished') {
          collision = true;
          break;
        }
      }
      if (collision) {
        attempts++;
        const retrySeed = makeSeed(
          ctx.timestamp.microsSinceUnixEpoch,
          0n,
          0n,
          BigInt(attempts)
        );
        code = generateGameCode(retrySeed);
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
    });

    // Insert player row
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
    });

    // Insert cards, shuffle, and draw opening hand
    insertCardsShuffleDraw(ctx, game, player, deckData);

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

    // Insert player (seat=1)
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
    });

    // Insert cards, shuffle, and draw opening hand
    insertCardsShuffleDraw(ctx, game, player, deckData);

    // Update game to playing state
    const latestGame = ctx.db.Game.id.find(game.id);
    if (!latestGame) throw new SenderError('Game not found');
    ctx.db.Game.id.update({
      ...latestGame,
      status: 'playing',
      currentTurn: 0n,
      currentPhase: 'draw',
      turnNumber: 1n,
    });

    // Log action
    logAction(ctx, game.id, player.id, 'GAME_STARTED', '', 1n, 'draw');
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
