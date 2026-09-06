import { unstable_cache } from "next/cache";
import { createAnonClient } from "@/utils/supabase/anon";
import { excerptFromMarkdown } from "./markdown";

// Public, cookie-less, cached reads. Every loader is wrapped in unstable_cache
// under ARTICLES_TAG; the server actions in app/admin/posts/actions.ts call
// revalidateTag(ARTICLES_TAG) after every write, so readers never wait out
// the hour. RLS already hides drafts from anon; the explicit status filter
// just makes the intent visible here.

export const PAGE_SIZE = 20;
export const FEED_SIZE = 30;
export const ARTICLES_TAG = "articles" as const;

export interface PublicPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  body_md: string;
  cover_image_url: string | null;
  tags: string[];
  status: "draft" | "published";
  author_id: string;
  published_at: string;
  author: { username: string | null } | null;
}

const COLUMNS =
  "id, slug, title, excerpt, body_md, cover_image_url, tags, status, author_id, published_at, author:profiles(username)";

export function postExcerpt(post: Pick<PublicPost, "excerpt" | "body_md">): string {
  const explicit = post.excerpt?.trim();
  return explicit ? explicit : excerptFromMarkdown(post.body_md);
}

async function loadPublishedPostsFresh(page: number, tag: string | null) {
  const from = (page - 1) * PAGE_SIZE;
  let q = createAnonClient()
    .from("posts")
    .select(COLUMNS, { count: "exact" })
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (tag) q = q.contains("tags", [tag]);
  const { data, error, count } = await q;
  if (error) {
    console.error("loadPublishedPosts:", error);
    return { posts: [] as PublicPost[], total: 0 };
  }
  return { posts: (data ?? []) as unknown as PublicPost[], total: count ?? 0 };
}

export function loadPublishedPosts(opts: { page?: number; tag?: string | null }) {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const tag = opts.tag?.trim() || null;
  return unstable_cache(
    () => loadPublishedPostsFresh(page, tag),
    ["articles-list", String(page), tag ?? ""],
    { tags: [ARTICLES_TAG], revalidate: 3600 },
  )().then((r) => ({ ...r, page }));
}

async function loadPostBySlugFresh(slug: string): Promise<PublicPost | null> {
  const { data, error } = await createAnonClient()
    .from("posts")
    .select(COLUMNS)
    .eq("status", "published")
    .eq("slug", slug)
    .maybeSingle();
  if (error) {
    console.error("loadPostBySlug:", error);
    return null;
  }
  return (data as unknown as PublicPost | null) ?? null;
}

export function loadPostBySlug(slug: string): Promise<PublicPost | null> {
  return unstable_cache(() => loadPostBySlugFresh(slug), ["articles-post", slug], {
    tags: [ARTICLES_TAG],
    revalidate: 3600,
  })();
}

async function loadFeedPostsFresh(): Promise<PublicPost[]> {
  const { data, error } = await createAnonClient()
    .from("posts")
    .select(COLUMNS)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(FEED_SIZE);
  if (error) {
    console.error("loadFeedPosts:", error);
    return [];
  }
  return (data ?? []) as unknown as PublicPost[];
}

export function loadFeedPosts(): Promise<PublicPost[]> {
  return unstable_cache(loadFeedPostsFresh, ["articles-feed"], { tags: [ARTICLES_TAG], revalidate: 3600 })();
}

async function listPublishedTagsFresh(): Promise<string[]> {
  const { data, error } = await createAnonClient().from("posts").select("tags").eq("status", "published");
  if (error) {
    console.error("listPublishedTags:", error);
    return [];
  }
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    for (const t of (row.tags as string[] | null) ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

export function listPublishedTags(): Promise<string[]> {
  return unstable_cache(listPublishedTagsFresh, ["articles-tags"], { tags: [ARTICLES_TAG], revalidate: 3600 })();
}
