"use client";

import { useEffect, useState } from "react";
import { createClient } from "../utils/supabase/client";
import { hasEnvVars } from "../utils/supabase/check-env-vars";
import { EnvVarWarning } from "./env-var-warning";
import Link from "next/link";
import { Button } from "./ui/button";
import { signOutAction } from "../app/actions";
import { ThemeSwitcher } from "./theme-switcher";

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
            <img src="/lor-lightmode.png" className="w-48 block dark:hidden" alt="Land of Redemption Logo" />
            <img src="/lor.png" className="w-48 hidden dark:block" alt="Land of Redemption Logo" />
          </div>
        </div>
        {!hasEnvVars ? <EnvVarWarning /> : (
          <div className="flex justify-end">
            {user ? (
              <div className="flex items-center gap-4">
                <div className="max-w-12:block hidden">Hey, {user.email}!</div>
                <div className="mr-2">
                  <ThemeSwitcher />
                </div>
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
              <div className="flex gap-3 items-center">
                <div className="mr-2">
                  <ThemeSwitcher />
                </div>
                <Link 
                  href="/sign-in"
                  className="bg-white hover:bg-gray-100 text-gray-800 px-6 py-2 rounded-md border border-gray-300 font-medium text-center shadow-md transition-all duration-200"
                >
                  Sign in
                </Link>
                <Link 
                  href="/sign-up"
                  className="bg-gray-800 hover:bg-gray-900 text-white px-6 py-2 rounded-md font-medium text-center shadow-md transition-all duration-200 border border-gray-700"
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
