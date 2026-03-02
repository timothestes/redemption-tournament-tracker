import { CounterColorId, GameAction, ZoneId } from '../types';

function createAction(
  type: GameAction['type'],
  payload: GameAction['payload'] = {}
): GameAction {
  return {
    id: crypto.randomUUID(),
    type,
    playerId: 'player1',
    timestamp: Date.now(),
    payload,
  };
}

export const actions = {
  moveCard(cardInstanceId: string, toZone: ZoneId, toIndex?: number, posX?: number, posY?: number): GameAction {
    return createAction('MOVE_CARD', { cardInstanceId, toZone, toIndex, posX, posY });
  },

  moveCardToTopOfDeck(cardInstanceId: string): GameAction {
    return createAction('SHUFFLE_AND_MOVE_TO_TOP', { cardInstanceId });
  },

  moveCardToBottomOfDeck(cardInstanceId: string): GameAction {
    return createAction('SHUFFLE_AND_MOVE_TO_BOTTOM', { cardInstanceId });
  },

  drawCard(): GameAction {
    return createAction('DRAW_CARD');
  },

  drawMultiple(quantity: number): GameAction {
    return createAction('DRAW_MULTIPLE', { quantity });
  },

  shuffleDeck(): GameAction {
    return createAction('SHUFFLE_DECK');
  },

  shuffleCardIntoDeck(cardInstanceId: string): GameAction {
    // Move card to deck, then shuffle
    return createAction('MOVE_CARD', { cardInstanceId, toZone: 'deck' });
  },

  addCounter(cardInstanceId: string, color: CounterColorId = 'red'): GameAction {
    return createAction('ADD_COUNTER', { cardInstanceId, color });
  },

  removeCounter(cardInstanceId: string, color: CounterColorId = 'red'): GameAction {
    return createAction('REMOVE_COUNTER', { cardInstanceId, color });
  },

  meekCard(cardInstanceId: string): GameAction {
    return createAction('MEEK_CARD', { cardInstanceId });
  },

  unmeekCard(cardInstanceId: string): GameAction {
    return createAction('UNMEEK_CARD', { cardInstanceId });
  },

  flipCard(cardInstanceId: string): GameAction {
    return createAction('FLIP_CARD', { cardInstanceId });
  },

  advancePhase(): GameAction {
    return createAction('ADVANCE_PHASE');
  },

  regressPhase(): GameAction {
    return createAction('REGRESS_PHASE');
  },

  endTurn(): GameAction {
    return createAction('END_TURN');
  },

  addNote(cardInstanceId: string, note: string): GameAction {
    return createAction('ADD_NOTE', { cardInstanceId, value: note });
  },

  addOpponentLostSoul(): GameAction {
    return createAction('ADD_OPPONENT_LOST_SOUL');
  },

  removeOpponentToken(cardInstanceId: string): GameAction {
    return createAction('REMOVE_OPPONENT_TOKEN', { cardInstanceId });
  },

  moveCardsBatch(cardInstanceIds: string[], toZone: ZoneId, positions?: Record<string, { posX: number; posY: number }>): GameAction {
    return createAction('MOVE_CARDS_BATCH', { cardInstanceIds, toZone, positions });
  },
};
