import { requireForgeSuperadmin, notFoundResponse } from "@/app/forge/lib/auth";
import sharp from "sharp";
import { zipSync } from "fflate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Release bundle for the sister API repo (redemption-tournament-api), §5.4 of
// the promote design: carddata-additions.jsonl (the API's lowercased-key format)
// + cardimages/<imgFile>.webp + a README of exact steps. Derives purely from the
// manifest + the already-public card-images/ blobs, so it can be regenerated
// anytime after the image step. NEVER regenerate that repo's jsonl from its
// stale local Lackey install.
//
// The webps are 345×495 by construction (the release images are), encoded at
// the API repo's q50 convention. Its own convert_jpg_to_webp does NOT resize,
// which is why the bundle ships finished webps instead of asking for a re-run.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ releaseId: string }> },
): Promise<Response> {
  const ctx = await requireForgeSuperadmin();
  if (!ctx) return notFoundResponse(); // 404, never 401/403 — the area stays secret

  const { releaseId } = await params;
  const { data: release } = await ctx.supabase
    .from("forge_public_releases")
    .select("id, set_code, official_set, status")
    .eq("id", releaseId)
    .maybeSingle();
  if (!release) return notFoundResponse();
  if (release.status === "staged") {
    return Response.json(
      { error: "Images are not processed yet — the bundle needs the public blobs" },
      { status: 409 },
    );
  }

  const { data: cards } = await ctx.supabase
    .from("forge_public_release_cards")
    .select("*")
    .eq("release_id", releaseId)
    .order("name", { ascending: true });
  if (!cards || cards.length === 0) return notFoundResponse();

  const blobBase = process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  if (!blobBase) {
    return Response.json({ error: "NEXT_PUBLIC_BLOB_BASE_URL is not configured" }, { status: 500 });
  }

  const files: Record<string, Uint8Array> = {};
  const jsonlLines: string[] = [];
  const missingImages: string[] = [];

  for (const c of cards) {
    // Key order mirrors assets/carddata/carddata.jsonl exactly.
    jsonlLines.push(
      JSON.stringify({
        name: c.name,
        set: c.set_code,
        imagefile: c.img_file,
        officialset: c.official_set,
        type: c.type,
        brigade: c.brigade,
        strength: c.strength,
        toughness: c.toughness,
        class: c.class,
        identifier: c.identifier,
        specialability: c.special_ability,
        rarity: c.rarity,
        reference: c.reference,
        sound: "",
        alignment: c.alignment,
        legality: c.legality,
      }),
    );
    try {
      const res = await fetch(`${blobBase}/card-images/${c.img_file}.jpg`);
      if (!res.ok) throw new Error(String(res.status));
      const jpg = Buffer.from(await res.arrayBuffer());
      const webp = await sharp(jpg).webp({ quality: 50 }).toBuffer();
      files[`cardimages/${c.img_file}.webp`] = new Uint8Array(webp);
    } catch {
      missingImages.push(c.img_file as string);
    }
  }

  if (missingImages.length > 0) {
    return Response.json(
      { error: `Public images missing for: ${missingImages.join(", ")}` },
      { status: 409 },
    );
  }

  const enc = new TextEncoder();
  files["carddata-additions.jsonl"] = enc.encode(jsonlLines.join("\n") + "\n");
  files["README.md"] = enc.encode(
    `# ${release.official_set} (${release.set_code}) — API repo release bundle\n\n` +
      `Generated from release ${release.id} (${cards.length} cards).\n\n` +
      `Apply to redemption-tournament-api:\n\n` +
      `1. Append every line of carddata-additions.jsonl to assets/carddata/carddata.jsonl.\n` +
      `2. Copy cardimages/*.webp into assets/cardimages/ (they are git-tracked).\n` +
      `3. Commit both and deploy.\n\n` +
      `Do NOT run \`make json\` / \`make webp\` there — those scripts read a local\n` +
      `Lackey install that is usually months stale and would silently regenerate\n` +
      `the whole file from old data. The webps here are already 345×495 q50.\n`,
  );

  // level 0: the webps already dominate and are pre-compressed; skip the CPU.
  const zip = zipSync(files, { level: 0 });
  const slug = release.set_code.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "set";

  return new Response(zip, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${slug}-api-bundle.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
