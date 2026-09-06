import { describe, expect, it } from "vitest";
import { resolveAuthors, serviceClient, updatePatch } from "../db";

const users = [{ id: "u-tim", email: "baboonytim@gmail.com" }, { id: "u-rob", email: "robmulye@gmail.com" }];
const map = [
  { login: "TimE", name: "BaboonyTim", email: "baboonytim@gmail.com" },
  { login: "RobM", name: "RobM", email: "robmulye@gmail.com" },
  { login: "admin", name: "Gabe", email: null },
];

describe("resolveAuthors", () => {
  it("maps emails to ids and null emails to the archive", () => {
    const r = resolveAuthors(map, users, "u-archive");
    expect(r.get("TimE")).toBe("u-tim");
    expect(r.get("RobM")).toBe("u-rob");
    expect(r.get("admin")).toBe("u-archive");
  });
  it("throws naming every unresolved mapped email", () => {
    expect(() => resolveAuthors([...map, { login: "X", name: "X", email: "nobody@example.com" }, { login: "Y", name: "Y", email: "ghost@example.com" }], users, "a")).toThrow(/nobody@example.com.*ghost@example.com|ghost@example.com.*nobody@example.com/s);
  });
});

describe("serviceClient", () => {
  it("requires the url and service role key", () => {
    expect(() => serviceClient({})).toThrow(/SUPABASE/);
    expect(serviceClient({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" })).toBeTruthy();
  });
});

describe("updatePatch", () => {
  it("excludes slug, status, created_at but includes author_name and updated_at", () => {
    const row = {
      slug: "test-slug",
      title: "Test Title",
      excerpt: "Test excerpt",
      body_md: "Test body",
      cover_image_url: "https://example.com/image.jpg",
      tags: ["tag1", "tag2"],
      status: "published" as const,
      author_id: "u-123",
      author_name: "Test Author",
      published_at: "2026-09-06T00:00:00Z",
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-06T10:00:00Z",
      source_url: "https://example.com/post",
    };
    const patch = updatePatch(row);
    expect(patch).not.toHaveProperty("slug");
    expect(patch).not.toHaveProperty("status");
    expect(patch).not.toHaveProperty("created_at");
    expect(patch).not.toHaveProperty("source_url");
    expect(patch).toHaveProperty("author_name", "Test Author");
    expect(patch).toHaveProperty("updated_at", "2026-09-06T10:00:00Z");
    expect(patch).toHaveProperty("title", "Test Title");
  });
});
