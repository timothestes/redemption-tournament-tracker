"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import FilePicker from "@/app/forge/components/FilePicker";
import CropCandidateModal from "@/app/forge/components/CropCandidateModal";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";
import { addArtCandidate, deleteArtCandidate, type ArtCandidate } from "@/app/forge/lib/artCandidates";

// Candidate blobs are immutable (a row is written once, never replaced), so a
// constant t cache-buster is enough for the proxy's immutable caching.
const candidateUrl = (cardId: string, id: string) => `/forge/api/art/${cardId}?candidate=${id}&t=c`;

export default function ArtCandidatesPanel({
  cardId, candidates, cardName,
}: {
  cardId: string;
  candidates: ArtCandidate[];
  cardName: string | null;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cropping, setCropping] = useState<string | null>(null); // candidate id
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  async function onFiles(files: File[]) {
    setErr(null);
    const errors: string[] = [];
    for (let i = 0; i < files.length; i++) {
      setProgress(`Uploading ${i + 1} of ${files.length}…`);
      const fd = new FormData();
      fd.set("file", files[i]);
      const r = await addArtCandidate(cardId, fd);
      if (r.ok === false) errors.push(`${files[i].name}: ${r.error ?? "failed"}`);
    }
    setProgress(null);
    if (errors.length > 0) setErr(errors.join(" · "));
    router.refresh();
  }

  async function onDelete(id: string) {
    setErr(null);
    const r = await deleteArtCandidate(cardId, id);
    if (r.ok === false) setErr(r.error ?? "Could not delete image");
    router.refresh();
  }

  return (
    <div>
      <FilePicker label="Add images…" accept="image/jpeg,image/png,image/webp" multiple
        disabled={progress !== null} onFiles={onFiles}
        hint={progress ?? `${candidates.length}/12 · click an image to crop`} />
      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}

      {candidates.length > 0 && (
        <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {candidates.map((c) => (
            <li key={c.id} className="group relative">
              <button type="button" className="block w-full" onClick={() => setCropping(c.id)}
                aria-label={c.isActiveSource ? "Re-crop the current artwork's source" : "Crop this image"}>
                {/* eslint-disable-next-line @next/next/no-img-element -- forge art must use the authed proxy, never next/image */}
                <img src={candidateUrl(cardId, c.id)} alt="" loading="lazy" decoding="async"
                  className={`aspect-square w-full rounded-md border object-cover ${c.isActiveSource ? "ring-2 ring-primary" : ""}`} />
              </button>
              {c.isActiveSource ? (
                <span className="absolute bottom-1 left-1 rounded bg-background/85 px-1 text-[10px] font-medium">Artwork source</span>
              ) : (
                <button type="button" aria-label="Delete image"
                  className="absolute right-1 top-1 rounded-md border bg-background/85 p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus:opacity-100 active:opacity-100 group-hover:opacity-100"
                  onClick={() => setPendingDelete(c.id)}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {cropping && (
        <CropCandidateModal cardId={cardId} candidateId={cropping}
          imageUrl={candidateUrl(cardId, cropping)} cardName={cardName}
          onClose={() => setCropping(null)}
          onApplied={() => { setCropping(null); router.refresh(); }} />
      )}

      <ConfirmationDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        onConfirm={() => { const id = pendingDelete; setPendingDelete(null); if (id) void onDelete(id); }}
        variant="destructive"
        title="Delete this image?"
        description="Removes it from this card's gallery. This can't be undone."
        confirmLabel="Delete"
      />
    </div>
  );
}
