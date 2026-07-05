"use client";

import {
  CARD_TYPES, ALIGNMENTS, BRIGADES, CLASSES,
  cardApplicability, type DesignCard, type CardType, type Brigade,
} from "@/app/forge/lib/designCard";
import { BRIGADE_HEX } from "@/app/forge/lib/frameAssets";

// Light-colored brigades need dark text for legible chip labels.
const LIGHT_BRIGADES = new Set<Brigade>(["White", "Silver", "GoodGold", "PaleGreen"]);

type ClassName = (typeof CLASSES)[number];

function toggle<T>(arr: T[] | undefined, v: T): T[] {
  const a = arr ?? [];
  return a.includes(v) ? a.filter((x) => x !== v) : [...a, v];
}

// Structured, deck-relevant fields. The freeform text box stays the primary way to
// write a card; these give the deckbuilder/validator machine-readable data (type,
// brigade, stats, class, identifiers, alignment). Fields appear only when they apply
// to the chosen card type (per the applicability matrix in designCard.ts).
export default function CardDetailsFields({
  snapshot, update,
}: { snapshot: DesignCard; update: (patch: Partial<DesignCard>) => void }) {
  const types = snapshot.cardType ?? [];
  const app = cardApplicability(types);

  return (
    <fieldset className="space-y-4 rounded-lg border bg-card p-4">
      <legend className="px-1 text-sm font-medium">Card details</legend>
      <p className="text-xs text-muted-foreground">
        Used for deck building — the builder reads these to categorize and validate the card.
      </p>

      {/* Type */}
      <div>
        <span className="mb-1 block text-sm font-medium">Type</span>
        <div className="flex flex-wrap gap-2">
          {CARD_TYPES.map((t) => (
            <button key={t} type="button"
              onClick={() => update({ cardType: toggle<CardType>(snapshot.cardType, t) })}
              className={`rounded-full border px-3 py-1 text-xs ${types.includes(t) ? "border-transparent bg-emerald-600 text-white" : "text-foreground"}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Alignment */}
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Alignment</span>
        <select value={snapshot.alignment ?? ""}
          onChange={(e) => update({ alignment: (e.target.value || undefined) as DesignCard["alignment"] })}
          className="rounded-md border bg-background px-3 py-2 text-sm">
          <option value="">—</option>
          {ALIGNMENTS.map((a) => <option key={a} value={a}>{a === "Good_Evil" ? "Good/Evil" : a}</option>)}
        </select>
      </label>

      {/* Brigade — only when the type uses brigades */}
      {app.brigades !== "na" && (
        <div>
          <span className="mb-1 block text-sm font-medium">
            Brigade{app.brigades === "required" ? "" : " (optional)"}
          </span>
          <div className="flex flex-wrap gap-2">
            {BRIGADES.map((b) => {
              const selected = (snapshot.brigades ?? []).includes(b);
              return (
                <button key={b} type="button"
                  onClick={() => update({ brigades: toggle<Brigade>(snapshot.brigades, b) })}
                  style={selected ? { backgroundColor: BRIGADE_HEX[b] } : undefined}
                  className={`rounded-full border px-3 py-1 text-xs ${selected ? `border-transparent ${LIGHT_BRIGADES.has(b) ? "text-gray-900" : "text-white"}` : "text-foreground"}`}>
                  {b}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Strength / Toughness — only for stat-bearing types */}
      {app.stats !== "na" && (
        <div className="flex gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Strength</span>
            <input type="number" value={snapshot.strength ?? ""}
              onChange={(e) => update({ strength: e.target.value === "" ? null : Number(e.target.value) })}
              className="w-24 rounded-md border bg-background px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Toughness</span>
            <input type="number" value={snapshot.toughness ?? ""}
              onChange={(e) => update({ toughness: e.target.value === "" ? null : Number(e.target.value) })}
              className="w-24 rounded-md border bg-background px-3 py-2 text-sm" />
          </label>
        </div>
      )}

      {/* Class — only when the type uses classes (Hero / Evil Character) */}
      {app.class !== "na" && (
        <div>
          <span className="mb-1 block text-sm font-medium">Class</span>
          <div className="flex flex-wrap gap-2">
            {CLASSES.map((c) => {
              const selected = (snapshot.class ?? []).includes(c);
              return (
                <button key={c} type="button"
                  onClick={() => update({ class: toggle<ClassName>(snapshot.class, c) })}
                  className={`rounded-full border px-3 py-1 text-xs ${selected ? "border-transparent bg-emerald-600 text-white" : "text-foreground"}`}>
                  {c}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Identifier(s) — only when the type uses them */}
      {app.identifiers !== "na" && (
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Identifier(s)</span>
          <input
            value={(snapshot.identifiers ?? []).join(", ")}
            onChange={(e) => update({ identifiers: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
            placeholder="Comma-separated, e.g. Genesis, Patriarch"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
        </label>
      )}
    </fieldset>
  );
}
