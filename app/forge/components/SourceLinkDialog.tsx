"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setArtCandidateSource } from "@/app/forge/lib/artCandidates";

export default function SourceLinkDialog({
  cardId, candidateId, sourceUrl, onClose, onSaved,
}: {
  cardId: string;
  candidateId: string;
  sourceUrl: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(sourceUrl ?? "");
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save(next: string | null) {
    setErr(null);
    setBusy(next ? "save" : "clear");
    const r = await setArtCandidateSource(cardId, candidateId, next);
    setBusy(null);
    if (r.ok === false) setErr(r.error ?? "Could not save link");
    else onSaved();
  }

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <form
        className="flex w-full max-w-sm flex-col gap-3 rounded-lg border bg-background p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (value.trim()) void save(value); }}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">Source link</p>
          {sourceUrl && (
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-muted-foreground underline hover:text-foreground">
              Open ↗
            </a>
          )}
        </div>
        <Input type="url" placeholder="https://…" value={value}
          onChange={(e) => setValue(e.target.value)} autoFocus disabled={busy !== null} />
        {err && <p className="text-sm text-destructive">{err}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy !== null}>Cancel</Button>
          {sourceUrl && (
            <Button type="button" variant="outline" size="sm" onClick={() => save(null)} disabled={busy !== null}>
              {busy === "clear" ? "Clearing…" : "Clear"}
            </Button>
          )}
          <Button type="submit" size="sm" disabled={busy !== null || !value.trim()}>
            {busy === "save" ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
