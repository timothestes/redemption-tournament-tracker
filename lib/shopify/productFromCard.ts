import type { CardData } from '@/lib/cards/generated/cardData';
import { normalizeBrigadeField } from '@/app/decklist/card-search/utils';
import { sanitizeImgFile } from '@/app/shared/utils/cardImageUrl';

export interface ShopifyProductSetInput {
  title: string;
  handle: string;
  productType: string;
  vendor: string;
  tags: string[];
  status: 'DRAFT' | 'ACTIVE';
  productOptions?: { name: string; values: { name: string }[] }[];
  variants?: { optionValues: { optionName: string; name: string }[]; price: string; sku: string }[];
  files?: { originalSource: string; contentType: 'IMAGE'; alt: string }[];
  metafields?: { namespace: string; key: string; value: string; type: string }[];
}

export interface ProductBuildOptions {
  price: string | null;        // normalized "1.50"; null => "0.00" + warning "no-price"
  imageUrl: string | null;     // null => no files + warning "no-image"
  status: 'DRAFT' | 'ACTIVE';
  titleOverride?: string;      // admin-entered title replaces the computed one verbatim
  includeMedia?: boolean;      // default true; false => omit files even if imageUrl set (update re-runs)
}

export interface BuiltProduct {
  cardKey: string;
  input: ShopifyProductSetInput;
  warnings: string[];          // 'no-price' | 'no-image' | 'no-set-alias' | `brigade-unmapped:<value>` | `type-unmapped:<value>`
}

const TYPE_TAGS: Record<string, string> = {
  'Hero': 'Hero', 'GE': 'Good Enhancement', 'EE': 'Evil Enhancement',
  'Evil Character': 'Evil Character', 'Artifact': 'Artifact', 'Lost Soul': 'Lost Soul',
  'Dominant': 'Dominant', 'Fortress': 'Fortress', 'Site': 'Site', 'City': 'City',
  'Covenant': 'Covenant', 'Curse': 'Curse',
  'Hero Token': 'Hero', 'Evil Character Token': 'Evil Character', 'Lost Soul Token': 'Lost Soul',
};
const GOOD_TYPE_PARTS = new Set(['Hero', 'GE']);
const EVIL_TYPE_PARTS = new Set(['Evil Character', 'EE']);
// Canonical brigade name -> YTG tag name (identity unless listed)
const BRIGADE_TAGS: Record<string, string> = { 'Good Gold': 'Gold' };

export function baseCardName(name: string): string {
  return name.replace(/\s*[([][^)\]]*[)\]]\s*$/, '').trim();
}

export function slugifyTitle(title: string): string {
  return title.toLowerCase().replace(/['‘’"“”]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function cardSku(card: CardData): string {
  return `${card.set}-${sanitizeImgFile(card.imgFile)}`.replace(/\s+/g, '');
}

function normalizeRarity(rarity: string): string {
  return rarity === 'Ultra-Rare' ? 'Ultra Rare' : rarity;
}

export function productFromCard(card: CardData, ytgAbbrev: string | null, opts: ProductBuildOptions): BuiltProduct {
  const warnings: string[] = [];
  const cardKey = `${card.name}|${card.set}|${card.imgFile}`;

  if (!ytgAbbrev) warnings.push('no-set-alias');
  const title = opts.titleOverride ?? `${baseCardName(card.name)} (${ytgAbbrev ?? card.set})`;
  const handle = slugifyTitle(title);

  // --- tags ---
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

  // --- variants / price ---
  if (opts.price === null) warnings.push('no-price');
  const price = opts.price ?? '0.00';

  // --- files / image ---
  if (opts.imageUrl === null) warnings.push('no-image');
  const files = opts.imageUrl !== null && opts.includeMedia !== false
    ? [{ originalSource: opts.imageUrl, contentType: 'IMAGE' as const, alt: baseCardName(card.name) }]
    : undefined;

  const input: ShopifyProductSetInput = {
    title,
    handle,
    productType: 'Single',
    vendor: 'Your Turn Games',
    tags: Array.from(tags).sort(),
    status: opts.status,
    productOptions: [{ name: 'Title', values: [{ name: 'Default Title' }] }],
    variants: [{ optionValues: [{ optionName: 'Title', name: 'Default Title' }], price, sku: cardSku(card) }],
    ...(files ? { files } : {}),
    metafields: [{ namespace: 'custom', key: 'rtt_card_key', value: cardKey, type: 'single_line_text_field' }],
  };

  return { cardKey, input, warnings };
}
