import HeaderServer from "../../components/header-server";
import SideNav from "../../components/side-nav";
import { createClient } from "../../utils/supabase/server";

export default async function DecklistLayout({ children }) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const isAuthenticated = !!session;

  return (
    <>
      {isAuthenticated && <SideNav />}
      <div className="flex-1 w-full overflow-hidden flex flex-col gap-9 items-center">
        <HeaderServer />
        <div className="flex flex-col w-full">
          <div className="w-full flex">{children}</div>
        </div>
      </div>
    </>
  );
}