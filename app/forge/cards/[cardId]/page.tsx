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

  return (
    <>
      <StudioEditor card={card} sets={sets} />
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
