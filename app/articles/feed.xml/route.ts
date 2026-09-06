import { loadFeedPosts } from "../lib/queries";
import { buildRss, SITE_URL } from "../lib/rss";

export const revalidate = 3600;

export async function GET() {
  const posts = await loadFeedPosts();
  return new Response(buildRss(posts, SITE_URL), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
