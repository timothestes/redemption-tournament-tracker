"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { deleteForgeDeck } from "@/app/forge/lib/forgeDecks";
import type { ForgeDeckSummary } from "@/app/forge/lib/deckTypes";

export default function DeckList({ decks }: { decks: ForgeDeckSummary[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onDelete = (id: string) => {
    if (!confirm("Delete this deck?")) return;
    startTransition(async () => {
      await deleteForgeDeck(id);
      router.refresh();
    });
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
                <div className="truncate font-medium">{d.name}</div>
                <div className="text-sm text-muted-foreground">{d.format} · {d.cardCount} card{d.cardCount === 1 ? "" : "s"}</div>
              </Link>
              <button onClick={() => onDelete(d.id)} disabled={pending}
                className="ml-4 rounded-md border px-3 py-1 text-sm text-muted-foreground hover:bg-muted/50">
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
