import HeaderServer from "../../components/header-server";
import TopNav from "../../components/top-nav";
import SponsorFooter from "../../components/sponsor-footer";
import { Suspense } from "react";

export default function DecklistLayout({ children }) {

  return (
    <div className="flex flex-col min-h-screen">
      <TopNav />
      <div className="flex-1 flex flex-col">
        <Suspense fallback={null}>
          <HeaderServer />
        </Suspense>
        <main className="flex-1">
          {children}
        </main>
      </div>
      <SponsorFooter />
    </div>
  );
}