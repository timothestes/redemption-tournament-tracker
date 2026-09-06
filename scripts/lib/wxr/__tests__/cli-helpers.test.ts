import { describe, expect, it } from "vitest";
import { newest, usableStatuses } from "../select";

const post = (slug: string, dateGmt: string, date: string) => ({ slug, dateGmt, date });

describe("newest", () => {
  it("takes the n newest posts by GMT date", () => {
    const posts = [
      post("old", "2015-03-25 10:00:00", "2015-03-25 06:00:00"),
      post("new", "2026-09-03 12:00:00", "2026-09-03 08:00:00"),
      post("mid", "2020-01-01 00:00:00", "2019-12-31 20:00:00"),
    ];
    expect(newest(posts, 2).map((p) => p.slug)).toEqual(["new", "mid"]);
  });
  it("falls back to the local date for WordPress's 0000 sentinel", () => {
    const posts = [
      post("sentinel", "0000-00-00 00:00:00", "2026-01-01 00:00:00"),
      post("dated", "2021-06-01 00:00:00", "2021-06-01 00:00:00"),
    ];
    expect(newest(posts, 1).map((p) => p.slug)).toEqual(["sentinel"]);
  });
  it("does not mutate the input and caps n at the number of posts", () => {
    const posts = [post("a", "2015-01-01 00:00:00", "2015-01-01 00:00:00"), post("b", "2026-01-01 00:00:00", "2026-01-01 00:00:00")];
    expect(newest(posts, 10).map((p) => p.slug)).toEqual(["b", "a"]);
    expect(posts.map((p) => p.slug)).toEqual(["a", "b"]);
  });
});

describe("usableStatuses", () => {
  it("previews planned files in a dry run", () => {
    const dry = usableStatuses("dry-run");
    expect(dry.has("planned")).toBe(true);
    expect(dry.has("exists")).toBe(true);
    expect(dry.has("uploaded")).toBe(true);
  });
  it("rewrites only files the store confirmed in a live run", () => {
    const live = usableStatuses("live");
    expect(live.has("planned")).toBe(false);
    expect(live.has("exists")).toBe(true);
    expect(live.has("uploaded")).toBe(true);
  });
  it("never treats a missing file as usable", () => {
    expect(usableStatuses("dry-run").has("missing")).toBe(false);
    expect(usableStatuses("live").has("missing")).toBe(false);
  });
});
