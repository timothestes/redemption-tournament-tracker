"use server";

import { revalidatePath } from "next/cache";
import { requirePoster } from "./auth";
import type { ActionResult } from "../actions";

const MAX_BIO = 500;

export async function updateAuthorProfileAction(
  bio: string | null,
  avatarUrl: string | null
): Promise<ActionResult> {
  try {
    const ctx = await requirePoster();

    const cleanBio = bio && bio.trim() ? bio.trim() : null;
    if (cleanBio && cleanBio.length > MAX_BIO) {
      return { success: false, error: `Bio must be ${MAX_BIO} characters or fewer` };
    }
    const cleanAvatar = avatarUrl && avatarUrl.trim() ? avatarUrl.trim() : null;
    if (cleanAvatar && !/^https:\/\//.test(cleanAvatar)) {
      return { success: false, error: "Avatar must be an https URL" };
    }

    const { error } = await ctx.supabase
      .from("profiles")
      .update({ bio: cleanBio, avatar_url: cleanAvatar })
      .eq("id", ctx.user.id);
    if (error) {
      console.error("updateAuthorProfile:", error);
      return { success: false, error: "Could not save your author profile" };
    }

    // A bio/avatar change is invisible on already-rendered article pages
    // until these run (or the hourly ISR window passes) — revalidate every
    // published slug this author owns, not just the ones edited today.
    const { data: mine, error: slugsError } = await ctx.supabase
      .from("posts")
      .select("slug")
      .eq("author_id", ctx.user.id)
      .eq("status", "published");
    if (slugsError) console.error("updateAuthorProfile: could not load slugs to revalidate:", slugsError);
    revalidatePath("/articles");
    for (const row of (mine ?? []) as { slug: string }[]) revalidatePath(`/articles/${row.slug}`);

    return { success: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.startsWith("Unauthorized")) return { success: false, error: "Unauthorized" };
    console.error("updateAuthorProfileAction failed:", e);
    return { success: false, error: "An unexpected error occurred" };
  }
}
