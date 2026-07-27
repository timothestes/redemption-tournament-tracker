"use client";

import { useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { applyCrop, activateCandidate } from "@/app/forge/lib/artCandidates";
import { cropBackgroundStyle, type CropRect } from "@/app/forge/lib/cropPreview";

// Frame aspect = the card face's art slot: full width × 48% of a 750×1050 face.
const ART_SLOT_ASPECT = 750 / 504;

export default function CropCandidateModal({
  cardId, candidateId, imageUrl, cardName, onClose, onApplied,
}: {
  cardId: string;
  candidateId: string;
  imageUrl: string;
  cardName: string | null;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  // react-easy-crop reports croppedArea in PERCENTAGES of the source image.
  const [rect, setRect] = useState<CropRect | null>(null);
  const [busy, setBusy] = useState<"crop" | "full" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(kind: "crop" | "full") {
    if (kind === "crop" && !rect) return;
    setErr(null);
    setBusy(kind);
    const r = kind === "crop"
      ? await applyCrop(cardId, candidateId, rect!)
      : await activateCandidate(cardId, candidateId);
    setBusy(null);
    if (r.ok === false) setErr(r.error ?? "Something went wrong");
    else onApplied();
  }

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-lg border bg-background p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-medium">Crop artwork</p>

        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative w-full sm:min-w-0 sm:flex-1" style={{ aspectRatio: "3 / 2", background: "black" }}>
            <Cropper
              image={imageUrl}
              crop={crop}
              zoom={zoom}
              aspect={ART_SLOT_ASPECT}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(area: Area) =>
                setRect({ x: area.x / 100, y: area.y / 100, width: area.width / 100, height: area.height / 100 })
              }
            />
          </div>

          {/* Live preview: the card face's art strip showing exactly the framed subrect. */}
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Preview on card</p>
            <div className="w-40 overflow-hidden rounded-md border">
              <div
                style={{
                  aspectRatio: "750 / 504",
                  backgroundImage: `url(${imageUrl})`,
                  backgroundRepeat: "no-repeat",
                  ...(rect ? cropBackgroundStyle(rect) : { backgroundSize: "cover", backgroundPosition: "center" }),
                }}
              />
              <p className="truncate px-2 py-1 text-xs font-semibold">{cardName?.trim() || "Untitled"}</p>
            </div>
          </div>
        </div>

        {err && <p className="text-sm text-destructive">{err}</p>}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy !== null}>Cancel</Button>
          <Button variant="outline" size="sm" onClick={() => run("full")} disabled={busy !== null}>
            {busy === "full" ? "Saving…" : "Use uncropped"}
          </Button>
          <Button size="sm" onClick={() => run("crop")} disabled={busy !== null || !rect}>
            {busy === "crop" ? "Saving…" : "Use cropped"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
