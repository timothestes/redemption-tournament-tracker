import { notFound, permanentRedirect } from "next/navigation";
import { CATEGORY_BY_SLUG } from "@/lib/wp/categoryMap";

/**
 * Old WordPress category archives (/category/<slug>/). Categories were imported
 * as article tags, so each maps to the tag-filtered article list. Unknown slugs
 * 404 (spec §1). Tag/author archives get no route at all — deliberate 404s.
 */
export default async function LegacyCategoryRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const name = CATEGORY_BY_SLUG[slug.toLowerCase()];
  if (!name) notFound();
  permanentRedirect(`/articles?tag=${encodeURIComponent(name)}`);
}
