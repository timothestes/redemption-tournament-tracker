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

  // RLS-checked lookup: only Forge members can see any row; non-members are
  // already rejected above. maybeSingle() → null (not throw) on no/invalid id.
  const { data: card } = await ctx.supabase
    .from("forge_cards")
    .select("working_art_key")
    .eq("id", cardId)
    .maybeSingle();

  if (!card?.working_art_key) return notFoundResponse();

  let result;
  try {
    result = await readForgeArt(card.working_art_key);
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
