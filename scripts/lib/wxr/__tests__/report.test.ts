import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { frontMatter, writeReport, type Report } from "../report";

describe("frontMatter", () => {
  it("lists the row's metadata", () => {
    const fm = frontMatter({ slug: "t", title: "T: x", excerpt: null, body_md: "", cover_image_url: null, tags: ["News"], status: "published", author_id: null, author_name: "Gabe", published_at: "2016-05-01T17:00:00.000Z", created_at: "2016-05-01T17:00:00.000Z", updated_at: "2016-05-01T17:00:00.000Z", source_url: "https://landofredemption.com/t/" });
    expect(fm).toBe('---\ntitle: "T: x"\nauthor_name: "Gabe"\nauthor_id: null\npublished_at: 2016-05-01T17:00:00.000Z\ntags: ["News"]\ncover_image_url: null\nsource_url: https://landofredemption.com/t/\n---\n\n');
  });
});

describe("writeReport", () => {
  it("writes json and a markdown summary that names problem posts", () => {
    const dir = mkdtempSync(join(tmpdir(), "wxr-"));
    const report: Report = {
      generatedAt: "2026-09-06T00:00:00.000Z", mode: "dry-run", totals: { posts: 2, failed: 1 },
      authors: [{ login: "admin", name: "Gabe", posts: 2, email: null, resolved: "ARCHIVE" }],
      slugChanges: [{ from: "a-very-long-slug", to: "a-very" }],
      posts: [
        { slug: "ok", originalSlug: "ok", title: "Fine", login: "admin", wpId: "1", classic: false, stats: { images: 1, links: 0, embeds: 0, residualHtml: [], residualMarkers: [], externalImageHosts: [], droppedBlocks: {}, unknownRefs: [], removedIframes: [], missingMedia: [] } },
        { slug: "bad", originalSlug: "bad", title: "Broken", login: "admin", wpId: "2", classic: true, stats: { images: 0, links: 0, embeds: 0, residualHtml: ["<div>"], residualMarkers: [], externalImageHosts: [], droppedBlocks: { spacer: 2 }, unknownRefs: [], removedIframes: [], missingMedia: ["/wp-content/uploads/x.jpg"] }, error: "insert failed" },
      ],
    };
    writeReport(dir, report);
    expect(JSON.parse(readFileSync(join(dir, "report.json"), "utf8")).totals.posts).toBe(2);
    const md = readFileSync(join(dir, "report.md"), "utf8");
    expect(md).toContain("| admin | Gabe | 2 |");
    expect(md).toContain("a-very-long-slug");
    expect(md).toContain("bad");
    expect(md).toContain("<div>");
    expect(md).toContain("insert failed");
    expect(md).not.toMatch(/\| ok \|/);
  });

  it("keeps a multi-line, pipe-containing error as a single well-formed table row", () => {
    const dir = mkdtempSync(join(tmpdir(), "wxr-"));
    const report: Report = {
      generatedAt: "2026-09-06T00:00:00.000Z", mode: "dry-run", totals: { posts: 1, failed: 1 },
      authors: [{ login: "admin", name: "Gabe", posts: 1, email: null, resolved: "ARCHIVE" }],
      slugChanges: [],
      posts: [
        { slug: "messy", originalSlug: "messy", title: "Messy", login: "admin", wpId: "3", classic: false,
          stats: { images: 0, links: 0, embeds: 0, residualHtml: [], residualMarkers: [], externalImageHosts: [], droppedBlocks: {}, unknownRefs: [], removedIframes: [], missingMedia: [] },
          error: "insert failed | at row 2\nsecond line of the error" },
      ],
    };
    writeReport(dir, report);
    const md = readFileSync(join(dir, "report.md"), "utf8");
    const rowLines = md.split("\n").filter((l) => l.includes("second line of the error"));
    expect(rowLines).toHaveLength(1);
    expect(rowLines[0].startsWith("| messy |")).toBe(true);
    expect(rowLines[0]).toContain("\\|");
  });
});
