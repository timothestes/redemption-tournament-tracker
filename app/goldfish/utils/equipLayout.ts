import type { GameCard } from '../types';

/** Fraction of the card's width/height used as the visual offset between a
 *  warrior and its attached weapon. Weapon sits up-and-left of the warrior. */
export const EQUIP_OFFSET_RATIO = 0.18;

/** Safety cap on how many weapons can be attached to a single warrior. */
export const MAX_EQUIPPED_WEAPONS_PER_WARRIOR = 1;

export function computeEquipOffset(
  cardWidth: number,
  cardHeight: number,
  weaponIndex: number = 0,
): { dx: number; dy: number } {
  // Fan weapons diagonally so each one past the first peeks out further.
  const multiplier = weaponIndex + 1;
  return {
    dx: -cardWidth * EQUIP_OFFSET_RATIO * multiplier,
    dy: -cardHeight * EQUIP_OFFSET_RATIO * multiplier,
  };
}

export function getAttachedWeapons(
  warrior: Pick<GameCard, 'instanceId'>,
  zoneCards: GameCard[],
): GameCard[] {
  return zoneCards.filter((c) => c.equippedTo === warrior.instanceId);
}

/** Minimum fraction of a card's area that must overlap for a drop to count
 *  as "on" a warrior. 25% matches human intuition: if the dropped card looks
 *  obviously on the warrior, it attaches. */
const EQUIP_HIT_OVERLAP_RATIO = 0.25;

/** Return the first card in `candidates` whose rect overlaps the dropped card's
 *  rect by at least `EQUIP_HIT_OVERLAP_RATIO` of a card area. The dropped card
 *  is assumed to be centered on (dropX, dropY) with the same width/height as
 *  the candidates. Skips `skipInstanceId` and candidates without posX/posY. */
export function hitTestWarrior(
  dropX: number,
  dropY: number,
  cardWidth: number,
  cardHeight: number,
  candidates: GameCard[],
  skipInstanceId: string,
): GameCard | null {
  const threshold = cardWidth * cardHeight * EQUIP_HIT_OVERLAP_RATIO;
  const wL = dropX - cardWidth / 2;
  const wR = dropX + cardWidth / 2;
  const wT = dropY - cardHeight / 2;
  const wB = dropY + cardHeight / 2;
  for (const c of candidates) {
    if (c.instanceId === skipInstanceId) continue;
    if (c.posX === undefined || c.posY === undefined) continue;
    const hL = c.posX;
    const hR = c.posX + cardWidth;
    const hT = c.posY;
    const hB = c.posY + cardHeight;
    const overlapW = Math.max(0, Math.min(wR, hR) - Math.max(wL, hL));
    const overlapH = Math.max(0, Math.min(wB, hB) - Math.max(wT, hT));
    if (overlapW * overlapH >= threshold) return c;
  }
  return null;
}
