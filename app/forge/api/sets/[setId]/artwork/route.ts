import { requireForge, notFoundResponse } from "@/app/forge/lib/auth";
import { getSet } from "@/app/forge/lib/sets";
import { listSetApprovedArt, artExt, artFileName } from "@/app/forge/lib/setArtwork";
import { readForgeArt } from "@/app/forge/lib/art";
import { zipSync } from "fflate";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ setId: string }> }
): Promise<Response> {
  const ctx = await requireForge();
  if (!ctx) return notFoundResponse(); // 404, never 401/403 — the area stays secret

  const { setId } = await params;
  const set = await getSet(setId);
  if (!set) return notFoundResponse(); // not readable under RLS ⇒ not a set-elder/super

  const arts = await listSetApprovedArt(setId);
  if (arts.length === 0) return notFoundResponse(); // nothing to export (indistinguishable 404)

  // Stable order: version number, then name.
  arts.sort((a, b) => a.versionNumber - b.versionNumber || a.name.localeCompare(b.name));

  const files: Record<string, Uint8Array> = {};
  let seq = 0;
  for (const art of arts) {
    let result;
    try {
      result = await readForgeArt(art.key);
    } catch {
      continue; // skip a missing/failed blob rather than failing the whole export
    }
    if (!result || result.statusCode !== 200) continue;
    const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
    seq += 1;
    files[artFileName(seq, art.name, artExt(result.blob.contentType))] = bytes;
  }
  if (Object.keys(files).length === 0) return notFoundResponse();

  // Images are already compressed → store (level 0), don't waste CPU recompressing.
  const zip = zipSync(files, { level: 0 });

  return new Response(zip, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${set.slug}-artwork.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
