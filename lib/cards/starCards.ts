/**
 * Star-card detection.
 *
 * Every star card in the pool leads its special ability with `(Star)` or
 * `STAR:` — 244 cards, verified against the generated card data. The regex is
 * anchored so the words "start"/"starts"/"Aristarchus" can never match.
 *
 * Always test against a card row's OWN `specialAbility` text, never against
 * `findCard(cardName)`: Forge cards are absent from the public card index, so
 * a lookup-based gate silently reads false for them.
 *
 * Mirrored server-side in `spacetimedb/src/index.ts` (isStarAbilityText) —
 * keep the two in sync.
 */
export const STAR_ABILITY_RE = /^\s*(\(star\)|star:)/i;

export function isStarAbilityText(specialAbility: string | null | undefined): boolean {
  return STAR_ABILITY_RE.test(specialAbility ?? '');
}
