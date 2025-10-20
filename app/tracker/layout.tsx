import HeaderServer from "../../components/header-server";
import TopNav from "../../components/top-nav";
import { createClient } from "../../utils/supabase/server";

export default async function TournamentsLayout({ children }) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const isAuthenticated = !!session;

  return (
    <div className="flex flex-col min-h-screen">
      {isAuthenticated && <TopNav />}
      <div className="flex-1 flex flex-col">
        <HeaderServer />
        <main className="flex-1 p-4">
          {children}
        </main>
      </div>
    </div>
  );
}
