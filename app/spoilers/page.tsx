import TopNav from "../../components/top-nav";
import { loadPublicSpoilersAction } from "./actions";
import SpoilersClient from "./spoilers-client";

export default async function SpoilersPage() {
  const { spoilers } = await loadPublicSpoilersAction();

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <SpoilersClient initialSpoilers={spoilers} />
    </div>
  );
}
