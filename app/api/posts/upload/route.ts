import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { requirePoster } from "@/app/admin/posts/lib/auth";
import { limitsFor, parseClientPayload } from "@/app/admin/posts/lib/media";
import { canEditPost } from "@/app/admin/posts/lib/validate";

// Client-upload token route (spec §7). The browser calls this to get a token
// (onBeforeGenerateToken runs with the user's cookies), and Vercel calls it
// again when the upload finishes (onUploadCompleted). The completion call
// cannot reach localhost — the SDK logs a warning in dev; that is expected and
// harmless because the browser already receives the final URL.
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const ctx = await requirePoster();
        const payload = parseClientPayload(clientPayload);
        if (!payload) throw new Error("Bad upload payload");
        if (!pathname.startsWith(`posts/${payload.postId}/`)) throw new Error("Bad upload path");

        const { data: post } = await ctx.supabase
          .from("posts")
          .select("author_id")
          .eq("id", payload.postId)
          .maybeSingle();
        // posts_select_published lets any authenticated poster READ another
        // user's published post, so a successful load is not proof of
        // ownership — canEditPost is the single source of truth for that.
        if (!post || !canEditPost({ userId: ctx.user.id, isSuperuser: ctx.isSuperuser }, post)) {
          throw new Error("Unauthorized: not your post");
        }

        const { types, maxBytes } = limitsFor(payload.kind);
        return {
          allowedContentTypes: types,
          maximumSizeInBytes: maxBytes,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ postId: payload.postId, userId: ctx.user.id }),
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log("[posts] media uploaded", blob.pathname);
      },
    });
    return NextResponse.json(json);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload failed";
    const status = message.startsWith("Unauthorized") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
