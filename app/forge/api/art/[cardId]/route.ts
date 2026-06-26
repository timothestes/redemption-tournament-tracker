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

  // RLS-checked: non-members are already rejected above. Playtesters can SELECT only
  // approved cards/versions of granted sets — so the approved branch is leak-safe.
  let artKey: string | null = null;
  if (wantApproved) {
    const { data: card } = await ctx.supabase
      .from("forge_cards")
      .select("approved_version_id")
      .eq("id", cardId)
      .maybeSingle();
    if (!card?.approved_version_id) return notFoundResponse();
    const { data: version } = await ctx.supabase
      .from("card_versions")
      .select("art_original_key, art_key, art_is_placeholder")
      .eq("id", card.approved_version_id)
      .maybeSingle();
    if (!version || version.art_is_placeholder) return notFoundResponse();
    artKey = version.art_original_key ?? version.art_key ?? null;
  } else {
    const { data: card } = await ctx.supabase
      .from("forge_cards")
      .select("working_art_key")
      .eq("id", cardId)
      .maybeSingle();
    artKey = card?.working_art_key ?? null;
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
