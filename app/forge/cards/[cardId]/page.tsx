import { notFound } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { getCard } from "@/app/forge/lib/cards";
import { listSets } from "@/app/forge/lib/sets";
import { getOpenProposalDiffs, listProposals } from "@/app/forge/lib/proposals";
import { listComments } from "@/app/forge/lib/comments";
import StudioEditor from "./StudioEditor";
import ReviewPanel from "./ReviewPanel";

export const dynamic = "force-dynamic";

export default async function StudioPage({ params }: { params: Promise<{ cardId: string }> }) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const { cardId } = await params;
  const card = await getCard(cardId);
  if (!card) notFound();

  const inSet = card.setId !== null;
  const sets = inSet ? [] : await listSets();
  const [openDiffs, proposals, comments] = inSet
    ? await Promise.all([getOpenProposalDiffs(cardId), listProposals(cardId), listComments(cardId)])
    : [[], [], []];
  const canReview = ctx.role === "elder" || ctx.role === "superadmin";

  const { data: meRow } = await ctx.supabase
    .from("playtest_members")
    .select("display_name")
    .eq("user_id", ctx.user.id)
    .single();
  const currentUser = { userId: ctx.user.id, displayName: meRow?.display_name ?? null };

  return (
    <>
      <StudioEditor card={card} sets={sets} currentUser={currentUser} setId={card.setId ?? null} />
      {inSet && (
        <ReviewPanel
          card={card}
          openDiffs={openDiffs}
          proposals={proposals}
          comments={comments}
          canReview={canReview}
        />
      )}
    </>
  );
}
