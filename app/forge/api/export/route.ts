import { requireForge, notFoundResponse } from "@/app/forge/lib/auth";
import { getSet } from "@/app/forge/lib/sets";
import { listSetWorkingCards, artExt } from "@/app/forge/lib/setArtwork";
import { readForgeArt } from "@/app/forge/lib/art";
import {
  designCardToLackeyRow, serializeCarddata, imageFileSlug,
} from "@/app/forge/lib/lackey";
import { zipSync } from "fflate";

export const dynamic = "force-dynamic";

// Export selected Forge sets as a LackeyCCG-format zip: sets/carddata.txt +
// sets/setimages/general/<ImageFile>.<ext> + sets/setlist.txt. The structure exactly
// mirrors what the importer (ImportWizard) reads, so it round-trips into the Forge and a
// Lackey user can merge the rows/images into their Redemption plugin. Elder-gated via
// requireForge + RLS (getSet returns null for sets the caller can't read → skipped).

const MAX_SETS = 50;

export async function GET(req: Request): Promise<Response> {
  const ctx = await requireForge();
  if (!ctx) return notFoundResponse(); // 404, never 401/403 — the area stays secret

  const url = new URL(req.url);
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_SETS);
  if (ids.length === 0) return notFoundResponse();

  const files: Record<string, Uint8Array> = {};
  const rows: string[][] = [];
  const setNames: string[] = [];
  const usedImageNames = new Set<string>(); // lowercased, unique across the whole export

  for (const setId of ids) {
    const set = await getSet(setId); // RLS: null ⇒ caller can't read it ⇒ skip
    if (!set) continue;
    setNames.push(set.name);

    const cards = await listSetWorkingCards(setId);
    for (const card of cards) {
      // A unique image base name for the flat setimages/general dir (deduped across sets).
      let base = imageFileSlug(card.title);
      if (usedImageNames.has(base.toLowerCase())) {
        let n = 2;
        while (usedImageNames.has(`${base}-${n}`.toLowerCase())) n++;
        base = `${base}-${n}`;
      }
      usedImageNames.add(base.toLowerCase());

      let imageFile = base;
      if (card.finishedKey) {
        try {
          const result = await readForgeArt(card.finishedKey);
          if (result && result.statusCode === 200) {
            const ext = artExt(result.blob.contentType);
            const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
            files[`sets/setimages/general/${base}.${ext}`] = bytes;
          }
        } catch {
          // Skip a missing/failed blob rather than failing the whole export; the card
          // still gets its carddata row (just without an image).
        }
      }

      rows.push(
        designCardToLackeyRow(card.snapshot, {
          name: card.title,
          set: set.slug,
          officialSet: set.name,
          imageFile,
        }),
      );
    }
  }

  if (rows.length === 0) return notFoundResponse(); // nothing readable to export

  const enc = new TextEncoder();
  files["sets/carddata.txt"] = enc.encode(serializeCarddata(rows));
  files["sets/setlist.txt"] = enc.encode(setNames.join("\n") + "\n");

  // level 0: the images already dominate and are pre-compressed; skip the CPU.
  const zip = zipSync(files, { level: 0 });

  const filename =
    setNames.length === 1 ? `${slugForFile(setNames[0])}-forge-export.zip` : "forge-export.zip";

  return new Response(zip, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

function slugForFile(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "set";
}
