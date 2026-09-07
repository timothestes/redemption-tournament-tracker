import { notFound, permanentRedirect } from "next/navigation";
import { CATEGORY_BY_SLUG } from "@/lib/wp/categoryMap";

/**
 * Old WordPress category archives (/category/<slug>/). Categories were imported
 * as article tags, so each maps to the tag-filtered article list. Unknown slugs
 * 404 (spec §1). Tag/author archives get no route at all — deliberate 404s.
 * WP categories can be hierarchical (/category/<parent>/<child>/) — the last
 * path segment is the actual category slug and the lookup key.
 */
export default async function LegacyCategoryRedirect({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  const slug = path[path.length - 1]?.toLowerCase() ?? "";
  const name = CATEGORY_BY_SLUG[slug];
  if (!name) notFound();
  permanentRedirect(`/articles?tag=${encodeURIComponent(name)}`);
}
