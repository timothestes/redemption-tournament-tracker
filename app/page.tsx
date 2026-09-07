import Link from "next/link";
import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { createAnonClient } from "@/utils/supabase/anon";
import { resolveLegacyWpParams } from "@/lib/wp/legacyParams";
import TopNav from "@/components/top-nav";
import SponsorFooter from "@/components/sponsor-footer";
import { loadPublishedPosts } from "@/app/articles/lib/queries";
import PostCard from "@/app/articles/components/PostCard";

export const metadata: Metadata = {
  title: { absolute: "Land of Redemption – Redemption CCG Strategy, Deck Building, and Tournaments" },
  alternates: { canonical: "/" },
};

const LINKS = [
  { href: "/decklist", title: "Deck Builder", desc: "Build, validate, and share Redemption decks." },
  { href: "/tournaments", title: "Tournaments", desc: "Events, standings, and live pairings." },
  { href: "/play", title: "Play Online", desc: "Play Redemption in your browser." },
  { href: "/rulings", title: "Rulings", desc: "Search official card rulings." },
  { href: "/resources", title: "Resources", desc: "Rulebooks, guides, and player documents." },
] as const;

export default async function Index(props: {
  searchParams: Promise<{
    code?: string;
    error?: string;
    error_description?: string;
    p?: string;
    page_id?: string;
    cat?: string;
  }>;
}) {
  const searchParams = await props.searchParams;

  if (searchParams.code) {
    redirect(
      `/auth/callback?code=${encodeURIComponent(searchParams.code)}&redirect_to=/tracker/reset-password`,
    );
  }

  if (searchParams.error) {
    // Token expired or invalid — send back to forgot-password with a message
    redirect(
      `/forgot-password?${new URLSearchParams({ error: searchParams.error_description ?? "The reset link has expired. Please request a new one." }).toString()}`,
    );
  }

  const legacy = await resolveLegacyWpParams(searchParams, async (id) => {
    const { data } = await createAnonClient()
      .from("posts").select("slug").eq("wp_post_id", id).maybeSingle();
    return data?.slug ?? null;
  });
  if (legacy.kind === "not-found") notFound();
  if (legacy.kind === "redirect") permanentRedirect(legacy.to);

  const { posts } = await loadPublishedPosts({ page: 1 });
  const latest = posts.slice(0, 5);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopNav />
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 py-8">
        <section className="rounded-xl bg-zinc-950 px-6 py-10 sm:px-10">
          <h1 className="sr-only">
            Land of Redemption – Redemption CCG Strategy, Deck Building, and Tournaments
          </h1>
          <img
            src="/brand/lor-wordmark.webp"
            alt=""
            aria-hidden
            width={450}
            height={122}
            className="h-auto w-full max-w-md"
          />
          <p className="mt-6 max-w-2xl text-zinc-300">
            Strategy, deck building, and tournaments for Redemption — the collectible card
            game of biblical battles. Build and share decks, register for events, read
            player articles, and play online.
          </p>
        </section>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-lg border bg-card p-4 transition-colors hover:border-primary"
            >
              <div className="font-semibold">{l.title}</div>
              <p className="mt-1 text-sm text-muted-foreground">{l.desc}</p>
            </Link>
          ))}
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-semibold">Latest articles</h2>
            <Link href="/articles" className="text-sm text-muted-foreground hover:text-foreground">
              All articles →
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {latest.map((post) => (
              <PostCard key={post.slug} post={post} />
            ))}
          </div>
        </section>
      </div>
      <SponsorFooter />
    </div>
  );
}
