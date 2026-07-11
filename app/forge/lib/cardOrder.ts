import type { ForgeCardFull } from "@/app/forge/lib/cards";
import { compareCardsDefault, type SortableCard } from "@/lib/cards/defaultSort";

// Adapt a forge card snapshot (array-valued cardType/brigades, numeric-or-string
// strength) to the canonical comparator's shape. Cards with no primary type get
// an empty type string, which the comparator sends to the trailing misc section
// — preserving the old "missing primary type sorts last" behavior, since every
// typed forge card lands in an earlier section.
function toSortable(c: ForgeCardFull): SortableCard {
  const s = c.snapshot;
  return {
    name: c.title ?? "",
    type: (s?.cardType ?? []).join("/"),
    brigade: (s?.brigades ?? []).join("/"),
    alignment: s?.alignment,
    strength: s?.strength == null ? "" : String(s.strength),
    reference: s?.reference,
  };
}

// Default set-card display order: the canonical default card sort (sections →
// brigades → strength → name). Shared by the set grid (SetCardsBrowser) and the
// single-card detail view's prev/next arrows so both walk the set in the same
// order.
export function sortSetCards(cards: ForgeCardFull[]): ForgeCardFull[] {
  return [...cards].sort((a, b) => compareCardsDefault(toSortable(a), toSortable(b)));
}
