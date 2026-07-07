"use client";

import ProposalDiff from "./ProposalDiff";
import CommentThread from "./CommentThread";
import CardHistory from "./CardHistory";
import { buildHistory } from "@/app/forge/lib/historyView";
import type { ForgeCardFull } from "@/app/forge/lib/cards";
import type { ProposalDiffData, ProposalRow } from "@/app/forge/lib/proposals";
import type { CommentRow } from "@/app/forge/lib/comments";
import type { VersionRow, CardEventRow } from "@/app/forge/lib/versions";

export default function ReviewPanel({
  card,
  openDiffs,
  proposals,
  comments,
  versions,
  events,
  canReview,
}: {
  card: ForgeCardFull;
  openDiffs: ProposalDiffData[];
  proposals: ProposalRow[];
  comments: CommentRow[];
  versions: VersionRow[];
  events: CardEventRow[];
  canReview: boolean;
}) {
  // Cache-buster: updated_at bumps on every image/snapshot write, mirroring the studio.
  const t = Date.parse(card.updatedAt) || 0;
  const artUrl = card.hasArt ? `/forge/api/art/${card.id}?t=${t}` : null;
  const finishedUrl = card.hasFinished ? `/forge/api/art/${card.id}?kind=finished&t=${t}` : null;
  const history = buildHistory(versions, proposals, events, comments);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 pt-0">
      <section>
        <h2 className="mb-2 text-sm font-semibold">Open proposals</h2>
        {openDiffs.length === 0 ? (
          <p className="text-xs text-muted-foreground">No open proposals.</p>
        ) : (
          <div className="space-y-3">
            {openDiffs.map((d) => (
              <ProposalDiff
                key={d.proposal.id}
                proposal={d.proposal}
                current={d.current}
                artUrl={artUrl}
                finishedUrl={finishedUrl}
                canReview={canReview}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">History</h2>
        <CardHistory history={history} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Comments &amp; suggestions</h2>
        <CommentThread
          cardId={card.id}
          comments={comments}
          canApply={canReview}
          versions={versions.map((v) => ({ versionNumber: v.versionNumber, createdAt: v.createdAt }))}
        />
      </section>
    </div>
  );
}
