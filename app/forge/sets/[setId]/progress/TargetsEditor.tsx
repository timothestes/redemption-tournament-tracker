"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveSetTargets } from "@/app/forge/lib/sets";
import type { TargetCounts } from "@/app/forge/lib/progress";
import { CARD_TYPES } from "@/app/forge/lib/designCard";

export default function TargetsEditor({ setId, initial }: { setId: string; initial: TargetCounts }) {
  const router = useRouter();
  const [total, setTotal] = useState<number>(initial.total ?? 0);
  const [cells, setCells] = useState<Record<string, Record<string, number>>>(initial.cells ?? {});
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const setCell = (type: string, brigade: string, value: number) =>
    setCells((c) => ({ ...c, [type]: { ...(c[type] ?? {}), [brigade]: value } }));

  async function save() {
    setBusy(true);
    // prune zero/NaN cells before persisting
    const pruned: Record<string, Record<string, number>> = {};
    for (const [t, row] of Object.entries(cells)) {
      for (const [b, v] of Object.entries(row)) {
        if (v > 0) (pruned[t] ??= {})[b] = v;
      }
    }
    const r = await saveSetTargets(setId, { total: total || undefined, cells: pruned });
    setBusy(false);
    if (r.ok) { setOpen(false); router.refresh(); } else alert(r.error);
  }

  if (!open) {
    return <button onClick={() => setOpen(true)} className="rounded-md border px-3 py-1 text-sm">Edit targets</button>;
  }
  return (
    <div className="rounded-md border p-3 text-sm">
      <label className="mb-2 flex items-center gap-2">
        Total target
        <input type="number" min={0} value={total} onChange={(e) => setTotal(Number(e.target.value))} className="w-24 rounded-md border bg-background px-2 py-1" />
      </label>
      <p className="mb-1 text-xs text-muted-foreground">Per-type, per-brigade targets (use the "none" column for brigade-less types):</p>
      <div className="max-h-72 overflow-auto">
        {CARD_TYPES.map((t) => (
          <details key={t} className="border-b py-1">
            <summary className="cursor-pointer">{t}</summary>
            <div className="flex flex-wrap gap-2 py-2">
              {["none", "Blue", "Clay", "GoodGold", "Green", "Purple", "Silver", "White", "Black", "Brown", "Crimson", "Gray", "Orange", "PaleGreen"].map((b) => (
                <label key={b} className="flex items-center gap-1 text-xs">
                  {b}
                  <input type="number" min={0} value={cells[t]?.[b] ?? 0} onChange={(e) => setCell(t, b, Number(e.target.value))} className="w-14 rounded border bg-background px-1 py-0.5" />
                </label>
              ))}
            </div>
          </details>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <button disabled={busy} onClick={save} className="rounded-md bg-emerald-600 px-3 py-1 font-medium text-white disabled:opacity-50">Save targets</button>
        <button onClick={() => setOpen(false)} className="rounded-md border px-3 py-1">Cancel</button>
      </div>
    </div>
  );
}
