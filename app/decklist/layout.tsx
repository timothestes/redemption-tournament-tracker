import HeaderServer from "../../components/header-server";
import TopNav from "../../components/top-nav";
import { createClient } from "../../utils/supabase/server";
import { Suspense } from "react";

export default async function DecklistLayout({ children }) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const isAuthenticated = !!session;

  return (
    <div className="flex flex-col min-h-screen">
      <TopNav />
      <div className="flex-1 flex flex-col">
        <Suspense fallback={null}>
          <HeaderServer />
        </Suspense>
        <main className="flex-1 p-4">
          {children}
        </main>
      </div>
    </div>
  );
}