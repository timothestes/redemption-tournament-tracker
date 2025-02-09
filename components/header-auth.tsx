import { signOutAction } from "../app/actions";
import Link from "next/link";
import { Button } from "./ui/button";
import { createClient } from "../utils/supabase/server";
import { HomeIcon } from "lucide-react";

export default async function AuthButton() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user ? (
    <div className="flex justify-end">
      <div className="flex items-center gap-4">
        <div className="max-w-12:block hidden">Hey, {user.email}!</div>
        <form
          // @ts-ignore
          action={signOutAction}
        >
          <Button type="submit" variant={"outline"}>
            Sign out
          </Button>
        </form>
      </div>
    </div>
  ) : (
    <div className="flex justify-end">
      <div className="flex gap-3">
        <Button asChild size="sm" variant={"outline"}>
          <Link href="/tracker/tournaments">Sign in</Link>
        </Button>
        <Button asChild size="sm" variant={"default"}>
          <Link href="/sign-up">Sign up</Link>
        </Button>
      </div>
    </div>
  );
}

export async function AuthLogo() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? (
    <div className="flex items-center">
      <HomeIcon />
    </div>
  ) : (
    <div className="flex items-center">
      <img src="lor.png" className="w-48" />
    </div>
  );
}
