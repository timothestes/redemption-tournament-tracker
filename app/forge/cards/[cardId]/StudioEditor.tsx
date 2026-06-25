"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ForgeCardPreview from "@/app/forge/components/ForgeCardPreview";
import { saveCard, type ForgeCardFull } from "@/app/forge/lib/cards";
import { createProposal } from "@/app/forge/lib/proposals";
import type { DesignCard } from "@/app/forge/lib/designCard";
import FullModeForm from "./FullModeForm";
import LifecycleControls from "./LifecycleControls";
import type { ForgeSetSummary } from "@/app/forge/lib/sets";

export default function StudioEditor({ card, sets }: { card: ForgeCardFull; sets: ForgeSetSummary[] }) {
  const [snapshot, setSnapshot] = useState<DesignCard>(card.snapshot ?? {});
  const [fullMode, setFullMode] = useState<boolean>(!!card.snapshot?.cardType?.length);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRender = useRef(true);

  // Debounced autosave — fires only after the user edits (skips mount).
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSaved("saving");
      const r = await saveCard(card.id, snapshot);
      setSaved(r.ok ? "saved" : "error");
    }, 700);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [snapshot, card.id]);

  const update = (patch: Partial<DesignCard>) => setSnapshot((s) => ({ ...s, ...patch }));

  const router = useRouter();
  const [proposing, setProposing] = useState(false);
  const [proposeSummary, setProposeSummary] = useState("");
  const [proposeBusy, setProposeBusy] = useState(false);

  const submitProposal = async () => {
    if (!proposeSummary.trim()) return;
    setProposeBusy(true);
    const r = await createProposal(card.id, snapshot, proposeSummary);
    setProposeBusy(false);
    if (r.ok === false) {
      alert(r.error);
      return;
    }
    setProposing(false);
    setProposeSummary("");
    router.refresh();
  };

  return (
    <div className="mx-auto max-w-5xl p-4">
      <div className="mb-3 flex flex-col gap-2 text-sm">
        <div className="flex items-center justify-between">
          <Link href={card.setId ? `/forge/sets/${card.setId}/cards` : "/forge/ideas"} className="text-muted-foreground hover:underline">
            ← {card.setId ? "Set" : "Ideas"}
          </Link>
          <span className="text-xs text-muted-foreground">
            {saved === "saving" ? "Saving…" : saved === "saved" ? "Saved" : saved === "error" ? "Save failed" : ""}
          </span>
        </div>
        <LifecycleControls card={card} sets={sets} />
        {card.setId &&
          (proposing ? (
            <div className="flex items-center gap-1 text-xs">
              <input
                autoFocus
                value={proposeSummary}
                onChange={(e) => setProposeSummary(e.target.value)}
                placeholder="Summarize your proposed change…"
                className="flex-1 rounded-md border bg-background px-2 py-1"
              />
              <button
                disabled={proposeBusy || !proposeSummary.trim()}
                onClick={submitProposal}
                className="rounded-md bg-emerald-600 px-3 py-1 font-medium text-white disabled:opacity-50"
              >
                Submit proposal
              </button>
              <button onClick={() => setProposing(false)} className="rounded-md border px-2 py-1">
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setProposing(true)}
              className="self-start rounded-md border px-3 py-1 text-xs"
            >
              Propose changes for review
            </button>
          ))}
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
