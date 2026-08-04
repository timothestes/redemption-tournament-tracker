"use client";

import { useState } from "react";
import type { CollisionEntry } from "./actions";

/**
 * First-run reconciliation surface, shown as a collapsed warning panel above
 * the diff whenever collisions exist (locked design decision: panel, not a
 * hard gate — acknowledgment is this session's expand/collapse state only).
 * Removals of these tag names are per-tag opt-in in the rollup anyway, and
 * the sync never edits products without confirmed mappings.
 */
export default function CollisionPanel({ collisions }: { collisions: CollisionEntry[] }) {
  const [open, setOpen] = useState(false);
  if (collisions.length === 0) return null;
  const total = collisions.reduce((sum, c) => sum + c.productCount, 0);

  return (
    <div className="rounded-lg bg-amber-50 p-4 dark:bg-amber-950/40">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 text-left outline-none"
      >
        <span className="text-sm font-medium text-amber-900 dark:text-amber-200">
          {collisions.length} managed tag name{collisions.length === 1 ? "" : "s"} also appear
          {collisions.length === 1 ? "s" : ""} on {total.toLocaleString()} non-card product
          {total === 1 ? "" : "s"}
        </span>
        <span className="shrink-0 text-xs text-amber-700 dark:text-amber-300">
          {open ? "Hide" : "Details"}
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-300">
            These tag names collide with tags hand-added for merchandising on products that have
            no confirmed card mapping (e.g. brigade names like Gold or Silver used as product
            labels). This sync never edits those products — it only touches products with
            confirmed card mappings — and removing any of these tag names from mapped products
            is per-tag opt-in below. Leave a colliding tag unchecked to leave it alone everywhere.
          </p>
          <ul className="space-y-1.5 text-xs text-amber-900 dark:text-amber-200">
            {collisions.map((c) => (
              <li key={c.tag} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold">{c.tag}</span>
                <span>
                  on {c.productCount.toLocaleString()} unmapped product{c.productCount === 1 ? "" : "s"}
                </span>
                <span className="text-amber-700 dark:text-amber-400">
                  e.g. {c.sampleTitles.join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
