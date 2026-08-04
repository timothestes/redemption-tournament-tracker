/**
 * Managed tag rules for YTG Shopify products.
 *
 * Single source of truth for the tags this system OWNS on store products.
 * Extracted from productFromCard.ts so the set importer and the Products-tab
 * tag sync compute tags from the same rules and can never drift.
 *
 * When the Limited/Unlimited format restructure lands in card data, the
 * legality rule updates here and nowhere else.
 *
 * Server-side only by weight: MANAGED_TAGS is built by walking CARDS at
 * module init — do NOT import this module from client components.
 */

import type { CardData } from '@/lib/cards/lookup';
import { CARDS } from '@/lib/cards/lookup';
import { normalizeBrigadeField } from '@/app/decklist/card-search/utils';
import { GOOD_BRIGADES, EVIL_BRIGADES } from '@/app/decklist/card-search/constants';

export const TYPE_TAGS: Record<string, string> = {
  'Hero': 'Hero', 'GE': 'Good Enhancement', 'EE': 'Evil Enhancement',
  'Evil Character': 'Evil Character', 'Artifact': 'Artifact', 'Lost Soul': 'Lost Soul',
  'Dominant': 'Dominant', 'Fortress': 'Fortress', 'Site': 'Site', 'City': 'City',
  'Covenant': 'Covenant', 'Curse': 'Curse',
  'Hero Token': 'Hero', 'Evil Character Token': 'Evil Character', 'Lost Soul Token': 'Lost Soul',
};
const GOOD_TYPE_PARTS = new Set(['Hero', 'GE']);
const EVIL_TYPE_PARTS = new Set(['Evil Character', 'EE']);
// Canonical brigade name -> YTG tag name (identity unless listed)
export const BRIGADE_TAGS: Record<string, string> = { 'Good Gold': 'Gold' };

function normalizeRarity(rarity: string): string {
  return rarity === 'Ultra-Rare' ? 'Ultra Rare' : rarity;
}

export interface CardTagComputation {
  tags: string[];      // sorted, deduped
  warnings: string[];  // `type-unmapped:<part>` | `brigade-unmapped:<value>`, in emission order
}

/**
 * Full tag computation including the warnings productFromCard surfaces at
 * plan time. The importer consumes this; the tag sync consumes desiredTags.
 */
export function computeCardTags(card: CardData): CardTagComputation {
  const warnings: string[] = [];
  const tags = new Set<string>();

  const typeParts = card.type.split('/').map(p => p.trim()).filter(p => p.length > 0);
  const matchedTypeParts: string[] = [];
  for (const part of typeParts) {
    const tag = TYPE_TAGS[part];
    if (tag) {
      tags.add(tag);
      matchedTypeParts.push(part);
    } else {
      warnings.push(`type-unmapped:${part}`);
    }
  }
  const hasGood = matchedTypeParts.some(p => GOOD_TYPE_PARTS.has(p));
  const hasEvil = matchedTypeParts.some(p => EVIL_TYPE_PARTS.has(p));
  if (hasGood && hasEvil) tags.add('Dual Alignment');

  if (card.brigade) {
    try {
      const canonicalBrigades = normalizeBrigadeField(card.brigade, card.alignment, card.name);
      for (const brigade of canonicalBrigades) {
        tags.add(BRIGADE_TAGS[brigade] ?? brigade);
      }
    } catch {
      warnings.push(`brigade-unmapped:${card.brigade}`);
    }
  }

  if (card.officialSet) tags.add(card.officialSet);

  const normalizedRarity = normalizeRarity(card.rarity);
  if (normalizedRarity === 'Legacy Rare' || normalizedRarity === 'Ultra Rare') tags.add(normalizedRarity);

  if (card.legality === 'Rotation') tags.add('Rotation Cards');
  if (card.officialSet.startsWith('Promo')) tags.add('Promos');

  return { tags: Array.from(tags).sort(), warnings };
}

/** The managed tags this card should carry — sorted, deduped. */
export function desiredTags(card: CardData): string[] {
  return computeCardTags(card).tags;
}

/**
 * MANAGED_TAGS = every tag desiredTags can emit. Diffing only ever
 * adds/removes tags in this set — hand-added merchandising tags are invisible
 * to the sync. Rule-derived where the rule is closed (types, brigades, the
 * five constants); data-derived for the open set of official set names
 * (enumerated from CARDS at module init).
 */
function buildManagedTags(): ReadonlySet<string> {
  const managed = new Set<string>();
  for (const tag of Object.values(TYPE_TAGS)) managed.add(tag);
  for (const brigade of [...GOOD_BRIGADES, ...EVIL_BRIGADES]) {
    managed.add(BRIGADE_TAGS[brigade] ?? brigade);
  }
  for (const card of CARDS) {
    if (card.officialSet) managed.add(card.officialSet);
  }
  for (const tag of ['Legacy Rare', 'Ultra Rare', 'Rotation Cards', 'Promos', 'Dual Alignment']) {
    managed.add(tag);
  }
  return managed;
}

export const MANAGED_TAGS: ReadonlySet<string> = buildManagedTags();
