import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import TopNav from "@/components/top-nav";
import SponsorFooter from "@/components/sponsor-footer";
import ArticleBody from "../components/ArticleBody";
import { formatPostDate } from "../components/PostCard";
import { loadPostBySlug, postByline, postExcerpt } from "../lib/queries";
import EditLink from "./EditLink";

export const revalidate = 3600;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await loadPostBySlug(slug);
  if (!post) return { title: "Article not found" };
  const description = postExcerpt(post);
  const images = post.cover_image_url ? [{ url: post.cover_image_url, alt: post.title }] : undefined;
  return {
    title: post.title,
    description,
    alternates: { canonical: `/articles/${slug}` },
    openGraph: {
      title: post.title,
      description,
      type: "article",
      siteName: "Land of Redemption",
      publishedTime: post.published_at ?? undefined,
      authors: [postByline(post)],
      images,
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title: post.title,
      description,
      images: images?.map((i) => i.url),
    },
  };
}

export default async function ArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const post = await loadPostBySlug(slug);
  if (!post) notFound();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopNav />
      <article className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:py-10">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Article",
              headline: post.title,
              datePublished: post.published_at ?? undefined,
              author: { "@type": "Person", name: postByline(post) },
              ...(post.cover_image_url ? { image: [post.cover_image_url] } : {}),
            }),
          }}
        />
        <Link
          href="/articles"
          className="mb-5 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          ← All articles
        </Link>
        <header className="mb-6">
          <h1 className="font-cinzel text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{post.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
              by {postByline(post)} · {formatPostDate(post.published_at)}
            </p>
            <EditLink postId={post.id} authorId={post.author_id} />
          </div>
          {post.tags.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {post.tags.map((t) => (
                <li key={t}>
                  <Link
                    href={`/articles?tag=${encodeURIComponent(t)}`}
                    className="inline-flex min-h-11 items-center rounded-full bg-muted px-3 text-sm text-muted-foreground hover:text-foreground"
                  >
                    {t}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </header>
        {post.cover_image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.cover_image_url}
            alt=""
            className="mb-6 w-full rounded-lg object-cover"
            style={{ aspectRatio: "16 / 9" }}
          />
        )}
        <ArticleBody markdown={post.body_md} />
      </article>
      <SponsorFooter />
    </div>
  );
}
