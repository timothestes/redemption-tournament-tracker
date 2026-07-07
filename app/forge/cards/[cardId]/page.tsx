import { notFound, redirect } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { getCard } from "@/app/forge/lib/cards";
import { getSet, listSets, listSetCards } from "@/app/forge/lib/sets";
import { sortSetCards } from "@/app/forge/lib/cardOrder";
import { getOpenProposalDiffs, listProposals } from "@/app/forge/lib/proposals";
import { listComments } from "@/app/forge/lib/comments";
import { listVersions, listCardEvents } from "@/app/forge/lib/versions";
import StudioEditor from "./StudioEditor";
import ReviewPanel from "./ReviewPanel";

export const dynamic = "force-dynamic";

export default async function StudioPage({ params }: { params: Promise<{ cardId: string }> }) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  if (ctx.role === "playtester") redirect("/forge/play");
  const { cardId } = await params;
  const card = await getCard(cardId);
  if (!card) notFound();
  const set = card.setId ? await getSet(card.setId) : null;

  const inSet = card.setId !== null;
  const sets = inSet ? [] : await listSets();
  const [openDiffs, proposals, comments, versions, events, siblings] = inSet
    ? await Promise.all([
        getOpenProposalDiffs(cardId),
        listProposals(cardId),
        listComments(cardId),
        listVersions(cardId),
        listCardEvents(cardId),
        listSetCards(card.setId!),
      ])
    : [[], [], [], [], [], []];
  const canReview = ctx.role === "elder" || ctx.role === "superadmin";

  // Prev/next arrows on the card face walk the set in the same order as the grid.
  // No wrap: the boundary card gets null and hides that arrow.
  const ordered = sortSetCards(siblings);
  const idx = ordered.findIndex((c) => c.id === cardId);
  const prevId = idx > 0 ? ordered[idx - 1].id : null;
  const nextId = idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1].id : null;

  const { data: meRow } = await ctx.supabase
    .from("playtest_members")
    .select("display_name")
    .eq("user_id", ctx.user.id)
    .single();
  const currentUser = { userId: ctx.user.id, displayName: meRow?.display_name ?? null };

  return (
    <>
      <StudioEditor card={card} sets={sets} currentUser={currentUser} setId={card.setId ?? null} setName={set?.name ?? null} prevId={prevId} nextId={nextId} />
      {inSet && (
        <ReviewPanel
          card={card}
          openDiffs={openDiffs}
          proposals={proposals}
          comments={comments}
          versions={versions}
          events={events}
          canReview={canReview}
        />
      )}
    </>
  );
}
