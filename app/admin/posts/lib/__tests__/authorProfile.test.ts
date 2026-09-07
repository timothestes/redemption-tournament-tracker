import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../auth", () => ({ requirePoster: vi.fn() }));

import { revalidatePath } from "next/cache";
import { requirePoster } from "../auth";
import { updateAuthorProfileAction } from "../authorProfile";

function ctx(overrides: { error?: unknown; posts?: { slug: string }[] } = {}) {
  const updateEq = vi.fn(async () => ({ error: overrides.error ?? null }));
  const postsEq2 = vi.fn(async () => ({ data: overrides.posts ?? [] }));
  return {
    user: { id: "u1" },
    supabase: {
      from: vi.fn((table: string) => {
        if (table === "profiles") return { update: vi.fn(() => ({ eq: updateEq })) };
        return { select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: postsEq2 })) })) };
      }),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("updateAuthorProfileAction", () => {
  it("rejects a non-poster", async () => {
    (requirePoster as any).mockRejectedValue(new Error("Unauthorized: publish_posts permission required"));
    const r = await updateAuthorProfileAction("hi", null);
    expect(r.success).toBe(false);
  });

  it("rejects a bio over 500 characters", async () => {
    (requirePoster as any).mockResolvedValue(ctx());
    const r = await updateAuthorProfileAction("x".repeat(501), null);
    expect(r).toEqual({ success: false, error: "Bio must be 500 characters or fewer" });
  });

  it("rejects a non-https avatar URL", async () => {
    (requirePoster as any).mockResolvedValue(ctx());
    const r = await updateAuthorProfileAction(null, "http://insecure.example/x.png");
    expect(r).toEqual({ success: false, error: "Avatar must be an https URL" });
  });

  it("saves a trimmed bio and https avatar, and revalidates the author's published posts", async () => {
    const c = ctx({ posts: [{ slug: "hello-world" }] });
    (requirePoster as any).mockResolvedValue(c);
    const r = await updateAuthorProfileAction("  Hi there  ", "https://x/y.png");
    expect(r).toEqual({ success: true });
    expect(revalidatePath).toHaveBeenCalledWith("/articles");
    expect(revalidatePath).toHaveBeenCalledWith("/articles/hello-world");
  });

  it("surfaces a database error", async () => {
    (requirePoster as any).mockResolvedValue(ctx({ error: { message: "boom" } }));
    const r = await updateAuthorProfileAction("hi", null);
    expect(r).toEqual({ success: false, error: "Could not save your author profile" });
  });
});
