import type { PublicPost } from "../lib/queries";

export default function AuthorBio({ author }: { author: PublicPost["author"] }) {
  if (!author || (!author.avatar_url && !author.bio)) return null;
  return (
    <div className="mt-8 flex gap-4 rounded-lg bg-card p-4">
      {author.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={author.avatar_url} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted text-sm text-muted-foreground">
          {(author.username ?? "?").slice(0, 1).toUpperCase()}
        </div>
      )}
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
          About {author.username ?? "the author"}
        </p>
        {author.bio && <p className="mt-1 text-sm text-muted-foreground">{author.bio}</p>}
      </div>
    </div>
  );
}
