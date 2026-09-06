import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BlobError, BlobNotFoundError, BlobServiceNotAvailable, BlobServiceRateLimited } from "@vercel/blob";
import { contentTypeFor, isRetryableBlobError, planMedia } from "../media";

describe("contentTypeFor", () => {
  it("maps known extensions and defaults to octet-stream", () => {
    expect(contentTypeFor("wp/a.JPG")).toBe("image/jpeg");
    expect(contentTypeFor("wp/a.png")).toBe("image/png");
    expect(contentTypeFor("wp/a.webp")).toBe("image/webp");
    expect(contentTypeFor("wp/a.mp3")).toBe("audio/mpeg");
    expect(contentTypeFor("wp/deck.dek")).toBe("text/plain");
    expect(contentTypeFor("wp/deck.txt")).toBe("text/plain");
    expect(contentTypeFor("wp/a.pdf")).toBe("application/pdf");
    expect(contentTypeFor("wp/a.xlsx")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(contentTypeFor("wp/a.weird")).toBe("application/octet-stream");
  });

  it("maps svg and zip", () => {
    expect(contentTypeFor("wp/a.svg")).toBe("image/svg+xml");
    expect(contentTypeFor("wp/a.zip")).toBe("application/zip");
  });
});

describe("planMedia", () => {
  it("uses the backup layout <backup>/<site path>, marks present files planned and absent ones missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "wxr-"));
    const nested = join(dir, "wp-content/uploads/2016");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "hello world.png"), Buffer.alloc(10));
    const m = planMedia(["/wp-content/uploads/2016/hello%20world.png", "/podcasts/none.mp3"], dir, "https://blob.test");
    expect(m["/wp-content/uploads/2016/hello%20world.png"]).toEqual({
      pathname: "wp/wp-content/uploads/2016/hello world.png",
      url: "https://blob.test/wp/wp-content/uploads/2016/hello%20world.png",
      bytes: 10, status: "planned",
    });
    expect(m["/podcasts/none.mp3"]).toEqual({ pathname: "wp/podcasts/none.mp3", url: "https://blob.test/wp/podcasts/none.mp3", bytes: 0, status: "missing" });
  });

  it("treats a malformed % escape in the site path as missing instead of throwing", () => {
    const dir = mkdtempSync(join(tmpdir(), "wxr-"));
    const m = planMedia(["/wp-content/uploads/100%.png"], dir, "https://blob.test");
    expect(m["/wp-content/uploads/100%.png"].status).toBe("missing");
    expect(m["/wp-content/uploads/100%.png"].bytes).toBe(0);
  });

  it("treats a path that escapes the backup dir via .. as missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "wxr-"));
    const traversal = "/" + "../".repeat(20) + "etc/passwd";
    const m = planMedia([traversal], dir, "https://blob.test");
    expect(m[traversal].status).toBe("missing");
    expect(m[traversal].bytes).toBe(0);
  });
});

describe("isRetryableBlobError", () => {
  it("retries rate limits, outages and transient network failures", () => {
    expect(isRetryableBlobError(new BlobServiceRateLimited(30))).toBe(true);
    expect(isRetryableBlobError(new BlobServiceNotAvailable())).toBe(true);
    expect(isRetryableBlobError(new Error("fetch failed: ETIMEDOUT"))).toBe(true);
    expect(isRetryableBlobError(new Error("Vercel Blob: 503 Service Unavailable"))).toBe(true);
  });
  it("does not retry a missing blob or a credential/permission failure", () => {
    expect(isRetryableBlobError(new BlobNotFoundError())).toBe(false);
    // What a run with no BLOB_READ_WRITE_TOKEN actually throws.
    expect(isRetryableBlobError(new BlobError("No blob credentials found. Pass a `token` or set BLOB_READ_WRITE_TOKEN"))).toBe(false);
    expect(isRetryableBlobError("nope")).toBe(false);
  });
});
