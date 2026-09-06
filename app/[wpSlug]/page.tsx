import { notFound, permanentRedirect } from "next/navigation";
import { createAnonClient } from "@/utils/supabase/anon";

/**
 * Catches old landofredemption.com post URLs (`/<slug>/`) once that domain
 * points at this app. Every imported post's original WordPress URL is stored
 * in `posts.source_url` (see scripts/import-wxr.ts), so a lookup there finds
 * the article's current slug even for the ~1% of posts whose WordPress slug
 * differs from the one it was imported under. Anything that isn't a known
 * post (WordPress pages, typos, bots) falls through to the real 404 — this
 * route only ever adds a redirect, never a page.
 *
 * Next.js resolves static routes before a dynamic segment like this one, so
 * this can't shadow any existing top-level page (see app/ directory).
 */
export default async function LegacyPostRedirect({
  params,
}: {
  params: Promise<{ wpSlug: string }>;
}) {
  const { wpSlug } = await params;
  const supabase = createAnonClient();
  const { data } = await supabase
    .from("posts")
    .select("slug")
    .eq("source_url", `https://landofredemption.com/${wpSlug}/`)
    .maybeSingle();

  if (!data) notFound();
  permanentRedirect(`/articles/${data.slug}`);
}
