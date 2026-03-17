import TopNav from "../../components/top-nav";
import SponsorFooter from "../../components/sponsor-footer";
import { loadPublicSpoilersAction } from "./actions";
import SpoilersClient from "./spoilers-client";

export default async function SpoilersPage() {
  const { spoilers } = await loadPublicSpoilersAction();

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <TopNav />
      <div className="flex-1">
        <SpoilersClient initialSpoilers={spoilers} />
      </div>
      <SponsorFooter />
    </div>
  );
}
