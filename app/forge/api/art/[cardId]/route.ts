import { createClient } from "@/utils/supabase/server";
import { notFoundResponse } from "@/app/forge/lib/auth";
import { readForgeArt } from "@/app/forge/lib/art";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ cardId: string }> }
): Promise<Response> {
  const supabase = await createClient();
  const { cardId } = await params;
  const url = new URL(req.url);
  const wantApproved = url.searchParams.get("v") === "approved";
  const kind = url.searchParams.get("kind") === "finished" ? "finished" : "art";

  // One RPC does the member gate + version resolution + key lookup (SECURITY
  // INVOKER so the 057 RLS policies still decide what the caller may see —
  // migration 066). getUser() runs concurrently, not before: it validates and
  // refreshes the session cookie, while an expired/invalid token makes the RPC
  // itself return nothing. Either failure is a 404 — the area stays secret.
  const [{ data: userData, error: userError }, { data: artKey }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc("forge_art_key", {
      p_card_id: cardId,
      p_approved: wantApproved,
      p_kind: kind,
    }),
  ]);
  if (userError || !userData?.user) return notFoundResponse();
  if (!artKey || typeof artKey !== "string") return notFoundResponse();

  let result;
  try {
    result = await readForgeArt(artKey);
  } catch {
    return notFoundResponse();
  }
  if (!result || result.statusCode !== 200) return notFoundResponse();

  const download = url.searchParams.get("download") === "1";
  if (download) {
    try {
      await supabase.rpc("forge_log_art_download", { p_card_id: cardId });
    } catch {
      // best-effort audit; never block the download on a logging failure
    }
  }

  // `t` is a cache-buster (forge_cards.updated_at for the working view; the frozen
  // versionId in play mode), so a `t`-stamped response can be cached by the member's OWN
  // browser indefinitely. `private` forbids shared/CDN caches; auth + RLS are unchanged.
  const cacheable = !download && url.searchParams.get("t") !== null;
  const headers = new Headers({
    "Content-Type": result.blob.contentType,
    "Cache-Control": cacheable ? "private, max-age=31536000, immutable" : "private, no-store",
  });
  if (download) {
    headers.set("Content-Disposition", `attachment; filename="card-${encodeURIComponent(cardId)}"`);
  }
  return new Response(result.stream, { headers });
}
