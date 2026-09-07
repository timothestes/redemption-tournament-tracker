import type { MetadataRoute } from "next";
import { createClient } from "@/utils/supabase/server";

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL
  ? process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")
  : process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = await createClient();

  // Static public routes
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${baseUrl}/decklist`,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/decklist/card-search`,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/decklist/community`,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/rulings`,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/resources`,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/sponsors`,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${baseUrl}/spoilers`,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${baseUrl}/tournaments`,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/register`,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${baseUrl}/goldfish`,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: `${baseUrl}/articles`,
      changeFrequency: "daily",
      priority: 0.8,
    },
  ];

  // Dynamic routes: public community decks (unlisted decks are excluded)
  const { data: decks } = await supabase
    .from("decks")
    .select("id, updated_at")
    .eq("visibility", "public")
    .order("updated_at", { ascending: false })
    .limit(1000);

  const deckRoutes: MetadataRoute.Sitemap = (decks ?? []).map((deck) => ({
    url: `${baseUrl}/decklist/${deck.id}`,
    lastModified: deck.updated_at,
    changeFrequency: "weekly" as const,
    priority: 0.5,
  }));

  // Dynamic routes: spoiler sets
  const { data: spoilerSets } = await supabase
    .from("spoiler_sets")
    .select("id, updated_at")
    .order("updated_at", { ascending: false });

  const spoilerRoutes: MetadataRoute.Sitemap = (spoilerSets ?? []).map(
    (set) => ({
      url: `${baseUrl}/spoilers/${set.id}`,
      lastModified: set.updated_at,
      changeFrequency: "daily" as const,
      priority: 0.6,
    }),
  );

  // Dynamic routes: published articles (the imported WordPress archive + new posts)
  // PostgREST caps every select at 1000 rows regardless of an explicit .limit(),
  // so paginate with .range() until a page comes back short.
  const posts: { slug: string; published_at: string | null; updated_at: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page } = await supabase
      .from("posts")
      .select("slug, published_at, updated_at")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .range(from, from + 999);

    if (!page || page.length === 0) break;
    posts.push(...page);
    if (page.length < 1000) break;
  }

  const articleRoutes: MetadataRoute.Sitemap = posts.map((post) => ({
    url: `${baseUrl}/articles/${post.slug}`,
    lastModified: post.updated_at ?? post.published_at ?? undefined,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  return [...staticRoutes, ...deckRoutes, ...spoilerRoutes, ...articleRoutes];
}
