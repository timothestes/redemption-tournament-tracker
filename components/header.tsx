"use client";

import { useEffect, useState } from "react";
import { createClient } from "../utils/supabase/client";
import { hasEnvVars } from "../utils/supabase/check-env-vars";
import { EnvVarWarning } from "./env-var-warning";
import Link from "next/link";
import { Button } from "./ui/button";
import { signOutAction } from "../app/actions";

export default function Header() {
  const [user, setUser] = useState(null);
  const supabase = createClient();

  useEffect(() => {
    const getUser = async () => {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      setUser(currentUser);
    };

    getUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <nav className="w-full flex justify-center border-b border-b-foreground/10 h-17">
      <div className="w-full max-w-1xl flex justify-between items-center p-3 px-5 text-sm">
        <div className="flex gap-5 items-center font-semibold">
          <div className="flex items-center">
            <img src="/lor.png" className="w-48" alt="Land of Redemption Logo" />
          </div>
        </div>
        {!hasEnvVars ? <EnvVarWarning /> : (
          <div className="flex justify-end">
            {user ? (
              <div className="flex items-center gap-4">
                <div className="max-w-12:block hidden">Hey, {user.email}!</div>
                <form
                  // @ts-ignore This is needed because the form action type is not properly inferred
                  action={signOutAction}
                >
                  <Button type="submit" variant="outline">
                    Sign out
                  </Button>
                </form>
              </div>
            ) : (
              <div className="flex gap-3">
                <Link 
                  href="/tracker/tournaments"
                  className="bg-zinc-600/80 hover:bg-zinc-500/80 text-white px-6 py-2 rounded-md border border-zinc-500 font-medium text-center"
                >
                  Sign in
                </Link>
                <Link 
                  href="/sign-up"
                  className="bg-white hover:bg-gray-100 text-black px-6 py-2 rounded-md font-medium text-center"
                >
                  Sign up
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
