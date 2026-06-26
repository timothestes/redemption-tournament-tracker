// Pure dashboard-model computation. No DB, no UI. Counts a card in every
// (type, brigade) cell it occupies; brigade-less types use the "none" bucket.

import { CARD_TYPES, type CardType } from "@/app/forge/lib/designCard";

export type TargetCounts = {
  total?: number;
  cells?: Record<string, Record<string, number>>;
};

// Default per-type proportions for seeding a brand-new set. Rationale:
// characters (Hero/EvilCharacter), enhancements (GE/EE) and Lost Souls are the
// playable bulk of any Redemption set — they fill decks and drive gameplay, so
// they carry the heaviest weight. Utility types (Artifact/Dominant) appear in
// smaller numbers, and territory/special cards
// (Site/Fortress/City/Curse/Covenant) are lighter still. Weights sum to ~1.0;
// they are a defensible starting point the designer refines, not a rule.
export const DEFAULT_TYPE_WEIGHTS: Record<CardType, number> = {
  Hero: 0.15,
  EvilCharacter: 0.13,
  GE: 0.14,
  EE: 0.12,
  LostSoul: 0.12,
  Artifact: 0.07,
  Dominant: 0.06,
  Site: 0.06,
  Fortress: 0.05,
  City: 0.04,
  Curse: 0.03,
  Covenant: 0.03,
};

// Build a brigade-agnostic seed from a desired grand total: each type's share of
// `total` is stored under its "none" bucket (the designer breaks it out per
// brigade later via the targets editor). Keeps the { total, cells } shape the
// progress heatmap consumes.
export function defaultTargets(total: number): TargetCounts {
  const cells: Record<string, Record<string, number>> = {};
  for (const type of CARD_TYPES) {
    const count = Math.round(DEFAULT_TYPE_WEIGHTS[type] * total);
    if (count > 0) cells[type] = { none: count };
  }
  return { total, cells };
}

export type ProgressCell = { type: string; brigade: string; actual: number; target: number };

export type ProgressModel = {
  headline: { actual: number; target: number; pct: number };
  byStatus: Record<string, number>;
  types: string[];
  brigades: string[];
  cells: ProgressCell[];
  checklist: { type: string; brigade: string; remaining: number }[];
};

type CardLike = { snapshot: { cardType?: string[]; brigades?: string[] }; status: string };

export function computeProgress(cards: CardLike[], targets: TargetCounts): ProgressModel {
  const live = cards.filter((c) => c.status !== "archived");

  const byStatus: Record<string, number> = {};
  for (const c of live) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;

  // actual[type][brigade] = count
  const actual: Record<string, Record<string, number>> = {};
  const bump = (t: string, b: string) => {
    (actual[t] ??= {})[b] = (actual[t]?.[b] ?? 0) + 1;
  };
  for (const c of live) {
    const types = c.snapshot.cardType ?? [];
    const brigades = c.snapshot.brigades ?? [];
    for (const t of types) {
      if (brigades.length === 0) bump(t, "none");
      else for (const b of brigades) bump(t, b);
    }
  }

  const cellTargets = targets.cells ?? {};
  const types = Array.from(new Set([...Object.keys(cellTargets), ...Object.keys(actual)])).sort();
  const brigades = Array.from(
    new Set([
      ...Object.values(cellTargets).flatMap((row) => Object.keys(row)),
      ...Object.values(actual).flatMap((row) => Object.keys(row)),
    ])
  ).sort();

  const cells: ProgressCell[] = [];
  const checklist: { type: string; brigade: string; remaining: number }[] = [];
  for (const t of types) {
    for (const b of brigades) {
      const a = actual[t]?.[b] ?? 0;
      const tgt = cellTargets[t]?.[b] ?? 0;
      cells.push({ type: t, brigade: b, actual: a, target: tgt });
      if (tgt > a) checklist.push({ type: t, brigade: b, remaining: tgt - a });
    }
  }

  const target = targets.total ?? 0;
  const pct = target > 0 ? Math.round((live.length / target) * 100) : 0;

  return { headline: { actual: live.length, target, pct }, byStatus, types, brigades, cells, checklist };
}
