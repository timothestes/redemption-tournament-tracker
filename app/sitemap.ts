import type { MetadataRoute } from "next";
import { createClient } from "@/utils/supabase/server";

const baseUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
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
  ];

  // Dynamic routes: public community decks
  const { data: decks } = await supabase
    .from("decks")
    .select("id, updated_at")
    .eq("is_public", true)
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

  return [...staticRoutes, ...deckRoutes, ...spoilerRoutes];
}
