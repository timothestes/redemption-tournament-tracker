import { describe, it, expect } from 'vitest';
import { CARDS } from '@/lib/cards/lookup';
import { desiredTags, MANAGED_TAGS } from './tagRules';
import { productFromCard } from './productFromCard';

// Tag output is independent of price/image/status/abbrev — pass fixed opts and
// card.set as the abbrev so no warnings-only paths change anything tag-related.
const BUILD_OPTS = { price: '1.00', imageUrl: null, status: 'DRAFT' as const };

describe('desiredTags characterization vs productFromCard', () => {
  it('emits IDENTICAL tags to productFromCard for every card in CARDS', () => {
    for (const card of CARDS) {
      const viaProduct = productFromCard(card, card.set, BUILD_OPTS).input.tags;
      expect(
        desiredTags(card),
        `tag mismatch for ${card.name}|${card.set}|${card.imgFile}`,
      ).toEqual(viaProduct);
    }
  });

  it('every tag desiredTags emits is in MANAGED_TAGS (over all of CARDS)', () => {
    for (const card of CARDS) {
      for (const tag of desiredTags(card)) {
        expect(
          MANAGED_TAGS.has(tag),
          `unmanaged tag "${tag}" emitted for ${card.name}|${card.set}|${card.imgFile}`,
        ).toBe(true);
      }
    }
  });

  it('MANAGED_TAGS contains the rule constants and YTG brigade tag names', () => {
    const expected = [
      // TYPE_TAGS values
      'Hero', 'Good Enhancement', 'Evil Enhancement', 'Evil Character', 'Artifact',
      'Lost Soul', 'Dominant', 'Fortress', 'Site', 'City', 'Covenant', 'Curse',
      // brigade tag names (canonical names mapped through BRIGADE_TAGS)
      'Gold', 'Red', 'Silver', 'Teal', 'White', 'Green', 'Purple', 'Blue', 'Clay',
      'Brown', 'Evil Gold', 'Crimson', 'Black', 'Gray', 'Orange', 'Pale Green',
      // rarity / legality / promo / dual
      'Legacy Rare', 'Ultra Rare', 'Rotation Cards', 'Promos', 'Dual Alignment',
      // spot-check officialSet values enumerated from card data
      'Kings', 'Prophecies of Christ', "Israel's Inheritance", 'Promo',
    ];
    for (const tag of expected) {
      expect(MANAGED_TAGS.has(tag), `missing managed tag "${tag}"`).toBe(true);
    }
    // 'Good Gold' is a canonical brigade NAME but never a tag — BRIGADE_TAGS maps it to 'Gold'.
    expect(MANAGED_TAGS.has('Good Gold')).toBe(false);
  });
});
