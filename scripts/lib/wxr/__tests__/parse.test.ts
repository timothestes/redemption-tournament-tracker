import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseWxr } from "../parse";

const xml = readFileSync(join(__dirname, "fixtures/mini.xml"), "utf8");

describe("parseWxr", () => {
  const out = parseWxr(xml);
  it("reads authors with lower-cased emails", () => {
    expect(out.authors).toEqual([
      { login: "admin", email: "gabe@landofredemption.com", displayName: "Gabe" },
      { login: "TimE", email: "timothestes@gmail.com", displayName: "BaboonyTim" },
    ]);
  });
  it("keeps only published posts (no drafts, pages, attachments, blocks)", () => {
    expect(out.posts.map((p) => p.slug)).toEqual(["ytg-qa-2016", "classic-post"]);
  });
  it("decodes the title and category names, keeps CDATA content raw", () => {
    const p = out.posts[0];
    expect(p.title).toBe("YTG Q&A | 2016");
    expect(p.categories).toEqual(["Fun & funny", "News"]);
    expect(p.content).toBe("<p>Hi &amp; bye</p>");
    expect(p.excerpt).toBe("<p>Short &amp; sweet</p>");
  });
  it("carries ids, dates, creator, link and thumbnail", () => {
    const p = out.posts[0];
    expect(p).toMatchObject({ wpId: "2016", creator: "admin", link: "https://landofredemption.com/ytg-qa-2016/", dateGmt: "2016-05-01 17:00:00", date: "2016-05-01 10:00:00", modifiedGmt: "2016-05-02 01:02:03", thumbnailId: "55" });
    expect(out.posts[1].thumbnailId).toBeNull();
    expect(out.posts[1].excerpt).toBe("");
  });
  it("maps attachments and reusable blocks by id", () => {
    expect(out.attachments.get("55")).toBe("https://landofredemption.com/wp-content/uploads/2016/05/cover.jpg");
    expect(out.blocks.get("14682")).toContain("visit our sponsors");
  });
  it("rejects a non-WXR document", () => {
    expect(() => parseWxr("<html></html>")).toThrow(/WXR/);
  });
});
