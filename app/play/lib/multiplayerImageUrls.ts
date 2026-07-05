import type { CardInstance } from '@/lib/spacetimedb/module_bindings/types';
import { resolveCardImageUrl, type ForgeResolverMap } from '@/app/play/utils/forgeResolver';

/** Sidebar pile zones, excluded from the tier-1 "critical" visible set. */
const SIDEBAR_PILE_ZONES = ['deck', 'discard', 'reserve', 'banish', 'land-of-redemption'] as const;

type CardsByZone = Record<string, CardInstance[] | undefined>;

function resolve(card: CardInstance | undefined, forgeResolver?: ForgeResolverMap | null): string | null {
  if (!card?.cardImgFile) return null;
  const url = resolveCardImageUrl(card.cardImgFile, forgeResolver);
  return url || null;
}

function pushZone(
  out: string[],
  seen: Set<string>,
  zoneCards: CardInstance[] | undefined,
  forgeResolver?: ForgeResolverMap | null,
) {
  if (!zoneCards) return;
  for (const card of zoneCards) {
    const url = resolve(card, forgeResolver);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
}

/**
 * Full priority-ordered image URL list for the multiplayer preloader.
 * Earlier entries load first under the concurrency cap, so visible/
 * high-value cards aren't starved behind deck-card preloads.
 */
export function buildPrioritizedImageUrls(
  myCards: CardsByZone,
  opponentCards: CardsByZone,
  sharedCards: CardsByZone,
  forgeResolver?: ForgeResolverMap | null,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  // Tier 1 — visible, face-up cards.
  pushZone(out, seen, myCards['hand'], forgeResolver);
  pushZone(out, seen, myCards['territory'], forgeResolver);
  pushZone(out, seen, myCards['land-of-bondage'], forgeResolver);
  pushZone(out, seen, opponentCards['territory'], forgeResolver);
  pushZone(out, seen, opponentCards['land-of-bondage'], forgeResolver);
  for (const zoneCards of Object.values(sharedCards)) pushZone(out, seen, zoneCards, forgeResolver);

  // Tier 2 — opponent's hand (may be revealed).
  pushZone(out, seen, opponentCards['hand'], forgeResolver);

  // Tier 3 — sidebar piles except deck.
  for (const zone of SIDEBAR_PILE_ZONES) {
    if (zone === 'deck') continue;
    pushZone(out, seen, myCards[zone], forgeResolver);
    pushZone(out, seen, opponentCards[zone], forgeResolver);
  }

  // Tier 4 — decks (face-down, least urgent).
  pushZone(out, seen, myCards['deck'], forgeResolver);
  pushZone(out, seen, opponentCards['deck'], forgeResolver);

  // Catch-all — any zone not enumerated above.
  const SKIP = new Set<string>(['hand', 'territory', 'land-of-bondage', 'deck', ...SIDEBAR_PILE_ZONES]);
  for (const [zone, zoneCards] of Object.entries(myCards)) {
    if (SKIP.has(zone)) continue;
    pushZone(out, seen, zoneCards, forgeResolver);
  }
  for (const [zone, zoneCards] of Object.entries(opponentCards)) {
    if (SKIP.has(zone)) continue;
    pushZone(out, seen, zoneCards, forgeResolver);
  }

  return out;
}

/**
 * Tier-1 subset: the cards visible the instant the board reveals. The gate
 * stays up until these are cached (or exhausted retries).
 */
export function buildCriticalImageUrls(
  myCards: CardsByZone,
  opponentCards: CardsByZone,
  sharedCards: CardsByZone,
  forgeResolver?: ForgeResolverMap | null,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  pushZone(out, seen, myCards['hand'], forgeResolver);
  pushZone(out, seen, myCards['territory'], forgeResolver);
  pushZone(out, seen, myCards['land-of-bondage'], forgeResolver);
  pushZone(out, seen, opponentCards['territory'], forgeResolver);
  pushZone(out, seen, opponentCards['land-of-bondage'], forgeResolver);
  for (const zoneCards of Object.values(sharedCards)) pushZone(out, seen, zoneCards, forgeResolver);
  return out;
}
