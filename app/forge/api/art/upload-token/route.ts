// Mints Vercel Blob client-upload tokens for Forge art. The browser uploads
// straight to Blob (bypassing Vercel's 4.5MB Function body cap) via
// @vercel/blob/client's upload(), which calls this route first for a token.
// Auth happens here, in onBeforeGenerateToken — no token, no upload.
import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireElder } from "@/app/forge/lib/auth";
import { MAX_ART_BYTES } from "@/app/forge/lib/art";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as HandleUploadBody;
    const json = await handleUpload({
      body,
      request,
      token: process.env.FORGE_BLOB_READ_WRITE_TOKEN, // the FORGE store's token, not the app's default one
      onBeforeGenerateToken: async (pathname) => {
        const ctx = await requireElder();
        if (!ctx) throw new Error("Not authorized");
        if (!pathname.startsWith("forge-art-raw/") || pathname.includes("..")) throw new Error("Bad upload path");
        return {
          // application/octet-stream stays allowed because browsers routinely misreport
          // .tif/.tiff with a generic or empty MIME type — the real content gate is
          // sharp() throwing on undecodable input during normalization, not this check.
          allowedContentTypes: [
            "image/jpeg", "image/png", "image/webp",
            "image/tiff", "image/tif", "application/octet-stream",
          ],
          maximumSizeInBytes: MAX_ART_BYTES,
          addRandomSuffix: true,
        };
      },
      // No onUploadCompleted — the client makes its own small follow-up call
      // (Tasks 3-5) to finalize the upload, instead of relying on Vercel's webhook.
    });
    return NextResponse.json(json);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
