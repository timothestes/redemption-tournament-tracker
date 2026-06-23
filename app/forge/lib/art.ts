// Server-only helpers for Forge private card art.
// DO NOT import this module into a "use client" component — it uses a
// server-only token and a PRIVATE-access Vercel Blob store. Art is uploaded with
// access:'private' under unguessable UUID keys and read back server-side; the
// browser only ever sees the /forge/api/art proxy URL.
//
// IMPORTANT: `access: 'private'` requires a store CONFIGURED for private access.
// Set FORGE_BLOB_READ_WRITE_TOKEN to a dedicated private store's token (keeps
// Forge art isolated from the app's public card-image store). If unset, falls
// back to BLOB_READ_WRITE_TOKEN — which then must itself have private access
// enabled, or `put`/`get` will fail with "Cannot use private access on a public store".
import { randomUUID } from "crypto";
import { put, get, del, type GetBlobResult } from "@vercel/blob";

/** Token for the private Forge blob store (dedicated if set, else the default store). */
function forgeBlobToken(): string {
  return (process.env.FORGE_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN)!;
}

const ART_PREFIX = "forge-art/";
export const ALLOWED_ART_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_ART_BYTES = 15 * 1024 * 1024; // 15MB

/** Returns an error string if the file is unacceptable, or null if valid. Pure. */
export function validateArtFile(file: { type: string; size: number }): string | null {
  if (!ALLOWED_ART_TYPES.includes(file.type as (typeof ALLOWED_ART_TYPES)[number])) {
    return "Invalid file type. Accepted: JPEG, PNG, WebP.";
  }
  if (file.size > MAX_ART_BYTES) {
    return "File too large. Maximum 15MB.";
  }
  return null;
}

/** Upload to the PRIVATE blob store under an unguessable UUID key. Returns the stored pathname. */
export async function uploadForgeArt(file: File): Promise<string> {
  const key = `${ART_PREFIX}${randomUUID()}`;
  const blob = await put(key, file, {
    access: "private",
    addRandomSuffix: false,
    token: forgeBlobToken(),
    contentType: file.type,
  });
  return blob.pathname;
}

/** Server-side read of a private art blob by its stored key. */
export function readForgeArt(key: string): Promise<GetBlobResult | null> {
  return get(key, { access: "private", token: forgeBlobToken() });
}

/** Best-effort delete of a private art blob (used when art is replaced). Non-fatal on failure. */
export async function deleteForgeArt(key: string): Promise<void> {
  try {
    await del(key, { token: forgeBlobToken() });
  } catch {
    // A dangling private+UUID blob is invisible and harmless; don't fail the request.
  }
}
