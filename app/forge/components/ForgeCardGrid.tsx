import Link from "next/link";
import ForgeCardPreview from "@/app/forge/components/ForgeCardPreview";
import type { ForgeCardFull } from "@/app/forge/lib/cards";

const STATUS_LABEL: Record<string, string> = {
  private_idea: "Idea", draft: "Draft", playtesting: "Playtesting",
  approved: "Approved", archived: "Archived",
};

export default function ForgeCardGrid({ cards, showStatus = false }: { cards: ForgeCardFull[]; showStatus?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {cards.map((c) => (
        <Link key={c.id} href={`/forge/cards/${c.id}`} className="block transition hover:opacity-90">
          <ForgeCardPreview card={c.snapshot} artUrl={c.hasArt ? `/forge/api/art/${c.id}` : null} />
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="truncate text-xs text-muted-foreground">{c.title ?? "Untitled"}</p>
            {showStatus && (
              <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {STATUS_LABEL[c.status] ?? c.status}
              </span>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
