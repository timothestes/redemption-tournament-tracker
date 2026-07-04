"use client";

// Lackey zip import wizard. The zip NEVER goes to the server (37MB > Vercel's ~4.5MB
// request cap): fflate unpacks it in the browser, carddata.txt is parsed/filtered
// locally, preview renders from zip bytes, and only the matched cards are sent —
// batched multipart POSTs to /forge/api/import. A route handler (not a Server Action)
// because Next serializes Server Action calls from one client; these batches genuinely
// run in parallel.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { unzipSync } from "fflate";
import {
  parseCarddata, matchesFilter, distinctSets, findImageEntry,
  lackeyRowToDesignCard, type LackeyRow,
} from "@/app/forge/lib/lackey";
import { createSet, type ForgeSetSummary } from "@/app/forge/lib/sets";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";

const BATCH_SIZE = 8;            // cards per request (must stay ≤ the route's cap of 12)
const BATCH_CONCURRENCY = 4;     // requests in flight
const MAX_BATCH_BYTES = 3_500_000; // keep each request under Vercel's ~4.5MB body cap

type CardStatus = "queued" | "importing" | "imported" | "updated" | "skipped" | "failed";
interface ImportItem {
  row: LackeyRow;
  entryName: string | null; // zip entry for the finished-card image, if present
  status: CardStatus;
  error?: string;
}

function mimeFor(entryName: string): string {
  const lower = entryName.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function baseName(entryName: string): string {
  return entryName.split("/").pop() ?? entryName;
}

interface BatchCardResult { name: string; ok: boolean; cardId?: string; skipped?: boolean; updated?: boolean; error?: string }

// Greedy chunking: ≤ BATCH_SIZE cards and ≤ MAX_BATCH_BYTES of image data per request.
// An image bigger than the cap still gets its own single-card batch.
function chunkIntoBatches(
  indexes: number[],
  work: { entryName: string | null }[],
  images: Record<string, Uint8Array>,
): number[][] {
  const batches: number[][] = [];
  let current: number[] = [];
  let currentBytes = 0;
  for (const idx of indexes) {
    const entry = work[idx].entryName;
    const size = entry && images[entry] ? images[entry].length : 0;
    if (current.length > 0 && (current.length >= BATCH_SIZE || currentBytes + size > MAX_BATCH_BYTES)) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(idx);
    currentBytes += size;
  }
  if (current.length) batches.push(current);
  return batches;
}

export default function ImportWizard({ sets }: { sets: ForgeSetSummary[] }) {
  const zipBytes = useRef<Uint8Array | null>(null);
  const [zipName, setZipName] = useState<string | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);
  const [rows, setRows] = useState<LackeyRow[] | null>(null);
  const [entryNames, setEntryNames] = useState<string[]>([]);

  const [filter, setFilter] = useState("");
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [newSetName, setNewSetName] = useState("");
  const [existingSetId, setExistingSetId] = useState(sets[0]?.id ?? "");
  const [overwrite, setOverwrite] = useState(false);
  const [newSetDialogOpen, setNewSetDialogOpen] = useState(false);

  const [items, setItems] = useState<ImportItem[] | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [doneSetId, setDoneSetId] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Map<string, string>>(new Map());

  async function onPickZip(file: File) {
    setZipError(null); setRows(null); setItems(null); setDoneSetId(null); setFilter("");
    setZipName(file.name);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      zipBytes.current = bytes;
      // Single pass: collect every entry name, decompress ONLY carddata.txt.
      const names: string[] = [];
      const unzipped = unzipSync(bytes, {
        filter: (f) => {
          if (!f.name.endsWith("/")) names.push(f.name);
          return f.name.toLowerCase().endsWith("sets/carddata.txt");
        },
      });
      const carddataEntry = Object.keys(unzipped)[0];
      if (!carddataEntry) {
        setZipError("No sets/carddata.txt found in this zip — is it a Lackey plugin export?");
        return;
      }
      const text = new TextDecoder("utf-8").decode(unzipped[carddataEntry]);
      setRows(parseCarddata(text));
      setEntryNames(names);
    } catch (e) {
      setZipError(e instanceof Error ? e.message : "Could not read this zip file.");
    }
  }

  const matched = useMemo(
    () => (rows ?? []).filter((r) => matchesFilter(r, filter)),
    [rows, filter],
  );
  const zipSets = useMemo(() => distinctSets(rows ?? []), [rows]);

  // Changing the filter starts a fresh selection — clear any previous run.
  // Locked while a run is in flight: in-flight workers would resurrect the old
  // status list over the new selection.
  function onFilterChange(value: string) {
    if (running) return;
    setFilter(value);
    setItems(null);
    setDoneSetId(null);
    setRunError(null);
  }
  const invalidRegex = useMemo(() => {
    const m = filter.trim().match(/^\/(.*)\/$/);
    if (!m) return false;
    try { new RegExp(m[1], "i"); return false; } catch { return true; }
  }, [filter]);

  // Decompress matched images once per filter change; expose object URLs for preview.
  useEffect(() => {
    if (!zipBytes.current || matched.length === 0) { setPreviews(new Map()); return; }
    const wanted = new Set(
      matched.map((r) => findImageEntry(r, entryNames)).filter(Boolean) as string[],
    );
    const files = unzipSync(zipBytes.current, { filter: (f) => wanted.has(f.name) });
    const urls = new Map<string, string>();
    for (const [name, bytes] of Object.entries(files)) {
      urls.set(name, URL.createObjectURL(new Blob([bytes.slice()], { type: mimeFor(name) })));
    }
    setPreviews(urls);
    return () => { for (const u of urls.values()) URL.revokeObjectURL(u); };
  }, [matched, entryNames]);

  // Prefill the new-set name with the (non-regex) filter value.
  useEffect(() => {
    if (filter && !filter.startsWith("/")) setNewSetName(filter.trim());
  }, [filter]);

  // POST one batch; write each card's result (or the batch-level error) into `work`.
  async function importBatch(
    setId: string,
    batch: number[],
    work: ImportItem[],
    images: Record<string, Uint8Array>,
  ) {
    const fd = new FormData();
    const cards = batch.map((idx, j) => {
      const it = work[idx];
      let fileField: string | undefined;
      if (it.entryName && images[it.entryName]) {
        fileField = `file-${j}`;
        fd.set(fileField, new File([images[it.entryName].slice()], baseName(it.entryName), { type: mimeFor(it.entryName) }));
      }
      return { name: it.row.name, snapshot: lackeyRowToDesignCard(it.row), fileField };
    });
    fd.set("payload", JSON.stringify({ setId, cards, overwrite }));

    const res = await fetch("/forge/api/import", { method: "POST", body: fd });
    if (!res.ok) {
      let message = `Import failed (${res.status})`;
      try {
        const body = await res.json();
        if (body?.error) message = body.error;
      } catch { /* non-JSON error body */ }
      for (const idx of batch) { work[idx].status = "failed"; work[idx].error = message; }
      return;
    }
    const body = (await res.json()) as { results?: BatchCardResult[] };
    batch.forEach((idx, j) => {
      const r = body.results?.[j];
      if (!r || r.ok === false) {
        work[idx].status = "failed";
        work[idx].error = r?.error ?? "Unexpected error";
      } else {
        work[idx].status = r.skipped ? "skipped" : r.updated ? "updated" : "imported";
      }
    });
  }

  // Chunk the given items into batches and run them BATCH_CONCURRENCY at a time.
  async function runBatches(setId: string, indexes: number[], work: ImportItem[]) {
    const bytes = zipBytes.current!;
    const wanted = new Set(indexes.map((i) => work[i].entryName).filter(Boolean) as string[]);
    const images = unzipSync(bytes, { filter: (f) => wanted.has(f.name) });
    const batches = chunkIntoBatches(indexes, work, images);

    let cursor = 0;
    const runOne = async () => {
      for (;;) {
        const b = cursor++;
        if (b >= batches.length) return;
        for (const idx of batches[b]) work[idx].status = "importing";
        setItems([...work]);
        try {
          await importBatch(setId, batches[b], work, images);
        } catch (e) {
          const message = e instanceof Error ? e.message : "Unexpected error";
          for (const idx of batches[b]) {
            if (work[idx].status === "importing") { work[idx].status = "failed"; work[idx].error = message; }
          }
        }
        setItems([...work]);
      }
    };
    await Promise.all(Array.from({ length: BATCH_CONCURRENCY }, runOne));
  }

  async function runImport() {
    if (running || matched.length === 0) return;
    setRunError(null);
    setRunning(true);
    try {
      let setId = existingSetId;
      if (mode === "new") {
        const name = newSetName.trim();
        if (!name) { setRunError("Name the new set first."); return; }
        const r = await createSet(name);
        if (r.ok === false) { setRunError(r.error); return; }
        setId = r.id;
      }
      if (!setId) { setRunError("Pick a destination set."); return; }

      const work: ImportItem[] = matched.map((row) => ({
        row, entryName: findImageEntry(row, entryNames), status: "queued" as CardStatus,
      }));
      setItems([...work]);
      await runBatches(setId, work.map((_, i) => i), work);
      setDoneSetId(setId);
    } finally {
      setRunning(false);
    }
  }

  async function retryFailed() {
    if (!items || !doneSetId || running) return;
    setRunning(true);
    try {
      const work = items.map((it) =>
        it.status === "failed" ? { ...it, error: undefined } : it,
      );
      const failedIndexes = work
        .map((it, i) => (it.status === "failed" ? i : -1))
        .filter((i) => i >= 0);
      setItems([...work]);
      await runBatches(doneSetId, failedIndexes, work);
    } finally {
      setRunning(false);
    }
  }

  const counts = useMemo(() => {
    const c = { imported: 0, updated: 0, skipped: 0, failed: 0 };
    for (const it of items ?? []) {
      if (it.status === "imported") c.imported++;
      else if (it.status === "updated") c.updated++;
      else if (it.status === "skipped") c.skipped++;
      else if (it.status === "failed") c.failed++;
    }
    return c;
  }, [items]);
  const finished = !!items && !running && items.every((it) =>
    it.status === "imported" || it.status === "updated" || it.status === "skipped" || it.status === "failed");

  return (
    <div className="mx-auto max-w-4xl p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Import a set</h1>
        <Link href="/forge/sets" className="text-sm text-muted-foreground hover:underline">← Sets</Link>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Upload a Lackey plugin zip. It’s unpacked in your browser — only the cards you
        select are uploaded, privately, to the Forge.
      </p>

      {/* 1 — zip */}
      <fieldset className="rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">1 · Lackey zip</legend>
        <input type="file" accept=".zip,application/zip" aria-label="Lackey zip file"
          className="block w-full text-xs disabled:opacity-50" disabled={running}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickZip(f); e.target.value = ""; }} />
        {zipName && !zipError && rows && (
          <p className="mt-2 text-xs text-muted-foreground">
            {zipName} — {rows.length} cards across {zipSets.length} sets.
          </p>
        )}
        {zipError && <p className="mt-2 text-xs text-red-500">{zipError}</p>}
      </fieldset>

      {/* 2 — filter */}
      {rows && (
        <fieldset className="mt-4 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">2 · Which set?</legend>
          <input value={filter} onChange={(e) => onFilterChange(e.target.value)} disabled={running}
            aria-label="Set filter" placeholder="Set code, e.g. EoT — or /regex/"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50" />
          {invalidRegex && <p className="mt-1 text-xs text-red-500">Invalid regular expression.</p>}
          <p className="mt-2 text-sm">
            {matched.length === 1 ? "1 card matches" : `${matched.length} cards match`}
            {matched.length > 0 && (
              <span className="text-muted-foreground">
                {" "}· {matched.filter((r) => !findImageEntry(r, entryNames)).length} without an image
              </span>
            )}
          </p>
        </fieldset>
      )}

      {/* 3 — preview */}
      {matched.length > 0 && !items && (
        <fieldset className="mt-4 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">3 · Preview</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {matched.map((r) => {
              const entry = findImageEntry(r, entryNames);
              const url = entry ? previews.get(entry) : null;
              return (
                <div key={`${r.name}|${r.imageFile}`}>
                  <div className="relative w-full overflow-hidden rounded-md border bg-muted/30" style={{ aspectRatio: "2.5 / 3.5" }}>
                    {url ? (
                      <img src={url} alt={r.name} loading="lazy" decoding="async"
                        className="absolute inset-0 h-full w-full object-contain" />
                    ) : (
                      <div className="flex h-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
                        No image
                      </div>
                    )}
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{r.name}</p>
                </div>
              );
            })}
          </div>
        </fieldset>
      )}

      {/* 4 — destination + run (hidden once a run starts; filter change resets) */}
      {matched.length > 0 && !items && (
        <fieldset className="mt-4 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">4 · Destination</legend>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="dest" checked={mode === "new"}
                onChange={() => { setMode("new"); setOverwrite(false); }} />
              Create a new set
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="dest" checked={mode === "existing"} onChange={() => setMode("existing")}
                disabled={sets.length === 0} />
              Add to an existing set
            </label>
            {mode === "existing" && (
              <>
                <select value={existingSetId} onChange={(e) => setExistingSetId(e.target.value)}
                  aria-label="Existing set" className="ml-6 w-64 rounded-md border bg-background px-2 py-1 text-sm">
                  {sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <label className="mt-2 flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)}
                    className="mt-0.5" />
                  <span>
                    <span className="font-medium">Overwrite existing cards</span>
                    <span className="block text-xs text-muted-foreground">
                      Cards whose names already exist in the set get their text and finished
                      image replaced (a new testing version — release the update when ready).
                      Cards not in this zip are untouched.
                    </span>
                  </span>
                </label>
              </>
            )}
          </div>
          {runError && <p className="mt-2 text-sm text-red-500">{runError}</p>}
          <button type="button" onClick={() => (mode === "new" ? setNewSetDialogOpen(true) : runImport())}
            disabled={running || matched.length === 0}
            className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {matched.length === 1 ? "Import 1 card" : `Import ${matched.length} cards`}
          </button>
        </fieldset>
      )}

      <Dialog open={newSetDialogOpen} onOpenChange={(o) => !running && setNewSetDialogOpen(o)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>New set for this import</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Set name</span>
              <input value={newSetName} onChange={(e) => setNewSetName(e.target.value)}
                aria-label="New set name" placeholder="Set name"
                className="w-full rounded-md border bg-background px-2 py-1 text-sm" />
            </label>
          </DialogBody>
          <DialogFooter className="justify-end">
            <Button variant="cancel" onClick={() => setNewSetDialogOpen(false)}>Cancel</Button>
            <Button disabled={running || !newSetName.trim()}
              onClick={() => { setNewSetDialogOpen(false); runImport(); }}>
              {matched.length === 1 ? "Create set & import 1 card" : `Create set & import ${matched.length} cards`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 5 — progress + summary */}
      {items && (
        <fieldset className="mt-4 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">5 · Import</legend>
          <p className="text-sm">
            {overwrite ? (
              <>Imported {counts.imported} · Updated {counts.updated} · Skipped {counts.skipped} · Failed {counts.failed}</>
            ) : (
              <>Imported {counts.imported} · Skipped {counts.skipped} · Failed {counts.failed}</>
            )}
          </p>
          {finished && counts.failed > 0 && (
            <button type="button" onClick={retryFailed}
              className="mt-2 rounded-md border px-3 py-1 text-xs">Retry failed</button>
          )}
          {finished && doneSetId && (
            <Link href={`/forge/sets/${doneSetId}/cards`}
              className="mt-2 block text-sm font-medium text-primary hover:underline">
              View set →
            </Link>
          )}
          <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto text-xs">
            {items.map((it, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="truncate">{it.row.name}</span>
                <span className={
                  it.status === "failed" ? "text-red-500"
                    : it.status === "imported" || it.status === "updated" ? "text-primary"
                    : "text-muted-foreground"
                }>
                  {it.status === "failed" ? `failed: ${it.error ?? "unknown"}` : it.status}
                </span>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
    </div>
  );
}
