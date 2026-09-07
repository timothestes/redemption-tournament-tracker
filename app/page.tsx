import { notFound, permanentRedirect, redirect } from "next/navigation";
import { createAnonClient } from "@/utils/supabase/anon";
import { resolveLegacyWpParams } from "@/lib/wp/legacyParams";

export default async function Index(props: {
  searchParams: Promise<{
    code?: string;
    error?: string;
    error_description?: string;
    p?: string;
    page_id?: string;
    cat?: string;
  }>;
}) {
  const searchParams = await props.searchParams;

  if (searchParams.code) {
    redirect(
      `/auth/callback?code=${encodeURIComponent(searchParams.code)}&redirect_to=/tracker/reset-password`,
    );
  }

  if (searchParams.error) {
    // Token expired or invalid — send back to forgot-password with a message
    redirect(
      `/forgot-password?${new URLSearchParams({ error: searchParams.error_description ?? "The reset link has expired. Please request a new one." }).toString()}`,
    );
  }

  const legacy = await resolveLegacyWpParams(searchParams, async (id) => {
    const { data } = await createAnonClient()
      .from("posts").select("slug").eq("wp_post_id", id).maybeSingle();
    return data?.slug ?? null;
  });
  if (legacy.kind === "not-found") notFound();
  if (legacy.kind === "redirect") permanentRedirect(legacy.to);

  redirect("/decklist/community");
}
