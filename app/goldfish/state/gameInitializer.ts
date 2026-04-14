import {
  GameCard,
  GameState,
  GoldfishOptions,
  ZoneId,
  ALL_ZONES,
  DEFAULT_OPTIONS,
  DeckDataForGoldfish,
} from '../types';

function createEmptyZones(): Record<ZoneId, GameCard[]> {
  const zones = {} as Record<ZoneId, GameCard[]>;
  for (const zone of ALL_ZONES) {
    zones[zone] = [];
  }
  return zones;
}

function expandDeckCards(deck: DeckDataForGoldfish): { main: GameCard[]; reserve: GameCard[] } {
  const main: GameCard[] = [];
  const reserve: GameCard[] = [];

  for (const dc of deck.cards) {
    for (let i = 0; i < dc.quantity; i++) {
      const card: GameCard = {
        instanceId: crypto.randomUUID(),
        cardName: dc.card_name,
        cardSet: dc.card_set,
        cardImgFile: dc.card_img_file,
        type: dc.card_type,
        brigade: dc.card_brigade,
        strength: dc.card_strength,
        toughness: dc.card_toughness,
        specialAbility: dc.card_special_ability,
        identifier: dc.card_identifier,
        reference: dc.card_reference,
        alignment: dc.card_alignment,
        isMeek: false,
        counters: [],
        isFlipped: false,
        zone: dc.is_reserve ? 'reserve' : 'deck',
        ownerId: 'player1',
        isToken: false,
        notes: '',
      };

      if (dc.is_reserve) {
        reserve.push(card);
      } else {
        main.push(card);
      }
    }
  }

  return { main, reserve };
}

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function isLostSoul(card: GameCard): boolean {
  return card.type === 'LS' || card.type === 'Lost Soul' || card.type.toLowerCase().includes('lost soul');
}

/**
 * Draw an opening hand, auto-routing Lost Souls to Land of Bondage.
 * Returns the updated zones after drawing.
 */
function drawOpeningHand(
  zones: Record<ZoneId, GameCard[]>,
  handSize: number,
  autoRoute: boolean,
  alwaysStartWith: string[]
): Record<ZoneId, GameCard[]> {
  const result = { ...zones };
  result.deck = [...zones.deck];
  result.hand = [...zones.hand];
  result['land-of-bondage'] = [...zones['land-of-bondage']];

  // Tutor "always start with" cards first
  for (const cardName of alwaysStartWith) {
    const idx = result.deck.findIndex(c => c.cardName === cardName);
    if (idx !== -1) {
      const [card] = result.deck.splice(idx, 1);
      card.zone = 'hand';
      card.isFlipped = false;
      result.hand.push(card);
    }
  }

  // Draw remaining cards to fill hand
  let cardsNeeded = handSize - result.hand.length;
  let safety = 0;
  const maxSafety = result.deck.length + 50;

  while (cardsNeeded > 0 && result.deck.length > 0 && safety < maxSafety) {
    safety++;
    const card = result.deck.shift()!;

    if (autoRoute && isLostSoul(card)) {
      // TODO: animate Lost Soul sliding to Land of Bondage during opening hand draw
      card.zone = 'land-of-bondage';
      card.isFlipped = false;
      result['land-of-bondage'].push(card);
      // Don't decrement cardsNeeded — draw a replacement
      continue;
    }

    card.zone = 'hand';
    card.isFlipped = false;
    result.hand.push(card);
    cardsNeeded--;
  }

  return result;
}

function parseFormat(format: string | undefined): 'T1' | 'T2' | 'Paragon' {
  if (!format) return 'T1';
  const f = format.toLowerCase();
  if (f.includes('paragon')) return 'Paragon';
  if (f.includes('2') || f === 't2') return 'T2';
  return 'T1';
}

export function buildInitialGameState(
  deck: DeckDataForGoldfish,
  optionsOverrides?: Partial<GoldfishOptions>
): GameState {
  const format = parseFormat(deck.format);
  const options: GoldfishOptions = {
    ...DEFAULT_OPTIONS,
    format,
    ...optionsOverrides,
  };

  const { main, reserve } = expandDeckCards(deck);
  const shuffledMain = shuffleArray(main);

  // Mark all deck cards as face-down; reserve cards stay face-up
  for (const card of shuffledMain) {
    card.isFlipped = true;
  }

  const zones = createEmptyZones();
  zones.deck = shuffledMain;
  zones.reserve = reserve;

  // Draw opening hand
  const zonesAfterDraw = drawOpeningHand(
    zones,
    options.startingHandSize,
    options.autoRouteLostSouls,
    options.alwaysStartWith
  );

  return {
    sessionId: crypto.randomUUID(),
    deckId: deck.id || '',
    deckName: deck.name,
    isOwner: deck.isOwner ?? false,
    format,
    paragonName: deck.paragon || null,
    turn: 1,
    phase: 'draw',
    zones: zonesAfterDraw,
    history: [],
    options,
    isSpreadHand: false,
    drawnThisTurn: true,
  };
}
