import { requireForge, notFoundResponse } from "@/app/forge/lib/auth";
import { FORGE_FONT_FACES, readForgeFont, type ForgeFontFace } from "@/app/forge/lib/art";

export const dynamic = "force-dynamic";

// The printed card faces (Symphony Black titles, Grail Light stats) are licensed, not
// redistributable, so they never sit in the repo or a public store: they live in the
// PRIVATE forge Blob store and stream only to forge members. Anyone else gets the same
// 404 as the rest of /forge. `forge-fonts.css` lists these URLs first and lets the
// browser fall back to the OFL substitutes in public/forge/fonts when they fail.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ face: string }> }
): Promise<Response> {
  const { face } = await params;
  if (!(FORGE_FONT_FACES as readonly string[]).includes(face)) return notFoundResponse();
  const ctx = await requireForge();
  if (!ctx) return notFoundResponse();

  let result;
  try {
    result = await readForgeFont(face as ForgeFontFace);
  } catch {
    return notFoundResponse();
  }
  if (!result || result.statusCode !== 200) return notFoundResponse();

  // The stylesheet versions the URL (?v=N), so a member's own browser may keep the font
  // indefinitely; `private` keeps it out of shared/CDN caches.
  return new Response(result.stream, {
    headers: {
      "Content-Type": "font/ttf",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
