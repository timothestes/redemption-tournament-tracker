"use client";

import type { Card } from "./utils";
import { ALL_CARDS } from "./data/cardIndex";

/**
 * Injection seams that let one builder serve both the public site and the Forge.
 * Phase 0 wires only `pool`; `renderThumb`, `persistence`, and `features`/`formats`
 * are added in later phases alongside their first consumer.
 *
 * See docs/superpowers/plans/2026-06-26-forge-deckbuilder-unification.md
 */
export interface DeckBuilderConfig {
  /** Card pool the builder searches and renders. Public: ALL_CARDS. Forge: [...forgeCards, ...ALL_CARDS]. */
  pool: Card[];
}

/** Public default: the builder behaves exactly as it does today. */
export const PUBLIC_BUILDER_CONFIG: DeckBuilderConfig = {
  pool: ALL_CARDS,
};
