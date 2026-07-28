import Link from "next/link";
import TopNav from "@/components/top-nav";
import SponsorFooter from "@/components/sponsor-footer";
import { loadPublicResultsIndexAction } from "../actions";

export const metadata = {
  title: "Tournament Results | Redemption CCG",
  description: "Browse published standings and decklists from past Redemption CCG tournaments.",
};

export default async function TournamentResultsIndexPage() {
  const result = await loadPublicResultsIndexAction();
  const events = result.success ? result.events : [];

  return (
    <div className="flex flex-col min-h-screen">
      <TopNav />
      <main className="flex-1 max-w-3xl mx-auto px-4 pt-8 pb-16 w-full">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Tournament Results
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Published standings from completed tournaments.
        </p>

        <div className="mt-6 space-y-2">
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No published results yet.</p>
          ) : (
            events.map((e) => (
              <Link
                key={e.id}
                href={`/tournaments/results/${e.id}`}
                className="block border border-border rounded-lg bg-card/80 backdrop-blur-sm hover:bg-card/90 transition-colors px-4 py-3"
              >
                <span className="text-sm font-medium text-foreground">{e.name}</span>
                <span className="text-sm text-muted-foreground">
                  {" "}
                  — {e.playerCount} player{e.playerCount !== 1 ? "s" : ""}
                </span>
              </Link>
            ))
          )}
        </div>
      </main>
      <SponsorFooter />
    </div>
  );
}
