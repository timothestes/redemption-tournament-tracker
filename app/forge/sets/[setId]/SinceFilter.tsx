"use client";

import type { ReactNode } from "react";
import { toDateInputValue } from "@/app/forge/lib/setCommentsView";

// The filter row shared by the Comments and Review tabs: a date cutoff, a
// jump to whatever arrived since your last visit, and a shown-of-total count.
// `children` holds the per-tab control (unresolved-only, proposals/suggestions).
export default function SinceFilter({
  since,
  onSince,
  shown,
  total,
  newCount,
  lastVisit,
  dateLabel,
  children,
}: {
  since: string;
  onSince: (value: string) => void;
  shown: number;
  total: number;
  newCount: number;
  lastVisit: number | null;
  dateLabel: string;
  children?: ReactNode;
}) {
  const lastVisitDate = lastVisit === null ? null : toDateInputValue(lastVisit);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Since
        <input
          type="date"
          value={since}
          onChange={(e) => onSince(e.target.value)}
          aria-label={dateLabel}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        />
      </label>
      {children}
      {newCount > 0 && lastVisitDate !== null && since !== lastVisitDate && (
        <button
          onClick={() => onSince(lastVisitDate)}
          className="rounded-full border px-2 py-0.5 text-[11px] font-medium text-foreground hover:border-primary/50 hover:text-primary"
        >
          {newCount} new since your last visit
        </button>
      )}
      {since !== "" && (
        <button
          onClick={() => onSince("")}
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          All time
        </button>
      )}
      <span className="text-xs text-muted-foreground">
        {shown} of {total}
      </span>
    </div>
  );
}
