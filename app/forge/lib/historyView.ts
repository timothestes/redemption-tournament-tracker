// Pure assembly of the card History timeline — isomorphic (no "use server"),
// imported by client components and unit tests alike.

import { diffCards, type FieldChange } from "@/app/forge/lib/cardDiff";
import type { ProposalRow } from "@/app/forge/lib/proposals";
import type { VersionRow, CardEventRow } from "@/app/forge/lib/versions";
import type { CommentRow } from "@/app/forge/lib/comments";

export type HistoryEvent =
  | { kind: "version"; at: string; version: VersionRow; changes: FieldChange[] }
  | { kind: "proposal"; at: string; proposal: ProposalRow; reasons: CommentRow[]; supersededBy: string | null; resultingVersionNumber: number | null }
  | { kind: "lifecycle"; at: string; event: CardEventRow };

export const EVENT_LABEL: Record<string, string> = {
  card_approved: "Marked final",
  card_unapproved: "Reopened testing",
  card_archived: "Shelved",
  card_unarchived: "Restored",
  card_returned_to_ideas: "Returned to ideas",
};

// A superseded proposal closes inside forge_accept_proposal, in the same
// transaction as the winning sibling — their closed_at values are identical
// (transaction-stable now()). No accepted sibling at that instant means the
// stale-base case: a direct release replaced the version it was based on.
export function deriveSupersededBy(p: ProposalRow, all: ProposalRow[]): string | null {
  if (p.status !== "superseded" || !p.closedAt) return null;
  const winner = all.find(
    (q) => q.id !== p.id && q.status === "accepted" && q.closedAt === p.closedAt
  );
  return winner ? (winner.summary ?? "an accepted proposal") : null;
}

// Newest-first merged timeline. Ties (an accept freezes a version and closes
// the proposal at the same instant) order version above its proposal entry.
const KIND_RANK: Record<HistoryEvent["kind"], number> = { lifecycle: 0, version: 1, proposal: 2 };

export function buildHistory(
  versions: VersionRow[],
  proposals: ProposalRow[],
  events: CardEventRow[],
  comments: CommentRow[]
): HistoryEvent[] {
  const byNumber = new Map(versions.map((v) => [v.versionNumber, v]));
  const out: HistoryEvent[] = [];
  for (const v of versions) {
    const prev = byNumber.get(v.versionNumber - 1);
    out.push({ kind: "version", at: v.createdAt, version: v, changes: diffCards(prev?.data ?? {}, v.data) });
  }
  for (const p of proposals) {
    if (p.status === "open") continue;
    out.push({
      kind: "proposal",
      at: p.closedAt ?? p.createdAt,
      proposal: p,
      reasons: comments.filter((c) => c.proposalId === p.id),
      supersededBy: deriveSupersededBy(p, proposals),
      resultingVersionNumber:
        versions.find((v) => v.id === p.resultingVersionId)?.versionNumber ?? null,
    });
  }
  for (const e of events) out.push({ kind: "lifecycle", at: e.at, event: e });
  return out.sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at) || KIND_RANK[a.kind] - KIND_RANK[b.kind]
  );
}

// Era dividers for the (ascending) top-level comment thread: before the first
// comment written at-or-after each release, mark which version it followed.
export type CommentEraItem =
  | { kind: "comment"; comment: CommentRow }
  | { kind: "era"; versionNumber: number; at: string };

export function buildCommentEras(
  topComments: CommentRow[],
  versions: Pick<VersionRow, "versionNumber" | "createdAt">[]
): CommentEraItem[] {
  const eras = [...versions].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const out: CommentEraItem[] = [];
  let nextEra = 0;
  for (const c of topComments) {
    while (nextEra < eras.length && Date.parse(eras[nextEra].createdAt) <= Date.parse(c.createdAt)) {
      out.push({ kind: "era", versionNumber: eras[nextEra].versionNumber, at: eras[nextEra].createdAt });
      nextEra++;
    }
    out.push({ kind: "comment", comment: c });
  }
  return out;
}
