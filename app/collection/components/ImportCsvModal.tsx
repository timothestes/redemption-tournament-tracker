"use client";

import React, { useState } from "react";
import type { Card } from "../../decklist/card-search/utils";
import { parseCollectionFile, type CsvImportResult } from "../utils/collectionCsv";

interface ImportCsvModalProps {
  allCards: Card[];
  onClose: () => void;
  onImport: (
    rows: { card: Card; quantity: number }[],
    mode: "merge" | "replace"
  ) => Promise<{ success: boolean; error?: string; imported?: number }>;
  /** Number of cards currently owned — drives the Replace guard. */
  currentCount: number;
  /** Download a backup of the current collection (called before a Replace wipe). */
  onBackup: () => void;
}

const CONFIRM_WORD = "REPLACE";

export default function ImportCsvModal({ allCards, onClose, onImport, currentCount, onBackup }: ImportCsvModalProps) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<CsvImportResult | null>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [confirmText, setConfirmText] = useState("");

  // A Replace that would wipe existing cards needs the type-to-confirm guard
  const replaceGuarded = mode === "replace" && currentCount > 0;
  const confirmOk = confirmText.trim().toUpperCase() === CONFIRM_WORD;

  const handleFile = async (file: File) => {
    const content = await file.text();
    setText(content);
    setParsed(parseCollectionFile(content, allCards));
  };

  const handleParse = () => {
    setParsed(parseCollectionFile(text, allCards));
  };

  const handleImport = async () => {
    if (!parsed || parsed.rows.length === 0) return;
    if (replaceGuarded) {
      if (!confirmOk) return;
      onBackup(); // download a backup right before the wipe
    }
    setIsImporting(true);
    setImportError(null);
    const result = await onImport(parsed.rows, mode);
    setIsImporting(false);
    if (result.success) {
      setDone(result.imported ?? parsed.rows.length);
    } else {
      setImportError(result.error || "Import failed");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-background border border-border rounded-t-xl sm:rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-4 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Import collection</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {done !== null ? (
          <div className="space-y-4">
            <p className="text-sm">
              Imported <span className="font-semibold">{done}</span> card
              {done === 1 ? "" : "s"} into your collection.
            </p>
            <button
              onClick={onClose}
              className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Drop in a deck builder <code>.txt</code> export (the cards become owned
              copies), or a spreadsheet CSV with <code>Quantity</code> and{" "}
              <code>Name</code> columns. The format is detected automatically.
            </p>

            <label className="block">
              <span className="text-sm font-medium">Choose a file</span>
              <input
                type="file"
                accept=".txt,.csv,text/csv,text/plain"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
                className="mt-1 block w-full text-sm text-muted-foreground file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-border file:bg-muted file:text-foreground file:text-sm hover:file:bg-muted/80"
              />
            </label>

            <div>
              <span className="text-sm font-medium">…or paste a deck list / CSV</span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onBlur={handleParse}
                rows={5}
                placeholder={"3\tAbraham\tPoC\n1\tMoses\tPa"}
                className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm font-mono"
              />
              <button
                onClick={handleParse}
                disabled={!text.trim()}
                className="mt-1 px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted disabled:opacity-50"
              >
                Preview
              </button>
            </div>

            {parsed && (
              <div className="rounded-lg border border-border p-3 text-sm space-y-2">
                <p>
                  <span className="font-semibold">{parsed.rows.length}</span> card
                  {parsed.rows.length === 1 ? "" : "s"} ready to import
                  {parsed.errors.length > 0 && (
                    <span className="text-red-600 dark:text-red-400">
                      {" "}· {parsed.errors.length} error{parsed.errors.length === 1 ? "" : "s"}
                    </span>
                  )}
                  {parsed.warnings.length > 0 && (
                    <span className="text-amber-600 dark:text-amber-400">
                      {" "}· {parsed.warnings.length} warning{parsed.warnings.length === 1 ? "" : "s"}
                    </span>
                  )}
                </p>
                {(parsed.errors.length > 0 || parsed.warnings.length > 0) && (
                  <ul className="max-h-32 overflow-y-auto space-y-0.5 text-xs">
                    {parsed.errors.map((e, i) => (
                      <li key={`e${i}`} className="text-red-600 dark:text-red-400">{e}</li>
                    ))}
                    {parsed.warnings.map((w, i) => (
                      <li key={`w${i}`} className="text-amber-600 dark:text-amber-400">{w}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium mb-1">Import mode</legend>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  checked={mode === "merge"}
                  onChange={() => setMode("merge")}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">Merge</span> — add these quantities to what
                  you already have
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  checked={mode === "replace"}
                  onChange={() => setMode("replace")}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">Replace</span> — wipe your collection and
                  start from this file
                </span>
              </label>
            </fieldset>

            {/* Replace guard: only when there's an existing collection to lose */}
            {replaceGuarded && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 space-y-2">
                <p className="text-sm text-red-600 dark:text-red-400">
                  This deletes all{" "}
                  <span className="font-semibold">{currentCount.toLocaleString()}</span> card
                  {currentCount === 1 ? "" : "s"} you currently own and imports{" "}
                  <span className="font-semibold">{parsed?.rows.length ?? 0}</span> from this
                  file. We&apos;ll download a backup first, but to be safe, type{" "}
                  <code className="font-semibold">{CONFIRM_WORD}</code> to confirm.
                </p>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={`Type ${CONFIRM_WORD}`}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  autoComplete="off"
                />
              </div>
            )}

            {importError && (
              <p className="text-sm text-red-600 dark:text-red-400">{importError}</p>
            )}

            <button
              onClick={handleImport}
              disabled={
                !parsed ||
                parsed.rows.length === 0 ||
                isImporting ||
                (replaceGuarded && !confirmOk)
              }
              className={`w-full px-4 py-2 rounded-lg font-medium disabled:opacity-50 ${
                replaceGuarded
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              }`}
            >
              {isImporting
                ? "Importing…"
                : replaceGuarded
                  ? "Download backup & replace"
                  : mode === "replace"
                    ? "Replace collection"
                    : "Import cards"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
