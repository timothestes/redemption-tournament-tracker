"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ForgeCardPreview from "@/app/forge/components/ForgeCardPreview";
import { saveCard, type ForgeCardFull } from "@/app/forge/lib/cards";
import type { DesignCard } from "@/app/forge/lib/designCard";
import FullModeForm from "./FullModeForm";

export default function StudioEditor({ card }: { card: ForgeCardFull }) {
  const [snapshot, setSnapshot] = useState<DesignCard>(card.snapshot ?? {});
  const [fullMode, setFullMode] = useState<boolean>(!!card.snapshot?.cardType?.length);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced autosave — always persists whatever is typed (never blocks).
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSaved("saving");
      const r = await saveCard(card.id, snapshot);
      setSaved(r.ok ? "saved" : "error");
    }, 700);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [snapshot, card.id]);

  const update = (patch: Partial<DesignCard>) => setSnapshot((s) => ({ ...s, ...patch }));

  return (
    <div className="mx-auto max-w-5xl p-4">
      <div className="mb-3 flex items-center justify-between text-sm">
        <Link href="/forge/ideas" className="text-muted-foreground hover:underline">← Ideas</Link>
        <div className="flex items-center gap-3">
          <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">Private idea</span>
          <span className="text-xs text-muted-foreground">
            {saved === "saving" ? "Saving…" : saved === "saved" ? "Saved" : saved === "error" ? "Save failed" : ""}
          </span>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,360px)_1fr]">
        {/* Preview (hero) — sticky on desktop, top on mobile */}
        <div className="md:sticky md:top-4 md:self-start">
          <ForgeCardPreview card={snapshot} artUrl={card.hasArt ? `/forge/api/art/${card.id}` : null} />
        </div>

        {/* Form */}
        <div className="space-y-4">
          {!fullMode ? (
            <div className="space-y-2">
              <input
                autoFocus
                value={snapshot.name ?? ""}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="Name your card… (just start typing)"
                className="w-full rounded-md border bg-background px-3 py-2 text-lg"
              />
              <textarea
                value={snapshot.specialAbility ?? ""}
                onChange={(e) => update({ specialAbility: e.target.value })}
                placeholder="Jot the idea — ability, theme, anything. No fields required."
                className="h-40 w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
              <button onClick={() => setFullMode(true)} className="text-sm text-emerald-600 hover:underline">
                Add card details →
              </button>
            </div>
          ) : (
            <FullModeForm card={card} snapshot={snapshot} update={update} />
          )}
        </div>
      </div>
    </div>
  );
}
