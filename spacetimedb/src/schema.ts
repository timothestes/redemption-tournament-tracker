import { schema, table, t } from 'spacetimedb/server';

// ---------------------------------------------------------------------------
// 1. Game
// ---------------------------------------------------------------------------
export const Game = table(
  {
    name: 'game',
    public: true,
    indexes: [
      { accessor: 'game_code', algorithm: 'btree' as const, columns: ['code'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    code: t.string(),
    status: t.string(),           // "waiting" | "playing" | "finished"
    currentTurn: t.u64(),         // seat number: 0 or 1
    currentPhase: t.string(),     // "draw" | "upkeep" | "preparation" | "battle" | "discard"
    turnNumber: t.u64(),
    format: t.string(),           // "T1" | "T2" | "Paragon"
    rngCounter: t.u64(),
    lastDiceRoll: t.string(),     // JSON: { result, sides, rollerId }
    createdAt: t.timestamp(),
    createdBy: t.identity(),
    isPublic: t.bool(),
    lobbyMessage: t.string(),
    createdByName: t.string(),
    pregamePhase: t.string(),     // "" | "deck_select" | "rolling" | "choosing"
    pregameReady0: t.bool(),      // seat 0 ready (reused for roll ack)
    pregameReady1: t.bool(),      // seat 1 ready (reused for roll ack)
    rollWinner: t.string(),       // "" | "0" | "1" — string to avoid 0n ambiguity
    rollResult0: t.u64(),         // d20 result for seat 0
    rollResult1: t.u64(),         // d20 result for seat 1
    rematchRequestedBy: t.string(), // "" | "0" | "1" — seat that requested rematch
    rematchDeckId0: t.string(),     // seat 0's deck ID for rematch
    rematchDeckData0: t.string(),   // seat 0's deck data for rematch
    rematchDeckId1: t.string(),     // seat 1's deck ID for rematch
    rematchDeckData1: t.string(),   // seat 1's deck data for rematch
    rematchResponse: t.string(),    // "" | "accepted" | "declined"
    rematchCode: t.string(),        // new game code for rematch
    disconnectTimeoutFired: t.bool().default(false), // true when timeout fired during active game
  }
);

// ---------------------------------------------------------------------------
// 2. Player
// ---------------------------------------------------------------------------
export const Player = table(
  {
    name: 'player',
    public: true,
    indexes: [
      { accessor: 'player_game_id', algorithm: 'btree' as const, columns: ['gameId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64(),
    identity: t.identity(),
    seat: t.u64(),                // 0 or 1
    deckId: t.string(),
    displayName: t.string(),
    supabaseUserId: t.string(),
    isConnected: t.bool(),
    autoRouteLostSouls: t.bool(),
    handRevealed: t.bool(),       // When true, hand is visible to opponent
    pendingDeckData: t.string(),  // JSON deck data, stored until game starts
    revealedCards: t.string(),    // JSON array of card instance IDs revealed from deck, "" when none
    reserveRevealed: t.bool().default(false), // When true, reserve is visible to opponent
  }
);

// ---------------------------------------------------------------------------
// 3. CardInstance
// ---------------------------------------------------------------------------
export const CardInstance = table(
  {
    name: 'card_instance',
    public: true,
    indexes: [
      { accessor: 'card_instance_game_id', algorithm: 'btree' as const, columns: ['gameId'] },
      { accessor: 'card_instance_owner_id', algorithm: 'btree' as const, columns: ['ownerId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64(),
    ownerId: t.u64(),
    zone: t.string(),             // "deck" | "hand" | "territory" | "land-of-bondage" | "land-of-redemption" | "discard" | "reserve" | "banish" | "paragon"
    zoneIndex: t.u64(),
    posX: t.string(),             // stringified number (empty string if unset)
    posY: t.string(),             // stringified number (empty string if unset)
    isMeek: t.bool(),
    isFlipped: t.bool(),
    cardName: t.string(),
    cardSet: t.string(),
    cardImgFile: t.string(),
    cardType: t.string(),
    brigade: t.string(),
    strength: t.string(),
    toughness: t.string(),
    alignment: t.string(),
    identifier: t.string(),
    specialAbility: t.string(),
    notes: t.string(),
  }
);

// ---------------------------------------------------------------------------
// 4. CardCounter
// ---------------------------------------------------------------------------
export const CardCounter = table(
  {
    name: 'card_counter',
    public: true,
    indexes: [
      { accessor: 'card_counter_card_instance_id', algorithm: 'btree' as const, columns: ['cardInstanceId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    cardInstanceId: t.u64(),
    color: t.string(),
    count: t.u64(),
  }
);

// ---------------------------------------------------------------------------
// 5. GameAction
// ---------------------------------------------------------------------------
export const GameAction = table(
  {
    name: 'game_action',
    public: true,
    indexes: [
      { accessor: 'game_action_game_id', algorithm: 'btree' as const, columns: ['gameId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64(),
    playerId: t.u64(),
    actionType: t.string(),
    payload: t.string(),          // JSON
    turnNumber: t.u64(),
    phase: t.string(),
    timestamp: t.timestamp(),
  }
);

// ---------------------------------------------------------------------------
// 6. ChatMessage
// ---------------------------------------------------------------------------
export const ChatMessage = table(
  {
    name: 'chat_message',
    public: true,
    indexes: [
      { accessor: 'chat_message_game_id', algorithm: 'btree' as const, columns: ['gameId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64(),
    senderId: t.u64(),
    text: t.string(),
    sentAt: t.timestamp(),
  }
);

// ---------------------------------------------------------------------------
// 7. Spectator
// ---------------------------------------------------------------------------
export const Spectator = table(
  {
    name: 'spectator',
    public: true,
    indexes: [
      { accessor: 'spectator_game_id', algorithm: 'btree' as const, columns: ['gameId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64(),
    identity: t.identity(),
    displayName: t.string(),
  }
);

// ---------------------------------------------------------------------------
// 8. DisconnectTimeout (scheduled table)
//    The `scheduled` option references a reducer that will be defined in
//    index.ts (Task 4). We use a forward reference via arrow function —
//    the arrow defers evaluation so the module loads without the reducer
//    existing yet. The actual reducer will be wired up at import time.
// ---------------------------------------------------------------------------

// Forward-reference placeholder — will be set by index.ts before schema
// resolution occurs. The arrow function in `scheduled` defers evaluation.
let _handleDisconnectTimeout: any;
export const setDisconnectTimeoutReducer = (reducer: any) => {
  _handleDisconnectTimeout = reducer;
};

export const DisconnectTimeout = table(
  {
    name: 'disconnect_timeout',
    public: true,
    scheduled: () => _handleDisconnectTimeout,
  },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    gameId: t.u64(),
    playerId: t.u64(),
  }
);

// ---------------------------------------------------------------------------
// 9. ZoneSearchRequest
// ---------------------------------------------------------------------------
export const ZoneSearchRequest = table(
  {
    name: 'zone_search_request',
    public: true,
    indexes: [
      { accessor: 'zone_search_request_game_id', algorithm: 'btree' as const, columns: ['gameId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64(),
    requesterId: t.u64(),
    targetPlayerId: t.u64(),
    zone: t.string(),
    status: t.string(),
    createdAt: t.timestamp(),
  }
);

// ---------------------------------------------------------------------------
// 10. ChooseFirstTimeout (scheduled table)
//     Server-side enforcement of the 30-second choosing phase timer.
//     If the roll winner doesn't choose in time, auto-selects them to go first.
// ---------------------------------------------------------------------------

let _handleChooseFirstTimeout: any;
export const setChooseFirstTimeoutReducer = (reducer: any) => {
  _handleChooseFirstTimeout = reducer;
};

export const ChooseFirstTimeout = table(
  {
    name: 'choose_first_timeout',
    public: true,
    scheduled: () => _handleChooseFirstTimeout,
  },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    gameId: t.u64(),
  }
);

// ---------------------------------------------------------------------------
// 11. CleanupSchedule (scheduled table)
// ---------------------------------------------------------------------------

let _handleCleanupStaleGames: any;
export const setCleanupStaleGamesReducer = (reducer: any) => {
  _handleCleanupStaleGames = reducer;
};

export const CleanupSchedule = table(
  {
    name: 'cleanup_schedule',
    public: true,
    scheduled: () => _handleCleanupStaleGames,
  },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

// ---------------------------------------------------------------------------
// Schema export
// ---------------------------------------------------------------------------
const spacetimedb = schema({
  Game,
  Player,
  CardInstance,
  CardCounter,
  GameAction,
  ChatMessage,
  Spectator,
  DisconnectTimeout,
  ZoneSearchRequest,
  ChooseFirstTimeout,
  CleanupSchedule,
});

export default spacetimedb;
