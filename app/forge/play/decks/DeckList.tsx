"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteForgeDeck, setForgeDeckShared } from "@/app/forge/lib/forgeDecks";
import type { ForgeDeckSummary } from "@/app/forge/lib/deckTypes";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";
import ForgeShareDeckModal from "@/app/forge/components/ForgeShareDeckModal";

export default function DeckList({ decks }: { decks: ForgeDeckSummary[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [toDelete, setToDelete] = useState<ForgeDeckSummary | null>(null);
  const [shareTarget, setShareTarget] = useState<ForgeDeckSummary | null>(null);
  const [shareState, setShareState] = useState(false);

  const confirmDelete = () => {
    if (!toDelete) return;
    const id = toDelete.id;
    startTransition(async () => {
      await deleteForgeDeck(id);
      router.refresh();
    });
  };

  const openShare = (deck: ForgeDeckSummary) => {
    setShareTarget(deck);
    setShareState(deck.isShared);
  };

  const applyShare = async (shared: boolean) => {
    if (!shareTarget) return;
    const res = await setForgeDeckShared(shareTarget.id, shared);
    if (res.ok) {
      setShareState(shared);
      router.refresh();
    }
  };

  return (
    <div className="mt-6">
      <Link href="/forge/play/decks/new" className="inline-block rounded-md border px-4 py-2 text-sm hover:bg-muted/50">
        + New deck
      </Link>
      {decks.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">No decks yet. Start one above.</p>
      ) : (
        <ul className="mt-6 divide-y rounded-lg border">
          {decks.map((d) => (
            <li key={d.id} className="flex items-center justify-between p-4">
              <Link href={`/forge/play/decks/${d.id}`} className="min-w-0 flex-1 hover:underline">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{d.name}</span>
                  {d.isShared && (
                    <span className="flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Shared
                    </span>
                  )}
                </div>
                <div className="text-sm text-muted-foreground">{d.format} · {d.cardCount} card{d.cardCount === 1 ? "" : "s"}</div>
              </Link>
              <div className="ml-4 flex flex-shrink-0 items-center gap-2">
                <button onClick={() => openShare(d)} disabled={pending}
                  className="rounded-md border px-3 py-1 text-sm text-muted-foreground hover:bg-muted/50">
                  Share
                </button>
                <button onClick={() => setToDelete(d)} disabled={pending}
                  className="rounded-md border px-3 py-1 text-sm text-muted-foreground hover:bg-muted/50">
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmationDialog
        open={toDelete !== null}
        onOpenChange={(o) => { if (!o) setToDelete(null); }}
        onConfirm={confirmDelete}
        variant="destructive"
        title="Delete this deck?"
        description={toDelete ? `"${toDelete.name}" will be permanently deleted. This cannot be undone.` : undefined}
        confirmLabel="Delete deck"
      />
      {shareTarget && (
        <ForgeShareDeckModal
          open={shareTarget !== null}
          onOpenChange={(o) => { if (!o) setShareTarget(null); }}
          deckId={shareTarget.id}
          deckName={shareTarget.name}
          isShared={shareState}
          onSetShared={applyShare}
        />
      )}
    </div>
  );
}
