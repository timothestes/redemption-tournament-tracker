import { notFound } from "next/navigation";
import TopNav from "@/components/top-nav";
import { getPosterContext } from "../lib/auth";
import PostEditor from "../components/PostEditor";
import type { PostRow } from "../actions";

export const metadata = { title: "Edit post - RedemptionCCG App" };
export const dynamic = "force-dynamic";

const ROW =
  "id, slug, title, excerpt, body_md, cover_image_url, tags, status, author_id, published_at, created_at, updated_at";

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getPosterContext();
  if (!ctx) notFound();
  const { id } = await params;
  // RLS: a poster only gets their own rows back; the superuser gets any.
  const { data } = await ctx.supabase.from("posts").select(ROW).eq("id", id).maybeSingle();
  if (!data) notFound();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopNav />
      <PostEditor initial={data as PostRow} />
    </div>
  );
}
