"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ForgeCardPreview from "@/app/forge/components/ForgeCardPreview";
import { diffCards, summarizeDiff } from "@/app/forge/lib/cardDiff";
import { acceptProposal, denyProposal, type ProposalRow } from "@/app/forge/lib/proposals";
import type { DesignCard } from "@/app/forge/lib/designCard";

export default function ProposalDiff({
  proposal,
  current,
  artUrl,
  canReview,
}: {
  proposal: ProposalRow;
  current: DesignCard;
  artUrl: string | null;
  canReview: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const changes = diffCards(current, proposal.proposedSnapshot);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) alert(r.error ?? "Action failed");
      router.refresh();
    });

  return (
    <div className="rounded-md border p-3">
      <p className="text-sm font-medium">{proposal.summary ?? "Proposed change"}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{summarizeDiff(changes)}</p>

      {/* Decision controls + change list render ABOVE the previews (mobile-first). */}
      {proposal.status === "open" && canReview && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <button
            disabled={pending}
            onClick={() =>
              confirm(
                "Accept this proposal? It publishes a new version and overwrites the working draft."
              ) && run(() => acceptProposal(proposal.id, proposal.cardId))
            }
            className="rounded-md bg-emerald-600 px-3 py-1 font-medium text-white disabled:opacity-50"
          >
            Accept
          </button>
          {!denying ? (
            <button
              disabled={pending}
              onClick={() => setDenying(true)}
              className="rounded-md border px-3 py-1"
            >
              Deny
            </button>
          ) : (
            <span className="flex items-center gap-1">
              <input
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason…"
                className="rounded-md border bg-background px-2 py-1"
              />
              <button
                disabled={pending || !reason.trim()}
                onClick={() => run(() => denyProposal(proposal.id, proposal.cardId, reason))}
                className="rounded-md border px-2 py-1 disabled:opacity-50"
              >
                Confirm deny
              </button>
            </span>
          )}
        </div>
      )}

      {changes.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs">
          {changes.map((c) => (
            <li key={c.field as string}>
              <span className="font-medium">{c.label}:</span>{" "}
              <span className="text-red-600 line-through">{c.before ?? "—"}</span>
              {" → "}
              <span className="text-emerald-700">{c.after ?? "—"}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Current</p>
          <ForgeCardPreview card={current} artUrl={artUrl} />
        </div>
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Proposed</p>
          <ForgeCardPreview card={proposal.proposedSnapshot} artUrl={artUrl} />
        </div>
      </div>
    </div>
  );
}
