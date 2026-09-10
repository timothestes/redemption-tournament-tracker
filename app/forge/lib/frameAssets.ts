// Pure mapping from a DesignCard to the frame kit under public/forge/frames/
// (washes, icon boxes, type icons, ability-box gradient). No DOM, no React.
// The kit and app/forge/lib/frameGeometry.ts are generated from the design team's
// Illustrator template by scripts/forge-extract-template.py — see the kit README.

import type { Alignment, Brigade, CardType, DesignCard } from "./designCard";
import { isStatBearing } from "./designCard";
import { BRIGADE_BOX_HEX, GRADIENT_ROWS } from "./frameGeometry";

const KIT = "/forge/frames";

// Brigade -> wash / box-color slug. Both golds share the template's one "gold".
export const BRIGADE_SLUG: Record<Brigade, keyof typeof BRIGADE_BOX_HEX> = {
  Blue: "blue", Clay: "clay", GoodGold: "gold", Green: "green", Purple: "purple",
  Red: "red", Silver: "silver", Teal: "teal", White: "white",
  Black: "black", Brown: "brown", Crimson: "crimson", EvilGold: "gold",
  Gray: "gray", Orange: "orange", PaleGreen: "pale-green",
};

// The template ships no Red or Teal wash; the kit hue-shifts crimson / blue for them.
export const SYNTHESIZED_WASHES: ReadonlySet<string> = new Set(["red", "teal"]);

// Icon-box color per brigade (ICC-converted from the template's CMYK fills).
export const BRIGADE_HEX: Record<Brigade, string> = Object.fromEntries(
  (Object.keys(BRIGADE_SLUG) as Brigade[]).map((b) => [b, BRIGADE_BOX_HEX[BRIGADE_SLUG[b]]]),
) as Record<Brigade, string>;

// Neutral box for brigade-less types that have no badge (Fortress/City/Curse/Covenant
// without a brigade). The template has no such fill; gray is the least wrong.
const NEUTRAL_BOX = BRIGADE_BOX_HEX.gray;

export type SpecialWash = "lost-soul" | "artifact" | "good-dom" | "evil-dom" | "good-fort" | "evil-fort";

// Brigade-less types take a type wash instead of a brigade wash (first match wins).
export function specialWash(card: DesignCard): SpecialWash | null {
  const types = card.cardType ?? [];
  const evil = card.alignment === "Evil";
  if (types.includes("LostSoul")) return "lost-soul";
  if (types.includes("Artifact")) return "artifact";
  if (types.includes("Dominant")) return evil ? "evil-dom" : "good-dom";
  if (types.includes("Fortress")) return evil ? "evil-fort" : "good-fort";
  return null;
}

/** Wash image URLs, bottom to top: [] (no brigade yet), [one], or [left, right] for a
 *  dual-brigade card. A special type always yields exactly one. */
export function washPaths(card: DesignCard): string[] {
  const special = specialWash(card);
  if (special) return [`${KIT}/washes/${special}.webp`];
  const slugs = (card.brigades ?? []).slice(0, 2).map((b) => BRIGADE_SLUG[b]);
  return slugs.map((s) => `${KIT}/washes/${s}.webp`);
}

export type IconBox = {
  /** Solid fill when there is no badge. */
  fill: string;
  /** Box-filling composite (artifact chalice, dominant nebula, multi-brigade foil). */
  badge: string | null;
  /** Type icon drawn over the fill/badge, if any. */
  icon: string | null;
  /** Stats text ("S/T") shares the box; the icon shrinks to make room. */
  withStats: boolean;
  /** Light fills take dark stat text (the template ships #/# in white and black). */
  darkText: boolean;
};

const ICON_BY_TYPE: Record<CardType, string | null> = {
  Hero: "cross", EvilCharacter: "dragon", GE: "bible", EE: "skull",
  Artifact: null, Dominant: null, Fortress: "fortress", Site: "site", City: "site",
  Curse: "skull", Covenant: "bible", LostSoul: "lostsoul-rebellion",
};
// Types whose icon has a stats-height variant in the template.
const SMALL_VARIANT = new Set(["skull", "bible"]);

function badgeFor(types: CardType[], alignment: Alignment | undefined, brigadeCount: number): string | null {
  const evil = alignment === "Evil";
  if (types.includes("Artifact")) return "artifact";
  if (types.includes("Dominant")) return evil ? "reaper" : "lamb";
  if (types.includes("Fortress") || types.includes("LostSoul")) return evil ? "evil-dom" : "good-dom";
  if (brigadeCount >= 3) return evil ? "multi-evil" : "multi-good";
  return null;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** The icon box for one side. Left always exists once a type is chosen; right only for
 *  a dual-brigade card (second brigade, same icon, no stats). */
export function iconBox(card: DesignCard, side: "left" | "right"): IconBox | null {
  const types = card.cardType ?? [];
  const brigades = card.brigades ?? [];
  if (types.length === 0) return null;
  if (side === "right" && (brigades.length !== 2 || specialWash(card))) return null;
  const brigade = side === "right" ? brigades[1] : brigades[0];
  const badge = side === "left" ? badgeFor(types, card.alignment, brigades.length) : null;
  const fill = brigade ? BRIGADE_HEX[brigade] : NEUTRAL_BOX;
  const withStats = side === "left" && isStatBearing(types);
  const base = ICON_BY_TYPE[types[0]];
  const icon = base && withStats && SMALL_VARIANT.has(base) ? `${base}-small` : base;
  return {
    fill,
    badge: badge ? `${KIT}/badges/${badge}.webp` : null,
    icon: icon ? `${KIT}/icons/${icon}.png` : null,
    withStats,
    darkText: !badge && luminance(fill) > 0.55,
  };
}

export type ClassIcon = "warrior" | "weapon" | "territory";
/** Class icons stack under the left box, in the template's order. */
export function classIcons(card: DesignCard): string[] {
  const out: ClassIcon[] = [];
  for (const c of card.class ?? []) out.push(c === "Warrior" ? "warrior" : "weapon");
  if ((card.icons ?? []).includes("Territory")) out.push("territory");
  return out.slice(0, 2).map((c) => `${KIT}/icons/${c}.png`);
}

/** Ability-box gradient variant: the dark (scripture) region grows with the verse.
 *  Rows = estimated verse lines (~62 chars each at the preview's size) + the reference line. */
export function gradientRows(card: DesignCard): keyof typeof GRADIENT_ROWS {
  const verse = (card.scripture ?? "").trim();
  if (!verse) return 2;
  const lines = Math.ceil(verse.length / 62) + 1;
  return Math.min(5, Math.max(2, lines)) as keyof typeof GRADIENT_ROWS;
}

export function isPreviewApproximate(card: DesignCard): boolean {
  if ((card.brigades ?? []).length >= 3) return true;
  if (card.legality === "Classic") return true;
  if ((card.brigades ?? []).some((b) => SYNTHESIZED_WASHES.has(BRIGADE_SLUG[b]))) return true;
  return false;
}
