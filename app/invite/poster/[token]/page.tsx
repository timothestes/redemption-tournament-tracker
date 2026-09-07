import { redirect } from "next/navigation";
import { Newspaper } from "lucide-react";
import { createClient } from "@/utils/supabase/server";
import AcceptPosterForm from "./AcceptPosterForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { robots: { index: false, follow: false } };

export default async function InvitePosterPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Must be signed in to bind the invite to a real auth.users.id.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/sign-in?redirectTo=${encodeURIComponent(`/invite/poster/${token}`)}`);
  }

  return (
    <div>
      <header className="flex items-center justify-center gap-2 border-b py-4">
        <Newspaper className="h-5 w-5" aria-hidden="true" />
        <span className="text-lg" style={{ fontFamily: "Cinzel, serif" }}>
          Land of Redemption
        </span>
      </header>
      <AcceptPosterForm token={token} />
    </div>
  );
}
