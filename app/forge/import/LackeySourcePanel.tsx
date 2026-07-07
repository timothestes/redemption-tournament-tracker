"use client";

// Source panel: LackeyCCG plugin zip. Unpacks in the browser (fflate), parses
// sets/carddata.txt, and lets the elder pick a set by code or /regex/. Emits the
// matched cards to the shared wizard.

import { useEffect, useMemo, useRef, useState } from "react";
import { unzipSync } from "fflate";
import {
  parseCarddata, matchesFilter, distinctSets, findImageEntry,
  lackeyRowToDesignCard, auditLackeyRow, type LackeyRow,
} from "@/app/forge/lib/lackey";
import FilePicker from "@/app/forge/components/FilePicker";
import type { SourceSelection } from "./selection";

export default function LackeySourcePanel({
  disabled,
  onSelection,
}: {
  disabled: boolean;
  onSelection: (s: SourceSelection | null) => void;
}) {
  const zipBytes = useRef<Uint8Array | null>(null);
  const sizesRef = useRef<Record<string, number>>({});
  const [zipName, setZipName] = useState<string | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);
  const [rows, setRows] = useState<LackeyRow[] | null>(null);
  const [entryNames, setEntryNames] = useState<string[]>([]);
  const [filter, setFilter] = useState("");

  async function onPickZip(file: File) {
    setZipError(null); setRows(null); setFilter("");
    setZipName(file.name);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      zipBytes.current = bytes;
      // Single pass: collect every entry name + size, decompress ONLY carddata.txt.
      const names: string[] = [];
      const sizes: Record<string, number> = {};
      const unzipped = unzipSync(bytes, {
        filter: (f) => {
          if (!f.name.endsWith("/")) { names.push(f.name); sizes[f.name] = f.originalSize; }
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
      sizesRef.current = sizes;
    } catch (e) {
      setZipError(e instanceof Error ? e.message : "Could not read this zip file.");
    }
  }

  const matched = useMemo(
    () => (rows ?? []).filter((r) => matchesFilter(r, filter)),
    [rows, filter],
  );
  const zipSets = useMemo(() => distinctSets(rows ?? []), [rows]);
  const invalidRegex = useMemo(() => {
    const m = filter.trim().match(/^\/(.*)\/$/);
    if (!m) return false;
    try { new RegExp(m[1], "i"); return false; } catch { return true; }
  }, [filter]);

  const selection = useMemo<SourceSelection | null>(() => {
    if (matched.length === 0) return null;
    return {
      cards: matched.map((r) => ({
        name: r.name,
        snapshot: lackeyRowToDesignCard(r),
        entryName: findImageEntry(r, entryNames),
        warnings: auditLackeyRow(r),
      })),
      zipBytes: zipBytes.current,
      sizes: sizesRef.current,
      defaultSetName: filter && !filter.startsWith("/") ? filter.trim() : "",
      key: `lackey|${zipName}|${filter}`,
    };
  }, [matched, entryNames, zipName, filter]);
  useEffect(() => { onSelection(selection); }, [selection, onSelection]);

  const noImage = selection ? selection.cards.filter((c) => !c.entryName).length : 0;

  return (
    <>
      {/* 2 — zip */}
      <fieldset className="mt-4 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">2 · Lackey zip</legend>
        <FilePicker label="Choose zip…" accept=".zip,application/zip" disabled={disabled} onFile={onPickZip} />
        {zipName && !zipError && rows && (
          <p className="mt-2 text-xs text-muted-foreground">
            {zipName} — {rows.length} cards across {zipSets.length} sets.
          </p>
        )}
        {zipError && <p className="mt-2 text-xs text-destructive">{zipError}</p>}
      </fieldset>

      {/* 3 — filter */}
      {rows && (
        <fieldset className="mt-4 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">3 · Which set?</legend>
          <input value={filter} onChange={(e) => !disabled && setFilter(e.target.value)} disabled={disabled}
            aria-label="Set filter" placeholder="Set code, e.g. EoT — or /regex/"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50" />
          {invalidRegex && <p className="mt-1 text-xs text-destructive">Invalid regular expression.</p>}
          <p className="mt-2 text-sm">
            {matched.length === 1 ? "1 card matches" : `${matched.length} cards match`}
            {matched.length > 0 && (
              <span className="text-muted-foreground"> · {noImage} without an image</span>
            )}
          </p>
        </fieldset>
      )}
    </>
  );
}
