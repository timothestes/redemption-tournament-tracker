"use client";

import { useEffect, useRef, useState } from "react";
import { saveSetNotes } from "@/app/forge/lib/sets";

export default function NotesEditor({ setId, initial, canEdit }: { setId: string; initial: string; canEdit: boolean }) {
  const [notes, setNotes] = useState(initial);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = useRef(true);
  const lastServer = useRef(initial);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSaved("saving");
      const r = await saveSetNotes(setId, notes);
      setSaved(r.ok ? "saved" : "error");
    }, 700);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [notes, setId]);

  useEffect(() => {
    if (initial === lastServer.current) return;     // our own save / no remote change
    const wasDirty = notes !== lastServer.current;   // local edits not yet reflected
    lastServer.current = initial;
    if (!wasDirty) setNotes(initial);                // safe to adopt the remote value
  }, [initial, notes]);

  if (!canEdit) {
    return <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-4 text-sm">{notes || "No notes yet."}</pre>;
  }
  return (
    <div>
      <div className="mb-1 text-right text-xs text-muted-foreground">
        {saved === "saving" ? "Saving…" : saved === "saved" ? "Saved" : saved === "error" ? "Save failed" : ""}
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Direction, themes, open questions, decisions… (markdown)"
        className="h-[60vh] w-full rounded-md border bg-background p-4 font-mono text-sm"
      />
    </div>
  );
}
