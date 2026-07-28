import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import TopNav from "@/components/top-nav";
import SponsorFooter from "@/components/sponsor-footer";
import { loadPublicResultsAction } from "../../actions";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const result = await loadPublicResultsAction(id);

  if (result.success !== true) {
    return { title: "Results Not Found" };
  }

  return { title: `${result.name} - Results | Redemption CCG` };
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function formatEndedAt(endedAt: string | null): string | null {
  if (!endedAt) return null;
  return new Date(endedAt).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function TournamentResultsPage({ params }: PageProps) {
  const { id } = await params;
  const result = await loadPublicResultsAction(id);

  if (result.success !== true) {
    notFound();
  }

  const dateLabel = formatEndedAt(result.endedAt);

  return (
    <div className="flex flex-col min-h-screen">
      <TopNav />
      <main className="flex-1 max-w-3xl mx-auto px-4 pt-8 pb-16 w-full">
        <div className="mb-6">
          <h1 className="font-cinzel text-2xl font-bold text-foreground">{result.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {dateLabel && <span>{dateLabel}</span>}
            {result.category && (
              <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-semibold tracking-wide text-muted-foreground">
                {result.category}
              </span>
            )}
            {result.deckFormat && (
              <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-semibold tracking-wide text-muted-foreground">
                {result.deckFormat}
              </span>
            )}
          </div>
        </div>

        {result.standings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No standings recorded.</p>
        ) : (
          <div className="rounded-lg border border-border bg-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Place
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Player
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Points
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Diff
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Decklist
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.standings.map((row, i) => (
                  <tr key={i} className="border-b border-border last:border-0 odd:bg-muted/40">
                    <td className="px-4 py-2.5 font-medium text-foreground">
                      {row.place !== null ? ordinal(row.place) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-foreground">{row.name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {row.matchPoints ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {row.differential ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      {row.publishedDeckId ? (
                        <Link
                          href={`/decklist/${row.publishedDeckId}`}
                          className="text-foreground underline underline-offset-2 hover:text-primary transition-colors"
                        >
                          View
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
      <SponsorFooter />
    </div>
  );
}
