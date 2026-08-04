"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { getCardImageUrl } from "@/app/shared/utils/cardImageUrl";
import { Button } from "@/components/ui/button";
import {
  createDeckFromContents, replaceDeckContents, resyncProduct,
} from "../actions";
import type { DeckProductMeta } from "../actions";
import type { ParsedLine, ParsedCandidate } from "@/lib/ytg/deckContentsParser";
import type { ResolvedEntry } from "@/lib/ytg/deckLinkOps";
import CardPickerInline, { type PickedCard } from "./CardPickerInline";

const imgFileFromCardKey = (cardKey: string) => cardKey.split("|")[2] ?? "";

interface RowState {
  line: ParsedLine;
  chosen: PickedCard | null;
  qty: number;
  dropped: boolean;
}

function toRows(lines: ParsedLine[]): RowState[] {
  return lines.map((line) => ({
    line,
    chosen:
      line.status === "resolved"
        ? {
            cardKey: line.candidates[0].cardKey,
            cardName: line.candidates[0].cardName,
            setCode: line.candidates[0].setCode,
            imgFile: imgFileFromCardKey(line.candidates[0].cardKey),
          }
        : null,
    qty: line.qty,
    dropped: false,
  }));
}

export default function ContentsWizard({
  product,
  initialLines,
  linked,
}: {
  product: DeckProductMeta;
  initialLines: ParsedLine[];
  linked: { deckId: string; currentCardCount: number } | null;
}) {
  const replaceMode = linked !== null;
  const [rows, setRows] = useState<RowState[]>(() => toRows(initialLines));
  const [error, setError] = useState("");
  const [conflictDeckId, setConflictDeckId] = useState<string | null>(null);
  const [done, setDone] = useState<{ deckId: string; deckName: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const counts = useMemo(() => {
    const active = rows.filter((r) => !r.dropped);
    return {
      total: rows.length,
      resolved: active.filter((r) => r.chosen !== null).length,
      ambiguous: active.filter((r) => r.chosen === null && r.line.status === "ambiguous").length,
      unresolved: active.filter((r) => r.chosen === null && r.line.status !== "ambiguous").length,
      dropped: rows.filter((r) => r.dropped).length,
      qtyTotal: active.reduce((s, r) => s + (r.chosen ? r.qty : 0), 0),
    };
  }, [rows]);

  const allSettled = rows.every((r) => r.dropped || r.chosen !== null);
  const deckNamePreview = product.title.replace(/^\*New\*\s*/i, "").trim();

  const patch = (i: number, p: Partial<RowState>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  const submit = () => {
    const resolved: ResolvedEntry[] = rows
      .filter((r) => !r.dropped && r.chosen !== null)
      .map((r) => ({
        cardKey: r.chosen!.cardKey,
        cardName: r.chosen!.cardName,
        setCode: r.chosen!.setCode,
        imgFile: r.chosen!.imgFile,
        qty: r.qty,
      }));
    startTransition(async () => {
      setError("");
      if (replaceMode) {
        const res = await replaceDeckContents(product.productId, resolved);
        if (res.success === false) { setError(res.error); return; }
        setDone({ deckId: res.deckId, deckName: deckNamePreview });
      } else {
        const res = await createDeckFromContents(product.productId, resolved);
        if (res.success === false) {
          if (res.conflict === true) setConflictDeckId(res.existingDeckId);
          else setError(res.error);
          return;
        }
        setDone({ deckId: res.deckId, deckName: res.deckName });
      }
    });
  };

  const resync = () => {
    startTransition(async () => {
      setError("");
      const res = await resyncProduct(product.productId);
      if (res.success === false) { setError(res.error); return; }
      setRows(toRows(res.lines));
    });
  };

  if (done) {
    return (
      <div className="max-w-xl space-y-4">
        <h2 className="text-lg font-semibold">
          {replaceMode ? "Contents replaced" : "Deck created"} — {done.deckName}
        </h2>
        <p className="text-sm text-muted-foreground">
          This deck is now the source of truth for &ldquo;{product.title}&rdquo;.
        </p>
        <div className="flex gap-3">
          <Link href={`/decklist/${done.deckId}`}><Button>View public deck</Button></Link>
          <Link href="/admin/ytg/decks"><Button variant="outline">Back to deck products</Button></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stepper + product header */}
      <div className="flex flex-col gap-2">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">
          Parse ✓ &nbsp;→&nbsp; <span className="text-foreground font-medium">Review</span> &nbsp;→&nbsp; {replaceMode ? "Replace" : "Create"}
        </div>
        <div className="flex items-center gap-3">
          {product.imageUrl && (
            <img src={product.imageUrl} alt="" className="w-12 h-12 rounded object-cover" />
          )}
          <div className="min-w-0">
            <h2 className="text-lg font-semibold truncate">{product.title}</h2>
            <p className="text-sm text-muted-foreground">
              Deck name: <span className="font-medium">{deckNamePreview}</span>
              {" "}(a &ldquo;— handle&rdquo; suffix is added automatically on collision)
            </p>
          </div>
          <div className="ml-auto shrink-0">
            <Button size="sm" variant="outline" disabled={pending} onClick={resync}>
              Re-sync &amp; re-parse
            </Button>
          </div>
        </div>
      </div>

      {replaceMode && (
        <div className="px-4 py-2 rounded-md bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 text-sm">
          Replace mode: deck currently has {linked!.currentCardCount} cards; this parse
          resolves {counts.qtyTotal}. Replacing rewrites the deck&apos;s contents.
          {" "}<Link className="underline" href={`/decklist/${linked!.deckId}`}>View current deck</Link>
        </div>
      )}

      {conflictDeckId !== null && (
        <div className="px-4 py-2 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-sm">
          This product was linked while you worked — no duplicate deck was created.
          {" "}<Link className="underline" href={`/decklist/${conflictDeckId}`}>View the linked deck</Link>
          {" "}or reload this page to enter replace mode.
        </div>
      )}
      {error && (
        <div className="px-4 py-2 rounded-md bg-destructive/10 text-destructive text-sm">
          {error.includes("a sale is being recorded")
            ? "A sale is being recorded for this product — wait for it to finish (or fail), then retry."
            : error}
        </div>
      )}

      {/* Running header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur px-1 py-2 text-sm">
        <span className="font-medium">{counts.resolved} of {counts.total} resolved</span>
        <span className="text-muted-foreground">
          {" "}· {counts.ambiguous} ambiguous · {counts.unresolved} unresolved · {counts.dropped} dropped · {counts.qtyTotal} cards total
        </span>
      </div>

      {/* Review table */}
      <div className="rounded-lg bg-muted/30 divide-y divide-background">
        {rows.map((r, i) => (
          <div key={i} className={`px-3 py-2 ${r.dropped ? "opacity-40" : ""}`}>
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-full sm:w-64 shrink-0">
                <div className="text-xs text-muted-foreground font-mono truncate" title={r.line.raw}>
                  {r.line.raw}
                </div>
                {r.line.section && (
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                    {r.line.section}
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                {r.chosen !== null ? (
                  <div className="flex items-center gap-2">
                    <img src={getCardImageUrl(r.chosen.imgFile)} alt="" className="w-7 h-10 rounded-sm object-cover" />
                    <span className="truncate text-sm">{r.chosen.cardName}</span>
                    <span className="text-xs text-muted-foreground">{r.chosen.setCode}</span>
                    {!r.dropped && (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline"
                        onClick={() => patch(i, { chosen: null })}
                      >
                        change
                      </button>
                    )}
                  </div>
                ) : r.dropped ? (
                  <span className="text-sm text-muted-foreground">dropped</span>
                ) : (
                  <div className="space-y-1">
                    {r.line.candidates.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {r.line.candidates.map((c: ParsedCandidate) => (
                          <button
                            key={c.cardKey}
                            type="button"
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted hover:bg-muted/70 text-xs"
                            onClick={() =>
                              patch(i, {
                                chosen: {
                                  cardKey: c.cardKey, cardName: c.cardName,
                                  setCode: c.setCode, imgFile: imgFileFromCardKey(c.cardKey),
                                },
                              })
                            }
                          >
                            <img src={getCardImageUrl(imgFileFromCardKey(c.cardKey))} alt="" className="w-5 h-7 rounded-sm object-cover" />
                            {c.cardName} <span className="text-muted-foreground">({c.setCode})</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <CardPickerInline
                      preferredSets={[...new Set(r.line.candidates.map((c) => c.setCode))]}
                      initialQuery={r.line.name}
                      onPick={(card) => patch(i, { chosen: card })}
                    />
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`px-1.5 py-0.5 rounded text-xs ${
                    r.dropped
                      ? "bg-muted text-muted-foreground"
                      : r.chosen !== null
                        ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                        : r.line.status === "ambiguous"
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                          : "bg-destructive/10 text-destructive"
                  }`}
                >
                  {r.dropped ? "dropped" : r.chosen !== null ? "resolved" : r.line.status}
                </span>
                <div className="flex items-center rounded bg-muted">
                  <button type="button" className="px-2 py-0.5 text-sm" disabled={r.dropped || r.qty <= 1}
                    onClick={() => patch(i, { qty: Math.max(1, r.qty - 1) })}>−</button>
                  <span className="px-1 text-sm tabular-nums">{r.qty}</span>
                  <button type="button" className="px-2 py-0.5 text-sm" disabled={r.dropped}
                    onClick={() => patch(i, { qty: r.qty + 1 })}>+</button>
                </div>
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline"
                  onClick={() => patch(i, { dropped: !r.dropped })}
                >
                  {r.dropped ? "restore" : "drop"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Button disabled={!allSettled || pending || conflictDeckId !== null} onClick={submit}>
          {replaceMode ? `Replace contents (${counts.qtyTotal} cards)` : `Create deck (${counts.qtyTotal} cards)`}
        </Button>
        {!allSettled && (
          <span className="text-sm text-muted-foreground">
            Resolve or drop every line to continue.
          </span>
        )}
        <Link href="/admin/ytg/decks" className="ml-auto text-sm text-muted-foreground hover:underline">
          Cancel
        </Link>
      </div>
    </div>
  );
}
