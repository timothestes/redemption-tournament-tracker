"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ForgeCardFace from "@/app/forge/components/ForgeCardFace";
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
  card, sets, currentUser, setId,
}: {
  card: ForgeCardFull;
  sets: ForgeSetSummary[];
  currentUser: { userId: string; displayName: string | null };
  setId: string | null;
}) {
  const [snapshot, setSnapshot] = useState<DesignCard>(card.snapshot ?? {});
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRender = useRef(true);
  const fieldsDirty = useRef(false);
  const [pendingFinished, setPendingFinished] = useState<File | null>(null);
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
    const fd = new FormData();
    fd.set("file", file);
    const r = kind === "art" ? await uploadArt(card.id, fd) : await uploadFinished(card.id, fd);
    if (!r.ok) setErr(r.error ?? "Upload failed");
    else router.refresh();
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
          <Link href={card.setId ? `/forge/sets/${card.setId}/cards` : "/forge/ideas"} className="text-muted-foreground hover:underline">
            ← {card.setId ? "Set" : "Ideas"}
          </Link>
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
              <button disabled={proposeBusy || !proposeSummary.trim()} onClick={submitProposal}
                className="rounded-md bg-emerald-600 px-3 py-1 font-medium text-white disabled:opacity-50">
                Submit proposal
              </button>
              <button onClick={() => setProposing(false)} className="rounded-md border px-2 py-1">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setProposing(true)} className="self-start rounded-md border px-3 py-1 text-xs">
              Propose changes for review
            </button>
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
          {err && <p className="text-sm text-red-500">{err}</p>}

          <input autoFocus value={snapshot.name ?? ""} onChange={(e) => update({ name: e.target.value })}
            placeholder="Name your card…" className="w-full rounded-md border bg-background px-3 py-2 text-lg" />

          <textarea value={snapshot.rawText ?? ""} onChange={(e) => update({ rawText: e.target.value })}
            placeholder="Type the card — type, brigade, stats, ability, reference, flavor… Freeform; not rendered."
            className="h-64 w-full rounded-md border bg-background px-3 py-2 text-sm" />

          {/* Artwork (illustration) */}
          <fieldset className="rounded-md border p-3">
            <legend className="px-1 font-medium">Artwork (illustration)</legend>
            <input type="file" accept="image/jpeg,image/png,image/webp"
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
              <a href={`/forge/api/art/${card.id}?download=1`} className="mt-2 inline-block text-emerald-600 hover:underline">
                Download original
              </a>
            )}
          </fieldset>

          {/* Finished card (full composed image) */}
          <fieldset className="rounded-md border p-3">
            <legend className="px-1 font-medium">Finished card (full composed image)</legend>
            <input type="file" accept="image/jpeg,image/png,image/webp"
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
            {pendingFinished && (
              <div role="alertdialog" className="mt-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-xs">
                <p className="font-medium">Replace image without updating the card fields?</p>
                <p className="mt-1 text-muted-foreground">
                  You’re replacing the finished card image but haven’t changed any card fields this
                  session. If the new image changed the ability text, update the fields to match.
                </p>
                <div className="mt-2 flex gap-2">
                  <button type="button"
                    onClick={() => { const f = pendingFinished; setPendingFinished(null); if (f) onUpload(f, "finished"); }}
                    className="rounded-md bg-amber-600 px-3 py-1 font-medium text-white">
                    Replace anyway
                  </button>
                  <button type="button" onClick={() => setPendingFinished(null)} className="rounded-md border px-2 py-1">
                    Cancel
                  </button>
                </div>
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              A finished card image made elsewhere. When present, it’s shown everywhere instead of the artwork.
            </p>
            {card.hasFinished && (
              <a href={`/forge/api/art/${card.id}?kind=finished&download=1`} className="mt-2 inline-block text-emerald-600 hover:underline">
                Download finished card
              </a>
            )}
          </fieldset>
        </div>
      </div>
    </div>
  );
}
