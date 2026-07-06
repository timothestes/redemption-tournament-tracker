"use client";

import {
  CARD_TYPES, ALIGNMENTS, BRIGADES, CLASSES, ICONS,
  type DesignCard, type CardType, type Brigade,
} from "@/app/forge/lib/designCard";
import { BRIGADE_HEX } from "@/app/forge/lib/frameAssets";
import { deriveTestamentAndGospel, formatTestament } from "@/app/decklist/card-search/data/testament";

// Light-colored brigades need dark text for legible chip labels.
const LIGHT_BRIGADES = new Set<Brigade>(["White", "Silver", "GoodGold", "PaleGreen"]);

type ClassName = (typeof CLASSES)[number];
type IconName = (typeof ICONS)[number];

function toggle<T>(arr: T[] | undefined, v: T): T[] {
  const a = arr ?? [];
  return a.includes(v) ? a.filter((x) => x !== v) : [...a, v];
}

// Structured, deck-relevant fields. The freeform text box stays the primary way to
// write a card; these give the deckbuilder/validator machine-readable data (type,
// brigade, stats, class, icons, identifiers, alignment, scripture). Every field is
// always editable so any card — including a brand-new idea with no type yet — can be
// filled out completely.
export default function CardDetailsFields({
  snapshot, update,
}: { snapshot: DesignCard; update: (patch: Partial<DesignCard>) => void }) {
  const types = snapshot.cardType ?? [];
  // Testament is never stored — it's derived from the reference. Mirror what the
  // deckbuilder's N.T./O.T. filter will see so designers get instant feedback
  // (and catch a mistyped reference that wouldn't classify).
  const reference = (snapshot.reference ?? "").trim();
  const { testament, isGospel } = deriveTestamentAndGospel(reference);

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

      {/* Brigade */}
      <div>
        <span className="mb-1 block text-sm font-medium">Brigade</span>
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

      {/* Strength / Toughness */}
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

      {/* Class */}
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

      {/* Icons — Territory / Star / Cloud */}
      <div>
        <span className="mb-1 block text-sm font-medium">Icons</span>
        <div className="flex flex-wrap gap-2">
          {ICONS.map((ic) => {
            const selected = (snapshot.icons ?? []).includes(ic);
            return (
              <button key={ic} type="button"
                onClick={() => update({ icons: toggle<IconName>(snapshot.icons, ic) })}
                className={`rounded-full border px-3 py-1 text-xs ${selected ? "border-transparent bg-emerald-600 text-white" : "text-foreground"}`}>
                {ic}
              </button>
            );
          })}
        </div>
      </div>

      {/* Identifier(s) */}
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Identifier(s)</span>
        <input
          value={(snapshot.identifiers ?? []).join(", ")}
          onChange={(e) => update({ identifiers: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
          placeholder="Comma-separated, e.g. Genesis, Patriarch"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
      </label>

      {/* Reference — scripture citation printed on the card */}
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Reference</span>
        <input
          value={snapshot.reference ?? ""}
          onChange={(e) => update({ reference: e.target.value || undefined })}
          placeholder="e.g. Revelation 19:15"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
        <span className="mt-1 block text-xs text-muted-foreground">The scripture reference printed on the card.</span>
        {reference !== "" &&
          (testament ? (
            <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="rounded border px-1.5 py-0.5 font-medium text-muted-foreground">{formatTestament(testament)}</span>
              {isGospel && (
                <span className="rounded border px-1.5 py-0.5 font-medium text-muted-foreground">Gospel</span>
              )}
            </span>
          ) : (
            <span className="mt-1.5 block text-xs text-amber-700 dark:text-amber-300">
              Couldn&rsquo;t determine testament from this reference.
            </span>
          ))}
      </label>

      {/* Scripture — the verse text printed on the card */}
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Scripture</span>
        <textarea
          value={snapshot.scripture ?? ""}
          onChange={(e) => update({ scripture: e.target.value || undefined })}
          placeholder="The scripture text printed on the card."
          className="h-20 w-full rounded-md border bg-background px-3 py-2 text-sm" />
      </label>
    </fieldset>
  );
}
