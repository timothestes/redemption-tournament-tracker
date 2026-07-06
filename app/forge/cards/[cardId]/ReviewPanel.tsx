"use client";

import ProposalDiff from "./ProposalDiff";
import CommentThread from "./CommentThread";
import { timeAgo } from "@/app/forge/lib/relativeTime";
import type { ForgeCardFull } from "@/app/forge/lib/cards";
import type { ProposalDiffData, ProposalRow } from "@/app/forge/lib/proposals";
import type { CommentRow } from "@/app/forge/lib/comments";

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  accepted: "Accepted",
  denied: "Denied",
  superseded: "Superseded",
};

export default function ReviewPanel({
  card,
  openDiffs,
  proposals,
  comments,
  canReview,
}: {
  card: ForgeCardFull;
  openDiffs: ProposalDiffData[];
  proposals: ProposalRow[];
  comments: CommentRow[];
  canReview: boolean;
}) {
  // Cache-buster: updated_at bumps on every image/snapshot write, mirroring the studio.
  const t = Date.parse(card.updatedAt) || 0;
  const artUrl = card.hasArt ? `/forge/api/art/${card.id}?t=${t}` : null;
  const finishedUrl = card.hasFinished ? `/forge/api/art/${card.id}?kind=finished&t=${t}` : null;
  const history = proposals.filter((p) => p.status !== "open");
  // Accept notes + deny reasons are stored as proposal-anchored comments.
  const reasonsFor = (proposalId: string) => comments.filter((c) => c.proposalId === proposalId);

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

      {history.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Proposal history</h2>
          <ul className="space-y-1 text-xs">
            {history.map((p) => {
              const reasons = reasonsFor(p.id);
              return (
                <li key={p.id} className="rounded-md border px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span>{p.summary ?? "Proposed change"}</span>
                    <span className="text-muted-foreground">{STATUS_LABEL[p.status] ?? p.status}</span>
                  </div>
                  {reasons.map((r) => (
                    <p key={r.id} className={`mt-1 whitespace-pre-wrap ${p.status === "denied" ? "text-destructive" : "text-muted-foreground"}`}>
                      <span className="font-medium text-foreground">{r.authorName ?? "Forge member"}</span>
                      {" · "}
                      {timeAgo(r.createdAt)}
                      {" — "}
                      {r.body}
                    </p>
                  ))}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold">Comments &amp; suggestions</h2>
        <CommentThread cardId={card.id} comments={comments} canApply={canReview} />
      </section>
    </div>
  );
}
