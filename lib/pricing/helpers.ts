/** Shared helper functions for the card price matching system */

/**
 * Normalize a string for comparison.
 */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019\u0060\u00B4]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract the "clean" card name by stripping embedded set suffixes.
 * carddata sometimes bakes the set into the name:
 *   "Aaron (Pi)", "Abel (CoW)", "Abed-nego (Azariah) [T2C]"
 */
export function stripEmbeddedSet(name: string): string {
  // Remove trailing bracket notation: "Abed-nego (Azariah) [T2C]", "Lost Soul [Jeremiah 3:25 - LR]"
  let cleaned = name.replace(/\s*\[[A-Z][A-Za-z0-9 &+()\-:.,]*\]\s*$/, '').trim();
  // Remove trailing paren that looks like a short set code (2-5 chars)
  // e.g. "(Pi)", "(PoC)", "(Di)", "(CoW)" — but NOT scripture refs like "(Luke 13:25)"
  cleaned = cleaned.replace(/\s*\(([A-Z][A-Za-z0-9]{0,4})\)\s*$/, (_match, inner) => {
    // Accept mixed-case set codes: Pi, Di, Ki, Pa, PoC, CoW, GoC, FoM, etc.
    if (/^[A-Z][A-Za-z0-9]{0,4}$/.test(inner) && !/\d{2}/.test(inner)) return '';
    return _match;
  });
  // Remove trailing "(SetCode AB)" alternate border suffixes: "(CoW AB)", "(RoJ AB)"
  cleaned = cleaned.replace(/\s*\([A-Z][A-Za-z0-9]{1,4} AB\)\s*$/, '').trim();
  // Remove trailing "(SetCode Rarity)" patterns: "(GoC UR+)", "(LoC LR)", "(FoM UR+)"
  cleaned = cleaned.replace(/\s*\([A-Z][A-Za-z0-9]{1,4}\s+(?:UR\+?|LR|R[1-3]?)\)\s*$/, '').trim();
  // Remove "1st Print" variant suffixes
  cleaned = cleaned.replace(/\s*\(1st Print[^)]*\)\s*$/, '').trim();
  return cleaned.trim();
}

/**
 * Strip *Banned...* / *Out of Print* / (errata/corrected) suffixes from Shopify titles.
 */
export function stripShopifySuffixes(title: string): string {
  return title
    .replace(/\s*\*Banned[^*]*\*\s*/gi, '')
    .replace(/\s*\*Out of Print\*\s*/gi, '')
    .replace(/\s*\*Errata[^*]*\*\s*/gi, '')
    .replace(/\s*\(errata\/corrected\)\s*/gi, '')
    .trim();
}

/**
 * Parse brigade/type/sets from Shopify tags string.
 */
export function parseShopifyTags(tags: string): {
  brigade: string[];
  type: string[];
  sets: string[];
} {
  const tagList = tags.split(',').map(t => t.trim().toLowerCase());
  const brigadeColors = [
    'white', 'silver', 'gold', 'crimson', 'green', 'blue',
    'purple', 'gray', 'brown', 'orange', 'multi', 'teal',
    'red', 'black', 'pale green', 'clay',
  ];
  const cardTypes = [
    'hero', 'evil character', 'good enhancement', 'evil enhancement',
    'lost soul', 'artifact', 'dominant', 'covenant', 'site', 'fortress',
  ];
  return {
    brigade: tagList.filter(t => brigadeColors.includes(t)),
    type: tagList.filter(t => cardTypes.includes(t)),
    sets: tagList.filter(t => !brigadeColors.includes(t) && !cardTypes.includes(t)),
  };
}

/** Sets that YTG doesn't sell as singles */
export const UNSOLD_SETS = new Set([
  'Main', 'Main UL', 'Main [Ban]', 'Main UL [Ban]',
  '1E', '1EU', '2E', '2ER', '3E',
  '10A', 'Fund',
]);
