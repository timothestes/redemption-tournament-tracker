import type { ReactNode } from "react";
import Link from "next/link";
import ForgeCardFace from "@/app/forge/components/ForgeCardFace";
import { cardRawText } from "@/app/forge/lib/designCard";
import { STATUS_LABEL, STATUS_BADGE_CLASS } from "@/app/forge/lib/lifecycleCopy";
import type { ForgeCardFull } from "@/app/forge/lib/cards";

export type GridSelection = {
  active: boolean;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
};

export default function ForgeCardGrid({
  cards, showStatus = false, selection, leading,
}: {
  cards: ForgeCardFull[];
  showStatus?: boolean;
  selection?: GridSelection;
  leading?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {leading}
      {cards.map((c) => {
        const t = Date.parse(c.updatedAt) || 0;
        const inner = (
          <>
            <ForgeCardFace
              name={c.snapshot.name ?? null}
              rawText={cardRawText(c.snapshot)}
              finishedUrl={c.hasFinished ? `/forge/api/art/${c.id}?kind=finished&t=${t}` : null}
              artUrl={c.hasArt ? `/forge/api/art/${c.id}?t=${t}` : null}
            />
            <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
              <p className="min-w-[6rem] flex-1 truncate text-xs text-muted-foreground">{c.title ?? "Untitled"}</p>
              {showStatus && (
                <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] ${STATUS_BADGE_CLASS[c.status] ?? "text-muted-foreground"}`}>
                  {STATUS_LABEL[c.status] ?? c.status}
                </span>
              )}
            </div>
          </>
        );
        if (selection?.active) {
          const isSel = selection.selected.has(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => selection.onToggle(c.id)}
              aria-pressed={isSel}
              className="relative block text-left transition hover:opacity-90"
            >
              <span
                aria-hidden
                className={`absolute left-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-md border-2 text-sm font-bold shadow-md ${
                  isSel ? "border-primary bg-primary text-primary-foreground" : "border-gray-400 bg-white text-transparent"
                }`}
              >
                {isSel ? "✓" : ""}
              </span>
              {isSel && (
                <span aria-hidden className="pointer-events-none absolute -inset-0.5 rounded-lg border border-primary/40" />
              )}
              {inner}
            </button>
          );
        }
        return (
          <Link key={c.id} href={`/forge/cards/${c.id}`} className="block transition hover:opacity-90">
            {inner}
          </Link>
        );
      })}
    </div>
  );
}
