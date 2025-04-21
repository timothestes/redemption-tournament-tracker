import { createClient } from "../utils/supabase/server";
import { hasEnvVars } from "../utils/supabase/check-env-vars";
import { EnvVarWarning } from "./env-var-warning";
import Link from "next/link";
import { Button } from "./ui/button";
import { signOutAction } from "../app/actions";

export default async function HeaderServer() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <nav className="w-full flex justify-center border-b border-b-foreground/10 h-17">
      <div className="w-full max-w-1xl flex justify-between items-center p-3 px-5 text-sm">
        <div className="flex gap-5 items-center font-semibold" />
        {!hasEnvVars ? <EnvVarWarning /> : (
          <div className="flex justify-end">
            {user ? (
              <div className="flex items-center gap-4">
                <div className="max-w-12:block hidden">Hey, {user.email}!</div>
                <form action={signOutAction}>
                  <Button type="submit" variant="outline">
                    Sign out
                  </Button>
                </form>
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