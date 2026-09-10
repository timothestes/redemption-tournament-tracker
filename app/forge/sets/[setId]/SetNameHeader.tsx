"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { renameSet } from "@/app/forge/lib/sets";

// Inline rename control for the set header. Rendered as plain siblings (no
// wrapping element) so it drops into the layout's existing flex row without
// changing the resting-state markup around the <h1>.
export default function SetNameHeader({
  setId, name, canRename,
}: {
  setId: string;
  name: string;
  canRename: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setValue(name);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  async function save() {
    const trimmed = value.trim();
    if (!trimmed) { setError("Name is required"); return; }
    if (trimmed === name) { setEditing(false); return; }
    setBusy(true);
    setError(null);
    const r = await renameSet(setId, trimmed);
    setBusy(false);
    if (r.ok === false) { setError(r.error); return; }
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <>
        <h1 className="text-lg font-semibold">{name}</h1>
        {canRename && (
          <button
            type="button"
            onClick={startEdit}
            aria-label="Rename set"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Pencil size={14} aria-hidden />
          </button>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <Input
          autoFocus
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); save(); }
            if (e.key === "Escape") { e.preventDefault(); cancel(); }
          }}
          className="h-8 w-48 py-1 text-base font-semibold sm:w-64"
        />
        <button
          type="button"
          onClick={save}
          disabled={busy}
          aria-label="Save"
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <Check size={16} aria-hidden />
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          aria-label="Cancel"
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
