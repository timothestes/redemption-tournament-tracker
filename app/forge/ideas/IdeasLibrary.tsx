"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createCard, type ForgeCardFull } from "@/app/forge/lib/cards";
import ForgeCardGrid from "@/app/forge/components/ForgeCardGrid";
import { CARD_TYPES, BRIGADES, type CardType, type Brigade } from "@/app/forge/lib/designCard";

export default function IdeasLibrary({ cards, canCreate }: { cards: ForgeCardFull[]; canCreate: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [type, setType] = useState<CardType | "">("");
  const [brigade, setBrigade] = useState<Brigade | "">("");
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => cards.filter((c) => {
    const s = c.snapshot ?? {};
    if (q && !(c.title ?? "").toLowerCase().includes(q.toLowerCase())) return false;
    if (type && !(s.cardType ?? []).includes(type)) return false;
    if (brigade && !(s.brigades ?? []).includes(brigade)) return false;
    return true;
  }), [cards, q, type, brigade]);

  async function onNew() {
    setCreating(true);
    const r = await createCard("");
    setCreating(false);
    if (r.ok) router.push(`/forge/cards/${r.id}`);
  }

  return (
    <div className="mx-auto max-w-6xl p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold">Ideas</h1>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
          className="rounded-md border bg-background px-3 py-1.5 text-sm" />
        <select value={type} onChange={(e) => setType(e.target.value as CardType | "")} className="rounded-md border bg-background px-2 py-1.5 text-sm">
          <option value="">All types</option>
          {CARD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={brigade} onChange={(e) => setBrigade(e.target.value as Brigade | "")} className="rounded-md border bg-background px-2 py-1.5 text-sm">
          <option value="">All brigades</option>
          {BRIGADES.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        {canCreate && (
          <button onClick={onNew} disabled={creating} className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            New card
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="mx-auto mt-16 max-w-xs text-center">
          <div className="mx-auto mb-4 aspect-[750/1050] w-40 rounded-lg border-2 border-dashed" />
          <p className="mb-3 text-sm text-muted-foreground">No ideas yet. Start with a name and a thought.</p>
          {canCreate && <button onClick={onNew} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white">Jot an idea</button>}
        </div>
      ) : (
        <ForgeCardGrid cards={filtered} />
      )}
    </div>
  );
}
