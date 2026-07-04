import Link from "next/link";
import ForgeCardFace from "@/app/forge/components/ForgeCardFace";
import { cardRawText } from "@/app/forge/lib/designCard";
import { STATUS_LABEL } from "@/app/forge/lib/lifecycleCopy";
import type { ForgeCardFull } from "@/app/forge/lib/cards";

export default function ForgeCardGrid({ cards, showStatus = false }: { cards: ForgeCardFull[]; showStatus?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {cards.map((c) => {
        const t = Date.parse(c.updatedAt) || 0;
        return (
          <Link key={c.id} href={`/forge/cards/${c.id}`} className="block transition hover:opacity-90">
            <ForgeCardFace
              name={c.snapshot.name ?? null}
              rawText={cardRawText(c.snapshot)}
              finishedUrl={c.hasFinished ? `/forge/api/art/${c.id}?kind=finished&t=${t}` : null}
              artUrl={c.hasArt ? `/forge/api/art/${c.id}?t=${t}` : null}
            />
            <div className="mt-1 flex items-center justify-between gap-2">
              <p className="truncate text-xs text-muted-foreground">{c.title ?? "Untitled"}</p>
              {showStatus && (
                <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {STATUS_LABEL[c.status] ?? c.status}
                </span>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
