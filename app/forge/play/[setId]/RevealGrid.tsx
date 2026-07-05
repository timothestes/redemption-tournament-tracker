"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import type { DesignCard, CardType, Brigade } from "@/app/forge/lib/designCard";
import { cardRawText, CARD_TYPES, BRIGADES } from "@/app/forge/lib/designCard";
import ForgeCardFace from "@/app/forge/components/ForgeCardFace";

export type RevealItem = { cardId: string; data: DesignCard; artUrl: string | null; finishedUrl: string | null };

const selectClass = "rounded-md border bg-background px-2 py-1.5 text-sm";

export default function RevealGrid({ items }: { items: RevealItem[] }) {
  const [active, setActive] = useState<RevealItem | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [type, setType] = useState<CardType | "">("");
  const [brigade, setBrigade] = useState<Brigade | "">("");

  // Press "/" (when not already typing in a field) to reset the search and jump to it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      e.preventDefault();
      setQ("");
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Default order: by card type, then brigade, then name. Type and brigade use
  // the canonical model order (CARD_TYPES / BRIGADES); cards missing a primary
  // type or brigade sort last within their group.
  const sorted = useMemo(() => {
    const rank = (value: string | undefined, order: readonly string[]) => {
      const i = value ? order.indexOf(value) : -1;
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    const typeRank = (it: RevealItem) => rank(it.data.cardType?.[0], CARD_TYPES);
    const brigadeRank = (it: RevealItem) => rank(it.data.brigades?.[0], BRIGADES);
    return [...items].sort(
      (a, b) =>
        typeRank(a) - typeRank(b) ||
        brigadeRank(a) - brigadeRank(b) ||
        (a.data.name ?? "").localeCompare(b.data.name ?? ""),
    );
  }, [items]);

  const filtered = useMemo(() => sorted.filter((it) => {
    const d = it.data;
    if (q) {
      const needle = q.toLowerCase();
      const hay = `${d.name ?? ""}\n${cardRawText(d)}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (type && !(d.cardType ?? []).includes(type)) return false;
    if (brigade && !(d.brigades ?? []).includes(brigade)) return false;
    return true;
  }), [sorted, q, type, brigade]);

  if (items.length === 0) {
    return <p className="mt-8 text-sm text-muted-foreground">No cards shared for playtesting yet.</p>;
  }

  return (
    <>
      <div className="mb-4 mt-6 flex flex-wrap items-center gap-2">
        <div className="relative">
          <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or text… (press /)"
            className="rounded-md border bg-background px-3 py-1.5 pr-8 text-sm" />
          {q && (
            <button type="button" aria-label="Clear search"
              onClick={() => { setQ(""); searchRef.current?.focus(); }}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <select value={type} onChange={(e) => setType(e.target.value as CardType | "")} className={selectClass} aria-label="Filter by type">
          <option value="">All types</option>
          {CARD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={brigade} onChange={(e) => setBrigade(e.target.value as Brigade | "")} className={selectClass} aria-label="Filter by brigade">
          <option value="">All brigades</option>
          {BRIGADES.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">{filtered.length} of {items.length}</span>
      </div>

      {filtered.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">No cards match your filters.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {filtered.map((it) => (
            <button key={it.cardId} onClick={() => setActive(it)} className="block w-full text-left">
              <ForgeCardFace name={it.data.name ?? null} rawText={cardRawText(it.data)} finishedUrl={it.finishedUrl} artUrl={it.artUrl} className="w-full rounded-md" />
            </button>
          ))}
        </div>
      )}
      {active && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setActive(null)}>
          <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <ForgeCardFace name={active.data.name ?? null} rawText={cardRawText(active.data)} finishedUrl={active.finishedUrl} artUrl={active.artUrl} className="w-full" />
          </div>
        </div>
      )}
    </>
  );
}
