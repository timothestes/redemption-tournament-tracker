import Link from "next/link";
import type { ReviewQueueItem } from "@/app/forge/lib/review";

export default function ReviewQueue({ items }: { items: ReviewQueueItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing needs review right now.</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.cardId}>
          <Link
            href={`/forge/cards/${i.cardId}`}
            className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted/50"
          >
            <span className="font-medium">{i.title ?? "Untitled card"}</span>
            <span className="flex gap-2 text-xs text-muted-foreground">
              {i.openProposals > 0 && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
                  {i.openProposals} proposal{i.openProposals === 1 ? "" : "s"}
                </span>
              )}
              {i.openSuggestions > 0 && (
                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-800">
                  {i.openSuggestions} suggestion{i.openSuggestions === 1 ? "" : "s"}
                </span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
