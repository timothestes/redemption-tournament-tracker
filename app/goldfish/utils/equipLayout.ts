import type { GameCard } from '../types';

/** Fraction of the card's width/height used as the visual offset between a
 *  warrior and its attached weapon. Weapon sits up-and-left of the warrior. */
export const EQUIP_OFFSET_RATIO = 0.18;

/** Safety cap on how many weapons can be attached to a single warrior. */
export const MAX_EQUIPPED_WEAPONS_PER_WARRIOR = 3;

export function computeEquipOffset(
  cardWidth: number,
  cardHeight: number,
): { dx: number; dy: number } {
  return {
    dx: -cardWidth * EQUIP_OFFSET_RATIO,
    dy: -cardHeight * EQUIP_OFFSET_RATIO,
  };
}

export function getAttachedWeapons(
  warrior: Pick<GameCard, 'instanceId'>,
  zoneCards: GameCard[],
): GameCard[] {
  return zoneCards.filter((c) => c.equippedTo === warrior.instanceId);
}

/** Return the first card in `candidates` whose rect contains (dropX, dropY),
 *  skipping the card with `skipInstanceId` (usually the card being dragged).
 *  Candidates without posX/posY are treated as unplaced and ignored. */
export function hitTestWarrior(
  dropX: number,
  dropY: number,
  cardWidth: number,
  cardHeight: number,
  candidates: GameCard[],
  skipInstanceId: string,
): GameCard | null {
  for (const c of candidates) {
    if (c.instanceId === skipInstanceId) continue;
    if (c.posX === undefined || c.posY === undefined) continue;
    const left = c.posX;
    const right = c.posX + cardWidth;
    const top = c.posY;
    const bottom = c.posY + cardHeight;
    if (dropX >= left && dropX <= right && dropY >= top && dropY <= bottom) {
      return c;
    }
  }
  return null;
}
