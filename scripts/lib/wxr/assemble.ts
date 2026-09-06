import { readFileSync } from "node:fs";
import he from "he";
import { normalizeTags } from "@/app/admin/posts/lib/validate";
import { MAX_SLUG, SLUG_RE } from "@/app/articles/lib/markdown";
import type { WxrPost } from "./parse";

export interface AuthorMapEntry { login: string; name: string; email: string | null }

export function loadAuthorMap(path: string): AuthorMapEntry[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(raw)) throw new Error(`${path}: expected an array`);
  const seen = new Set<string>();
  return raw.map((e, i) => {
    const x = e as Partial<AuthorMapEntry>;
    if (typeof x.login !== "string" || !x.login || typeof x.name !== "string" || !(x.email === null || typeof x.email === "string"))
      throw new Error(`${path}[${i}]: bad entry ${JSON.stringify(e)}`);
    if (seen.has(x.login)) throw new Error(`${path}: duplicate login ${x.login}`);
    seen.add(x.login);
    return { login: x.login, name: x.name, email: x.email ? x.email.trim().toLowerCase() : null };
  });
}

export function truncateSlug(slug: string, max = MAX_SLUG): string {
  if (slug.length <= max) return slug;
  let s = slug.slice(0, max);
  if (slug[max] !== "-") s = s.replace(/-[^-]*$/, ""); // the cut split a word
  return s.replace(/-+$/, "");
}

export function finalSlugs(posts: { slug: string }[]): Map<string, string> {
  const bad = posts.map((p) => p.slug).filter((s) => !SLUG_RE.test(s));
  if (bad.length) throw new Error(`slugs failing SLUG_RE: ${bad.join(", ")}`);
  const taken = new Set<string>();
  const out = new Map<string, string>();
  for (const { slug } of posts) {
    let final = truncateSlug(slug);
    for (let n = 2; taken.has(final); n++) final = `${truncateSlug(slug, MAX_SLUG - `-${n}`.length)}-${n}`;
    taken.add(final);
    out.set(slug, final);
  }
  return out;
}

export function wpDateToIso(gmt: string, fallback: string): string {
  const pick = gmt.startsWith("0000-") ? fallback : gmt;
  const m = pick.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/);
  if (!m) throw new Error(`bad WordPress date: ${JSON.stringify(gmt)} / ${JSON.stringify(fallback)}`);
  return new Date(`${m[1]}T${m[2]}Z`).toISOString();
}

export interface ImportRow {
  slug: string; title: string; excerpt: string | null; body_md: string; cover_image_url: string | null;
  tags: string[]; status: "published" | "draft"; author_id: string | null; author_name: string;
  published_at: string; created_at: string; updated_at: string; source_url: string;
}

export function assemblePost(
  post: WxrPost,
  ctx: { finalSlug: string; authorId: string | null; authorName: string; bodyMd: string; coverUrl: string | null; status: "published" | "draft" },
): ImportRow {
  const title = post.title.trim();
  if (!title || title.length > 200) throw new Error(`post ${post.wpId}: title must be 1-200 chars`);
  const excerpt = he.decode(post.excerpt.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 500) || null;
  const created = wpDateToIso(post.dateGmt, post.date);
  let updated = post.modifiedGmt ? wpDateToIso(post.modifiedGmt, post.date) : created;
  if (updated < created) updated = created;
  return {
    slug: ctx.finalSlug, title, excerpt, body_md: ctx.bodyMd, cover_image_url: ctx.coverUrl,
    tags: normalizeTags(post.categories), status: ctx.status, author_id: ctx.authorId, author_name: ctx.authorName.slice(0, 80),
    published_at: created, created_at: created, updated_at: updated, source_url: post.link,
  };
}
