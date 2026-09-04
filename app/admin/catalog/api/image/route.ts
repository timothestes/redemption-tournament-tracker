import { put, copy, BlobNotFoundError } from "@vercel/blob";
import { requireCatalogEditor } from "@/app/admin/permissions/lib/auth";
import { parseImageTransform } from "@/app/forge/lib/catalogRow";
import { transformReleaseImage } from "@/app/forge/lib/releaseImage";
import { findCardStrict } from "@/app/admin/catalog/lib/editorShared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

// Replace one public card image in place (spec §6). Route handler, not a
// server action: card scans routinely exceed the 1MB server-action body cap.
// Order of operations is load-bearing:
//   bump (atomic CAS) → archive previous → transform → overwrite.
// Bump-first means a crash can leave a bumped version with old bytes (visible
// in the UI, healed by re-running) but never a new image with no cache-bust.
export async function POST(req: Request): Promise<Response> {
  const ctx = await requireCatalogEditor();
  if (!ctx) return new Response("Not Found", { status: 404 }); // invisible, portal precedent

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const blobBase = process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  if (!token || !blobBase) {
    return Response.json({ error: "Public blob store not configured" }, { status: 500 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }
  const name = typeof form.get("name") === "string" ? (form.get("name") as string) : "";
  const set = typeof form.get("set") === "string" ? (form.get("set") as string) : "";
  const note = typeof form.get("note") === "string" ? (form.get("note") as string) : "";
  const file = form.get("file");
  if (!name || !set || !(file instanceof Blob)) {
    return Response.json({ error: "name, set and file are required" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ error: "Image too large (15MB max)" }, { status: 400 });
  }

  // Strict identity (spec F3) — findCard's fallbacks could replace another card's art.
  const card = findCardStrict(name, set);
  if (!card) {
    return Response.json({ error: `No catalog card matches exactly "${name}" | "${set}"` }, { status: 400 });
  }
  const imgFile = card.imgFile;

  let transform = null;
  const rawTransform = form.get("transform");
  if (typeof rawTransform === "string" && rawTransform) {
    try {
      transform = parseImageTransform(JSON.parse(rawTransform));
    } catch {
      transform = null;
    }
    if (transform === null) return Response.json({ error: "Invalid transform" }, { status: 400 });
  }

  // 1) Version bump — compare-and-set so a double-submit can't reuse a version
  //    or clobber an archive slot (spec F11).
  const { data: existing } = await ctx.supabase
    .from("card_image_versions")
    .select("version")
    .eq("img_file", imgFile)
    .maybeSingle();

  let newVersion: number;
  if (!existing) {
    const { error } = await ctx.supabase
      .from("card_image_versions")
      .insert({ img_file: imgFile, version: 1, note: note || null, updated_by: ctx.user.id });
    if (error) return Response.json({ error: "Version race — retry" }, { status: 409 });
    newVersion = 1;
  } else {
    const { data: updated, error } = await ctx.supabase
      .from("card_image_versions")
      .update({
        version: existing.version + 1,
        note: note || null,
        updated_by: ctx.user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("img_file", imgFile)
      .eq("version", existing.version) // CAS
      .select("version");
    if (error || !updated || updated.length === 0) {
      return Response.json({ error: "Version race — retry" }, { status: 409 });
    }
    newVersion = existing.version + 1;
  }

  // 2) Archive the outgoing image — server-side copy, NOT a CDN fetch (a fetch
  //    can capture stale edge bytes on back-to-back replaces, spec F8).
  try {
    await copy(`${blobBase}/card-images/${imgFile}.jpg`, `card-images-archive/${imgFile}.v${newVersion - 1}.jpg`, {
      access: "public",
      token,
      addRandomSuffix: false,
    });
  } catch (e) {
    // Source blob missing (image never synced) — nothing to archive.
    // But if it's a transient/auth/rate-limit error, fail the whole operation.
    if (!(e instanceof BlobNotFoundError)) {
      console.error(`Archive failed for ${imgFile}: ${e instanceof Error ? e.message : String(e)}`);
      return Response.json(
        { error: "Could not archive the current image — nothing was overwritten; retry" },
        { status: 500 }
      );
    }
  }

  // 3) Transform to the uniform 345×495 q90 format (promote's pipeline).
  const input = Buffer.from(await file.arrayBuffer());
  let result;
  try {
    result = await transformReleaseImage(input, transform);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Could not process image" },
      { status: 400 },
    );
  }

  // 4) Overwrite in place. The daily sync cron head()-skips existing blobs, so
  //    this can never be clobbered back to the Lackey original.
  await put(`card-images/${imgFile}.jpg`, result.data, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "image/jpeg",
    token,
  });

  return Response.json({
    ok: true,
    version: newVersion,
    method: result.method,
    upscaled: result.upscaled,
  });
}
