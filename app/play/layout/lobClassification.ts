import { isLostSoulCard } from '@/lib/cards/cardAbilities';

// ---------------------------------------------------------------------------
// Land of Bondage host/accessory classification
// A card renders as an accessory (tucked ~85% behind its host, peeking past
// the strip) only when it is attached AND its host is present in the same LOB
// list. Two guards keep bad/stale data from hiding cards (a soul once
// rendered tucked below the opponent's strip until refresh):
//   1. Lost Souls are ALWAYS hosts — souls are never accessories, whatever
//      their equippedToInstanceId claims.
//   2. An accessory whose host is missing falls back to a host slot instead
//      of vanishing (orphaned sites).
// Layout memos, render splits, marquee bounds, and the attach drag must all
// classify through this helper so they stay consistent.
// ---------------------------------------------------------------------------
export function splitLobCards<
  T extends { id: bigint; equippedToInstanceId: bigint; cardType: string },
>(cards: T[]): { hosts: T[]; accessoriesByHost: Map<bigint, T[]> } {
  const hostIds = new Set<bigint>();
  for (const c of cards) {
    if (c.equippedToInstanceId === 0n || isLostSoulCard(c)) hostIds.add(c.id);
  }
  const hosts: T[] = [];
  const accessoriesByHost = new Map<bigint, T[]>();
  for (const c of cards) {
    if (hostIds.has(c.id) || !hostIds.has(c.equippedToInstanceId)) {
      hosts.push(c);
    } else {
      const list = accessoriesByHost.get(c.equippedToInstanceId);
      if (list) list.push(c);
      else accessoriesByHost.set(c.equippedToInstanceId, [c]);
    }
  }
  return { hosts, accessoriesByHost };
}
