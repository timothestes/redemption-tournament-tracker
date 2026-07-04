// Server-only helpers for Forge private card art.
// DO NOT import this module into a "use client" component — it uses
// server-only credentials and a PRIVATE-access Vercel Blob store. Art is uploaded with
// access:'private' under unguessable UUID keys and read back server-side; the
// browser only ever sees the /forge/api/art proxy URL.
//
// IMPORTANT: `access: 'private'` requires a store CONFIGURED for private access.
// Art lives in a dedicated private store (FORGE_BLOB_STORE_ID), isolated from the
// app's public card-image store. See `forgeAuth` below for how requests authenticate.
import { randomUUID } from "crypto";
import { put, get, del, type GetBlobResult } from "@vercel/blob";

/**
 * Auth for the PRIVATE Forge store. Production uses Vercel OIDC (no static secret):
 * the SDK reads VERCEL_OIDC_TOKEN automatically and pairs it with the store id. Local
 * dev sets FORGE_BLOB_READ_WRITE_TOKEN (OIDC isn't enabled for the dev environment),
 * which the SDK prefers when present — so prod stays on OIDC as long as that var is
 * left unset there.
 */
const forgeAuth: { token: string } | { storeId: string } =
  process.env.FORGE_BLOB_READ_WRITE_TOKEN
    ? { token: process.env.FORGE_BLOB_READ_WRITE_TOKEN }
    : { storeId: process.env.FORGE_BLOB_STORE_ID! };

const ART_PREFIX = "forge-art/";
const FINISHED_PREFIX = "forge-finished/";
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
    ...forgeAuth,
    contentType: file.type,
  });
  return blob.pathname;
}

/** Upload a finished-card image to the PRIVATE store under an unguessable UUID key. */
export async function uploadForgeFinished(file: File): Promise<string> {
  const key = `${FINISHED_PREFIX}${randomUUID()}`;
  const blob = await put(key, file, {
    access: "private",
    addRandomSuffix: false,
    ...forgeAuth,
    contentType: file.type,
  });
  return blob.pathname;
}

/** Server-side read of a private art blob by its stored key. */
export function readForgeArt(key: string): Promise<GetBlobResult | null> {
  return get(key, { access: "private", ...forgeAuth });
}

/** Best-effort delete of a private art blob (used when art is replaced). Non-fatal on failure. */
export async function deleteForgeArt(key: string): Promise<void> {
  try {
    await del(key, { ...forgeAuth });
  } catch {
    // A dangling private+UUID blob is invisible and harmless; don't fail the request.
  }
}
