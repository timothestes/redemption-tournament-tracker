// Pure play-field zone helpers. No SpacetimeDB runtime imports so this can be
// unit tested in isolation (see __tests__/playField.test.ts) and shared by the
// reducer write paths in index.ts.

// The three zones where a card is "in play" on the field. Everything else
// (deck, hand, discard, reserve, banish, soul-deck, land-of-redemption) is
// off-field — the card has left play.
export const ON_FIELD_ZONES = ['territory', 'land-of-bondage', 'battle'] as const;

export function isOnFieldZone(zone: string): boolean {
  return (ON_FIELD_ZONES as readonly string[]).includes(zone);
}

// True only when a card moves from an on-field zone to an off-field zone, i.e.
// it genuinely leaves the play field. Relocations between on-field zones — most
// importantly the battle-zone round trip (territory -> battle -> territory) —
// are NOT leaving play, so lasting in-play characteristics must survive them.
export function isLeavingPlayField(fromZone: string, toZone: string): boolean {
  return isOnFieldZone(fromZone) && !isOnFieldZone(toZone);
}
