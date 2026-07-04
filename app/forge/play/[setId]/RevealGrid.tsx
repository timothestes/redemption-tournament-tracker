"use client";

import { useState } from "react";
import type { DesignCard } from "@/app/forge/lib/designCard";
import { cardRawText } from "@/app/forge/lib/designCard";
import ForgeCardFace from "@/app/forge/components/ForgeCardFace";

export type RevealItem = { cardId: string; data: DesignCard; artUrl: string | null; finishedUrl: string | null };

export default function RevealGrid({ items }: { items: RevealItem[] }) {
  const [active, setActive] = useState<RevealItem | null>(null);

  if (items.length === 0) {
    return <p className="mt-8 text-sm text-muted-foreground">No cards shared for playtesting yet.</p>;
  }

  return (
    <>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {items.map((it) => (
          <button key={it.cardId} onClick={() => setActive(it)} className="block w-full text-left">
            <ForgeCardFace name={it.data.name ?? null} rawText={cardRawText(it.data)} finishedUrl={it.finishedUrl} artUrl={it.artUrl} className="w-full rounded-md" />
          </button>
        ))}
      </div>
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
