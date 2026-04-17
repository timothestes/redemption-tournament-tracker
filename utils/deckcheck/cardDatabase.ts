/**
 * Thin compatibility shim over `lib/cards/lookup`.
 *
 * New code should import directly from `@/lib/cards/lookup`. This module
 * exists only to preserve the `findCard` / `getCardDatabase` / `CardData`
 * export names that predate the build-time codegen migration.
 */

import { CARDS, findCard as findCardSync, type CardData } from '@/lib/cards/lookup';

export type { CardData };

export async function findCard(
  name: string,
  set?: string,
): Promise<CardData | undefined> {
  return findCardSync(name, set);
}

/**
 * Returns a Map keyed by card name, matching the legacy last-wins-on-collision
 * behavior (same printing semantics as the old fetch-based implementation).
 */
export async function getCardDatabase(): Promise<Map<string, CardData>> {
  const map = new Map<string, CardData>();
  for (const card of CARDS) {
    if (card.name) map.set(card.name, card);
  }
  return map;
}
