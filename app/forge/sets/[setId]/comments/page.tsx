import { notFound, redirect } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { getSet } from "@/app/forge/lib/sets";
import { listSetComments } from "@/app/forge/lib/comments";
import SetCommentsFeed from "./SetCommentsFeed";

export const dynamic = "force-dynamic";

export default async function SetCommentsPage({ params }: { params: Promise<{ setId: string }> }) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  if (ctx.role === "playtester") redirect("/forge/play");
  const { setId } = await params;
  const set = await getSet(setId);
  if (!set) notFound(); // RLS hides sets the caller can't see → 404
  const comments = await listSetComments(setId);
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold">Comments</h2>
      <SetCommentsFeed setId={setId} comments={comments} />
    </div>
  );
}
