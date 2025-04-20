"use client";

import { useEffect, useState } from "react";
import { createClient } from "../utils/supabase/client";
import { hasEnvVars } from "../utils/supabase/check-env-vars";
import EnvVarWarning from "./env-var-warning";
import Link from "next/link";
import { Button } from "./ui/button";

const supabase = createClient();

export default function Header() {
  const [user, setUser] = useState(null);

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

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

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
                <Button type="button" variant="outline" onClick={handleSignOut}>
                  Sign out
                </Button>
              </div>
            ) : (
              <div className="flex gap-3">
                <Button asChild size="sm" variant="outline">
                  <Link href="/tracker/tournaments">Sign in</Link>
                </Button>
                <Button asChild size="sm" variant="default">
                  <Link href="/sign-up">Sign up</Link>
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
