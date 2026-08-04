"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { TagDiffRow } from "@/lib/shopify/tagDiff";

const PAGE = 250; // incremental rendering — an all-store diff can exceed 2,000 rows

interface DiffTableProps {
  rows: TagDiffRow[];
  selectedAddTags: Set<string>;
  selectedRemoveTags: Set<string>;
  excludedRows: Set<string>;
  onToggleRow: (productId: string) => void;
  disabled: boolean;
}

export default function DiffTable({
  rows,
  selectedAddTags,
  selectedRemoveTags,
  excludedRows,
  onToggleRow,
  disabled,
}: DiffTableProps) {
  const [visible, setVisible] = useState(PAGE);
  const shown = rows.slice(0, visible);

  return (
    <div>
      <div className="space-y-px">
        {shown.map((row) => {
          const included = !excludedRows.has(row.productId);
          return (
            <div
              key={row.productId}
              className={`flex flex-col gap-2 rounded-md bg-card px-3 py-2 sm:flex-row sm:items-center ${included ? "" : "opacity-40"}`}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Checkbox
                  checked={included}
                  onCheckedChange={() => onToggleRow(row.productId)}
                  disabled={disabled}
                  aria-label={`Include ${row.title}`}
                />
                <div className="min-w-0">
                  <div className="truncate text-sm">{row.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{row.handle}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1 sm:max-w-[55%] sm:justify-end">
                {row.add.map((tag) => (
                  <span
                    key={`a-${tag}`}
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      selectedAddTags.has(tag)
                        ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                        : "bg-muted text-muted-foreground line-through"
                    }`}
                  >
                    +{tag}
                  </span>
                ))}
                {row.remove.map((tag) => (
                  <span
                    key={`r-${tag}`}
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      selectedRemoveTags.has(tag)
                        ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
                        : "bg-muted text-muted-foreground line-through"
                    }`}
                  >
                    −{tag}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {rows.length > visible && (
        <button
          type="button"
          onClick={() => setVisible(visible + PAGE)}
          className="mt-2 w-full rounded-md bg-muted py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          Show {Math.min(PAGE, rows.length - visible).toLocaleString()} more (
          {(rows.length - visible).toLocaleString()} remaining)
        </button>
      )}
    </div>
  );
}
