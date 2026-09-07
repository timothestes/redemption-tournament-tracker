import Link from "next/link";
import { postByline, postExcerpt, type PublicPost } from "../lib/queries";

export function formatPostDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

interface PostCardProps {
  post: PublicPost;
  /** `compact` = thumbnail + title row for a `divide-y` list (landing headlines, "More in …"). */
  variant?: "default" | "compact";
  /** Eager, high-priority cover — only for the one card that is the page's LCP. */
  priority?: boolean;
  headingLevel?: 2 | 3;
}

function CoverImage({ src, priority }: { src: string; priority: boolean }) {
  // The wrapper owns the aspect ratio; the image fills it absolutely so a
  // tall cover can't grow the box (h-full on a static img never resolved
  // against the ratio-derived height, so every cover laid out at natural size).
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}

/** Cover slot for the ~3% of posts without an image: a Cinzel initial on the muted plate. */
function CoverPlate({ title }: { title: string }) {
  return (
    <span
      aria-hidden
      className="absolute inset-0 flex items-center justify-center font-cinzel text-4xl font-semibold text-muted-foreground/50"
    >
      {title.trim().charAt(0)}
    </span>
  );
}

// The title link is stretched over the whole card (`after:absolute after:inset-0`
// on a `relative` article), so the entire row/tile is the tap target while the
// accessible name stays the title. The kicker link sits above it with z-10.
const STRETCHED = "hover:underline after:absolute after:inset-0";

export default function PostCard({ post, variant = "default", priority = false, headingLevel = 2 }: PostCardProps) {
  const href = `/articles/${post.slug}`;
  const H = `h${headingLevel}` as const;
  const byline = [postByline(post), formatPostDate(post.published_at)].filter(Boolean).join(" · ");
  const kicker = post.tags[0];

  if (variant === "compact") {
    return (
      <article className="relative flex gap-3 py-3 first:pt-0">
        <div className="relative aspect-[4/3] w-24 shrink-0 overflow-hidden rounded-md bg-muted/60 sm:w-28">
          {post.cover_image_url ? (
            <CoverImage src={post.cover_image_url} priority={false} />
          ) : (
            <CoverPlate title={post.title} />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{byline}</p>
          <H className="mt-1 line-clamp-2 font-cinzel text-base font-semibold leading-snug">
            <Link href={href} className={STRETCHED}>
              {post.title}
            </Link>
          </H>
        </div>
      </article>
    );
  }

  return (
    <article className="relative flex flex-col overflow-hidden rounded-lg bg-foreground/[0.03] ring-1 ring-border/60 transition-colors hover:bg-foreground/[0.06]">
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted/60">
        {post.cover_image_url ? (
          <CoverImage src={post.cover_image_url} priority={priority} />
        ) : (
          <CoverPlate title={post.title} />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        {kicker && (
          <Link
            href={`/articles?tag=${encodeURIComponent(kicker)}`}
            className="relative z-10 self-start text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground"
          >
            {kicker}
          </Link>
        )}
        <H className="font-cinzel text-lg font-semibold leading-snug">
          <Link href={href} className={STRETCHED}>
            {post.title}
          </Link>
        </H>
        <p className="line-clamp-3 text-sm text-muted-foreground">{postExcerpt(post)}</p>
        <p className="mt-auto pt-2 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{byline}</p>
      </div>
    </article>
  );
}
