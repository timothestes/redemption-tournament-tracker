"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CARDS } from "@/lib/cards/lookup";
import { getCardImageUrl } from "@/app/shared/utils/cardImageUrl";
import { Input } from "@/components/ui/input";

export interface PickedCard {
  cardKey: string;
  cardName: string;
  setCode: string;
  imgFile: string;
}

const ALL: readonly PickedCard[] = CARDS
  .filter((c) => c.name && !c.imgFile.startsWith("forge:"))
  .map((c) => ({
    cardKey: `${c.name}|${c.set}|${c.imgFile}`,
    cardName: c.name,
    setCode: c.set,
    imgFile: c.imgFile,
  }));

export default function CardPickerInline({
  preferredSets,
  initialQuery,
  onPick,
}: {
  preferredSets: string[];
  initialQuery: string;
  onPick: (card: PickedCard) => void;
}) {
  const [q, setQ] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    const pref = new Set(preferredSets);
    // Candidate sets rank first; falls back to the whole card pool.
    return ALL
      .filter((c) => c.cardName.toLowerCase().includes(needle))
      .sort(
        (a, b) =>
          (pref.has(b.setCode) ? 1 : 0) - (pref.has(a.setCode) ? 1 : 0) ||
          a.cardName.localeCompare(b.cardName),
      )
      .slice(0, 12);
  }, [q, preferredSets]);

  return (
    <div ref={wrapRef} className="relative w-full max-w-sm">
      <Input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search cards…"
        autoComplete="off"
        className="h-8 text-sm"
      />
      {open && results.length > 0 && (
        <div className="absolute mt-1 w-full bg-card rounded-lg shadow-lg max-h-72 overflow-y-auto z-20">
          {results.map((c) => (
            <button
              key={c.cardKey}
              type="button"
              className="flex items-center gap-2 w-full px-2 py-1.5 text-left hover:bg-muted"
              onClick={() => { onPick(c); setOpen(false); }}
            >
              <img src={getCardImageUrl(c.imgFile)} alt="" className="w-7 h-10 rounded-sm object-cover shrink-0" />
              <span className="min-w-0 flex-1 truncate text-sm">{c.cardName}</span>
              <span className="text-xs text-muted-foreground shrink-0">{c.setCode}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
