import { requireForge, notFoundResponse } from "@/app/forge/lib/auth";
import { readForgeArt } from "@/app/forge/lib/art";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ cardId: string }> }
): Promise<Response> {
  const ctx = await requireForge();
  if (!ctx) return notFoundResponse(); // 404, never 401/403 — the area stays secret

  const { cardId } = await params;
  const url = new URL(req.url);
  const wantApproved = url.searchParams.get("v") === "approved";
  const kind = url.searchParams.get("kind") === "finished" ? "finished" : "art";

  // RLS-checked: non-members are already rejected above. Granted playtesters can SELECT
  // only the published/approved versions of granted playtesting/approved cards (migration
  // 057) — so the reveal branch is leak-safe. We serve the approved snapshot if finalized,
  // else the published (in-testing) snapshot.
  let artKey: string | null = null;
  if (wantApproved) {
    const { data: card } = await ctx.supabase
      .from("forge_cards")
      .select("approved_version_id, published_version_id")
      .eq("id", cardId)
      .maybeSingle();
    const versionId = card?.approved_version_id ?? card?.published_version_id ?? null;
    if (!versionId) return notFoundResponse();
    if (kind === "finished") {
      const { data: version } = await ctx.supabase
        .from("card_versions")
        .select("finished_key")
        .eq("id", versionId)
        .maybeSingle();
      artKey = version?.finished_key ?? null;
    } else {
      const { data: version } = await ctx.supabase
        .from("card_versions")
        .select("art_original_key, art_key, art_is_placeholder")
        .eq("id", versionId)
        .maybeSingle();
      if (!version || version.art_is_placeholder) return notFoundResponse();
      artKey = version.art_original_key ?? version.art_key ?? null;
    }
  } else {
    const col = kind === "finished" ? "working_finished_key" : "working_art_key";
    const { data: card } = await ctx.supabase
      .from("forge_cards")
      .select(col)
      .eq("id", cardId)
      .maybeSingle();
    artKey = (card as any)?.[col] ?? null;
  }
  if (!artKey) return notFoundResponse();

  let result;
  try {
    result = await readForgeArt(artKey);
  } catch {
    return notFoundResponse();
  }
  if (!result || result.statusCode !== 200) return notFoundResponse();

  const download = new URL(req.url).searchParams.get("download") === "1";
  if (download) {
    try {
      await ctx.supabase.rpc("forge_log_art_download", { p_card_id: cardId });
    } catch {
      // best-effort audit; never block the download on a logging failure
    }
  }

  const headers = new Headers({
    "Content-Type": result.blob.contentType,
    "Cache-Control": "private, no-store",
  });
  if (download) {
    headers.set("Content-Disposition", `attachment; filename="card-${encodeURIComponent(cardId)}"`);
  }
  return new Response(result.stream, { headers });
}
