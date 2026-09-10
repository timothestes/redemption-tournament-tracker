"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { timeAgo } from "@/app/forge/lib/relativeTime";
import { groupCommentsByCard, toDateInputValue, type SetCommentThread } from "@/app/forge/lib/setCommentsView";
import type { SetCommentRow } from "@/app/forge/lib/comments";

const selectClass = "rounded-md border bg-background px-2 py-1.5 text-sm";
const pillClass = "rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground";

function Comment({ c, isReply, contextOnly }: { c: SetCommentRow; isReply?: boolean; contextOnly?: boolean }) {
  return (
    <div className={`rounded-md border p-2 text-sm ${isReply ? "ml-4" : ""} ${c.resolved ? "opacity-60" : ""}`}>
      <p className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{c.authorName ?? "Forge member"}</span>
        {" · "}
        {timeAgo(c.createdAt)}
        {c.resolved && <span className={pillClass}>Resolved</span>}
        {c.proposalId && <span className={pillClass}>on a proposal</span>}
        {contextOnly && <span className={pillClass}>Earlier</span>}
      </p>
      <p className="whitespace-pre-wrap">{c.body}</p>
    </div>
  );
}

function Thread({ thread }: { thread: SetCommentThread }) {
  return (
    <div className="space-y-2">
      <Comment c={thread.comment} contextOnly={thread.contextOnly} />
      {thread.replies.map((r) => (
        <Comment key={r.id} c={r} isReply />
      ))}
    </div>
  );
}

export default function SetCommentsFeed({ setId, comments }: { setId: string; comments: SetCommentRow[] }) {
  const [since, setSince] = useState(""); // "" = no date filter
  const [unresolvedOnly, setUnresolvedOnly] = useState(false);
  const init = useRef(false);
  useEffect(() => {
    if (init.current) return; // StrictMode runs effects twice; the ref survives
    init.current = true;
    const key = `forge:set:${setId}:comments-last-visit`;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(key);
    } catch {}
    const ms = stored ? Date.parse(stored) : NaN;
    setSince(toDateInputValue(Number.isFinite(ms) ? ms : Date.now() - 7 * 24 * 60 * 60 * 1000));
    try {
      window.localStorage.setItem(key, new Date().toISOString());
    } catch {}
  }, [setId]);

  const groups = useMemo(() => groupCommentsByCard(comments, { since, unresolvedOnly }), [comments, since, unresolvedOnly]);
  const n = groups.reduce((s, g) => s + g.count, 0);

  const controls = (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Since
        <input
          type="date"
          value={since}
          onChange={(e) => setSince(e.target.value)}
          aria-label="Show comments since date"
          className={selectClass}
        />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input type="checkbox" checked={unresolvedOnly} onChange={(e) => setUnresolvedOnly(e.target.checked)} />
        Unresolved only
      </label>
      <button onClick={() => setSince("")} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
        All time
      </button>
      <span className="text-xs text-muted-foreground">
        {n} of {comments.length}
      </span>
    </div>
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
                <Thread key={t.comment.id} thread={t} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
