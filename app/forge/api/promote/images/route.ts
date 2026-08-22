import { put } from "@vercel/blob";
import { requireForgeSuperadmin, notFoundResponse } from "@/app/forge/lib/auth";
import { readForgeArt } from "@/app/forge/lib/art";
import { parseImageTransform } from "@/app/forge/lib/catalogRow";
import { transformReleaseImage } from "@/app/forge/lib/releaseImage";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Batched release image processing (§5.3 of the promote design). A route
// handler, not a server action — Next serializes server-action calls from one
// client, while batches posted here genuinely run in parallel (the Lackey
// importer's pattern). Superadmin-gated; every DB write still goes through the
// SECURITY DEFINER mark RPC, which re-checks authorization.
//
// THIS IS THE LEAK-BOUNDARY CROSSING: the private finished image is read,
// transformed to the uniform 345×495 public format, and uploaded to the PUBLIC
// card-images/ store under its released imgFile. That is what "promote" means.

const MAX_CARDS_PER_BATCH = 8;

interface CardResult {
  cardId: string;
  ok: boolean;
  method?: string;
  upscaled?: boolean;
  skipped?: boolean;
  remaining?: number;
  error?: string;
}

export async function POST(req: Request): Promise<Response> {
  const ctx = await requireForgeSuperadmin();
  if (!ctx) return notFoundResponse(); // 404, never 401/403 — the area stays secret

  let payload: { releaseId?: unknown; cardIds?: unknown };
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }
  const releaseId = typeof payload.releaseId === "string" ? payload.releaseId : "";
  const cardIds = Array.isArray(payload.cardIds)
    ? payload.cardIds.filter((id): id is string => typeof id === "string")
    : [];
  if (!releaseId || cardIds.length === 0 || cardIds.length > MAX_CARDS_PER_BATCH) {
    return Response.json({ error: "Invalid batch" }, { status: 400 });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return Response.json({ error: "Public blob store not configured" }, { status: 500 });

  const { data: release } = await ctx.supabase
    .from("forge_public_releases")
    .select("id, status")
    .eq("id", releaseId)
    .maybeSingle();
  if (!release) return notFoundResponse();
  if (release.status !== "staged") {
    return Response.json({ error: `Release is ${release.status}, not staged` }, { status: 409 });
  }

  const { data: rows } = await ctx.supabase
    .from("forge_public_release_cards")
    .select("card_id, version_id, img_file, image_uploaded, image_transform")
    .eq("release_id", releaseId)
    .in("card_id", cardIds);
  const byCard = new Map((rows ?? []).map((r: any) => [r.card_id as string, r]));

  const versionIds = (rows ?? []).map((r: any) => r.version_id as string);
  const { data: versions } = await ctx.supabase
    .from("card_versions")
    .select("id, finished_key")
    .in("id", versionIds);
  const keyByVersion = new Map<string, string | null>(
    (versions ?? []).map((v: any) => [v.id as string, (v.finished_key as string | null) ?? null]),
  );

  const results: CardResult[] = await Promise.all(
    cardIds.map(async (cardId): Promise<CardResult> => {
      const row = byCard.get(cardId);
      if (!row) return { cardId, ok: false, error: "Not in this release" };
      if (row.image_uploaded === true) return { cardId, ok: true, skipped: true };
      try {
        const key = keyByVersion.get(row.version_id as string);
        if (!key) throw new Error("No finished image on the approved version");
        const blob = await readForgeArt(key);
        if (!blob || blob.statusCode !== 200) throw new Error("Finished image unreadable");
        const buffer = Buffer.from(await new Response(blob.stream).arrayBuffer());

        const result = await transformReleaseImage(buffer, parseImageTransform(row.image_transform));
        await put(`card-images/${row.img_file}.jpg`, result.data, {
          access: "public",
          addRandomSuffix: false,
          token,
          contentType: "image/jpeg",
        });

        const { data: remaining, error: markErr } = await ctx.supabase.rpc(
          "forge_mark_release_image_uploaded",
          { p_release_id: releaseId, p_card_id: cardId },
        );
        if (markErr) throw new Error(markErr.message);
        return {
          cardId, ok: true, method: result.method, upscaled: result.upscaled,
          remaining: typeof remaining === "number" ? remaining : undefined,
        };
      } catch (e) {
        return { cardId, ok: false, error: e instanceof Error ? e.message : "Processing failed" };
      }
    }),
  );

  return Response.json({ results });
}
