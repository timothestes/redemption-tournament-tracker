/**
 * Port of redemption-tournament-api/src/utilities/sort.py's `sort_cards`,
 * restricted to the sheets' fixed field order `["type", "alignment", "brigade", "name"]`
 * (sort.py:13-40,311-328). The "default" mode and brigade-order arrays are out of
 * scope here and must NOT be used.
 */
import type { ResolvedCard } from "./types";

const ALIGNMENT_PRIORITY: Record<string, number> = { Good: 0, Evil: 1, Neutral: 2 };

function alignmentPriority(alignment: string | null | undefined): number {
  return ALIGNMENT_PRIORITY[alignment ?? ""] ?? 3;
}

/** Raw code-point compare — never localeCompare (parity with Python's `<`). */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

type SortKey = readonly [type: string, alignment: number, brigade: string, name: string];

function keyOf(name: string, card: ResolvedCard): SortKey {
  return [card.type ?? "", alignmentPriority(card.alignment), card.rawBrigade ?? "", name.toLowerCase()];
}

function compareKeys(a: SortKey, b: SortKey): number {
  return (
    compareStrings(a[0], b[0]) ||
    (a[1] - b[1]) ||
    compareStrings(a[2], b[2]) ||
    compareStrings(a[3], b[3])
  );
}

/**
 * Sort by [type, alignment, brigade, name]. JS `Array.prototype.sort` is stable
 * (ES2019+), same as Python's `sorted`, so ties break by insertion order in `cards`.
 */
export function sheetSort(cards: Map<string, ResolvedCard>): Array<[string, ResolvedCard]> {
  return Array.from(cards.entries()).sort(
    ([nameA, cardA], [nameB, cardB]) => compareKeys(keyOf(nameA, cardA), keyOf(nameB, cardB))
  );
}
