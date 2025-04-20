"use client";

import { useEffect, useState } from "react";
import Header from "../../components/header";
import SideNav from "../../components/side-nav";
import { createClient } from "../../utils/supabase/client";
import { useRouter } from "next/navigation";

const supabase = createClient();

export default function DecklistLayout({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setIsAuthenticated(!!session);
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(!!session);
    });

    checkAuth();

    return () => subscription.unsubscribe();
  }, []);

  return (
    <>
      {isAuthenticated && <SideNav />}
      <div className="flex-1 w-full overflow-hidden flex flex-col gap-9 items-center">
        <Header />
        <div className="flex flex-col w-full">
          <div className="w-full flex">{children}</div>
        </div>
      </div>
    </>
  );
}