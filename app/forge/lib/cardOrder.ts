import { BRIGADES } from "@/app/forge/lib/designCard";
import type { ForgeCardFull } from "@/app/forge/lib/cards";

// Default set-card display order: by card type alphabetically, then brigade
// (canonical BRIGADES order ascending), then title. Cards missing a primary type
// sort last. Shared by the set grid (SetCardsBrowser) and the single-card detail
// view's prev/next arrows so both walk the set in the same order.
export function sortSetCards(cards: ForgeCardFull[]): ForgeCardFull[] {
  const rank = (value: string | undefined, order: readonly string[]) => {
    const i = value ? order.indexOf(value) : -1;
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const brigadeRank = (c: ForgeCardFull) => rank(c.snapshot?.brigades?.[0], BRIGADES);
  const typeAlpha = (a: ForgeCardFull, b: ForgeCardFull) => {
    const ta = a.snapshot?.cardType?.[0], tb = b.snapshot?.cardType?.[0];
    if (ta === tb) return 0;
    if (!ta) return 1; // no primary type → last
    if (!tb) return -1;
    return ta.localeCompare(tb);
  };
  return [...cards].sort(
    (a, b) =>
      typeAlpha(a, b) ||
      brigadeRank(a) - brigadeRank(b) ||
      (a.title ?? "").localeCompare(b.title ?? ""),
  );
}
