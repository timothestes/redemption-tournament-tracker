"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { undoSale } from "./saleActions";
import type { SaleHistoryRow } from "./saleActions";

const fmtWhen = (iso: string) => new Date(iso).toLocaleString();

const STATUS_CLS: Record<string, string> = {
  applied: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  partial: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  failed: "bg-destructive/10 text-destructive",
  pending: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  applying: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  undoing: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  undone: "bg-muted text-muted-foreground",
  undo_partial: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  dry_run: "bg-muted text-muted-foreground",
};

function Row({ s, onUndo, pending }: { s: SaleHistoryRow; onUndo: ((id: string) => void) | null; pending: boolean }) {
  const [armed, setArmed] = useState(false);
  const stuck = s.status === "pending" || s.status === "applying";
  return (
    <div className="px-3 py-2 flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm truncate">
          {s.productTitle} <span className="text-muted-foreground">× {s.qty}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {fmtWhen(s.createdAt)}{s.createdByName ? ` · by ${s.createdByName}` : ""}
          {" "}· {s.appliedCount}/{s.totalItems} items applied
          {s.skippedCount > 0 ? `, ${s.skippedCount} skipped` : ""}
          {s.troubleCount > 0 ? `, ${s.troubleCount} need attention` : ""}
          {s.undoneAt ? ` · undone ${fmtWhen(s.undoneAt)}${s.undoneByName ? ` by ${s.undoneByName}` : ""}` : ""}
        </div>
      </div>
      <span className={`px-1.5 py-0.5 rounded text-xs shrink-0 ${STATUS_CLS[s.status] ?? "bg-muted"}`}>
        {s.status.replace(/_/g, " ")}
      </span>
      {stuck && (
        <Link className="text-sm hover:underline shrink-0" href={`/admin/ytg/decks/${s.productId}/sale`}>
          Resume
        </Link>
      )}
      {/* Undo appears only where eligible; it is ABSENT on dry_run rows. */}
      {onUndo !== null && (s.status === "applied" || s.status === "partial") && (
        armed ? (
          <>
            <Button size="sm" variant="destructive" disabled={pending} onClick={() => onUndo(s.id)}>
              Confirm undo
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setArmed(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setArmed(true)}>
            Undo
          </Button>
        )
      )}
    </div>
  );
}

export default function SalesHistory({
  sales, writesEnabled, loadError,
}: {
  sales: SaleHistoryRow[]; writesEnabled: boolean; loadError: string;
}) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const doUndo = (saleId: string) => {
    startTransition(async () => {
      const res = await undoSale(saleId);
      if (res.success === false) setError(res.error);
      else { setError(""); router.refresh(); }
    });
  };

  const dryRuns = sales.filter((s) => s.status === "dry_run");
  const real = sales.filter((s) => s.status !== "dry_run");

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Sales history</h2>
      {loadError !== "" && (
        <div className="px-4 py-2 rounded-md bg-destructive/10 text-destructive text-sm">{loadError}</div>
      )}
      {error !== "" && (
        <div className="px-4 py-2 rounded-md bg-destructive/10 text-destructive text-sm">{error}</div>
      )}
      {sales.length === 0 && loadError === "" && (
        <p className="text-sm text-muted-foreground">
          No sales recorded yet. Record one from a linked deck product above.
        </p>
      )}
      {real.length > 0 && (
        <div className="rounded-lg bg-muted/30 divide-y divide-background">
          {real.map((s) => (
            <Row key={s.id} s={s} pending={pending} onUndo={writesEnabled ? doUndo : null} />
          ))}
        </div>
      )}
      {dryRuns.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Dry runs — recorded before inventory writes were enabled — not applied
          </div>
          <div className="rounded-lg bg-muted/20 divide-y divide-background opacity-75">
            {dryRuns.map((s) => (
              <Row key={s.id} s={s} pending={pending} onUndo={null} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
