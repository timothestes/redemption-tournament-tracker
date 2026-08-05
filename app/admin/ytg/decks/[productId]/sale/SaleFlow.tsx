"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { getCardImageUrl } from "@/app/shared/utils/cardImageUrl";
import { Button } from "@/components/ui/button";
import {
  previewSale, confirmSale, applySale, resumeSale, retrySaleItem, undoSale,
} from "../../saleActions";
import type { SalePreview, SalePreviewRow, SaleView } from "../../saleActions";

const imgOf = (cardKey: string) => cardKey.split("|")[2] ?? "";
const fmtWhen = (iso: string) => new Date(iso).toLocaleString();

const FLAG_BADGE: Record<string, { label: string; cls: string }> = {
  ok: { label: "ok", cls: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" },
  unmapped: { label: "unmapped", cls: "bg-destructive/10 text-destructive" },
  untracked: { label: "untracked", cls: "bg-muted text-muted-foreground" },
  would_go_negative: { label: "would go negative", cls: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
};

const ITEM_EXPLAIN: Record<string, string> = {
  applied: "Inventory decremented in Shopify.",
  pending: "Not applied yet.",
  applying: "Was in flight when this loaded — use Resume to reconcile against live inventory.",
  skipped_unmapped: "No confirmed card-product mapping; nothing was adjusted.",
  skipped_untracked: "Variant does not track inventory; nothing was adjusted.",
  error: "Shopify rejected this change.",
  conflict: "Live quantity moved between preview and apply — the compare-and-swap refused it. Verify in Shopify, then Retry with fresh numbers.",
  undone: "Reversed by undo.",
  undo_conflict: "Live quantity moved since the sale — undo refused to stack stock. Review in Shopify.",
};

export default function SaleFlow({ initialPreview }: { initialPreview: SalePreview }) {
  const [preview, setPreview] = useState<SalePreview>(initialPreview);
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const [ack, setAck] = useState(false);
  const [error, setError] = useState("");
  const [inProgress, setInProgress] = useState<{ createdAt: string; createdByName: string | null } | null>(null);
  const [deckChanged, setDeckChanged] = useState(false);
  const [dryRunDone, setDryRunDone] = useState<string | null>(null); // saleId
  const [sale, setSale] = useState<SaleView | null>(null);
  const [undoArmed, setUndoArmed] = useState(false);
  const [pending, startTransition] = useTransition();

  const productId = preview.product.productId;
  const activeRows = preview.rows.filter((r) => !dropped.has(r.cardKey));
  const negatives = activeRows.filter((r) => r.flag === "would_go_negative");
  const adjustable = activeRows.filter((r) => r.flag === "ok" || r.flag === "would_go_negative");
  const flagged = activeRows.filter((r) => r.flag !== "ok");

  const reload = (qty: number) => {
    startTransition(async () => {
      setError("");
      setDeckChanged(false);
      const res = await previewSale(productId, qty);
      if (res.success === false) { setError(res.error); return; }
      setPreview(res.preview);
      setAck(false);
    });
  };

  const toggleDrop = (cardKey: string) => {
    setDropped((prev) => {
      const next = new Set(prev);
      if (next.has(cardKey)) next.delete(cardKey);
      else next.add(cardKey);
      return next;
    });
  };

  const confirm = () => {
    startTransition(async () => {
      setError("");
      setInProgress(null);
      const rows: SalePreviewRow[] = activeRows;
      const res = await confirmSale({
        productId,
        qty: preview.qty,
        deckId: preview.deckId,
        deckUpdatedAt: preview.deckUpdatedAt,
        rows,
        ackNegative: ack,
      });
      if (res.success === false) {
        if (res.code === "deck_changed") setDeckChanged(true);
        else if (res.code === "sale_in_progress") setInProgress(res.inProgress ?? { createdAt: "", createdByName: null });
        else setError(res.error);
        return;
      }
      if (res.dryRun === true) { setDryRunDone(res.saleId); return; }
      const applied = await applySale(res.saleId);
      if (applied.success === false) { setError(applied.error); return; }
      setSale(applied.sale);
    });
  };

  const resume = (saleId: string) => {
    startTransition(async () => {
      setError("");
      const res = await resumeSale(saleId);
      if (res.success === false) { setError(res.error); return; }
      setSale(res.sale);
    });
  };

  const retry = (cardKey: string, ackNeg: boolean) => {
    if (sale === null) return;
    startTransition(async () => {
      setError("");
      const res = await retrySaleItem(sale.id, cardKey, ackNeg);
      if (res.success === false) {
        if ("needsAck" in res && res.needsAck === true) {
          setError(`Retry for this row would go negative (${res.qtyBefore} to ${res.qtyAfter}). Click Retry again to acknowledge.`);
          return;
        }
        setError(res.error);
        return;
      }
      setSale(res.sale);
    });
  };

  const doUndo = () => {
    if (sale === null) return;
    startTransition(async () => {
      setError("");
      const res = await undoSale(sale.id);
      if (res.success === false) { setError(res.error); return; }
      setSale(res.sale);
      setUndoArmed(false);
    });
  };

  // ── Dry-run recorded ────────────────────────────────────────────────────
  if (dryRunDone !== null) {
    return (
      <div className="max-w-xl space-y-4">
        <h2 className="text-lg font-semibold">Dry-run sale recorded</h2>
        <div className="px-4 py-2 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-sm">
          Inventory writes are not enabled yet — this sale was recorded before inventory
          writes were enabled and was <strong>not applied</strong>. It cannot be replayed later.
        </div>
        <div className="flex gap-3">
          <Link href="/admin/ytg/decks"><Button>Back to deck products</Button></Link>
        </div>
      </div>
    );
  }

  // ── Results screen ──────────────────────────────────────────────────────
  if (sale !== null) {
    const troubled = sale.items.filter((i) => i.status === "error" || i.status === "conflict");
    const canUndo = sale.status === "applied" || sale.status === "partial";
    const isDryRun = sale.status === "dry_run";
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">
          Sale result — {preview.product.title} × {sale.qty}
        </h2>
        <div className="text-sm">
          Status: <span className="font-medium">{sale.status}</span>
          {" "}· recorded {fmtWhen(sale.createdAt)}
        </div>
        {sale.degraded === "scope_missing" && (
          <div className="px-4 py-2 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-sm">
            Shopify refused the inventory write: the <code>write_inventory</code> scope is not
            yet granted. The sale was parked as a dry-run and was not applied.
          </div>
        )}
        {error !== "" && (
          <div className="px-4 py-2 rounded-md bg-destructive/10 text-destructive text-sm">{error}</div>
        )}
        {sale.status === "applying" && (
          <div className="px-4 py-2 rounded-md bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 text-sm flex items-center gap-3">
            <span>Some items were in flight — reconcile against live inventory.</span>
            <Button size="sm" disabled={pending} onClick={() => resume(sale.id)}>Resume</Button>
          </div>
        )}
        <div className="rounded-lg bg-muted/30 divide-y divide-background">
          {sale.items.map((i) => (
            <div key={i.cardKey} className="px-3 py-2 flex items-center gap-3">
              <img src={getCardImageUrl(imgOf(i.cardKey))} alt="" className="w-7 h-10 rounded-sm object-cover shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm truncate">{i.cardName ?? i.cardKey}</div>
                <div className="text-xs text-muted-foreground">
                  {i.qtyPerDeck} per deck · delta {i.delta}
                  {i.qtyBefore !== null && i.qtyAfter !== null && (
                    <span> · {i.qtyBefore} to {i.qtyAfter}</span>
                  )}
                </div>
                {(i.status === "conflict" || i.status === "error" || i.status === "undo_conflict") && (
                  <div className="text-xs text-destructive mt-0.5">
                    {ITEM_EXPLAIN[i.status]}{i.error ? ` (${i.error})` : ""}
                  </div>
                )}
              </div>
              <span className={`px-1.5 py-0.5 rounded text-xs shrink-0 ${
                i.status === "applied" || i.status === "undone"
                  ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                  : i.status === "skipped_unmapped" || i.status === "skipped_untracked" || i.status === "pending"
                    ? "bg-muted text-muted-foreground"
                    : "bg-destructive/10 text-destructive"
              }`}>
                {i.status.replace(/_/g, " ")}
              </span>
              {(i.status === "error" || i.status === "conflict") && (
                <Button size="sm" variant="outline" disabled={pending}
                  onClick={() => retry(i.cardKey, error.includes("acknowledge"))}>
                  Retry
                </Button>
              )}
            </div>
          ))}
        </div>
        {troubled.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Retries are safe: each retry re-reads live inventory and uses a fresh
            compare-and-swap anchor plus an idempotency key.
          </p>
        )}
        <div className="flex items-center gap-3">
          {/* Undo is ABSENT (not disabled) on dry_run sales. */}
          {!isDryRun && canUndo && (
            undoArmed ? (
              <>
                <Button variant="destructive" disabled={pending} onClick={doUndo}>
                  Confirm undo — restore {sale.items.filter((i) => i.status === "applied").length} item quantities
                </Button>
                <Button variant="ghost" disabled={pending} onClick={() => setUndoArmed(false)}>Cancel</Button>
              </>
            ) : (
              <Button variant="outline" disabled={pending} onClick={() => setUndoArmed(true)}>
                Undo sale
              </Button>
            )
          )}
          <Link href="/admin/ytg/decks" className="ml-auto text-sm text-muted-foreground hover:underline">
            Back to deck products
          </Link>
        </div>
      </div>
    );
  }

  // ── Preview screen ──────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {preview.product.imageUrl && (
          <img src={preview.product.imageUrl} alt="" className="w-12 h-12 rounded object-cover" />
        )}
        <div className="min-w-0">
          <h2 className="text-lg font-semibold truncate">Record sale — {preview.product.title}</h2>
          <p className="text-sm text-muted-foreground">
            Preview reads live Shopify inventory (main + reserve zones, summed per card).
          </p>
        </div>
        <div className="ml-auto flex items-center rounded bg-muted shrink-0">
          <button type="button" className="px-3 py-1 text-sm" disabled={pending || preview.qty <= 1}
            onClick={() => reload(preview.qty - 1)}>−</button>
          <span className="px-2 text-sm tabular-nums">{preview.qty}</span>
          <button type="button" className="px-3 py-1 text-sm" disabled={pending}
            onClick={() => reload(preview.qty + 1)}>+</button>
        </div>
      </div>

      {preview.writesEnabled === false && (
        <div className="px-4 py-2 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-sm">
          Dry-run mode: the <code>write_inventory</code> scope is not enabled
          (<code>YTG_INVENTORY_WRITES</code> unset). Confirming records the sale in the
          ledger as a dry-run — no inventory moves, and dry-runs cannot be replayed later.
        </div>
      )}
      {preview.activeSale !== null && (
        <div className="px-4 py-2 rounded-md bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 text-sm flex items-center gap-3">
          <span>
            A sale for this product is {preview.activeSale.status}
            {preview.activeSale.createdByName ? ` (by ${preview.activeSale.createdByName})` : ""} since {fmtWhen(preview.activeSale.createdAt)}.
          </span>
          <Button size="sm" disabled={pending} onClick={() => resume(preview.activeSale!.id)}>
            Resume it
          </Button>
        </div>
      )}
      {preview.recentSale !== null && (
        <div className="px-4 py-2 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-sm">
          {preview.recentSale.createdByName ?? "Someone"} recorded a sale of this product
          {" "}{fmtWhen(preview.recentSale.createdAt)} (qty {preview.recentSale.qty}) — record another?
        </div>
      )}
      {inProgress !== null && (
        <div className="px-4 py-2 rounded-md bg-destructive/10 text-destructive text-sm">
          A sale is already being recorded for this product
          {inProgress.createdByName ? ` by ${inProgress.createdByName}` : ""}
          {inProgress.createdAt ? ` (started ${fmtWhen(inProgress.createdAt)})` : ""}.
          Wait for it to finish, or reload to resume it.
        </div>
      )}
      {deckChanged && (
        <div className="px-4 py-2 rounded-md bg-destructive/10 text-destructive text-sm flex items-center gap-3">
          <span>The deck changed since this preview — re-preview before recording.</span>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => reload(preview.qty)}>
            Re-preview
          </Button>
        </div>
      )}
      {error !== "" && (
        <div className="px-4 py-2 rounded-md bg-destructive/10 text-destructive text-sm">{error}</div>
      )}

      {flagged.length > 0 && (
        <div className="px-4 py-2 rounded-md bg-muted/50 text-sm space-y-1">
          <div className="font-medium">{flagged.length} flagged row{flagged.length === 1 ? "" : "s"}</div>
          {flagged.some((r) => r.flag === "unmapped") && (
            <div>
              Unmapped cards will be recorded as skipped.{" "}
              <Link className="underline" href="/admin/ytg/matching">Fix in Matching</Link>
            </div>
          )}
          {flagged.some((r) => r.flag === "untracked") && (
            <div>Untracked variants will be recorded as skipped (Shopify does not track their inventory).</div>
          )}
          {negatives.length > 0 && (
            <div className="text-destructive">
              {negatives.length} row{negatives.length === 1 ? "" : "s"} would drive inventory negative.
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg bg-muted/30 divide-y divide-background">
        {preview.rows.map((r) => {
          const isDropped = dropped.has(r.cardKey);
          const badge = FLAG_BADGE[r.flag];
          return (
            <div key={r.cardKey} className={`px-3 py-2 flex items-center gap-3 ${isDropped ? "opacity-40" : ""}`}>
              <img src={getCardImageUrl(imgOf(r.cardKey))} alt="" className="w-7 h-10 rounded-sm object-cover shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm truncate">{r.cardName}</div>
                <div className="text-xs text-muted-foreground">
                  {r.qtyPerDeck} per deck · delta {r.delta}
                  {r.qtyBefore !== null && r.qtyAfter !== null && (
                    <span> · {r.qtyBefore} to <span className={r.qtyAfter < 0 ? "text-destructive font-medium" : ""}>{r.qtyAfter}</span></span>
                  )}
                </div>
              </div>
              <span className={`px-1.5 py-0.5 rounded text-xs shrink-0 ${badge.cls}`}>{badge.label}</span>
              <button type="button" className="text-xs text-muted-foreground underline shrink-0"
                onClick={() => toggleDrop(r.cardKey)}>
                {isDropped ? "restore" : "drop"}
              </button>
            </div>
          );
        })}
      </div>

      {negatives.length > 0 && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          I understand {negatives.length} row{negatives.length === 1 ? "" : "s"} will drive
          available inventory negative in Shopify.
        </label>
      )}

      <div className="flex items-center gap-3">
        <Button
          disabled={pending || adjustable.length === 0 || (negatives.length > 0 && !ack) || preview.activeSale !== null}
          onClick={confirm}
        >
          {pending
            ? "Working…"
            : preview.writesEnabled === false
              ? `Record dry-run sale (${adjustable.length} adjustable rows)`
              : `Confirm sale — decrement ${adjustable.length} singles`}
        </Button>
        {adjustable.length === 0 && (
          <span className="text-sm text-muted-foreground">Nothing adjustable — every row is flagged or dropped.</span>
        )}
        <Link href="/admin/ytg/decks" className="ml-auto text-sm text-muted-foreground hover:underline">
          Cancel
        </Link>
      </div>
    </div>
  );
}
