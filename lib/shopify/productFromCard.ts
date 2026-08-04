import type { CardData } from '@/lib/cards/generated/cardData';
import { sanitizeImgFile } from '@/app/shared/utils/cardImageUrl';
import { computeCardTags } from './tagRules';

export interface ShopifyProductSetInput {
  title: string;
  handle: string;
  productType: string;
  vendor: string;
  tags: string[];
  status: 'DRAFT' | 'ACTIVE';
  descriptionHtml?: string;
  productOptions?: { name: string; values: { name: string }[] }[];
  variants?: { optionValues: { optionName: string; name: string }[]; price: string; sku: string; inventoryItem?: { tracked: boolean } }[];
  files?: { originalSource: string; contentType: 'IMAGE'; alt: string }[];
  metafields?: { namespace: string; key: string; value: string; type: string }[];
}

export interface ProductBuildOptions {
  price: string | null;        // normalized "1.50"; null => "0.00" + warning "no-price"
  imageUrl: string | null;     // null => no files + warning "no-image"
  status: 'DRAFT' | 'ACTIVE';
  titleOverride?: string;      // admin-entered title replaces the computed one verbatim
  includeMedia?: boolean;      // default true; false => omit files even if imageUrl set (update re-runs)
  includeVariants?: boolean;   // default true; false => omit variants + productOptions (blank-price updates leave live variant data untouched)
  includeDescription?: boolean; // default true; false => omit descriptionHtml even if specialAbility set (updates don't clobber store edits)
  trackInventory?: boolean;    // default true; false on update re-runs — never toggle tracking on live products
}

export interface BuiltProduct {
  cardKey: string;
  input: ShopifyProductSetInput;
  warnings: string[];          // 'no-price' | 'no-image' | 'no-set-alias' | `brigade-unmapped:<value>` | `type-unmapped:<value>`
}

export function baseCardName(name: string): string {
  return name.replace(/\s*[([][^)\]]*[)\]]\s*$/, '').trim();
}

export function slugifyTitle(title: string): string {
  return title.toLowerCase().replace(/['‘’"“”]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function cardSku(card: CardData): string {
  return `${card.set}-${sanitizeImgFile(card.imgFile)}`.replace(/\s+/g, '');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function productFromCard(card: CardData, ytgAbbrev: string | null, opts: ProductBuildOptions): BuiltProduct {
  const warnings: string[] = [];
  const cardKey = `${card.name}|${card.set}|${card.imgFile}`;

  if (!ytgAbbrev) warnings.push('no-set-alias');
  const title = opts.titleOverride ?? `${baseCardName(card.name)} (${ytgAbbrev ?? card.set})`;
  const handle = slugifyTitle(title);

  // --- tags (shared rules with the Products-tab tag sync — see tagRules.ts) ---
  const tagResult = computeCardTags(card);
  warnings.push(...tagResult.warnings);

  // --- variants / price ---
  const includeVariants = opts.includeVariants !== false;
  if (includeVariants && opts.price === null) warnings.push('no-price');
  const price = opts.price ?? '0.00';
  const trackInventory = opts.trackInventory !== false;

  // --- files / image ---
  if (opts.imageUrl === null) warnings.push('no-image');
  const files = opts.imageUrl !== null && opts.includeMedia !== false
    ? [{ originalSource: opts.imageUrl, contentType: 'IMAGE' as const, alt: baseCardName(card.name) }]
    : undefined;

  // --- description ---
  const trimmedAbility = card.specialAbility.trim();
  const descriptionHtml = opts.includeDescription !== false && trimmedAbility.length > 0
    ? `<p>${escapeHtml(trimmedAbility)}</p>`
    : undefined;

  const input: ShopifyProductSetInput = {
    title,
    handle,
    productType: 'Single',
    vendor: 'Your Turn Games',
    tags: tagResult.tags,
    status: opts.status,
    ...(descriptionHtml ? { descriptionHtml } : {}),
    ...(includeVariants ? {
      productOptions: [{ name: 'Title', values: [{ name: 'Default Title' }] }],
      variants: [{
        optionValues: [{ optionName: 'Title', name: 'Default Title' }],
        price,
        sku: cardSku(card),
        ...(trackInventory ? { inventoryItem: { tracked: true } } : {}),
      }],
    } : {}),
    ...(files ? { files } : {}),
    metafields: [{ namespace: 'custom', key: 'rtt_card_key', value: cardKey, type: 'single_line_text_field' }],
  };

  return { cardKey, input, warnings };
}
