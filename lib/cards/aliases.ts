/**
 * Card aliases — short names people actually say ("LAFS") pointing at the
 * printing they mean ("Love at First Sight (LoC)").
 *
 * Curated in /admin/catalog, stored in `card_aliases`, and baked into the
 * generated overlay by `make pull-card-overrides` — the same build-time path
 * card overrides take, so one generated artifact serves the server-rendered
 * article page and the browser-rendered deck description alike.
 *
 * Aliases are a LAST resort in `[[mention]]` resolution: a real card name or
 * name stem always wins, so an alias can never shadow the catalog. The editor
 * and the codegen both refuse an alias that collides with one.
 */
import { findCard, type CardData } from "./lookup";
import { cardNameKey } from "./nameKey";
import generated from "./generated/cardAliases.json";

export interface CardAlias {
  /** As typed by the curator — what the picker shows. */
  alias: string;
  /** Target printing, matched byte-for-byte against CardData name|set. */
  name: string;
  set: string;
}

export type AliasIndex = ReadonlyMap<string, CardAlias>;

/** Loose key → entry. First entry wins; the codegen rejects duplicates outright. */
export function buildAliasIndex(entries: readonly CardAlias[]): AliasIndex {
  const map = new Map<string, CardAlias>();
  for (const entry of entries) {
    const key = cardNameKey(entry.alias);
    if (key && !map.has(key)) map.set(key, entry);
  }
  return map;
}

/**
 * The printing an alias names, or undefined when the alias is unknown or its
 * target has left the catalog. Strict on name AND set: findCard() degrades to a
 * name-only match, which would let a stale set_code point at another print.
 */
export function lookupAlias(index: AliasIndex, alias: string): CardData | undefined {
  const entry = index.get(cardNameKey(alias));
  if (!entry) return undefined;
  const card = findCard(entry.name, entry.set);
  return card && card.name === entry.name && card.set === entry.set ? card : undefined;
}

export const CARD_ALIASES: readonly CardAlias[] = generated as CardAlias[];

const INDEX = buildAliasIndex(CARD_ALIASES);

export function aliasTarget(alias: string): CardData | undefined {
  return lookupAlias(INDEX, alias);
}
