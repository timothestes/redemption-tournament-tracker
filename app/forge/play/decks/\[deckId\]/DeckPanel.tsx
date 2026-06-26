"use client";

import type { DeckCard, DeckZone } from "@/app/decklist/card-search/types/deck";
import type { DesignCard } from "@/app/forge/lib/designCard";
import type { DeckValidation } from "@/app/decklist/card-search/utils/deckValidation";

const ZONES: { key: DeckZone; label: string }[] = [
  { key: "main", label: "Main deck" },
  { key: "reserve", label: "Reserve" },
  { key: "maybeboard", label: "Maybeboard" },
];

export default function DeckPanel({
  cards, validation, onAdd, onRemove, onZone,
}: {
  cards: DeckCard[];
  forgeData: Map<string, DesignCard>;
  validation: DeckValidation;
  onAdd: (dataLine: string, zone: DeckZone) => void;
  onRemove: (dataLine: string, zone: DeckZone) => void;
  onZone: (dataLine: string, from: DeckZone, to: DeckZone) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border p-3 text-sm">
        <div className="font-medium">{validation.isValid ? "Legal" : "Issues"} · {validation.stats.mainDeckSize} main / {validation.stats.reserveSize} reserve</div>
        {validation.issues.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-muted-foreground">
            {validation.issues.slice(0, 8).map((iss, i) => <li key={i}>{iss.message}</li>)}
          </ul>
        )}
      </div>
      {ZONES.map(({ key, label }) => {
        const zoneCards = cards.filter((c) => c.zone === key);
        const count = zoneCards.reduce((n, c) => n + c.quantity, 0);
        return (
          <div key={key}>
            <h3 className="text-sm font-semibold">{label} ({count})</h3>
            {zoneCards.length === 0 ? (
              <p className="text-xs text-muted-foreground">Empty</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {zoneCards.map((c) => (
                  <li key={c.card.dataLine} className="flex items-center gap-2 text-sm">
                    <span className="w-6 text-right tabular-nums">{c.quantity}×</span>
                    <span className="min-w-0 flex-1 truncate">{c.card.name}</span>
                    <button onClick={() => onRemove(c.card.dataLine, key)} className="rounded border px-1.5">−</button>
                    <button onClick={() => onAdd(c.card.dataLine, key)} className="rounded border px-1.5">+</button>
                    {ZONES.filter((z) => z.key !== key).map((z) => (
                      <button key={z.key} onClick={() => onZone(c.card.dataLine, key, z.key)}
                        className="rounded border px-1.5 text-xs text-muted-foreground" title={`Move to ${z.label}`}>
                        {z.label[0]}
                      </button>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
