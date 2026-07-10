"use client";

import { timeAgo } from "@/app/forge/lib/relativeTime";
import { summarizeDiff, type FieldChange } from "@/app/forge/lib/cardDiff";
import {
  EVENT_LABEL,
  VERSION_STATUS_LABEL,
  VERSION_PILL,
  versionVerb,
  type HistoryEvent,
} from "@/app/forge/lib/historyView";

const PROPOSAL_STATUS_LABEL: Record<string, string> = {
  accepted: "Accepted",
  denied: "Denied",
  superseded: "Superseded",
};

function ChangeList({ changes }: { changes: FieldChange[] }) {
  if (changes.length === 0) return null;
  return (
    <details className="mt-1">
      <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
        {summarizeDiff(changes)}
      </summary>
      <ul className="mt-1 space-y-1 text-xs">
        {changes.map((c) => (
          <li key={c.field as string}>
            <span className="font-medium">{c.label}:</span>{" "}
            <span className="text-destructive line-through">{c.before ?? "—"}</span>
            {" → "}
            <span className="text-primary">{c.after ?? "—"}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function CardHistory({ history }: { history: HistoryEvent[] }) {
  if (history.length === 0) {
    return <p className="text-xs text-muted-foreground">No history yet.</p>;
  }
  return (
    <ul className="space-y-1 text-xs">
      {history.map((e) => {
        if (e.kind === "version") {
          const v = e.version;
          return (
            <li key={`v-${v.id}`} className="rounded-md border px-2 py-1.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-medium">v{v.versionNumber} {versionVerb(v.status)}</span>
                <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${VERSION_PILL[v.status]}`}>
                  {VERSION_STATUS_LABEL[v.status]}
                </span>
                <span className="text-muted-foreground">
                  {v.authorName ?? "Forge member"} · {timeAgo(v.createdAt)}
                </span>
              </div>
              {v.note && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{v.note}</p>}
              <ChangeList changes={e.changes} />
            </li>
          );
        }
        if (e.kind === "proposal") {
          const p = e.proposal;
          return (
            <li key={`p-${p.id}`} className="rounded-md border px-2 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span>{p.summary ?? "Proposed change"}</span>
                <span className="text-muted-foreground">
                  {PROPOSAL_STATUS_LABEL[p.status] ?? p.status}
                  {p.status === "accepted" && e.resultingVersionNumber != null && <> → v{e.resultingVersionNumber}</>}
                </span>
              </div>
              <p className="mt-0.5 text-muted-foreground">
                Proposed by <span className="font-medium text-foreground">{p.proposerName ?? "Forge member"}</span>
                {p.status === "accepted" && p.approverName && (
                  <> · accepted by <span className="font-medium text-foreground">{p.approverName}</span></>
                )}
              </p>
              {p.status === "superseded" && (
                <p className="mt-1 text-muted-foreground">
                  {e.supersededBy
                    ? <>Superseded when “{e.supersededBy}” was accepted.</>
                    : <>Out of date — a direct release replaced the version it was based on.</>}
                </p>
              )}
              {e.reasons.map((r) => (
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
        }
        return (
          <li key={`e-${e.event.id}`} className="px-2 py-1 text-muted-foreground">
            <span className="font-medium text-foreground">{EVENT_LABEL[e.event.action] ?? e.event.action}</span>
            {" · "}
            {e.event.actorName ?? "Forge member"}
            {" · "}
            {timeAgo(e.at)}
          </li>
        );
      })}
    </ul>
  );
}
