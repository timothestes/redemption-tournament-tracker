"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { uploadArt, setPlaceholder, type ForgeCardFull } from "@/app/forge/lib/cards";
import {
  CARD_TYPES, ALIGNMENTS, BRIGADES, LEGALITIES,
  cardApplicability, isStatBearing, type DesignCard, type CardType, type Brigade,
} from "@/app/forge/lib/designCard";
import { BRIGADE_HEX } from "@/app/forge/lib/frameAssets";

// Light-colored brigades need dark text for legible chip labels.
const LIGHT_BRIGADES = new Set<Brigade>(["White", "Silver", "GoodGold", "PaleGreen"]);

export default function FullModeForm({
  card, snapshot, update,
}: { card: ForgeCardFull; snapshot: DesignCard; update: (patch: Partial<DesignCard>) => void }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const types = snapshot.cardType ?? [];
  const app = cardApplicability(types);
  const show = (k: keyof typeof app) => app[k] !== "na";

  const toggle = <T,>(arr: T[] | undefined, v: T): T[] => {
    const a = arr ?? [];
    return a.includes(v) ? a.filter((x) => x !== v) : [...a, v];
  };

  async function onUpload(file: File) {
    setErr(null);
    const fd = new FormData();
    fd.set("file", file);
    const r = await uploadArt(card.id, fd);
    if (!r.ok) setErr(r.error ?? "Upload failed");
    else router.refresh();
  }

  return (
    <div className="space-y-4 text-sm">
      {err && <p className="text-red-500">{err}</p>}

      <label className="block">
        <span className="mb-1 block font-medium">Name</span>
        <input value={snapshot.name ?? ""} onChange={(e) => update({ name: e.target.value })}
          className="w-full rounded-md border bg-background px-3 py-2" />
      </label>

      <fieldset>
        <legend className="mb-1 font-medium">Card type</legend>
        <div className="flex flex-wrap gap-2">
          {CARD_TYPES.map((t) => (
            <button key={t} type="button"
              onClick={() => update({ cardType: toggle<CardType>(snapshot.cardType, t) })}
              className={`rounded-full border px-3 py-1 text-xs ${types.includes(t) ? "bg-emerald-600 text-white" : ""}`}>
              {t}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className="mb-1 block font-medium">Alignment</span>
        <select value={snapshot.alignment ?? ""} onChange={(e) => update({ alignment: (e.target.value || undefined) as any })}
          className="rounded-md border bg-background px-3 py-2">
          <option value="">—</option>
          {ALIGNMENTS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </label>

      {show("brigades") && (
        <fieldset>
          <legend className="mb-1 font-medium">Brigade{app.brigades === "required" ? "" : " (optional)"}</legend>
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
        </fieldset>
      )}

      {isStatBearing(types) && (
        <div className="flex gap-3">
          <label className="block"><span className="mb-1 block font-medium">Strength</span>
            <input type="number" value={snapshot.strength ?? ""} onChange={(e) => update({ strength: e.target.value === "" ? null : Number(e.target.value) })}
              className="w-24 rounded-md border bg-background px-3 py-2" /></label>
          <label className="block"><span className="mb-1 block font-medium">Toughness</span>
            <input type="number" value={snapshot.toughness ?? ""} onChange={(e) => update({ toughness: e.target.value === "" ? null : Number(e.target.value) })}
              className="w-24 rounded-md border bg-background px-3 py-2" /></label>
        </div>
      )}

      {show("specialAbility") && (
        <label className="block"><span className="mb-1 block font-medium">Special ability</span>
          <textarea value={snapshot.specialAbility ?? ""} onChange={(e) => update({ specialAbility: e.target.value })}
            className="h-28 w-full rounded-md border bg-background px-3 py-2" /></label>
      )}

      {show("reference") && (
        <label className="block"><span className="mb-1 block font-medium">Reference</span>
          <input value={snapshot.reference ?? ""} onChange={(e) => update({ reference: e.target.value })}
            placeholder="e.g. 2 Kings 25:8" className="w-full rounded-md border bg-background px-3 py-2" /></label>
      )}

      {show("identifiers") && (
        <label className="block"><span className="mb-1 block font-medium">Identifiers</span>
          <input
            value={(snapshot.identifiers ?? []).join(", ")}
            onChange={(e) => update({ identifiers: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
            placeholder="Comma-separated, e.g. Genesis, Patriarch"
            className="w-full rounded-md border bg-background px-3 py-2" />
          <span className="mt-1 block text-xs text-muted-foreground">Shown as pills on the card (e.g. Lost Soul / Hero identifiers).</span>
        </label>
      )}

      <label className="block"><span className="mb-1 block font-medium">Flavor text</span>
        <textarea value={snapshot.flavorText ?? ""} onChange={(e) => update({ flavorText: e.target.value })}
          className="h-20 w-full rounded-md border bg-background px-3 py-2" /></label>

      <label className="block"><span className="mb-1 block font-medium">Artist</span>
        <input value={snapshot.artistCredit ?? ""} onChange={(e) => update({ artistCredit: e.target.value })}
          placeholder="Illustrator name — shown in the card footer"
          className="w-full rounded-md border bg-background px-3 py-2" /></label>

      <label className="block"><span className="mb-1 block font-medium">Legality</span>
        <select value={snapshot.legality ?? ""} onChange={(e) => update({ legality: (e.target.value || undefined) as any })}
          className="rounded-md border bg-background px-3 py-2">
          <option value="">—</option>
          {LEGALITIES.map((l) => <option key={l} value={l}>{l}</option>)}
        </select></label>

      {/* Art control (reuses 1a.3) */}
      <fieldset className="rounded-md border p-3">
        <legend className="px-1 font-medium">Art</legend>
        <input type="file" accept="image/jpeg,image/png,image/webp"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }}
          className="block w-full text-xs" />
        <label className="mt-3 flex items-start gap-2">
          <input type="checkbox" className="mt-0.5" checked={!!card.isPlaceholder}
            onChange={async () => { await setPlaceholder(card.id, !card.isPlaceholder); router.refresh(); }} />
          <span>
            <span className="font-medium">Temporary / placeholder art</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Mark this art as a stand-in. Placeholder art isn’t shown on the card in playtests — upload final art and uncheck this when it’s ready.
            </span>
          </span>
        </label>
        <div className="mt-2 flex gap-3">
          {card.hasArt && <a href={`/forge/api/art/${card.id}?download=1`} className="text-emerald-600 hover:underline">Download original</a>}
        </div>
      </fieldset>
    </div>
  );
}
