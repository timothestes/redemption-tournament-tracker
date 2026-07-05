"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2 } from "lucide-react";
import { createCardInSet } from "@/app/forge/lib/cards";

// Dashed-outline "card" that creates a blank card directly in the set and opens
// the editor — the set-scoped sibling of the Ideas "New card" button.
// `disabled` keeps the tile mounted but inert (e.g. during bulk selection) so the
// grid doesn't reflow when the create affordance is temporarily unavailable.
export default function AddCardTile({ setId, disabled = false }: { setId: string; disabled?: boolean }) {
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
        disabled={busy || disabled}
        aria-label="New card in this set"
        className={`flex aspect-[750/1050] w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-input text-muted-foreground transition-colors disabled:opacity-60 ${
          disabled ? "cursor-default" : "hover:border-primary hover:text-primary"
        }`}
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
