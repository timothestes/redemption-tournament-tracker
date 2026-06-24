"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { shareToSet, sendToPrivate, publish, approve, unapprove, archive, unarchive, deleteCard } from "@/app/forge/lib/lifecycle";
import type { ForgeSetSummary } from "@/app/forge/lib/sets";
import type { ForgeCardFull } from "@/app/forge/lib/cards";

const STEPS = ["draft", "playtesting", "approved"] as const;

export default function LifecycleControls({ card, sets }: { card: ForgeCardFull; sets: ForgeSetSummary[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picking, setPicking] = useState(false);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) alert(r.error ?? "Action failed");
      router.refresh();
    });

  const inSet = card.setId !== null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {inSet ? (
        <>
          <ol className="flex items-center gap-1 text-muted-foreground">
            {STEPS.map((s) => (
              <li key={s} className={card.status === s ? "font-semibold text-foreground" : ""}>
                {s === "playtesting" ? "Playtesting" : s[0].toUpperCase() + s.slice(1)}
                {s !== "approved" ? " ›" : ""}
              </li>
            ))}
          </ol>
          <div className="ml-auto flex flex-wrap gap-2">
            {(card.status === "draft" || card.status === "playtesting") && (
              <button disabled={pending} onClick={() => run(() => publish(card.id))} className="rounded-md bg-emerald-600 px-3 py-1 font-medium text-white disabled:opacity-50">Publish</button>
            )}
            {card.status === "playtesting" && (
              <button disabled={pending} onClick={() => run(() => approve(card.id))} className="rounded-md border px-3 py-1">Approve</button>
            )}
            {card.status === "approved" && (
              <button disabled={pending} onClick={() => run(() => unapprove(card.id))} className="rounded-md border px-3 py-1">Unapprove</button>
            )}
            {card.status === "archived" ? (
              <button disabled={pending} onClick={() => run(() => unarchive(card.id))} className="rounded-md border px-3 py-1">Unarchive</button>
            ) : (
              <button disabled={pending} onClick={() => run(() => archive(card.id))} className="rounded-md border px-3 py-1">Archive</button>
            )}
            <button disabled={pending} onClick={() => confirm("Send this card back to your private sketchbook? Its published versions will be retired.") && run(() => sendToPrivate(card.id))} className="rounded-md border px-3 py-1">Send back to private</button>
            <button disabled={pending} onClick={() => confirm("Delete this card and all its versions? This cannot be undone.") && run(() => deleteCard(card.id))} className="rounded-md border border-red-300 px-3 py-1 text-red-600">Delete</button>
          </div>
        </>
      ) : (
        <div className="ml-auto">
          {picking ? (
            <select autoFocus disabled={pending} defaultValue="" onChange={(e) => e.target.value && run(() => shareToSet(card.id, e.target.value))} className="rounded-md border bg-background px-2 py-1">
              <option value="" disabled>Share into set…</option>
              {sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          ) : (
            <button onClick={() => setPicking(true)} className="rounded-md border px-3 py-1">Share to a set</button>
          )}
        </div>
      )}
    </div>
  );
}
