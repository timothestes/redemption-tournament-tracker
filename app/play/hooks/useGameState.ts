'use client';

import { useMemo, useCallback } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from '@/lib/spacetimedb/module_bindings';
import type {
  Game,
  Player,
  CardInstance,
  CardCounter,
  ChatMessage,
  GameAction,
  Spectator,
} from '@/lib/spacetimedb/module_bindings/types';

// ---------------------------------------------------------------------------
// Row types inferred from the generated type objects
// ---------------------------------------------------------------------------
type GameRow = Game;
type PlayerRow = Player;
type CardInstanceRow = CardInstance;
type CardCounterRow = CardCounter;
type ChatMessageRow = ChatMessage;
type GameActionRow = GameAction;
type SpectatorRow = Spectator;

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface GameState {
  // All games (used for game discovery by code before gameId is known)
  allGames: GameRow[];

  // Core data
  game: GameRow | undefined;
  myPlayer: PlayerRow | undefined;
  opponentPlayer: PlayerRow | undefined;
  myCards: Record<string, CardInstanceRow[]>;
  opponentCards: Record<string, CardInstanceRow[]>;
  isMyTurn: boolean;
  counters: Map<bigint, CardCounterRow[]>;
  chatMessages: ChatMessageRow[];
  gameActions: GameActionRow[];
  spectators: SpectatorRow[];
  soulsRescued: { me: number; opponent: number };
  zoneSearchRequests: any[];
  incomingSearchRequest: any | null;
  approvedSearchRequest: any | null;

  // Loading state
  isLoading: boolean;

  // Connection identity (as hex string for comparisons)
  identityHex: string | undefined;

  // Action methods — each wraps a SpacetimeDB reducer call
  drawCard: () => void;
  drawMultiple: (count: bigint) => void;
  moveCard: (cardInstanceId: bigint, toZone: string, zoneIndex?: string, posX?: string, posY?: string, targetOwnerId?: string) => void;
  moveCardsBatch: (cardInstanceIds: string, toZone: string, positions?: string, targetOwnerId?: string) => void;
  shuffleDeck: () => void;
  shuffleCardIntoDeck: (cardInstanceId: bigint) => void;
  reloadDeck: (deckId: string, deckData: string) => void;
  randomHandToZone: (count: number, toZone: string, deckPosition: string) => void;
  meekCard: (cardInstanceId: bigint) => void;
  unmeekCard: (cardInstanceId: bigint) => void;
  flipCard: (cardInstanceId: bigint) => void;
  updateCardPosition: (cardInstanceId: bigint, posX: string, posY: string) => void;
  addCounter: (cardInstanceId: bigint, color: string) => void;
  removeCounter: (cardInstanceId: bigint, color: string) => void;
  setNote: (cardInstanceId: bigint, text: string) => void;
  exchangeCards: (cardInstanceIds: string) => void;
  setPhase: (phase: string) => void;
  endTurn: () => void;
  rollDice: (sides: bigint) => void;
  sendChat: (text: string) => void;
  setPlayerOption: (optionName: string, value: string) => void;
  moveCardToTopOfDeck: (cardInstanceId: bigint) => void;
  moveCardToBottomOfDeck: (cardInstanceId: bigint) => void;
  spawnLostSoul: (testament: string, posX: string, posY: string) => void;
  removeToken: (cardInstanceId: bigint) => void;
  resignGame: () => void;
  leaveGame: () => void;
  // Pregame ceremony actions
  pregameReady: (ready: boolean) => void;
  pregameAcknowledgeRoll: () => void;
  pregameChooseFirst: (chosenSeat: bigint) => void;
  pregameChangeDeck: (deckId: string, deckData: string) => void;
  // Rematch actions
  requestRematch: (deckId: string, deckData: string) => void;
  respondRematch: (accepted: boolean, deckId: string, deckData: string) => void;
  requestZoneSearch: (zone: string) => void;
  approveZoneSearch: (requestId: bigint) => void;
  denyZoneSearch: (requestId: bigint) => void;
  completeZoneSearch: (requestId: bigint) => void;
  moveOpponentCard: (requestId: bigint, cardInstanceId: bigint, toZone: string, posX?: string, posY?: string) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useGameState(gameId: bigint): GameState {
  // Connection + identity from SpacetimeDB provider
  const spacetimeCtx = useSpacetimeDB() as any;
  const conn = spacetimeCtx?.getConnection?.() ?? null;
  const identity = spacetimeCtx?.identity;

  const identityHex: string | undefined = identity?.toHexString?.();

  // ---------------------------------------------------------------------------
  // Subscribe to all relevant tables.
  // useTable returns ALL rows for the subscribed table — we filter client-side.
  // ---------------------------------------------------------------------------
  const [allGames, gamesLoading] = useTable(tables.Game) as [GameRow[], boolean];
  const [allPlayers, playersLoading] = useTable(tables.Player) as [PlayerRow[], boolean];
  const [allCards, cardsLoading] = useTable(tables.CardInstance) as [CardInstanceRow[], boolean];
  const [allCounters, countersLoading] = useTable(tables.CardCounter) as [CardCounterRow[], boolean];
  const [allChat, chatLoading] = useTable(tables.ChatMessage) as [ChatMessageRow[], boolean];
  const [allActions, actionsLoading] = useTable(tables.GameAction) as [GameActionRow[], boolean];
  const [allSpectators, spectatorsLoading] = useTable(tables.Spectator) as [SpectatorRow[], boolean];
  const [allZoneSearchRequests, zsrLoading] = useTable(tables.ZoneSearchRequest) as [any[], boolean];

  // useTable returns [rows, subscribeApplied] where subscribeApplied=true means data is ready
  // Only require core tables (game, player, cards) — chat/actions/spectators can load async
  const isLoading = !(gamesLoading && playersLoading && cardsLoading);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const game = useMemo(
    () => allGames.find((g) => g.id === gameId),
    [allGames, gameId],
  );

  const gamePlayers = useMemo(
    () => allPlayers.filter((p) => p.gameId === gameId),
    [allPlayers, gameId],
  );

  const myPlayer = useMemo(
    () =>
      identityHex
        ? gamePlayers.find((p) => (p.identity as any)?.toHexString?.() === identityHex)
        : undefined,
    [gamePlayers, identityHex],
  );

  const opponentPlayer = useMemo(
    () =>
      identityHex
        ? gamePlayers.find((p) => (p.identity as any)?.toHexString?.() !== identityHex)
        : undefined,
    [gamePlayers, identityHex],
  );

  const isMyTurn = useMemo(
    () => (game && myPlayer ? game.currentTurn === myPlayer.seat : false),
    [game, myPlayer],
  );

  // Cards for this game, grouped by owner and zone
  const gameCards = useMemo(
    () => allCards.filter((c) => c.gameId === gameId),
    [allCards, gameId],
  );

  const myCards = useMemo(() => {
    if (!myPlayer) return {} as Record<string, CardInstanceRow[]>;
    return groupCardsByZone(gameCards.filter((c) => c.ownerId === myPlayer.id));
  }, [gameCards, myPlayer]);

  const opponentCards = useMemo(() => {
    if (!opponentPlayer) return {} as Record<string, CardInstanceRow[]>;
    return groupCardsByZone(gameCards.filter((c) => c.ownerId === opponentPlayer.id));
  }, [gameCards, opponentPlayer]);

  // Counters indexed by cardInstanceId
  const counters = useMemo(() => {
    const map = new Map<bigint, CardCounterRow[]>();
    // Only include counters for cards that belong to this game
    const gameCardIds = new Set(gameCards.map((c) => c.id));
    for (const counter of allCounters) {
      if (!gameCardIds.has(counter.cardInstanceId)) continue;
      const existing = map.get(counter.cardInstanceId);
      if (existing) {
        existing.push(counter);
      } else {
        map.set(counter.cardInstanceId, [counter]);
      }
    }
    return map;
  }, [allCounters, gameCards]);

  // Chat messages for this game, sorted by sentAt
  const chatMessages = useMemo(
    () =>
      allChat
        .filter((m) => m.gameId === gameId)
        .sort((a, b) => {
          const aTime = Number((a.sentAt as any).microsSinceUnixEpoch / BigInt(1000));
          const bTime = Number((b.sentAt as any).microsSinceUnixEpoch / BigInt(1000));
          return aTime - bTime;
        }),
    [allChat, gameId],
  );

  // Game actions for this game, sorted by id ascending
  const gameActions = useMemo(
    () =>
      allActions
        .filter((a) => a.gameId === gameId)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    [allActions, gameId],
  );

  // Spectators for this game
  const spectators = useMemo(
    () => allSpectators.filter((s) => s.gameId === gameId),
    [allSpectators, gameId],
  );

  // Souls rescued — count cards in "land-of-redemption" zone per player
  const soulsRescued = useMemo(() => {
    const myLor = myCards['land-of-redemption'] ?? [];
    const oppLor = opponentCards['land-of-redemption'] ?? [];
    return { me: myLor.length, opponent: oppLor.length };
  }, [myCards, opponentCards]);

  const zoneSearchRequests = useMemo(
    () => allZoneSearchRequests.filter((r: any) => r.gameId === gameId),
    [allZoneSearchRequests, gameId],
  );

  const incomingSearchRequest = useMemo(() => {
    if (!myPlayer) return null;
    return zoneSearchRequests.find((r: any) => r.targetPlayerId === myPlayer.id && r.status === 'pending') ?? null;
  }, [zoneSearchRequests, myPlayer]);

  const approvedSearchRequest = useMemo(() => {
    if (!myPlayer) return null;
    return zoneSearchRequests.find((r: any) => r.requesterId === myPlayer.id && r.status === 'approved') ?? null;
  }, [zoneSearchRequests, myPlayer]);

  // ---------------------------------------------------------------------------
  // Action methods — each wraps a SpacetimeDB reducer call using object syntax
  // ---------------------------------------------------------------------------

  const drawCard = useCallback(() => {
    conn?.reducers.drawCard({ gameId });
  }, [conn, gameId]);

  const drawMultiple = useCallback(
    (count: bigint) => {
      conn?.reducers.drawMultiple({ gameId, count });
    },
    [conn, gameId],
  );

  const moveCard = useCallback(
    (cardInstanceId: bigint, toZone: string, zoneIndex?: string, posX?: string, posY?: string, targetOwnerId?: string) => {
      conn?.reducers.moveCard({
        gameId,
        cardInstanceId,
        toZone,
        zoneIndex: zoneIndex || '0',
        posX: posX || '',
        posY: posY || '',
        targetOwnerId: targetOwnerId || '',
      });
    },
    [conn, gameId],
  );

  const moveCardsBatch = useCallback(
    (cardInstanceIds: string, toZone: string, positions?: string, targetOwnerId?: string) => {
      conn?.reducers.moveCardsBatch({
        gameId,
        cardInstanceIds,
        toZone,
        positions: positions || '{}',
        targetOwnerId: targetOwnerId || '',
      });
    },
    [conn, gameId],
  );

  const shuffleDeck = useCallback(() => {
    conn?.reducers.shuffleDeck({ gameId });
  }, [conn, gameId]);

  const shuffleCardIntoDeck = useCallback(
    (cardInstanceId: bigint) => {
      conn?.reducers.shuffleCardIntoDeck({ gameId, cardInstanceId });
    },
    [conn, gameId],
  );

  const randomHandToZone = useCallback(
    (count: number, toZone: string, deckPosition: string) => {
      conn?.reducers.randomHandToZone({ gameId, count: BigInt(count), toZone, deckPosition });
    },
    [conn, gameId],
  );

  const reloadDeck = useCallback(
    (deckId: string, deckData: string) => {
      conn?.reducers.reloadDeck({ gameId, deckId, deckData });
    },
    [conn, gameId],
  );

  const meekCard = useCallback(
    (cardInstanceId: bigint) => {
      conn?.reducers.meekCard({ gameId, cardInstanceId });
    },
    [conn, gameId],
  );

  const unmeekCard = useCallback(
    (cardInstanceId: bigint) => {
      conn?.reducers.unmeekCard({ gameId, cardInstanceId });
    },
    [conn, gameId],
  );

  const flipCard = useCallback(
    (cardInstanceId: bigint) => {
      conn?.reducers.flipCard({ gameId, cardInstanceId });
    },
    [conn, gameId],
  );

  const updateCardPosition = useCallback(
    (cardInstanceId: bigint, posX: string, posY: string) => {
      conn?.reducers.updateCardPosition({ gameId, cardInstanceId, posX, posY });
    },
    [conn, gameId],
  );

  const addCounter = useCallback(
    (cardInstanceId: bigint, color: string) => {
      conn?.reducers.addCounter({ gameId, cardInstanceId, color });
    },
    [conn, gameId],
  );

  const removeCounter = useCallback(
    (cardInstanceId: bigint, color: string) => {
      conn?.reducers.removeCounter({ gameId, cardInstanceId, color });
    },
    [conn, gameId],
  );

  const setNote = useCallback(
    (cardInstanceId: bigint, text: string) => {
      conn?.reducers.setNote({ gameId, cardInstanceId, text });
    },
    [conn, gameId],
  );

  const exchangeCards = useCallback(
    (cardInstanceIds: string) => {
      conn?.reducers.exchangeCards({ gameId, cardInstanceIds });
    },
    [conn, gameId],
  );

  const setPhase = useCallback(
    (phase: string) => {
      conn?.reducers.setPhase({ gameId, phase });
    },
    [conn, gameId],
  );

  const endTurn = useCallback(() => {
    conn?.reducers.endTurn({ gameId });
  }, [conn, gameId]);

  const rollDice = useCallback(
    (sides: bigint) => {
      conn?.reducers.rollDice({ gameId, sides });
    },
    [conn, gameId],
  );

  const sendChat = useCallback(
    (text: string) => {
      conn?.reducers.sendChat({ gameId, text });
    },
    [conn, gameId],
  );

  const setPlayerOption = useCallback(
    (optionName: string, value: string) => {
      conn?.reducers.setPlayerOption({ gameId, optionName, value });
    },
    [conn, gameId],
  );

  const moveCardToTopOfDeck = useCallback(
    (cardInstanceId: bigint) => {
      conn?.reducers.moveCardToTopOfDeck({ gameId, cardInstanceId });
    },
    [conn, gameId],
  );

  const moveCardToBottomOfDeck = useCallback(
    (cardInstanceId: bigint) => {
      conn?.reducers.moveCardToBottomOfDeck({ gameId, cardInstanceId });
    },
    [conn, gameId],
  );

  const spawnLostSoul = useCallback(
    (testament: string, posX: string, posY: string) => {
      conn?.reducers.spawnLostSoul({ gameId, testament, posX, posY });
    },
    [conn, gameId],
  );

  const removeToken = useCallback(
    (cardInstanceId: bigint) => {
      conn?.reducers.removeToken({ gameId, cardInstanceId });
    },
    [conn, gameId],
  );

  const resignGame = useCallback(() => {
    conn?.reducers.resignGame({ gameId });
  }, [conn, gameId]);

  const leaveGame = useCallback(() => {
    conn?.reducers.leaveGame({ gameId });
  }, [conn, gameId]);

  const pregameReady = useCallback((ready: boolean) => {
    conn?.reducers.pregameReady({ gameId, ready });
  }, [conn, gameId]);

  const pregameAcknowledgeRoll = useCallback(() => {
    conn?.reducers.pregameAcknowledgeRoll({ gameId });
  }, [conn, gameId]);

  const pregameChooseFirst = useCallback((chosenSeat: bigint) => {
    conn?.reducers.pregameChooseFirst({ gameId, chosenSeat });
  }, [conn, gameId]);

  const pregameChangeDeck = useCallback((deckId: string, deckData: string) => {
    conn?.reducers.pregameChangeDeck({ gameId, deckId, deckData });
  }, [conn, gameId]);

  const requestRematch = useCallback((deckId: string, deckData: string) => {
    conn?.reducers.requestRematch({ gameId, deckId, deckData });
  }, [conn, gameId]);

  const respondRematch = useCallback((accepted: boolean, deckId: string, deckData: string) => {
    conn?.reducers.respondRematch({ gameId, accepted, deckId, deckData });
  }, [conn, gameId]);

  const requestZoneSearch = useCallback(
    (zone: string) => {
      conn?.reducers.requestZoneSearch({ gameId, zone });
    },
    [conn, gameId],
  );

  const approveZoneSearch = useCallback(
    (requestId: bigint) => {
      conn?.reducers.approveZoneSearch({ gameId, requestId });
    },
    [conn, gameId],
  );

  const denyZoneSearch = useCallback(
    (requestId: bigint) => {
      conn?.reducers.denyZoneSearch({ gameId, requestId });
    },
    [conn, gameId],
  );

  const completeZoneSearch = useCallback(
    (requestId: bigint) => {
      conn?.reducers.completeZoneSearch({ gameId, requestId });
    },
    [conn, gameId],
  );

  const moveOpponentCard = useCallback(
    (requestId: bigint, cardInstanceId: bigint, toZone: string, posX?: string, posY?: string) => {
      conn?.reducers.moveOpponentCard({
        gameId,
        requestId,
        cardInstanceId,
        toZone,
        posX: posX || '',
        posY: posY || '',
      });
    },
    [conn, gameId],
  );

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------

  return {
    allGames,
    game,
    myPlayer,
    opponentPlayer,
    myCards,
    opponentCards,
    isMyTurn,
    counters,
    chatMessages,
    gameActions,
    spectators,
    soulsRescued,
    isLoading,
    identityHex,
    drawCard,
    drawMultiple,
    moveCard,
    moveCardsBatch,
    shuffleDeck,
    shuffleCardIntoDeck,
    randomHandToZone,
    reloadDeck,
    meekCard,
    unmeekCard,
    flipCard,
    updateCardPosition,
    addCounter,
    removeCounter,
    setNote,
    exchangeCards,
    setPhase,
    endTurn,
    rollDice,
    sendChat,
    setPlayerOption,
    moveCardToTopOfDeck,
    moveCardToBottomOfDeck,
    spawnLostSoul,
    removeToken,
    resignGame,
    leaveGame,
    pregameReady,
    pregameAcknowledgeRoll,
    pregameChooseFirst,
    pregameChangeDeck,
    requestRematch,
    respondRematch,
    zoneSearchRequests,
    incomingSearchRequest,
    approvedSearchRequest,
    requestZoneSearch,
    approveZoneSearch,
    denyZoneSearch,
    completeZoneSearch,
    moveOpponentCard,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupCardsByZone(cards: CardInstanceRow[]): Record<string, CardInstanceRow[]> {
  const result: Record<string, CardInstanceRow[]> = {};
  for (const card of cards) {
    const zone = card.zone;
    if (!result[zone]) {
      result[zone] = [];
    }
    result[zone].push(card);
  }
  // Sort deck cards by zoneIndex to preserve shuffled order
  if (result['deck']) {
    result['deck'].sort((a, b) => {
      const ai = typeof a.zoneIndex === 'bigint' ? a.zoneIndex : BigInt(a.zoneIndex ?? 0);
      const bi = typeof b.zoneIndex === 'bigint' ? b.zoneIndex : BigInt(b.zoneIndex ?? 0);
      return ai < bi ? -1 : ai > bi ? 1 : 0;
    });
  }
  return result;
}
