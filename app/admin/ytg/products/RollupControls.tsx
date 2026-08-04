"use client";

import { Checkbox } from "@/components/ui/checkbox";
import type { TagRollupEntry } from "@/lib/shopify/tagDiff";

interface RollupControlsProps {
  rollup: TagRollupEntry[];
  selectedAddTags: Set<string>;
  selectedRemoveTags: Set<string>;
  onToggleAdd: (tag: string) => void;
  onToggleRemove: (tag: string) => void;
  onSelectAllAdds: () => void;
  onClearAdds: () => void;
  disabled: boolean;
}

/**
 * Roll-up summary + selection controls. Additive writes are safe → additions
 * get select-all. Subtractive writes are where hand-added data dies → each
 * removal tag is an individual opt-in with NO select-all (spec-locked).
 */
export default function RollupControls({
  rollup,
  selectedAddTags,
  selectedRemoveTags,
  onToggleAdd,
  onToggleRemove,
  onSelectAllAdds,
  onClearAdds,
  disabled,
}: RollupControlsProps) {
  const adds = rollup.filter((r) => r.addCount > 0);
  const removes = rollup.filter((r) => r.removeCount > 0);

  return (
    <div className="space-y-3">
      {adds.length > 0 && (
        <div className="rounded-lg bg-muted/50 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Additions
            </h3>
            <div className="flex gap-3 text-xs">
              <button
                type="button"
                onClick={onSelectAllAdds}
                disabled={disabled}
                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={onClearAdds}
                disabled={disabled}
                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                None
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {adds.map((r) => (
              <label
                key={`add-${r.tag}`}
                className="flex cursor-pointer items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
              >
                <Checkbox
                  checked={selectedAddTags.has(r.tag)}
                  onCheckedChange={() => onToggleAdd(r.tag)}
                  disabled={disabled}
                  className="h-3.5 w-3.5"
                />
                + {r.tag} on {r.addCount.toLocaleString()}
              </label>
            ))}
          </div>
        </div>
      )}
      {removes.length > 0 && (
        <div className="rounded-lg bg-muted/50 p-3">
          <div className="mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Removals — opt in per tag
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Unchecked tags are excluded from every product. There is no select-all for removals.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {removes.map((r) => (
              <label
                key={`rem-${r.tag}`}
                className="flex cursor-pointer items-center gap-1.5 rounded-full bg-red-100 px-3 py-1 text-xs text-red-900 dark:bg-red-950 dark:text-red-200"
              >
                <Checkbox
                  checked={selectedRemoveTags.has(r.tag)}
                  onCheckedChange={() => onToggleRemove(r.tag)}
                  disabled={disabled}
                  className="h-3.5 w-3.5"
                />
                − {r.tag} on {r.removeCount.toLocaleString()}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
