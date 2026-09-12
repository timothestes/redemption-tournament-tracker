"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { timeAgo } from "@/app/forge/lib/relativeTime";
import { groupCommentsByCard, type SetCommentThread } from "@/app/forge/lib/setCommentsView";
import { useLastVisit } from "@/app/forge/lib/useLastVisit";
import SinceFilter from "../SinceFilter";
import type { SetCommentRow } from "@/app/forge/lib/comments";

const pillClass = "rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground";
const newPillClass = "rounded-full border border-foreground/30 px-2 py-0.5 text-[11px] font-medium text-foreground";

function Comment({
  c,
  isReply,
  contextOnly,
  isNew,
}: {
  c: SetCommentRow;
  isReply?: boolean;
  contextOnly?: boolean;
  isNew?: boolean;
}) {
  return (
    <div className={`rounded-md border p-2 text-sm ${isReply ? "ml-4" : ""} ${c.resolved ? "opacity-60" : ""}`}>
      <p className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{c.authorName ?? "Forge member"}</span>
        {" · "}
        {timeAgo(c.createdAt)}
        {isNew && <span className={newPillClass}>New</span>}
        {c.resolved && <span className={pillClass}>Resolved</span>}
        {c.proposalId && <span className={pillClass}>on a proposal</span>}
        {contextOnly && <span className={pillClass}>Earlier</span>}
      </p>
      <p className="whitespace-pre-wrap">{c.body}</p>
    </div>
  );
}

function Thread({ thread, isNew }: { thread: SetCommentThread; isNew: (c: SetCommentRow) => boolean }) {
  return (
    <div className="space-y-2">
      <Comment c={thread.comment} contextOnly={thread.contextOnly} isNew={!thread.contextOnly && isNew(thread.comment)} />
      {thread.replies.map((r) => (
        <Comment key={r.id} c={r} isReply isNew={isNew(r)} />
      ))}
    </div>
  );
}

export default function SetCommentsFeed({ setId, comments }: { setId: string; comments: SetCommentRow[] }) {
  const [since, setSince] = useState(""); // "" = no date filter; the feed opens on everything
  const [unresolvedOnly, setUnresolvedOnly] = useState(false);
  const lastVisit = useLastVisit(`forge:set:${setId}:comments-last-visit`);

  const groups = useMemo(() => groupCommentsByCard(comments, { since, unresolvedOnly }), [comments, since, unresolvedOnly]);
  const n = groups.reduce((s, g) => s + g.count, 0);
  const isNew = (c: SetCommentRow) => lastVisit !== null && Date.parse(c.createdAt) > lastVisit;
  // Counted through the unresolved filter (but not the date one, which the chip
  // sets), so the chip never promises comments the current filter would hide.
  const newCount = comments.filter((c) => isNew(c) && (!unresolvedOnly || !c.resolved)).length;

  const controls = (
    <SinceFilter
      since={since}
      onSince={setSince}
      shown={n}
      total={comments.length}
      newCount={newCount}
      lastVisit={lastVisit}
      dateLabel="Show comments since date"
    >
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input type="checkbox" checked={unresolvedOnly} onChange={(e) => setUnresolvedOnly(e.target.checked)} />
        Unresolved only
      </label>
    </SinceFilter>
  );

  if (comments.length === 0) {
    return (
      <div className="space-y-3">
        {controls}
        <p className="text-sm text-muted-foreground">No comments on this set&apos;s cards yet.</p>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="space-y-3">
        {controls}
        <p className="text-sm text-muted-foreground">
          Nothing new since {since || "the start"}
          {unresolvedOnly ? " that is still unresolved" : ""}.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {controls}
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.cardId} className="space-y-2">
            <div className="flex items-center justify-between">
              <Link href={`/forge/cards/${g.cardId}`} className="font-medium hover:underline">
                {g.cardTitle ?? "Untitled card"}
              </Link>
              <span className="text-xs text-muted-foreground">{g.count}</span>
            </div>
            <div className="space-y-2">
              {g.threads.map((t) => (
                <Thread key={t.comment.id} thread={t} isNew={isNew} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
