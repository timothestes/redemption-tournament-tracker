"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ForgeCardFace from "@/app/forge/components/ForgeCardFace";
import ForgeBreadcrumbs from "@/app/forge/components/ForgeBreadcrumbs";
import { Button } from "@/components/ui/button";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";
import { saveCard, uploadArt, uploadFinished, setPlaceholder, type ForgeCardFull } from "@/app/forge/lib/cards";
import { createProposal } from "@/app/forge/lib/proposals";
import { cardRawText, type DesignCard } from "@/app/forge/lib/designCard";
import LifecycleControls from "./LifecycleControls";
import type { ForgeSetSummary } from "@/app/forge/lib/sets";
import { forgeCardTopic } from "@/app/forge/lib/realtime";
import { useForgeCardChannel } from "@/app/forge/lib/useForgeRealtime";
import PresenceBar from "./PresenceBar";

// DESCOPE (2026-07-03): the structured template (FullModeForm) and the composite
// renderer (ForgeCardPreview) were removed from the studio. A card is now a name +
// raw text + optional artwork + optional finished-card image. Both files remain on
// disk (unused here) for recovery.

export default function StudioEditor({
  card, sets, currentUser, setId, setName,
}: {
  card: ForgeCardFull;
  sets: ForgeSetSummary[];
  currentUser: { userId: string; displayName: string | null };
  setId: string | null;
  setName: string | null;
}) {
  const [snapshot, setSnapshot] = useState<DesignCard>(card.snapshot ?? {});
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRender = useRef(true);
  const fieldsDirty = useRef(false);
  const [pendingFinished, setPendingFinished] = useState<File | null>(null);
  const [uploading, setUploading] = useState<"art" | "finished" | null>(null);
  const router = useRouter();

  const { others, setEditing } = useForgeCardChannel(
    setId ? forgeCardTopic(card.id) : null,
    { userId: currentUser.userId, displayName: currentUser.displayName, editing: false },
  );

  // Debounced autosave — fires only after the user edits (skips mount).
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSaved("saving");
      const r = await saveCard(card.id, snapshot);
      setSaved(r.ok ? "saved" : "error");
    }, 700);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [snapshot, card.id]);

  const update = (patch: Partial<DesignCard>) => {
    fieldsDirty.current = true;
    setSnapshot((s) => ({ ...s, ...patch }));
  };

  async function onUpload(file: File, kind: "art" | "finished") {
    setErr(null);
    setUploading(kind);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const r = kind === "art" ? await uploadArt(card.id, fd) : await uploadFinished(card.id, fd);
      if (r.ok === false) setErr(r.error ?? "Upload failed");
      else router.refresh();
    } finally {
      setUploading(null);
    }
  }

  const [proposing, setProposing] = useState(false);
  const [proposeSummary, setProposeSummary] = useState("");
  const [proposeBusy, setProposeBusy] = useState(false);
  const submitProposal = async () => {
    if (!proposeSummary.trim()) return;
    setProposeBusy(true);
    const r = await createProposal(card.id, snapshot, proposeSummary);
    setProposeBusy(false);
    if (r.ok === false) { alert(r.error); return; }
    setProposing(false);
    setProposeSummary("");
    router.refresh();
  };

  // Cache-buster: updated_at bumps on every image/snapshot write, so the browser can
  // cache each t-stamped art URL indefinitely and still swap after router.refresh().
  const t = Date.parse(card.updatedAt) || 0;

  return (
    <div className="mx-auto max-w-5xl p-4">
      <PresenceBar others={others} />
      <div className="mb-3 flex flex-col gap-2 text-sm">
        <div className="flex items-center justify-between">
          <ForgeBreadcrumbs items={
            card.setId
              ? [
                  { label: "The Forge", href: "/forge" },
                  { label: "Sets", href: "/forge/sets" },
                  { label: setName ?? "Set", href: `/forge/sets/${card.setId}/cards` },
                  { label: card.title?.trim() || "Untitled" },
                ]
              : [
                  { label: "The Forge", href: "/forge" },
                  { label: "Ideas", href: "/forge/ideas" },
                  { label: card.title?.trim() || "Untitled" },
                ]
          } />
          <span className="text-xs text-muted-foreground">
            {saved === "saving" ? "Saving…" : saved === "saved" ? "Saved" : saved === "error" ? "Save failed" : ""}
          </span>
        </div>
        <LifecycleControls card={card} sets={sets} />
        {card.setId &&
          (proposing ? (
            <div className="flex items-center gap-1 text-xs">
              <input autoFocus value={proposeSummary} onChange={(e) => setProposeSummary(e.target.value)}
                placeholder="Summarize your proposed change…" className="flex-1 rounded-md border bg-background px-2 py-1" />
              <Button size="sm" className="h-7 px-3 text-xs" disabled={proposeBusy || !proposeSummary.trim()} onClick={submitProposal}>
                Submit proposal
              </Button>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setProposing(false)}>Cancel</Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="h-7 self-start px-3 text-xs" onClick={() => setProposing(true)}>
              Propose changes for review
            </Button>
          ))}
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,360px)_1fr]">
        {/* Face — sticky on desktop, top on mobile */}
        <div className="md:sticky md:top-4 md:self-start">
          <ForgeCardFace
            name={snapshot.name ?? null}
            rawText={cardRawText(snapshot)}
            finishedUrl={card.hasFinished ? `/forge/api/art/${card.id}?kind=finished&t=${t}` : null}
            artUrl={card.hasArt ? `/forge/api/art/${card.id}?t=${t}` : null}
          />
        </div>

        {/* Form */}
        <div className="space-y-4" onFocusCapture={() => setEditing(true)} onBlurCapture={() => setEditing(false)}>
          {err && <p className="text-sm text-destructive">{err}</p>}

          <input autoFocus value={snapshot.name ?? ""} onChange={(e) => update({ name: e.target.value })}
            placeholder="Name your card…" className="w-full rounded-md border bg-background px-3 py-2 text-lg" />

          <textarea value={snapshot.rawText ?? ""} onChange={(e) => update({ rawText: e.target.value })}
            placeholder="Type the card — type, brigade, stats, ability, reference, flavor… Freeform; not rendered."
            className="h-64 w-full rounded-md border bg-background px-3 py-2 text-sm" />

          {/* Artwork (illustration) */}
          <fieldset className="rounded-lg border bg-card p-4">
            <legend className="px-1 text-sm font-medium">
              Artwork (illustration)
              {uploading === "art" && <span className="ml-2 text-xs text-muted-foreground">Uploading…</span>}
            </legend>
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading !== null}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f, "art"); e.target.value = ""; }}
              className="block w-full text-xs" />
            <label className="mt-3 flex items-start gap-2">
              <input type="checkbox" className="mt-0.5" checked={!!card.isPlaceholder}
                onChange={async () => { await setPlaceholder(card.id, !card.isPlaceholder); router.refresh(); }} />
              <span>
                <span className="font-medium">Temporary / placeholder art</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Placeholder art isn’t shown in playtests — upload final art and uncheck when it’s ready.
                </span>
              </span>
            </label>
            {card.hasArt && (
              <a href={`/forge/api/art/${card.id}?download=1`}
                className="mt-2 inline-block font-medium text-foreground underline-offset-2 hover:text-primary hover:underline">
                Download original
              </a>
            )}
          </fieldset>

          {/* Finished card (full composed image) */}
          <fieldset className="rounded-lg border bg-card p-4">
            <legend className="px-1 text-sm font-medium">
              Finished card (full composed image)
              {uploading === "finished" && <span className="ml-2 text-xs text-muted-foreground">Uploading…</span>}
            </legend>
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading !== null}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  // Replacing an existing finished image without touching any field this session
                  // usually means the printed ability text changed — confirm before overwriting.
                  if (card.hasFinished && !fieldsDirty.current) setPendingFinished(f);
                  else onUpload(f, "finished");
                }
                e.target.value = "";
              }}
              className="block w-full text-xs" />
            <p className="mt-2 text-xs text-muted-foreground">
              A finished card image made elsewhere. When present, it’s shown everywhere instead of the artwork.
            </p>
            {card.hasFinished && (
              <a href={`/forge/api/art/${card.id}?kind=finished&download=1`}
                className="mt-2 inline-block font-medium text-foreground underline-offset-2 hover:text-primary hover:underline">
                Download finished card
              </a>
            )}
          </fieldset>
        </div>
      </div>

      <ConfirmationDialog
        open={pendingFinished !== null}
        onOpenChange={(o) => { if (!o) setPendingFinished(null); }}
        onConfirm={() => { const f = pendingFinished; setPendingFinished(null); if (f) onUpload(f, "finished"); }}
        variant="warning"
        title="Replace image without updating the card fields?"
        description="You're replacing the finished card image but haven't changed any card fields this session. If the new image changed the ability text, update the fields to match."
        confirmLabel="Replace anyway"
      />
    </div>
  );
}
