"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { sendMissive, sendMissiveTest } from "@/app/forge/lib/missives";

// Inlined (not imported from lib/missives) so this client component never pulls the
// server-only supabase client into the browser bundle.
type ForgeRole = "superadmin" | "elder" | "playtester";
type Member = { userId: string; displayName: string | null; role: ForgeRole; email: string; setIds: string[] };
type Recent = { id: string; sender: string; subject: string; recipientCount: number; sentAt: string };

export default function AnnouncementComposer({
  members,
  sets,
  recent,
  callerId,
}: {
  members: Member[];
  sets: { id: string; name: string }[];
  recent: Recent[];
  callerId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const membersByUserId = new Map(members.map((m) => [m.userId, m]));
  const canSend = selected.size > 0 && subject.trim().length > 0 && body.trim().length > 0 && !pending;

  function selectAll() {
    setSelected(new Set(members.map((m) => m.userId)));
  }
  function selectElders() {
    setSelected(new Set(members.filter((m) => m.role === "elder" || m.role === "superadmin").map((m) => m.userId)));
  }
  function selectPlaytesters() {
    setSelected(new Set(members.filter((m) => m.role === "playtester").map((m) => m.userId)));
  }
  function selectNone() {
    setSelected(new Set());
  }
  function selectSet(setId: string) {
    setSelected(new Set(members.filter((m) => m.setIds.includes(setId)).map((m) => m.userId)));
  }
  function toggleMember(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function handleTestSend() {
    setMsg(null);
    startTransition(async () => {
      const r = await sendMissiveTest({ subject, body });
      setMsg(r.ok ? "Test sent." : r.error ?? "Failed");
    });
  }

  function handleSend() {
    if (!window.confirm(`Send this announcement to ${selected.size} member(s)?`)) return;
    setMsg(null);
    startTransition(async () => {
      const r = await sendMissive({ subject, body, recipientIds: Array.from(selected) });
      if (r.ok === false) {
        setMsg(r.error ?? "Failed");
        return;
      }
      setSubject("");
      setBody("");
      setSelected(new Set());
      setMsg(`Sent ${r.sent}, failed ${r.failed}.`);
    });
  }

  return (
    <div className="mt-6 space-y-8">
      <section>
        <h2 className="text-lg font-medium">Compose an announcement</h2>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={selectAll} disabled={pending}>
            All
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={selectElders} disabled={pending}>
            Elders
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={selectPlaytesters} disabled={pending}>
            Playtesters
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={selectNone} disabled={pending}>
            None
          </Button>
          {sets.length > 0 && (
            <label className="text-xs">
              Everyone on set…
              <select
                className="ml-1.5 rounded-md border bg-background px-2 py-1 text-xs"
                value=""
                onChange={(e) => {
                  if (e.target.value) selectSet(e.target.value);
                  e.target.value = "";
                }}
                disabled={pending}
              >
                <option value="" disabled>
                  Choose a set
                </option>
                {sets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="mt-2 max-h-64 overflow-y-auto rounded-md border">
          {members.map((m) => (
            <label
              key={m.userId}
              htmlFor={`recipient-${m.userId}`}
              className="flex cursor-pointer items-center gap-2 border-b px-2 py-1.5 text-sm last:border-b-0"
            >
              <Checkbox
                id={`recipient-${m.userId}`}
                checked={selected.has(m.userId)}
                onCheckedChange={() => toggleMember(m.userId)}
                disabled={pending}
              />
              <span>{m.displayName ?? "(no name)"}</span>
              <span className="text-xs text-muted-foreground">{m.role}</span>
              <span className="ml-auto text-xs text-muted-foreground">{m.email}</span>
            </label>
          ))}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {selected.size} recipient{selected.size === 1 ? "" : "s"} selected
        </p>

        <label className="mt-4 block text-sm">
          Subject
          <input
            type="text"
            className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={pending}
          />
        </label>
        <p className="mt-1 text-xs text-muted-foreground">Sent as: [Forge] {subject}</p>

        <label className="mt-4 block text-sm">
          Body
          <textarea
            rows={10}
            className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={pending}
          />
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          Plain text. {"{name}"} becomes each member&apos;s display name. Your signature and the
          confidentiality notice are added automatically.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleTestSend}
            disabled={pending || subject.trim().length === 0 || body.trim().length === 0}
          >
            Send test to me
          </Button>
          <Button type="button" size="sm" onClick={handleSend} disabled={!canSend}>
            Send to {selected.size} member{selected.size === 1 ? "" : "s"}
          </Button>
        </div>

        {msg && (
          <p aria-live="polite" className="mt-2 text-sm">
            {msg}
          </p>
        )}
      </section>

      <section>
        <h2 className="text-lg font-medium">Recent announcements</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {recent.map((r) => (
            <li key={r.id} className="text-muted-foreground">
              {r.subject} · {membersByUserId.get(r.sender)?.displayName ?? "Former member"} ·{" "}
              {r.recipientCount} recipient{r.recipientCount === 1 ? "" : "s"} ·{" "}
              {new Date(r.sentAt).toLocaleDateString()}
            </li>
          ))}
          {recent.length === 0 && <li className="text-muted-foreground">No announcements sent yet.</li>}
        </ul>
      </section>
    </div>
  );
}
