import TopNav from "@/components/top-nav";
import SponsorFooter from "@/components/sponsor-footer";
import { loadUpcomingListings } from "./actions";
import TournamentsClient from "./tournaments-client";

export const metadata = {
  title: "Upcoming Tournaments | Redemption CCG",
  description:
    "Find upcoming Redemption card game tournaments near you. Browse dates, locations, formats, and entry fees.",
};

export default async function TournamentsPage() {
  const listings = await loadUpcomingListings();

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <TopNav />
      <div className="flex-1">
        <TournamentsClient listings={listings} />
      </div>
      <SponsorFooter />
    </div>
  );
}
