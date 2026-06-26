"use client";

import { useMemo, useState } from "react";
import type { Card } from "@/app/decklist/card-search/utils";
import type { DesignCard } from "@/app/forge/lib/designCard";
import { isForgeDataLine, cardIdFromDataLine } from "@/app/forge/lib/deckAdapter";
import CardImage from "@/app/decklist/card-search/components/CardImage";
import ForgeCardPreview from "@/app/forge/components/ForgeCardPreview";

const RENDER_CAP = 60;

// Forge cards render via ForgeCardPreview (plain <img> + ?v=approved proxy — never
// next/image). Public cards render via CardImage. This keeps Forge art off the image
// optimizer (forge-no-next-image guardrail).
export function MixedThumb({ card, forgeData, forgeArtIds }: { card: Card; forgeData: Map<string, DesignCard>; forgeArtIds: Set<string> }) {
  if (isForgeDataLine(card.dataLine)) {
    const id = cardIdFromDataLine(card.dataLine);
    const data = forgeData.get(id);
    if (!data) return null;
    // Only request the approved-art proxy when the card actually has approved art;
    // otherwise render the composite with no art (matches the reveal grid).
    const artUrl = forgeArtIds.has(id) ? `/forge/api/art/${id}?v=approved` : null;
    return <ForgeCardPreview card={data} artUrl={artUrl} className="w-full rounded-md" />;
  }
  return <CardImage imgFile={card.imgFile} alt={card.name} />;
}

export default function PoolSearch({
  pool, forgeData, forgeArtIds, onAdd,
}: { pool: Card[]; forgeData: Map<string, DesignCard>; forgeArtIds: Set<string>; onAdd: (card: Card) => void }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [source, setSource] = useState<"all" | "forge" | "public">("all");

  const types = useMemo(
    () => Array.from(new Set(pool.map((c) => c.type).filter(Boolean))).sort(),
    [pool],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return pool.filter((c) => {
      const isForge = isForgeDataLine(c.dataLine);
      if (source === "forge" && !isForge) return false;
      if (source === "public" && isForge) return false;
      if (type && c.type !== type) return false;
      if (!needle) return true;
      return (
        c.name.toLowerCase().includes(needle) ||
        c.brigade.toLowerCase().includes(needle) ||
        c.specialAbility.toLowerCase().includes(needle)
      );
    });
  }, [pool, q, type, source]);

  const shown = filtered.slice(0, RENDER_CAP);

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search cards…"
          className="flex-1 rounded-md border px-3 py-2 text-sm" />
        <select value={source} onChange={(e) => setSource(e.target.value as any)} className="rounded-md border px-2 py-2 text-sm">
          <option value="all">All</option>
          <option value="forge">Forge only</option>
          <option value="public">Public only</option>
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-md border px-2 py-2 text-sm">
          <option value="">All types</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {filtered.length} match{filtered.length === 1 ? "" : "es"}{filtered.length > RENDER_CAP ? ` (showing ${RENDER_CAP})` : ""}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {shown.map((c) => (
          <button key={c.dataLine} onClick={() => onAdd(c)} className="block w-full text-left" title={`Add ${c.name}`}>
            <MixedThumb card={c} forgeData={forgeData} forgeArtIds={forgeArtIds} />
            <div className="mt-1 truncate text-xs">{c.name}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
