import { upload } from "@vercel/blob/client";
import { mediaPathname, validateMediaFile, type UploadKind } from "./media";

/**
 * Browser → Blob directly. The token route (/api/posts/upload) checks the
 * permission and that the caller owns the post before Vercel issues a token,
 * so audio never streams through a function body. Throws with a user-facing
 * message on a validation or upload failure.
 */
export async function uploadPostMedia(postId: string, file: File, kind: UploadKind): Promise<{ url: string }> {
  const problem = validateMediaFile(file, kind);
  if (problem) throw new Error(problem);
  const blob = await upload(mediaPathname(postId, file.name), file, {
    access: "public",
    handleUploadUrl: "/api/posts/upload",
    clientPayload: JSON.stringify({ postId, kind }),
    multipart: kind === "audio",
  });
  return { url: blob.url };
}
