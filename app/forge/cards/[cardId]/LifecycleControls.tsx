"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { shareToSet, sendToPrivate, publish, approve, unapprove, archive, unarchive, deleteCard } from "@/app/forge/lib/lifecycle";
import { STATUS_PATH, STATUS_LABEL, ACTION_LABEL, releaseLabel, CONFIRM_COPY } from "@/app/forge/lib/lifecycleCopy";
import type { ForgeSetSummary } from "@/app/forge/lib/sets";
import type { ForgeCardFull } from "@/app/forge/lib/cards";
import { Button } from "@/components/ui/button";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";

export default function LifecycleControls({ card, sets }: { card: ForgeCardFull; sets: ForgeSetSummary[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picking, setPicking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReturn, setConfirmReturn] = useState(false);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok === false) alert(r.error ?? "Action failed");
      router.refresh();
    });

  // Delete navigates away (the card no longer exists) — refreshing in place would 404.
  const onDelete = () =>
    start(async () => {
      const r = await deleteCard(card.id);
      if (r.ok === false) { alert(r.error ?? "Could not delete card"); return; }
      router.push(card.setId ? `/forge/sets/${card.setId}/cards` : "/forge/ideas");
    });

  const inSet = card.setId !== null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {inSet ? (
        <>
          <ol className="flex items-center gap-1 text-muted-foreground">
            {STATUS_PATH.map((s) => (
              <li key={s} className={card.status === s ? "font-semibold text-foreground" : ""}>
                {STATUS_LABEL[s]}
                {s !== "approved" ? " ›" : ""}
              </li>
            ))}
            {card.status === "archived" && <li className="font-semibold text-foreground">· {STATUS_LABEL.archived}</li>}
          </ol>
          <div className="ml-auto flex flex-wrap gap-2">
            {(card.status === "draft" || card.status === "playtesting") && (
              <Button size="sm" className="h-7 px-3 text-xs" disabled={pending} onClick={() => run(() => publish(card.id))}>
                {releaseLabel(card.status)}
              </Button>
            )}
            {card.status === "playtesting" && (
              <Button size="sm" variant="outline" className="h-7 px-3 text-xs" disabled={pending} onClick={() => run(() => approve(card.id))}>
                {ACTION_LABEL.markFinal}
              </Button>
            )}
            {card.status === "approved" && (
              <Button size="sm" variant="outline" className="h-7 px-3 text-xs" disabled={pending} onClick={() => run(() => unapprove(card.id))}>
                {ACTION_LABEL.reopen}
              </Button>
            )}
            {card.status === "archived" ? (
              <Button size="sm" variant="outline" className="h-7 px-3 text-xs" disabled={pending} onClick={() => run(() => unarchive(card.id))}>
                {ACTION_LABEL.restore}
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="h-7 px-3 text-xs" disabled={pending} onClick={() => run(() => archive(card.id))}>
                {ACTION_LABEL.shelve}
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7 px-3 text-xs" disabled={pending} onClick={() => setConfirmReturn(true)}>
              {ACTION_LABEL.returnToIdeas}
            </Button>
            <Button size="sm" variant="outline" className="h-7 border-destructive/40 px-3 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={pending} onClick={() => setConfirmDelete(true)}>
              {ACTION_LABEL.delete}
            </Button>
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
            <Button size="sm" variant="outline" className="h-7 px-3 text-xs" onClick={() => setPicking(true)}>Share to a set</Button>
          )}
        </div>
      )}
      <ConfirmationDialog
        open={confirmReturn}
        onOpenChange={setConfirmReturn}
        onConfirm={() => run(() => sendToPrivate(card.id))}
        variant="warning"
        title={CONFIRM_COPY.returnToIdeas.title}
        description={CONFIRM_COPY.returnToIdeas.description}
        confirmLabel={CONFIRM_COPY.returnToIdeas.confirmLabel}
      />
      <ConfirmationDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        onConfirm={onDelete}
        variant="destructive"
        title="Delete this card?"
        description={CONFIRM_COPY.delete.description}
        confirmLabel="Delete card"
      />
    </div>
  );
}
