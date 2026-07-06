"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import ForgeCardFace from "@/app/forge/components/ForgeCardFace";
import ForgeBreadcrumbs from "@/app/forge/components/ForgeBreadcrumbs";
import FilePicker from "@/app/forge/components/FilePicker";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";
import { cn } from "@/lib/utils";
import { saveCard, uploadArt, uploadFinished, setPlaceholder, type ForgeCardFull } from "@/app/forge/lib/cards";
import { createProposal } from "@/app/forge/lib/proposals";
import { cardRawText, type DesignCard } from "@/app/forge/lib/designCard";
import LifecycleControls from "./LifecycleControls";
import type { ForgeSetSummary } from "@/app/forge/lib/sets";
import { forgeCardTopic } from "@/app/forge/lib/realtime";
import { useForgeCardChannel } from "@/app/forge/lib/useForgeRealtime";
import PresenceBar from "./PresenceBar";
import CardDetailsFields from "./CardDetailsFields";

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
  const latest = useRef(snapshot);       // most recent edit (for flush-on-leave)
  const lastSaved = useRef(snapshot);    // last snapshot the server accepted
  const savedRef = useRef(saved);
  const [pendingFinished, setPendingFinished] = useState<File | null>(null);
  const [uploading, setUploading] = useState<"art" | "finished" | null>(null);
  const router = useRouter();

  const { others, setEditing } = useForgeCardChannel(
    setId ? forgeCardTopic(card.id) : null,
    { userId: currentUser.userId, displayName: currentUser.displayName, editing: false },
  );

  // Debounced autosave — fires only after the user edits (skips mount).
  useEffect(() => {
    latest.current = snapshot;
    if (firstRender.current) { firstRender.current = false; return; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSaved("saving");
      const r = await saveCard(card.id, snapshot);
      if (r.ok) lastSaved.current = snapshot;
      setSaved(r.ok ? "saved" : "error");
    }, 700);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [snapshot, card.id]);

  useEffect(() => { savedRef.current = saved; }, [saved]);

  // Clicking a nav link within the debounce window unmounts this editor before the
  // timer fires — flush the pending edit so it isn't silently dropped. A hard
  // unload (close tab, reload) gets the browser's leave prompt instead.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (latest.current !== lastSaved.current || savedRef.current === "saving") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (latest.current !== lastSaved.current) void saveCard(card.id, latest.current);
    };
  }, [card.id]);

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
  const [proposeErr, setProposeErr] = useState<string | null>(null);
  const submitProposal = async () => {
    if (!proposeSummary.trim()) return;
    setProposeErr(null);
    setProposeBusy(true);
    const r = await createProposal(card.id, snapshot, proposeSummary);
    setProposeBusy(false);
    if (r.ok === false) { setProposeErr(r.error); return; }
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
          <span className={`text-xs ${saved === "error" ? "text-destructive" : "text-muted-foreground"}`}>
            {saved === "saving" ? "Saving…" : saved === "saved" ? "Saved" : saved === "error" ? "Save failed" : ""}
          </span>
        </div>
        <LifecycleControls card={card} sets={sets} />
        {card.setId &&
          (proposing ? (
            <div className="flex flex-col gap-1 text-xs">
              <div className="flex items-start gap-1">
                <textarea autoFocus value={proposeSummary} onChange={(e) => setProposeSummary(e.target.value)}
                  placeholder="Summarize your proposed change…" className="h-16 flex-1 rounded-md border bg-background px-2 py-1" />
                <Button size="sm" className="h-7 px-3 text-xs" disabled={proposeBusy || !proposeSummary.trim()} onClick={submitProposal}>
                  Submit proposal
                </Button>
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => { setProposing(false); setProposeErr(null); }}>Cancel</Button>
              </div>
              {proposeErr && <p className="text-destructive">{proposeErr}</p>}
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

          <CardDetailsFields snapshot={snapshot} update={update} />

          {/* Artwork (illustration) */}
          <fieldset className="rounded-lg border bg-card p-4">
            <legend className="px-1 text-sm font-medium">
              Artwork (illustration)
              {uploading === "art" && <span className="ml-2 text-xs text-muted-foreground">Uploading…</span>}
            </legend>
            <FilePicker label="Choose image…" accept="image/jpeg,image/png,image/webp"
              disabled={uploading !== null} onFile={(f) => onUpload(f, "art")} />
            <label className="mt-3 flex items-start gap-2">
              <Checkbox className="mt-0.5" checked={!!card.isPlaceholder}
                onCheckedChange={async () => { await setPlaceholder(card.id, !card.isPlaceholder); router.refresh(); }} />
              <span>
                <span className="font-medium">Temporary / placeholder art</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Placeholder art isn’t shown in playtests — upload final art and uncheck when it’s ready.
                </span>
              </span>
            </label>
            {card.hasArt && (
              <a href={`/forge/api/art/${card.id}?download=1`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3")}>
                <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
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
            <FilePicker label="Choose image…" accept="image/jpeg,image/png,image/webp" disabled={uploading !== null}
              onFile={(f) => {
                // Replacing an existing finished image without touching any field this session
                // usually means the printed ability text changed — confirm before overwriting.
                if (card.hasFinished && !fieldsDirty.current) setPendingFinished(f);
                else onUpload(f, "finished");
              }} />
            <p className="mt-2 text-xs text-muted-foreground">
              A finished card image made elsewhere. When present, it’s shown everywhere instead of the artwork.
            </p>
            {card.hasFinished && (
              <a href={`/forge/api/art/${card.id}?kind=finished&download=1`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3")}>
                <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
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
