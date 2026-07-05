"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteForgeDeck } from "@/app/forge/lib/forgeDecks";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";

export default function DeleteDeckButton({ deckId, deckName }: { deckId: string; deckName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const confirm = () => {
    startTransition(async () => {
      const res = await deleteForgeDeck(deckId);
      if (res.ok) {
        router.push("/forge/play/decks");
      } else {
        setError(res.error ?? "Could not delete deck");
        setOpen(false);
      }
    });
  };

  return (
    <div className="flex shrink-0 items-center gap-2">
      {error && <span className="text-xs text-destructive">{error}</span>}
      <button
        type="button"
        onClick={() => { setError(null); setOpen(true); }}
        disabled={pending}
        className="rounded-md border border-destructive/40 px-3 py-1 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
      >
        {pending ? "Deleting…" : "Delete deck"}
      </button>
      <ConfirmationDialog
        open={open}
        onOpenChange={(o) => { if (!o) setOpen(false); }}
        onConfirm={confirm}
        variant="destructive"
        title="Delete this deck?"
        description={`"${deckName}" will be permanently deleted. This cannot be undone.`}
        confirmLabel="Delete deck"
      />
    </div>
  );
}
