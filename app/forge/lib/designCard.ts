// Pure DesignCard schema + advisory validation. No UI, no DB. Consumed by the
// form, the preview, and (later) publish validation. Arrays are native; the
// legacy delimited-string toCardData() adapter is deferred to Phase 2.

export const CARD_TYPES = [
  "Hero", "EvilCharacter", "GE", "EE", "LostSoul", "Artifact",
  "Dominant", "Fortress", "Site", "City", "Curse", "Covenant",
] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const ALIGNMENTS = ["Good", "Evil", "Neutral", "Good_Evil"] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

// Resolved brigades only — no GoodMulti/EvilMulti sentinels (spec Decision #2).
// Red, Teal, and Evil Gold are intentionally unsupported (the kit has no frame for them).
export const GOOD_BRIGADES = ["Blue", "Clay", "GoodGold", "Green", "Purple", "Silver", "White"] as const;
export const EVIL_BRIGADES = ["Black", "Brown", "Crimson", "Gray", "Orange", "PaleGreen"] as const;
export const BRIGADES = [...GOOD_BRIGADES, ...EVIL_BRIGADES] as const;
export type Brigade = (typeof BRIGADES)[number];

export const CLASSES = ["Warrior", "Weapon"] as const;
export const ICONS = ["Territory", "Star", "Cloud"] as const;
export const LEGALITIES = ["Rotation", "Classic", "Scrolls", "Paragon", "Banned"] as const;

// NOTE: the property keys below are mirrored by the SQL allowlist
// `_forge_is_card_field` (used to validate field-anchored suggestions); its
// current definition is in supabase/migrations/067_forge_scripture_field.sql.
// Keep the two lists in sync.
// "X" is a real stat value (variable strength/toughness, e.g. The Faithful Followers).
export type StatValue = number | "X" | null;

export type DesignCard = {
  name?: string;
  rawText?: string;
  cardType?: CardType[];
  alignment?: Alignment;
  brigades?: Brigade[];
  strength?: StatValue;
  toughness?: StatValue;
  class?: (typeof CLASSES)[number][];
  icons?: (typeof ICONS)[number][];
  identifiers?: string[];
  specialAbility?: string;
  reference?: string;
  legality?: (typeof LEGALITIES)[number];
  rarity?: string;
  scripture?: string;
  artistCredit?: string;
  cardFrame?: string;
};

export type Applicability = "required" | "optional" | "na";
export type FieldKey =
  | "brigades" | "stats" | "class" | "icons"
  | "identifiers" | "specialAbility" | "reference";

const NA: Record<FieldKey, Applicability> = {
  brigades: "na", stats: "na", class: "na",
  icons: "na", identifiers: "na", specialAbility: "na", reference: "na",
};

// Per-type applicability, grounded in the real Redemption card pool (Site ~100%
// brigade, Fortress ~6%). "stats" = strength+toughness (Hero/EvilCharacter only).
const MATRIX: Record<CardType, Partial<Record<FieldKey, Applicability>>> = {
  Hero:          { brigades: "required", stats: "required", class: "optional", icons: "optional", identifiers: "optional", specialAbility: "optional", reference: "optional" },
  EvilCharacter: { brigades: "required", stats: "required", class: "optional", icons: "optional", identifiers: "optional", specialAbility: "optional", reference: "optional" },
  GE:            { brigades: "required", specialAbility: "required", reference: "optional" },
  EE:            { brigades: "required", specialAbility: "required", reference: "optional" },
  LostSoul:      { specialAbility: "optional", reference: "optional", identifiers: "optional" },
  Artifact:      { specialAbility: "required", identifiers: "optional", reference: "optional" },
  Dominant:      { specialAbility: "required", identifiers: "optional", reference: "optional" },
  Fortress:      { brigades: "optional", specialAbility: "optional", reference: "optional" },
  Site:          { brigades: "required", specialAbility: "optional", reference: "optional" },
  City:          { brigades: "optional", specialAbility: "optional", reference: "optional" },
  Curse:         { brigades: "optional", specialAbility: "optional", reference: "optional" },
  Covenant:      { brigades: "optional", specialAbility: "optional", reference: "optional" },
};

const RANK: Record<Applicability, number> = { na: 0, optional: 1, required: 2 };

export function cardApplicability(types: CardType[]): Record<FieldKey, Applicability> {
  const out: Record<FieldKey, Applicability> = { ...NA };
  for (const t of types) {
    const m = MATRIX[t] ?? {};
    for (const k of Object.keys(out) as FieldKey[]) {
      const cand = m[k] ?? "na";
      if (RANK[cand] > RANK[out[k]]) out[k] = cand;
    }
  }
  return out;
}

export function isStatBearing(types: CardType[]): boolean {
  return cardApplicability(types).stats === "required";
}

export type ValidationHint = { field: string; message: string };

// ADVISORY ONLY — never blocks autosave/creation. Empty/napkin card => no hints.
export function validate(card: DesignCard): ValidationHint[] {
  const types = card.cardType ?? [];
  if (types.length === 0) return [];
  const app = cardApplicability(types);
  const hints: ValidationHint[] = [];
  const has = (v: unknown) =>
    Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== "";

  if (app.brigades === "required" && !has(card.brigades))
    hints.push({ field: "brigades", message: "This type usually has a brigade." });
  if (app.stats === "required" && (!has(card.strength) || !has(card.toughness)))
    hints.push({ field: "stats", message: "This type usually has strength / toughness." });
  if (app.specialAbility === "required" && !has(card.specialAbility))
    hints.push({ field: "specialAbility", message: "This type usually has a special ability." });
  return hints;
}

/**
 * The descoped raw-text body. Falls back to the legacy napkin `specialAbility`
 * so cards saved before the 2026-07-03 descope don't read blank. Pure.
 */
export function cardRawText(card: DesignCard): string {
  return card.rawText ?? card.specialAbility ?? "";
}

/** Parse a stats text input: "" → null, "x"/"X" → "X", numbers pass, junk → null. Pure. */
export function parseStatInput(raw: string): StatValue {
  const t = raw.trim();
  if (!t) return null;
  if (/^x$/i.test(t)) return "X";
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
