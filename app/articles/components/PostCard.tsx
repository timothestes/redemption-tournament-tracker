import Link from "next/link";
import { postExcerpt, type PublicPost } from "../lib/queries";

export function formatPostDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default function PostCard({ post }: { post: PublicPost }) {
  const href = `/articles/${post.slug}`;
  return (
    <article className="flex flex-col overflow-hidden rounded-lg bg-card transition-colors hover:bg-muted/60">
      <Link href={href} className="block aspect-[16/9] w-full bg-muted/50">
        {post.cover_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.cover_image_url}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : null}
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
          {post.author?.username ?? "Land of Redemption"} · {formatPostDate(post.published_at)}
        </p>
        <h2 className="font-cinzel text-lg font-semibold leading-snug">
          <Link href={href} className="hover:underline">
            {post.title}
          </Link>
        </h2>
        <p className="line-clamp-3 text-sm text-muted-foreground">{postExcerpt(post)}</p>
        {post.tags.length > 0 && (
          <ul className="mt-auto flex flex-wrap gap-1.5 pt-2">
            {post.tags.map((t) => (
              <li key={t}>
                <Link
                  href={`/articles?tag=${encodeURIComponent(t)}`}
                  className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  {t}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
