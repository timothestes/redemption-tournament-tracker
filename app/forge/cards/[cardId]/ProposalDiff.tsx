"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ForgeCardFace from "@/app/forge/components/ForgeCardFace";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";
import { diffCards, summarizeDiff, type FieldChange } from "@/app/forge/lib/cardDiff";
import { acceptProposal, denyProposal, type ProposalRow } from "@/app/forge/lib/proposals";
import { addComment } from "@/app/forge/lib/comments";
import { cardRawText, type DesignCard } from "@/app/forge/lib/designCard";

// A body/verse change (or any value with a newline) is unreadable inline — stack
// the before/after as pre-wrapped blocks instead of a single strikethrough line.
function isBlockChange(c: FieldChange): boolean {
  return (
    c.field === "rawText" ||
    c.field === "scripture" ||
    (c.before?.includes("\n") ?? false) ||
    (c.after?.includes("\n") ?? false)
  );
}

export default function ProposalDiff({
  proposal,
  current,
  artUrl,
  finishedUrl,
  canReview,
  cardStatus,
}: {
  proposal: ProposalRow;
  current: DesignCard;
  artUrl: string | null;
  finishedUrl: string | null;
  canReview: boolean;
  cardStatus: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [denyOpen, setDenyOpen] = useState(false);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const changes = diffCards(current, proposal.proposedSnapshot);
  const proposed = proposal.proposedSnapshot;
  // No base version = the card has never been released; a field-by-field
  // "— → value" diff is noise, so render the proposal as a plain new card.
  const isNewCard = proposal.baseVersionId === null;
  const isDraft = cardStatus === "draft";

  const doAccept = () =>
    start(async () => {
      setErr(null);
      const r = await acceptProposal(proposal.id);
      if (!r.ok) { setErr(r.error ?? "Could not accept proposal"); return; }
      // Optional accept note → stored as a proposal-anchored comment, mirroring deny.
      if (note.trim()) await addComment({ cardId: proposal.cardId, proposalId: proposal.id, body: note });
      setAcceptOpen(false);
      setNote("");
      router.refresh();
    });

  const doDeny = () =>
    start(async () => {
      setErr(null);
      const r = await denyProposal(proposal.id, proposal.cardId, reason);
      if (!r.ok) { setErr(r.error ?? "Could not deny proposal"); return; }
      setDenyOpen(false);
      setReason("");
      router.refresh();
    });

  return (
    <div className="rounded-md border p-3">
      <p className="text-sm font-medium">{proposal.summary ?? "Proposed change"}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {isNewCard ? "New card — first proposal" : summarizeDiff(changes)}
      </p>

      {/* Decision controls + change list render ABOVE the previews (mobile-first). */}
      {proposal.status === "open" && canReview && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={pending} onClick={() => { setErr(null); setAcceptOpen(true); }}>
            Accept
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => { setErr(null); setDenyOpen(true); }}>
            Deny
          </Button>
        </div>
      )}

      {changes.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs">
          {changes.map((c) =>
            isNewCard ? (
              isBlockChange(c) ? (
                <li key={c.field as string} className="space-y-1">
                  <span className="font-medium">{c.label}</span>
                  <div className="whitespace-pre-wrap rounded bg-muted/60 px-2 py-1">{c.after ?? "—"}</div>
                </li>
              ) : (
                <li key={c.field as string}>
                  <span className="font-medium">{c.label}:</span> {c.after ?? "—"}
                </li>
              )
            ) : isBlockChange(c) ? (
              <li key={c.field as string} className="space-y-1">
                <span className="font-medium">{c.label}</span>
                {c.before !== null && (
                  <div className="whitespace-pre-wrap rounded bg-destructive/10 px-2 py-1 text-destructive">{c.before}</div>
                )}
                {c.after !== null && (
                  <div className="whitespace-pre-wrap rounded bg-primary/10 px-2 py-1">{c.after}</div>
                )}
              </li>
            ) : (
              <li key={c.field as string}>
                <span className="font-medium">{c.label}:</span>{" "}
                <span className="text-destructive line-through">{c.before ?? "—"}</span>
                {" → "}
                <span className="text-primary">{c.after ?? "—"}</span>
              </li>
            )
          )}
        </ul>
      )}

      {/* The field diff above carries the change; the paired faces are collapsed by
          default (a proposal never changes the art/finished image, so for those cards
          the two previews are identical). Available on demand. */}
      <details className="mt-3">
        <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
          Show card preview
        </summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Current</p>
            <ForgeCardFace
              name={current.name ?? null}
              rawText={cardRawText(current)}
              finishedUrl={finishedUrl}
              artUrl={artUrl}
            />
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Proposed</p>
            <ForgeCardFace
              name={proposed.name ?? null}
              rawText={cardRawText(proposed)}
              finishedUrl={finishedUrl}
              artUrl={artUrl}
            />
          </div>
        </div>
      </details>

      <Dialog open={acceptOpen} onOpenChange={(o) => { if (!o) { setAcceptOpen(false); setErr(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Accept proposal</DialogTitle>
            <DialogDescription>
              {isDraft
                ? "Applies this change to the working draft and records it as a new draft version in the card’s history. The card stays in Draft — nothing is visible to playtesters."
                : "Releases a new version to playtesters (not the public card database) and replaces the working draft with this proposal. The card stays in playtest — use Mark final when it’s done."}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">Note (optional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note for the proposal history…"
              className="h-24 w-full rounded-md border bg-background px-2 py-1 text-sm"
            />
            {err && <p className="text-sm text-destructive">{err}</p>}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => { setAcceptOpen(false); setErr(null); }}>
              Cancel
            </Button>
            <Button disabled={pending} onClick={doAccept}>{isDraft ? "Accept" : "Accept & release"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={denyOpen} onOpenChange={(o) => { if (!o) { setDenyOpen(false); setErr(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deny proposal</DialogTitle>
            <DialogDescription>The reason is recorded in the proposal history.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">Reason</label>
            <textarea
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this being denied?"
              className="h-24 w-full rounded-md border bg-background px-2 py-1 text-sm"
            />
            {err && <p className="text-sm text-destructive">{err}</p>}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => { setDenyOpen(false); setErr(null); }}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={pending || !reason.trim()} onClick={doDeny}>
              Deny proposal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
