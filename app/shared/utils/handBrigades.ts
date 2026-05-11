import { normalizeBrigadeField } from '@/app/decklist/card-search/cardHelpers';
import {
  GOOD_BRIGADES,
  EVIL_BRIGADES,
} from '@/app/decklist/card-search/constants';

export interface BrigadeCard {
  cardName: string;
  brigade: string;
  alignment: string;
  /** Card type (e.g. "Hero", "Evil Character", "Site", "City"). Sites and
   *  cities route their brigades to the neutral bucket regardless of which
   *  color is printed on them. */
  type: string;
}

export interface HandBrigadeCounts {
  total: number;
  good: number;
  evil: number;
  neutral: number;
}

const GOOD_SET = new Set<string>(GOOD_BRIGADES);
const EVIL_SET = new Set<string>(EVIL_BRIGADES);

function isNeutralBrigadeSource(type: string): boolean {
  return type === 'Site' || type === 'City';
}

export function computeHandBrigades(cards: BrigadeCard[]): HandBrigadeCounts {
  const good = new Set<string>();
  const evil = new Set<string>();
  const neutral = new Set<string>();

  for (const card of cards) {
    let brigades: string[];
    try {
      brigades = normalizeBrigadeField(card.brigade, card.alignment, card.cardName);
    } catch {
      continue;
    }
    const routeToNeutral = isNeutralBrigadeSource(card.type);
    for (const b of brigades) {
      if (routeToNeutral) {
        neutral.add(b);
      } else if (GOOD_SET.has(b)) {
        good.add(b);
      } else if (EVIL_SET.has(b)) {
        evil.add(b);
      }
    }
  }

  const total = new Set<string>([...good, ...evil, ...neutral]).size;
  return {
    total,
    good: good.size,
    evil: evil.size,
    neutral: neutral.size,
  };
}
