"use client";

import Link from "next/link";
import type { ProgressModel, TargetCounts } from "@/app/forge/lib/progress";
import type { SetElder } from "@/app/forge/lib/sets";
import TargetsEditor from "./TargetsEditor";
import SetEldersPanel from "./SetEldersPanel";

const STATUS_ORDER = ["draft", "playtesting", "approved"];
const STATUS_COLOR: Record<string, string> = { draft: "bg-zinc-400", playtesting: "bg-amber-500", approved: "bg-emerald-600" };

function cellTone(actual: number, target: number): string {
  if (target === 0) return actual > 0 ? "bg-emerald-50 dark:bg-emerald-950" : "";
  if (actual >= target) return "bg-emerald-200 dark:bg-emerald-900";
  if (actual === 0) return "bg-muted";
  return "bg-amber-100 dark:bg-amber-950";
}

export default function ProgressDashboard({
  setId, model, targets, elders, addable, canEdit, hasApprovedArt,
}: {
  setId: string; model: ProgressModel; targets: TargetCounts; elders: SetElder[];
  addable: { userId: string; displayName: string | null }[]; canEdit: boolean; hasApprovedArt: boolean;
}) {
  const live = model.headline.actual;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-3xl font-semibold tabular-nums">
            {model.headline.actual}{model.headline.target ? <span className="text-muted-foreground"> / {model.headline.target}</span> : null}
            {model.headline.target ? <span className="ml-2 text-base text-muted-foreground">· {model.headline.pct}%</span> : null}
          </div>
          <p className="text-xs text-muted-foreground">cards in set</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {hasApprovedArt ? (
            <a
              href={`/forge/api/sets/${setId}/artwork`}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
            >
              Download artwork (ZIP)
            </a>
          ) : (
            <span
              className="cursor-not-allowed rounded-md border px-3 py-1.5 text-sm text-muted-foreground opacity-50"
              title="Approve cards with art to enable"
              aria-disabled="true"
            >
              Download artwork (ZIP)
            </span>
          )}
          {canEdit && <TargetsEditor setId={setId} initial={targets} />}
        </div>
      </div>

      {/* status breakdown bar */}
      {live > 0 && (
        <div>
          <div className="flex h-3 overflow-hidden rounded-full border">
            {STATUS_ORDER.map((s) => {
              const n = model.byStatus[s] ?? 0;
              return n > 0 ? <div key={s} className={STATUS_COLOR[s]} style={{ width: `${(n / live) * 100}%` }} /> : null;
            })}
          </div>
          <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
            {STATUS_ORDER.map((s) => <span key={s}>{s}: {model.byStatus[s] ?? 0}</span>)}
          </div>
        </div>
      )}

      {/* brigade × card-type heatmap */}
      {model.types.length > 0 && (
        <div className="overflow-x-auto">
          <table className="border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 bg-background p-1 text-left">Type \ Brigade</th>
                {model.brigades.map((b) => <th key={b} className="p-1 font-normal">{b}</th>)}
              </tr>
            </thead>
            <tbody>
              {model.types.map((t) => (
                <tr key={t}>
                  <th className="sticky left-0 bg-background p-1 text-left font-normal">{t}</th>
                  {model.brigades.map((b) => {
                    const cell = model.cells.find((c) => c.type === t && c.brigade === b)!;
                    return (
                      <td key={b} className={`p-1 text-center ${cellTone(cell.actual, cell.target)}`}>
                        <Link href={`/forge/sets/${setId}/cards`} className="block tabular-nums">
                          {cell.actual}{cell.target ? `/${cell.target}` : ""}
                        </Link>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* what's-left checklist */}
      {model.checklist.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-medium">What&apos;s left</p>
          <ul className="space-y-0.5 text-sm text-muted-foreground">
            {model.checklist.map((c) => (
              <li key={`${c.type}-${c.brigade}`}>
                {c.remaining} more {c.brigade === "none" ? "" : `${c.brigade} `}{c.type}
              </li>
            ))}
          </ul>
        </div>
      )}

      {canEdit && <SetEldersPanel setId={setId} elders={elders} addable={addable} />}
    </div>
  );
}
