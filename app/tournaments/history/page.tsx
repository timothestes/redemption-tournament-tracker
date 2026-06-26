import { Suspense } from "react";
import TopNav from "@/components/top-nav";
import SponsorFooter from "@/components/sponsor-footer";
import HistoryClient from "./HistoryClient";
import { loadLeaderboard } from "./actions";

export const metadata = {
  title: "Nationals History | Redemption CCG",
  description:
    "Complete history of Redemption Nationals tournaments: champions, players, stats, and trivia.",
};

export default async function Page() {
  const initialLeaderboard = await loadLeaderboard();
  return (
    <div className="flex flex-col min-h-screen">
      <TopNav />
      <div className="flex-1">
        <Suspense fallback={null}>
          <HistoryClient initialLeaderboard={initialLeaderboard} />
        </Suspense>
      </div>
      <SponsorFooter />
    </div>
  );
}
