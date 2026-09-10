// Pure assembly of the set-wide Comments feed — isomorphic (no "use server"),
// imported by a client component and by unit tests alike (same shape as
// app/forge/lib/historyView.ts).

import type { SetCommentRow } from "@/app/forge/lib/comments";

export type SetCommentThread = { comment: SetCommentRow; replies: SetCommentRow[]; contextOnly: boolean };
export type SetCommentGroup = { cardId: string; cardTitle: string | null; latestAt: string; count: number; threads: SetCommentThread[] };

// "2026-09-05" -> epoch ms at LOCAL midnight. Date.parse() on a bare date is UTC,
// which shifts the cutoff by up to a day for US viewers.
export function sinceCutoffMs(since: string | null | undefined): number | null {
  if (!since) return null;
  const ms = Date.parse(`${since}T00:00:00`);
  return Number.isFinite(ms) ? ms : null;
}

// epoch ms -> "YYYY-MM-DD" in the viewer's timezone (for <input type="date">).
export function toDateInputValue(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function groupCommentsByCard(
  comments: SetCommentRow[],
  opts?: { since?: string; unresolvedOnly?: boolean }
): SetCommentGroup[] {
  const cutoff = sinceCutoffMs(opts?.since);
  const matches = (x: SetCommentRow) =>
    (cutoff === null || Date.parse(x.createdAt) >= cutoff) && (!opts?.unresolvedOnly || !x.resolved);

  const ids = new Set(comments.map((c) => c.id));
  const repliesByParent = new Map<string, SetCommentRow[]>();
  const topLevel: SetCommentRow[] = [];
  for (const row of comments) {
    if (row.parentId && ids.has(row.parentId)) {
      const list = repliesByParent.get(row.parentId) ?? [];
      list.push(row);
      repliesByParent.set(row.parentId, list);
    } else {
      topLevel.push(row);
    }
  }

  const groupsByCard = new Map<string, SetCommentGroup>();
  for (const row of topLevel) {
    const kept = (repliesByParent.get(row.id) ?? [])
      .filter(matches)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    if (!matches(row) && kept.length === 0) continue;
    const thread: SetCommentThread = { comment: row, replies: kept, contextOnly: !matches(row) };

    let group = groupsByCard.get(row.cardId);
    if (!group) {
      group = { cardId: row.cardId, cardTitle: row.cardTitle, latestAt: row.createdAt, count: 0, threads: [] };
      groupsByCard.set(row.cardId, group);
    }
    group.threads.push(thread);
    const rendered = [row, ...kept];
    for (const r of rendered) {
      if (Date.parse(r.createdAt) > Date.parse(group.latestAt)) group.latestAt = r.createdAt;
    }
  }

  for (const group of groupsByCard.values()) {
    group.count = group.threads.reduce((n, t) => n + (t.contextOnly ? 0 : 1) + t.replies.length, 0);
    group.threads.sort((a, b) => Date.parse(b.comment.createdAt) - Date.parse(a.comment.createdAt));
  }

  return [...groupsByCard.values()].sort((a, b) => Date.parse(b.latestAt) - Date.parse(a.latestAt));
}
