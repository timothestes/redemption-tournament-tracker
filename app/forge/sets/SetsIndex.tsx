"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSet, saveSetTargets, type ForgeSetSummary } from "@/app/forge/lib/sets";
import { defaultTargets } from "@/app/forge/lib/progress";
import { CARD_TYPES } from "@/app/forge/lib/designCard";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";

const inputClass = "rounded-md border border-input bg-background px-2 py-1 text-sm";

export default function SetsIndex({ sets, canCreate }: { sets: ForgeSetSummary[]; canCreate: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number>(100);
  // Per-type counts shown in the preview. Recomputed from `total` only when the
  // total changes (via the seed key), so manual per-type nudges aren't clobbered.
  const [perType, setPerType] = useState<Record<string, number>>(() => seedPerType(100));

  function seedTotal(next: number) {
    setTotal(next);
    setPerType(seedPerType(next));
  }

  const grandTotal = useMemo(
    () => CARD_TYPES.reduce((sum, t) => sum + (perType[t] ?? 0), 0),
    [perType],
  );

  function openCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    seedTotal(100);
    setOpen(true);
  }

  async function confirmCreate() {
    setBusy(true);
    setError(null);
    const r = await createSet(name.trim());
    if (r.ok === false) {
      setBusy(false);
      setError(r.error);
      return;
    }
    // Build the seed from the (possibly tweaked) per-type preview, brigade-agnostic.
    const cells: Record<string, Record<string, number>> = {};
    for (const t of CARD_TYPES) {
      if ((perType[t] ?? 0) > 0) cells[t] = { none: perType[t] };
    }
    const seed = await saveSetTargets(r.id, { total: total || undefined, cells });
    setBusy(false);
    if (!seed.ok) {
      // Set exists; don't strand the user — send them in, but tell them targets failed.
      setError("Set created but targets failed to save — set them from the Progress tab.");
      router.push(`/forge/sets/${r.id}/progress`);
      return;
    }
    router.push(`/forge/sets/${r.id}/cards`);
  }

  return (
    <div className="mx-auto max-w-3xl p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Sets</h1>
        {canCreate && (
          <form onSubmit={openCreate} className="flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New set name…" className="rounded-md border bg-background px-3 py-1.5 text-sm" />
            <Button type="submit" variant="success" size="sm">Create</Button>
          </form>
        )}
      </div>
      {sets.length === 0 ? (
        <div className="mx-auto mt-16 max-w-xs text-center">
          <div className="mx-auto mb-4 aspect-[750/1050] w-40 rounded-lg border-2 border-dashed" />
          <p className="text-sm text-muted-foreground">No sets yet. Create one to gather cards toward print.</p>
        </div>
      ) : (
        <ul className="divide-y rounded-md border">
          {sets.map((s) => (
            <li key={s.id}>
              <Link href={`/forge/sets/${s.id}/cards`} className="flex items-center justify-between p-3 hover:bg-muted/50">
                <span className="font-medium">{s.name}</span>
                <span className="text-sm text-muted-foreground">
                  {s.total}{s.targetTotal ? ` / ${s.targetTotal}` : ""} cards
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>New set: {name.trim()}</DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Seed starting targets — you can refine them anytime from the Progress tab.
            </p>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <label className="flex items-center gap-2 text-sm">
              <span className="font-medium">How many cards total?</span>
              <input
                type="number"
                min={0}
                value={total}
                onChange={(e) => seedTotal(Number(e.target.value))}
                aria-label="Total cards"
                className={`${inputClass} w-24`}
              />
            </label>

            <div>
              <p className="mb-2 text-xs text-muted-foreground">
                Suggested per-type targets ({grandTotal} total) — nudge any value:
              </p>
              <ul className="divide-y divide-border">
                {CARD_TYPES.map((t) => (
                  <li key={t} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="text-sm">{t}</span>
                    <input
                      type="number"
                      min={0}
                      value={perType[t] ?? 0}
                      onChange={(e) => setPerType((p) => ({ ...p, [t]: Number(e.target.value) }))}
                      aria-label={`${t} target`}
                      className={`${inputClass} w-20`}
                    />
                  </li>
                ))}
              </ul>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </DialogBody>

          <DialogFooter className="justify-end">
            <Button variant="cancel" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="success" disabled={busy} onClick={confirmCreate}>
              {busy ? "Creating…" : "Create set"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Per-type counts for a given grand total, derived from the centralized default
// distribution in progress.ts.
function seedPerType(total: number): Record<string, number> {
  const seed: Record<string, number> = {};
  const cells = defaultTargets(total).cells ?? {};
  for (const t of CARD_TYPES) seed[t] = cells[t]?.none ?? 0;
  return seed;
}
