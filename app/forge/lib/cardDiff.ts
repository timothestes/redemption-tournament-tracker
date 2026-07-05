// Pure diff of two DesignCard snapshots → per-field change descriptors + a
// one-line plain-language summary, plus a value coercer for suggestions. No DB,
// no UI. Drives the Current vs Proposed review diff.

import type { DesignCard } from "@/app/forge/lib/designCard";

export type FieldChange = {
  field: keyof DesignCard;
  label: string;
  kind: "added" | "removed" | "changed";
  before: string | null;
  after: string | null;
};

// Display order + friendly labels for the diffable DesignCard fields.
export const FIELD_LABELS: Record<string, string> = {
  name: "Name", cardType: "Type", alignment: "Alignment", brigades: "Brigade",
  strength: "Strength", toughness: "Toughness", class: "Class", icons: "Icons",
  identifiers: "Identifiers", specialAbility: "Special ability", reference: "Reference",
  legality: "Legality", rarity: "Rarity", scripture: "Scripture",
  artistCredit: "Artist", cardFrame: "Card frame",
};

export const DIFF_FIELDS = Object.keys(FIELD_LABELS) as (keyof DesignCard)[];

const ARRAY_FIELDS = new Set(["cardType", "brigades", "class", "icons", "identifiers"]);
const NUMBER_FIELDS = new Set(["strength", "toughness"]);

function display(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (Array.isArray(v)) return v.length ? v.join(", ") : null;
  return String(v);
}

export function diffCards(before: DesignCard, after: DesignCard): FieldChange[] {
  const out: FieldChange[] = [];
  for (const f of DIFF_FIELDS) {
    const b = display(before[f]);
    const a = display(after[f]);
    if (b === a) continue;
    const kind = b === null ? "added" : a === null ? "removed" : "changed";
    out.push({ field: f, label: FIELD_LABELS[f as string], kind, before: b, after: a });
  }
  return out;
}

export function summarizeDiff(changes: FieldChange[]): string {
  if (changes.length === 0) return "No field changes.";
  const labels = changes.map((c) => c.label);
  if (labels.length <= 3) return `Changed ${labels.join(", ")}.`;
  return `Changed ${labels.slice(0, 3).join(", ")} +${labels.length - 3} more.`;
}

// Best-effort coercion of a free-text suggestion value into the field's jsonb shape.
export function coerceFieldValue(field: string, text: string): unknown {
  const t = text.trim();
  if (NUMBER_FIELDS.has(field)) { const n = Number(t); return Number.isFinite(n) ? n : null; }
  if (ARRAY_FIELDS.has(field)) return t ? t.split(",").map((s) => s.trim()).filter(Boolean) : [];
  return t;
}
