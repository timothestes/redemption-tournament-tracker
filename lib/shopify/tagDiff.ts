/**
 * Pure product-granularity tag diff for the YTG Products tab.
 *
 * Kept free of Supabase/Shopify so the union-over-mappings rule is unit
 * testable. Server actions (app/admin/ytg/products/actions.ts) do the data
 * loading and feed this module.
 *
 * Diff granularity is the PRODUCT, not the mapping: multiple card_keys can
 * map to one product (promo fallback passes), so the desired managed tag set
 * is the UNION of desiredTags(card) over all confirmed mappings. Per-mapping
 * diffing oscillates and the post-apply "clean diff" check would never pass.
 *
 * Server-side only by weight (imports tagRules, whose init walks CARDS).
 * Client components may `import type` from here, never values.
 */

import type { CardData } from '@/lib/cards/lookup';
import { desiredTags, MANAGED_TAGS } from './tagRules';

/** Apply is refused when the oldest involved mirror row is older than this. */
export const STALENESS_LIMIT_MS = 60 * 60 * 1000; // 1 hour, per spec §Products tab

export interface TagDiffRow {
  productId: string;
  title: string;
  handle: string;
  add: string[];     // desired ∖ current, sorted
  remove: string[];  // (current ∩ MANAGED_TAGS) ∖ desired, sorted
}

export interface TagRollupEntry {
  tag: string;
  addCount: number;
  removeCount: number;
}

/** Mirror `tags` column is Shopify's comma-separated string. */
export function splitTags(tags: string | null): string[] {
  if (!tags) return [];
  return tags.split(',').map(t => t.trim()).filter(t => t.length > 0);
}

export function computeProductTagDiff(
  products: { id: string; title: string; handle: string; tags: string | null }[],
  mappingsByProduct: Map<string, CardData[]>,
): TagDiffRow[] {
  const rows: TagDiffRow[] = [];

  for (const product of products) {
    const cards = mappingsByProduct.get(product.id);
    // No confirmed mapping ⇒ no union to diff against ⇒ never touch the
    // product (hand-tagged non-card products are the collision report's job).
    if (!cards || cards.length === 0) continue;

    const desired = new Set<string>();
    for (const card of cards) {
      for (const tag of desiredTags(card)) desired.add(tag);
    }

    const current = splitTags(product.tags);
    const currentSet = new Set(current);
    const currentManaged = new Set(current.filter(t => MANAGED_TAGS.has(t)));

    const add = Array.from(desired).filter(t => !currentSet.has(t)).sort();
    const remove = Array.from(currentManaged).filter(t => !desired.has(t)).sort();

    if (add.length === 0 && remove.length === 0) continue;
    rows.push({ productId: product.id, title: product.title, handle: product.handle, add, remove });
  }

  rows.sort((a, b) => a.title.localeCompare(b.title));
  return rows;
}

export function rollupTagChanges(rows: TagDiffRow[]): TagRollupEntry[] {
  const byTag = new Map<string, TagRollupEntry>();
  const entryFor = (tag: string): TagRollupEntry => {
    let entry = byTag.get(tag);
    if (!entry) {
      entry = { tag, addCount: 0, removeCount: 0 };
      byTag.set(tag, entry);
    }
    return entry;
  };
  for (const row of rows) {
    for (const tag of row.add) entryFor(tag).addCount++;
    for (const tag of row.remove) entryFor(tag).removeCount++;
  }
  return Array.from(byTag.values()).sort(
    (a, b) =>
      (b.addCount + b.removeCount) - (a.addCount + a.removeCount)
      || a.tag.localeCompare(b.tag),
  );
}
