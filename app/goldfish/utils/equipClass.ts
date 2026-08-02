import { findCard, classIsWarrior, classIsWeapon } from '@/lib/cards/lookup';
import type { GameCard } from '../types';

/** The fields a class test needs off a GameCard. */
type ClassFields = Pick<GameCard, 'cardName' | 'cardSet' | 'cardImgFile'> &
  Partial<Pick<GameCard, 'cardClass'>>;

/** Forge cards are not in the public card index, so `findCard` can't tell you
 *  their class — their class rides `cardClass` from the granted forge resolver.
 *  When `cardClass` is set (including to '') it is authoritative: a forge card
 *  must never inherit the class of a same-named public card. Everything else
 *  resolves through the public index as before. */
function classOf(card: ClassFields): string | undefined {
  if (card.cardClass !== undefined) return card.cardClass;
  return findCard(card.cardName, card.cardSet, card.cardImgFile)?.class;
}

export function gameCardIsWarrior(card: ClassFields): boolean {
  return classIsWarrior(classOf(card));
}

export function gameCardIsWeapon(card: ClassFields): boolean {
  return classIsWeapon(classOf(card));
}
