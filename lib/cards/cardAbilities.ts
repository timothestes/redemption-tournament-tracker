// lib/cards/cardAbilities.ts
// -----------------------------------------------------------------------------
// Per-card ability registry.
// NOTE: A duplicate of this file exists at spacetimedb/src/cardAbilities.ts —
// keep the CARD_ABILITIES entries and CardAbility union in sync. The parity
// is enforced by the test in lib/cards/__tests__/cardAbilities.test.ts.
// The SpacetimeDB copy also carries TOKEN_CARD_DATA (server-side token
// metadata) because the module tsconfig's rootDir prevents it from reading
// the generated CARDS dataset.
// -----------------------------------------------------------------------------
import type { ZoneId } from '@/app/shared/types/gameCard';

export type CardAbility =
  | { type: 'spawn_token'; tokenName: string; count?: number; defaultZone?: ZoneId }
  | { type: 'shuffle_and_draw'; shuffleCount: number; drawCount: number }
  | { type: 'custom'; reducerName: string; label: string };

/**
 * Registry keyed by CardData.identifier (see lib/cards/lookup.ts).
 * Each entry lists the abilities exposed on that card's right-click menu.
 * `count` defaults to 1 when omitted; cards that spawn multiple tokens per
 * effect set count explicitly so one click produces all of them atomically.
 */
export const CARD_ABILITIES: Record<string, CardAbility[]> = {
  'Two Possessed (GoC)':        [{ type: 'spawn_token', tokenName: 'Violent Possessor Token', count: 2 }],
  'The Accumulator (GoC)':      [{ type: 'spawn_token', tokenName: 'Wicked Spirit Token' }],
  'The Proselytizers (GoC)':    [{ type: 'spawn_token', tokenName: 'Proselyte Token' }],
  'The Church of Christ (GoC)': [{ type: 'spawn_token', tokenName: 'Follower Token' }],
  'Angel of the Harvest (GoC)': [{ type: 'spawn_token', tokenName: 'Heavenly Host Token' }],
  'The Heavenly Host (GoC)':    [{ type: 'spawn_token', tokenName: 'Heavenly Host Token' }],
};

export function getAbilitiesForCard(identifier: string): CardAbility[] {
  return CARD_ABILITIES[identifier] ?? [];
}

export function abilityLabel(a: CardAbility): string {
  switch (a.type) {
    case 'spawn_token': {
      const n = a.count ?? 1;
      return n > 1 ? `Create ${n}× ${a.tokenName}` : `Create ${a.tokenName}`;
    }
    case 'shuffle_and_draw':
      return `Shuffle ${a.shuffleCount} from hand, draw ${a.drawCount}`;
    case 'custom':
      return a.label;
  }
}
