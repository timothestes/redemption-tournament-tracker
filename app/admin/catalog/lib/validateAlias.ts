// Alias validation for the catalog editor — run in the browser for instant
// feedback and again in the server action, which is the one that counts.
//
// The scripts-side twin (scripts/lib/applyCardAliases.js) repeats all of this
// at codegen time against the FINAL catalog, because the catalog moves under
// the table: a card added upstream can turn a fine alias into a shadowed one
// long after it was saved.
import { CARDS } from "@/lib/cards/lookup";
import { cardNameStem } from "@/lib/cards/cardIdentity";
import { cardNameKey } from "@/lib/cards/nameKey";
import { aliasShapeError, normalizeAlias } from "./aliasShared";

// Every key a `[[mention]]` already resolves without help — printed names and
// the name stems the resolver falls back to. Built lazily from the catalog
// itself, the way validateOverride builds its enum sets.
let takenKeys: Set<string> | null = null;
function getTakenKeys(): Set<string> {
  if (!takenKeys) {
    takenKeys = new Set<string>();
    for (const card of CARDS) {
      takenKeys.add(cardNameKey(card.name));
      takenKeys.add(cardNameKey(cardNameStem(card.name, card.type)));
    }
  }
  return takenKeys;
}

/**
 * @param existing every alias already stored, any card — aliases are global.
 */
export function validateAlias(
  raw: string,
  existing: readonly string[],
): { ok: true; alias: string } | { ok: false; error: string } {
  const shape = aliasShapeError(raw);
  if (shape) return { ok: false, error: shape };

  const alias = normalizeAlias(raw);
  const key = cardNameKey(alias);

  // A real card always wins in resolution, so an alias landing on one would
  // never fire — better to refuse it than to ship a mention that does nothing.
  if (getTakenKeys().has(key)) {
    return { ok: false, error: `"${alias}" is already a card name — a mention matches the catalog first` };
  }
  if (existing.some((e) => cardNameKey(e) === key)) {
    return { ok: false, error: `"${alias}" is already in use` };
  }
  return { ok: true, alias };
}
