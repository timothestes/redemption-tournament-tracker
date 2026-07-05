"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { coerceFieldValue, FIELD_LABELS, DIFF_FIELDS } from "@/app/forge/lib/cardDiff";
import {
  addComment,
  resolveComment,
  applySuggestion,
  deleteComment,
  type CommentRow,
} from "@/app/forge/lib/comments";
import { timeAgo } from "@/app/forge/lib/relativeTime";

function valueText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

export default function CommentThread({
  cardId,
  comments,
  canApply,
}: {
  cardId: string;
  comments: CommentRow[];
  canApply: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");
  const [field, setField] = useState("");
  const [value, setValue] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) alert(r.error ?? "Action failed");
      else after?.();
      router.refresh();
    });

  // Card-level thread only (proposal-anchored comments live under their proposal).
  const cardComments = comments.filter((c) => c.proposalId === null);
  const top = cardComments.filter((c) => c.parentId === null);
  const repliesOf = (id: string) => cardComments.filter((c) => c.parentId === id);

  const submitTop = () =>
    run(
      () =>
        addComment({
          cardId,
          body,
          field: field || null,
          suggestedValue: field && value.trim() ? coerceFieldValue(field, value) : undefined,
        }),
      () => {
        setBody("");
        setField("");
        setValue("");
      }
    );

  const Comment = ({ c, isReply }: { c: CommentRow; isReply?: boolean }) => (
    <div className={`rounded-md border p-2 text-sm ${isReply ? "ml-4" : ""} ${c.resolved ? "opacity-60" : ""}`}>
      <p className="mb-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{c.authorName ?? "Forge member"}</span>
        {" · "}
        {timeAgo(c.createdAt)}
      </p>
      {c.field && (
        <p className="text-xs text-muted-foreground">
          Suggestion · <span className="font-medium">{FIELD_LABELS[c.field] ?? c.field}</span>
          {c.suggestedValue != null && <> → {valueText(c.suggestedValue)}</>}
        </p>
      )}
      <p className="whitespace-pre-wrap">{c.body}</p>
      <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
        {c.field && c.suggestedValue != null && canApply && !c.resolved && (
          <button disabled={pending} onClick={() => run(() => applySuggestion(c.id, cardId))} className="text-foreground underline-offset-2 hover:text-primary hover:underline">
            Apply
          </button>
        )}
        <button disabled={pending} onClick={() => run(() => resolveComment(c.id, cardId, !c.resolved))} className="hover:underline">
          {c.resolved ? "Unresolve" : "Resolve"}
        </button>
        {!isReply && (
          <button onClick={() => setReplyTo(replyTo === c.id ? null : c.id)} className="hover:underline">
            Reply
          </button>
        )}
        <button disabled={pending} onClick={() => confirm("Delete this comment?") && run(() => deleteComment(c.id, cardId))} className="text-destructive hover:underline">
          Delete
        </button>
      </div>
      {replyTo === c.id && (
        <div className="mt-2 flex items-center gap-1">
          <input
            autoFocus
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="Reply…"
            className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={pending || !replyBody.trim()}
            onClick={() =>
              run(
                () => addComment({ cardId, parentId: c.id, body: replyBody }),
                () => {
                  setReplyBody("");
                  setReplyTo(null);
                }
              )
            }
          >
            Send
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Compose */}
      <div className="space-y-2 rounded-md border p-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Comment, or attach a field suggestion below…"
          className="h-16 w-full rounded-md border bg-background px-2 py-1 text-sm"
        />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select value={field} onChange={(e) => setField(e.target.value)} className="rounded-md border bg-background px-2 py-1">
            <option value="">No field</option>
            {DIFF_FIELDS.map((f) => (
              <option key={f as string} value={f as string}>
                {FIELD_LABELS[f as string]}
              </option>
            ))}
          </select>
          {field && (
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Suggested value (comma-separate lists)"
              className="flex-1 rounded-md border bg-background px-2 py-1"
            />
          )}
          <Button size="sm" className="ml-auto" disabled={pending || !body.trim()} onClick={submitTop}>
            Post
          </Button>
        </div>
      </div>

      {top.length === 0 && <p className="text-xs text-muted-foreground">No comments yet.</p>}
      {top.map((c) => (
        <div key={c.id} className="space-y-2">
          <Comment c={c} />
          {repliesOf(c.id).map((r) => (
            <Comment key={r.id} c={r} isReply />
          ))}
        </div>
      ))}
    </div>
  );
}
