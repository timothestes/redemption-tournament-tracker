import { Suspense } from "react";
import TopNav from "@/components/top-nav";
import SponsorFooter from "@/components/sponsor-footer";
import HistoryClient from "./HistoryClient";

export const metadata = {
  title: "Nationals History | Redemption CCG",
  description:
    "Complete history of Redemption Nationals tournaments: champions, players, stats, and trivia.",
};

export default function Page() {
  return (
    <div className="flex flex-col min-h-screen">
      <TopNav />
      <div className="flex-1">
        <Suspense fallback={null}>
          <HistoryClient />
        </Suspense>
      </div>
      <SponsorFooter />
    </div>
  );
}
