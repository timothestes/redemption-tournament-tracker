import { notFound } from "next/navigation";
import TopNav from "@/components/top-nav";
import { hasPermission } from "@/utils/adminUtils";
import HealthStrip from "./components/HealthStrip";
import YtgTabs from "./components/YtgTabs";

export const metadata = { title: "YTG Store" };
export const dynamic = "force-dynamic";

// Shared shell for every /admin/ytg tab. Per the WS plan set: WS-1/2/3 own
// ONLY their tab directory — this file, YtgTabs, and HealthStrip belong to
// WS-0 and are not edited by other workstreams. Layout gating does NOT
// protect server actions or API routes: every action/route re-checks
// hasPermission itself.
export default async function YtgLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server gate, /admin/permissions precedent: 404 (not 403) keeps the
  // area invisible to anyone without manage_shopify_imports.
  if (!(await hasPermission("manage_shopify_imports"))) notFound();

  return (
    <div className="flex flex-col min-h-screen">
      <TopNav />
      <div className="flex-1 w-full overflow-auto px-5">
        <div className="max-w-7xl mx-auto py-8">
          <h1 className="text-3xl font-bold mb-1">YTG Store</h1>
          <p className="text-muted-foreground mb-4">
            Import, reconcile, and manage the Your Turn Games Shopify store.
          </p>
          <HealthStrip />
          <YtgTabs />
          {children}
        </div>
      </div>
    </div>
  );
}
