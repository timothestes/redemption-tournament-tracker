"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2 } from "lucide-react";
import { createCardInSet } from "@/app/forge/lib/cards";

// Dashed-outline "card" that creates a blank card directly in the set and opens
// the editor — the set-scoped sibling of the Ideas "New card" button.
export default function AddCardTile({ setId }: { setId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCreate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await createCardInSet(setId, "");
    if (r.ok === false) {
      setBusy(false);
      setError(r.error);
      return;
    }
    // Keep busy through navigation so the spinner shows until the editor loads.
    router.push(`/forge/cards/${r.id}`);
  }

  return (
    <div>
      <button
        type="button"
        onClick={onCreate}
        disabled={busy}
        aria-label="New card in this set"
        className="flex aspect-[750/1050] w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-input text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-8 w-8 animate-spin" /> : <Plus className="h-8 w-8" />}
      </button>
      <p className="mt-1 truncate text-xs text-muted-foreground">
        {busy ? "Creating…" : "New card"}
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
