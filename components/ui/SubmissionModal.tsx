"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "./dialog";
import { getSubmissionAction } from "@/app/tracker/tournaments/actions";
import { findCard } from "@/lib/cards/lookup";
import type { DeckSnapshot, DeckSnapshotCard } from "@/lib/tournament/deckSubmission";
import type { DeckCheckIssue } from "@/utils/deckcheck";

interface SubmissionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournamentId: string;
  participantId: string | null;
  participantName: string;
}

interface SubmissionDetail {
  snapshot: DeckSnapshot;
  isLegal: boolean | null;
  issues: DeckCheckIssue[];
  submittedAt: string;
  source: "player" | "host";
  submittedByUsername: string | null;
}

/** green/red/gray for true/false/null — shared between the participant table's
 * decklist cell and this modal's header so the two never drift apart. */
export function LegalityDot({ isLegal }: { isLegal: boolean | null }) {
  const color =
    isLegal === true
      ? "bg-primary"
      : isLegal === false
        ? "bg-destructive"
        : "bg-muted-foreground/50";
  const label = isLegal === true ? "Legal" : isLegal === false ? "Illegal" : "Legality unknown";
  return (
    <span
      className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${color}`}
      title={label}
      aria-label={label}
    />
  );
}

function groupByType(cards: DeckSnapshotCard[]): { type: string; cards: DeckSnapshotCard[] }[] {
  const groups = new Map<string, DeckSnapshotCard[]>();
  for (const c of cards) {
    const resolved = findCard(c.name, c.set, c.imgFile ?? undefined);
    const type = resolved?.type || "Other";
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type)!.push(c);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === "Other") return 1;
      if (b === "Other") return -1;
      return a.localeCompare(b);
    })
    .map(([type, typeCards]) => ({
      type,
      cards: [...typeCards].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

function ZoneSection({ title, cards }: { title: string; cards: DeckSnapshotCard[] }) {
  if (cards.length === 0) return null;
  const groups = groupByType(cards);
  const total = cards.reduce((n, c) => n + c.quantity, 0);
  return (
    <div>
      <h4 className="text-sm font-semibold text-foreground">
        {title} <span className="font-normal text-muted-foreground">({total})</span>
      </h4>
      <div className="mt-1.5 space-y-2">
        {groups.map((g) => (
          <div key={g.type}>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {g.type}
            </p>
            <ul className="text-sm text-foreground">
              {g.cards.map((c, i) => (
                <li key={`${c.name}-${c.set}-${i}`} className="truncate">
                  {c.quantity}× {c.name} <span className="text-muted-foreground">({c.set})</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

const ISSUE_COLOR: Record<DeckCheckIssue["type"], string> = {
  error: "text-destructive",
  warning: "text-amber-600 dark:text-amber-400",
  info: "text-blue-600 dark:text-blue-400",
};

export default function SubmissionModal({
  open,
  onOpenChange,
  tournamentId,
  participantId,
  participantName,
}: SubmissionModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submission, setSubmission] = useState<SubmissionDetail | null>(null);

  useEffect(() => {
    if (!open || !participantId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getSubmissionAction(tournamentId, participantId)
      .then((res) => {
        if (cancelled) return;
        if (res.success === true && res.submission) {
          setSubmission(res.submission);
        } else {
          setError(res.error ?? "not_found");
        }
      })
      .catch(() => {
        // Thrown server action / network failure — distinct from the
        // `{ success: false }` path above, which the action returns
        // normally. Without this, a rejection leaves `loading` true
        // forever and the modal is stuck on "Loading…" until closed and
        // reopened.
        if (cancelled) return;
        setError("load_failed");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, participantId, tournamentId]);

  // Clear stale data once the dialog closes so the next open doesn't briefly
  // flash the previous participant's deck before the fresh fetch resolves.
  useEffect(() => {
    if (!open) {
      setSubmission(null);
      setError(null);
    }
  }, [open]);

  const mainCards = submission?.snapshot.cards.filter((c) => c.zone === "main") ?? [];
  const reserveCards = submission?.snapshot.cards.filter((c) => c.zone === "reserve") ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle>{submission?.snapshot.deckName ?? "Decklist"}</DialogTitle>
            {submission && <LegalityDot isLegal={submission.isLegal} />}
          </div>
          <p className="text-sm text-muted-foreground">{participantName}</p>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!loading && error && (
            <p className="text-sm text-destructive">Couldn't load the submission — try again.</p>
          )}
          {!loading && submission && (
            <>
              <p className="text-xs text-muted-foreground">
                {submission.source === "player" ? "Submitted" : "Attached"} by{" "}
                {submission.submittedByUsername ? `@${submission.submittedByUsername}` : "unknown"}
                {" · "}
                {new Date(submission.submittedAt).toLocaleString()}
              </p>
              {submission.isLegal === false && submission.issues.length > 0 && (
                <div className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  {submission.issues.map((issue, i) => (
                    <p key={i} className={`text-xs ${ISSUE_COLOR[issue.type]}`}>
                      {issue.message}
                    </p>
                  ))}
                </div>
              )}
              <ZoneSection title="Main deck" cards={mainCards} />
              <ZoneSection title="Reserve" cards={reserveCards} />
            </>
          )}
        </DialogBody>
        <DialogFooter className="justify-end">
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-sm font-medium text-foreground bg-card border border-border rounded-lg hover:bg-muted transition-colors"
          >
            Close
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
