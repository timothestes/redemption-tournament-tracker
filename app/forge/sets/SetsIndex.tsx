"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createSet, saveSetTargets, bulkDeleteSets, type ForgeSetSummary } from "@/app/forge/lib/sets";
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
import ConfirmationDialog from "@/components/ui/confirmation-dialog";

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

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [summary, setSummary] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportSel, setExportSel] = useState<ReadonlySet<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const toggleExport = (id: string) =>
    setExportSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  function openExport() {
    setExportSel(new Set());
    setExportError(null);
    setExportOpen(true);
  }

  async function runExport() {
    if (exportSel.size === 0 || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch(`/forge/api/export?ids=${[...exportSel].join(",")}`);
      if (!res.ok) {
        setExportError(res.status === 404 ? "Nothing to export in the selected sets." : "Export failed.");
        return;
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1]
        ?? "forge-export.zip";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportOpen(false);
    } catch {
      setExportError("Export failed.");
    } finally {
      setExporting(false);
    }
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const selectedSets = sets.filter((s) => selected.has(s.id));

  async function onBulkDelete() {
    setBusy(true); setSummary(null);
    const r = await bulkDeleteSets([...selected]);
    setBusy(false);
    if (r.ok === false) { setSummary(r.error); return; }
    setSummary(`Deleted ${r.done} · ${r.failed} failed`);
    setSelected(new Set());
    router.refresh();
  }

  function seedTotal(next: number) {
    setTotal(next);
    setPerType(seedPerType(next));
  }

  const grandTotal = useMemo(
    () => CARD_TYPES.reduce((sum, t) => sum + (perType[t] ?? 0), 0),
    [perType],
  );

  function openCreate() {
    setName("");
    setError(null);
    seedTotal(100);
    setOpen(true);
  }

  async function confirmCreate() {
    if (!name.trim()) return;
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
    if (!seed.ok) {
      // Set exists; don't strand the user — send them in, but tell them targets failed.
      setBusy(false);
      setError("Set created but targets failed to save — set them from the Progress tab.");
      router.push(`/forge/sets/${r.id}/progress`);
      return;
    }
    // Keep `busy` true through navigation so the spinner shows until the next page loads.
    router.push(`/forge/sets/${r.id}/cards`);
  }

  return (
    <div className="mx-auto max-w-3xl p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Sets</h1>
        {canCreate && (
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/forge/import" className="rounded-md border px-3 py-1 text-sm hover:bg-muted">
              Import a set
            </Link>
            {sets.length > 0 && (
              <button
                type="button"
                onClick={openExport}
                className="rounded-md border px-3 py-1 text-sm hover:bg-muted"
              >
                Export a set
              </button>
            )}
            <Button type="button" variant="success" size="sm" onClick={openCreate}>Create</Button>
            <Button
              size="sm"
              variant={selecting ? "secondary" : "outline"}
              onClick={() => { setSelecting(!selecting); setSelected(new Set()); setSummary(null); }}
            >
              {selecting ? "Done selecting" : "Select"}
            </Button>
          </div>
        )}
      </div>
      {selecting && (
        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{selected.size} selected</span>
          <span aria-live="polite" className="text-foreground">{summary}</span>
        </div>
      )}
      {sets.length === 0 ? (
        <div className="mx-auto mt-16 max-w-xs text-center">
          <div className="mx-auto mb-4 aspect-[750/1050] w-40 rounded-lg border-2 border-dashed" />
          <p className="text-sm text-muted-foreground">No sets yet. Create one to gather cards toward print.</p>
        </div>
      ) : (
        <ul className="divide-y rounded-md border [.jayden_&]:bg-card/80 [.jayden_&]:backdrop-blur-sm [.jayden_&]:border-primary/20">
          {sets.map((s) => (
            <li key={s.id} className="flex items-center gap-2 p-1">
              {selecting && (
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  onChange={() => toggle(s.id)}
                  aria-label={`Select ${s.name}`}
                  className="ml-2 h-4 w-4 rounded border-input"
                />
              )}
              {selecting ? (
                <button
                  type="button"
                  onClick={() => toggle(s.id)}
                  className="flex flex-1 items-center justify-between p-2 text-left hover:bg-muted/50"
                >
                  <span className="font-medium">{s.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {s.total}{s.targetTotal ? ` / ${s.targetTotal}` : ""} cards
                  </span>
                </button>
              ) : (
                <Link href={`/forge/sets/${s.id}/cards`} className="flex flex-1 items-center justify-between p-2 hover:bg-muted/50">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {s.total}{s.targetTotal ? ` / ${s.targetTotal}` : ""} cards
                  </span>
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}

      {selecting && selected.size > 0 && (
        <div className="mt-3">
          <Button
            size="sm"
            variant="outline"
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={busy}
            onClick={() => setConfirmOpen(true)}
          >
            Delete {selected.size} {selected.size === 1 ? "set" : "sets"}
          </Button>
        </div>
      )}

      <ConfirmationDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={onBulkDelete}
        variant="destructive"
        title={`Delete ${selected.size} set(s)?`}
        description="This permanently deletes the sets AND every card in them, including released versions, comments, and proposals. This cannot be undone."
        confirmLabel="Delete sets"
      >
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {selectedSets.map((s) => (
            <li key={s.id}>{s.name} ({s.total} cards)</li>
          ))}
        </ul>
      </ConfirmationDialog>

      <Dialog open={exportOpen} onOpenChange={(o) => !exporting && setExportOpen(o)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Export sets as a Lackey zip</DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Downloads <code>carddata.txt</code> + card images for the selected sets — re-importable
              here, or merge into a LackeyCCG plugin to playtest.
            </p>
          </DialogHeader>

          <DialogBody className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={exportSel.size === sets.length && sets.length > 0}
                onChange={(e) =>
                  setExportSel(e.target.checked ? new Set(sets.map((s) => s.id)) : new Set())
                }
                className="h-4 w-4 rounded border-input"
              />
              Select all
            </label>
            <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
              {sets.map((s) => (
                <li key={s.id}>
                  <label className="flex cursor-pointer items-center justify-between gap-2 p-2 text-sm hover:bg-muted/50">
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={exportSel.has(s.id)}
                        onChange={() => toggleExport(s.id)}
                        aria-label={`Select ${s.name}`}
                        className="h-4 w-4 rounded border-input"
                      />
                      <span className="font-medium">{s.name}</span>
                    </span>
                    <span className="text-muted-foreground">{s.total} cards</span>
                  </label>
                </li>
              ))}
            </ul>
            {exportError && <p className="text-sm text-destructive">{exportError}</p>}
          </DialogBody>

          <DialogFooter className="justify-end">
            <Button variant="cancel" disabled={exporting} onClick={() => setExportOpen(false)}>
              Cancel
            </Button>
            <Button disabled={exporting || exportSel.size === 0} onClick={runExport}>
              {exporting ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  Preparing…
                </span>
              ) : (
                `Export ${exportSel.size || ""} ${exportSel.size === 1 ? "set" : "sets"}`.trim()
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>New set</DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Name the set and seed starting targets — you can refine them anytime from the Progress tab.
            </p>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Set name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim() && !busy) confirmCreate();
                }}
                placeholder="New set name…"
                autoFocus
                aria-label="Set name"
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              />
            </label>

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
            <Button variant="success" disabled={busy || !name.trim()} onClick={confirmCreate}>
              {busy ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  Creating…
                </span>
              ) : (
                "Create set"
              )}
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
