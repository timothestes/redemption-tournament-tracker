import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import TopNav from "@/components/top-nav";
import SponsorFooter from "@/components/sponsor-footer";
import { loadPublishedPosts, listPublishedTags, PAGE_SIZE } from "./lib/queries";
import PostCard from "./components/PostCard";

export const metadata: Metadata = {
  title: "Articles",
  description: "Strategy, deck techs, tournament reports and news for Redemption CCG.",
  alternates: { canonical: "/articles", types: { "application/rss+xml": "/articles/feed.xml" } },
};

interface PageProps {
  searchParams: Promise<{ page?: string; tag?: string }>;
}

function pageHref(page: number, tag: string | null): string {
  const sp = new URLSearchParams();
  if (tag) sp.set("tag", tag);
  if (page > 1) sp.set("page", String(page));
  const qs = sp.toString();
  return qs ? `/articles?${qs}` : "/articles";
}

export default async function ArticlesPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const requested = Number.parseInt(sp.page ?? "1", 10);
  const page = Number.isInteger(requested) && requested > 0 ? requested : 1;
  const tag = sp.tag?.trim() || null;

  const [{ posts, total }, tags] = await Promise.all([loadPublishedPosts({ page, tag }), listPublishedTags()]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Past-the-end (?page=99, or the last post on a page being unpublished)
  // used to render an empty list with no pager and no way back. Land the
  // reader on the last real page instead.
  if (page > pageCount) redirect(pageHref(pageCount, tag));

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopNav />
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:py-10">
        <header className="mb-6 flex flex-col gap-3 sm:mb-8">
          <h1 className="font-cinzel text-3xl font-bold tracking-tight sm:text-4xl">Articles</h1>
          {tags.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {tag && (
                <li>
                  <Link
                    href="/articles"
                    className="inline-flex min-h-11 items-center gap-1 rounded-full bg-primary px-3 text-sm text-primary-foreground"
                  >
                    {tag} <span aria-hidden>×</span>
                    <span className="sr-only">clear tag filter</span>
                  </Link>
                </li>
              )}
              {tags
                .filter((t) => t !== tag)
                .slice(0, 20)
                .map((t) => (
                  <li key={t}>
                    <Link
                      href={pageHref(1, t)}
                      className="inline-flex min-h-11 items-center rounded-full bg-muted px-3 text-sm text-muted-foreground hover:text-foreground"
                    >
                      {t}
                    </Link>
                  </li>
                ))}
            </ul>
          )}
        </header>

        {total === 0 ? (
          <p className="text-muted-foreground">No articles yet{tag ? ` tagged “${tag}”` : ""}.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {posts.map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
          </div>
        )}

        {pageCount > 1 && (
          <nav className="mt-8 flex items-center justify-between text-sm" aria-label="Pagination">
            {page > 1 ? (
              <Link href={pageHref(page - 1, tag)} className="min-h-11 rounded-md px-3 py-2 hover:bg-muted">
                ← Newer
              </Link>
            ) : (
              <span />
            )}
            <span className="text-muted-foreground">
              Page {page} of {pageCount}
            </span>
            {page < pageCount ? (
              <Link href={pageHref(page + 1, tag)} className="min-h-11 rounded-md px-3 py-2 hover:bg-muted">
                Older →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </div>
      <SponsorFooter />
    </div>
  );
}
