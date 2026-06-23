import type { Brigade, CardType, DesignCard } from "./designCard";
import { isStatBearing } from "./designCard";

const BASE = "/forge/frames/Elements";
const ICONS = "/forge/frames/Icons";

// Brigade -> wash slug. GoodGold uses the kit's single "gold" wash.
const BRIGADE_SLUG: Record<Brigade, string> = {
  Blue: "blue", Clay: "clay", GoodGold: "gold", Green: "green", Purple: "purple",
  Silver: "silver", White: "white",
  Black: "black", Brown: "brown", Crimson: "crimson",
  Gray: "gray", Orange: "orange", PaleGreen: "pale-green",
};

// Slugs that ship as Elements washes — one per supported brigade.
const AVAILABLE_WASH = new Set([
  "blue", "clay", "gold", "green", "purple", "silver", "white",
  "black", "brown", "crimson", "gray", "orange", "pale-green",
]);

// Fallback solid colors for every brigade (used for dual washes / safety).
export const BRIGADE_HEX: Record<Brigade, string> = {
  Blue: "#2f6fb3", Clay: "#b08a5a", GoodGold: "#d4af37", Green: "#2f8f4e",
  Purple: "#7a4fa3", Silver: "#aab2bd", White: "#e8e8e8",
  Black: "#222222", Brown: "#6b4423", Crimson: "#a01a4a",
  Gray: "#6b7280", Orange: "#d2691e", PaleGreen: "#9bbf8a",
};

// Special types use a type-specific wash instead of a brigade wash.
function specialWash(card: DesignCard): string | null {
  const types = card.cardType ?? [];
  const evil = card.alignment === "Evil";
  if (types.includes("LostSoul")) return "lost-soul";
  if (types.includes("Artifact")) return "artifact";
  if (types.includes("Dominant")) return evil ? "evil-dom" : "good-dom";
  if (types.includes("Fortress")) return evil ? "evil-fort" : "good-fort";
  return null;
}

export function washPath(card: DesignCard): string | null {
  const special = specialWash(card);
  if (special) return `${BASE}/Background=${special}.webp`;
  const brigades = card.brigades ?? [];
  if (brigades.length === 0) return null;
  const s1 = BRIGADE_SLUG[brigades[0]];
  if (brigades.length >= 2) {
    const s2 = BRIGADE_SLUG[brigades[1]];
    if (AVAILABLE_WASH.has(s1) && AVAILABLE_WASH.has(s2)) return `${BASE}/Background=${s1}/${s2}.webp`;
  }
  return AVAILABLE_WASH.has(s1) ? `${BASE}/Background=${s1}.webp` : null;
}

export function statBoxPath(card: DesignCard): string | null {
  if (!isStatBearing(card.cardType ?? [])) return null;
  const brigades = card.brigades ?? [];
  const s1 = brigades[0] ? BRIGADE_SLUG[brigades[0]] : null;
  if (!s1 || !AVAILABLE_WASH.has(s1)) return null; // solid fallback handled by component
  // Stat-box color element: capitalized brigade name in the kit (e.g. Color=Gold).
  const cap = s1.charAt(0).toUpperCase() + s1.slice(1);
  return `${BASE}/Color=${cap}.webp`;
}

// Type icon shown in the stat box / corner. Tuned visually against references.
const ICON_BY_TYPE: Partial<Record<CardType, string>> = {
  Hero: "Cross Icon.png",
  EvilCharacter: "Evil Character.png",
  Site: "Site.png",
};
export function iconPath(card: DesignCard): string | null {
  const t = (card.cardType ?? [])[0];
  const f = t ? ICON_BY_TYPE[t] : undefined;
  return f ? `${ICONS}/${f}` : null;
}

export function isPreviewApproximate(card: DesignCard): boolean {
  if ((card.brigades ?? []).length >= 3) return true;
  if (card.legality === "Classic") return true;
  return false;
}
