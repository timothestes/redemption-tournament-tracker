"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ProposalDiff from "./ProposalDiff";
import CommentThread from "./CommentThread";
import CardHistory from "./CardHistory";
import { Button } from "@/components/ui/button";
import { buildHistory } from "@/app/forge/lib/historyView";
import type { ForgeCardFull } from "@/app/forge/lib/cards";
import { createProposal, type ProposalDiffData, type ProposalRow } from "@/app/forge/lib/proposals";
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

  // Proposing lives beside the proposals it creates. The proposal freezes the
  // card's saved working draft server-side (see createProposal).
  const router = useRouter();
  const [proposing, setProposing] = useState(false);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submitProposal = async () => {
    if (!summary.trim()) return;
    setErr(null);
    setBusy(true);
    const r = await createProposal(card.id, summary);
    setBusy(false);
    if (r.ok === false) { setErr(r.error); return; }
    setProposing(false);
    setSummary("");
    router.refresh();
  };
  const canPropose = card.status === "draft" || card.status === "playtesting";

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 pt-0">
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Open proposals</h2>
          {canPropose && !proposing && (
            <Button size="sm" variant="outline" className="h-7 px-3 text-xs" onClick={() => setProposing(true)}>
              Propose changes
            </Button>
          )}
        </div>
        {proposing && (
          <div className="mb-3 flex flex-col gap-1 text-xs">
            <div className="flex items-start gap-1">
              <textarea autoFocus value={summary} onChange={(e) => setSummary(e.target.value)}
                placeholder="Summarize this change — what and why?" className="h-16 flex-1 rounded-md border bg-background px-2 py-1" />
              <Button size="sm" className="h-7 px-3 text-xs" disabled={busy || !summary.trim()} onClick={submitProposal}>
                Submit proposal
              </Button>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => { setProposing(false); setErr(null); }}>Cancel</Button>
            </div>
            <p className="text-muted-foreground">Proposes the card’s current saved draft for another elder to accept or deny.</p>
            {err && <p className="text-destructive">{err}</p>}
          </div>
        )}
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
                cardStatus={card.status}
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
          versions={versions.map((v) => ({ versionNumber: v.versionNumber, createdAt: v.createdAt, status: v.status }))}
        />
      </section>
    </div>
  );
}
