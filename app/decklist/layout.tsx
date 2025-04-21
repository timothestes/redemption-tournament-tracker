import HeaderServer from "../../components/header-server";
import SideNav from "../../components/side-nav";
import { createClient } from "../../utils/supabase/server";
import { Suspense } from "react";

export default async function DecklistLayout({ children }) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const isAuthenticated = !!session;

  return (
    <div className="flex">
      {isAuthenticated && <SideNav />}
      <main className="flex-1 min-h-screen flex flex-col">
        <Suspense fallback={null}>
          <HeaderServer />
        </Suspense>
        <div className="flex-1 p-4">
          {children}
        </div>
      </main>
    </div>
  );
}