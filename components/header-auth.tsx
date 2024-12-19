import { signOutAction } from "../app/actions";
import Link from "next/link";
import { Button } from "./ui/button";
import { createClient } from "../utils/supabase/server";

export default async function AuthButton() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user ? (
    <div className="flex justify-end">
      <div className="flex items-center gap-4">
        Hey, {user.email}!
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
      <div className="flex gap-2">
        <Button asChild size="sm" variant={"outline"}>
          <Link href="/protected/tournaments">Sign in</Link>
        </Button>
        <Button asChild size="sm" variant={"default"}>
          <Link href="/protected/tournaments">Sign up</Link>
        </Button>
      </div>
    </div>
  );
}
