/**
 * Pure helpers: strip product body_html to comparable text and score token
 * overlap against a card's special ability. Client-safe (no server deps) —
 * the review-queue UI reuses stripHtmlToText for display.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  ndash: '–', mdash: '—', hellip: '…',
};

export function stripHtmlToText(html: string | null | undefined): string {
  if (!html) return '';
  let text = html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  text = text.replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)));
  text = text.replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)));
  text = text.replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
  return text.replace(/\s+/g, ' ').trim();
}

// Small, ability-text-tuned stopword list — connective glue that appears in
// nearly every Redemption ability and carries no discriminating signal.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'or', 'and', 'is', 'are', 'be',
  'you', 'your', 'may', 'if', 'it', 'its', 'this', 'that', 'from', 'with',
  'for', 'at', 'by', 'not', 'cannot',
]);

export function tokenSet(text: string): Set<string> {
  const normalized = text.toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
  const words = normalized.match(/[a-z0-9']+/g) ?? [];
  const out = new Set<string>();
  for (const w of words) if (!STOPWORDS.has(w)) out.add(w);
  return out;
}

/** Jaccard similarity of stopword-filtered token sets. 0 when either side is empty. */
export function abilityTextScore(cardAbility: string, bodyText: string): number {
  const a = tokenSet(cardAbility);
  const b = tokenSet(bodyText);
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}
