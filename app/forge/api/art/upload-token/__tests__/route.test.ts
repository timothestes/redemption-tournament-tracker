import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/forge/lib/auth", () => ({ requireElder: vi.fn() }));
vi.mock("@vercel/blob/client", () => ({ handleUpload: vi.fn() }));

import { requireElder } from "@/app/forge/lib/auth";
import { handleUpload } from "@vercel/blob/client";
import { POST } from "../route";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function reqWith(body: unknown) {
  return new Request("http://localhost/forge/api/art/upload-token", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /forge/api/art/upload-token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FORGE_BLOB_READ_WRITE_TOKEN = "test-token";
  });

  it("targets the FORGE store's token and offers a permissive content-type allowlist", async () => {
    asMock(handleUpload).mockResolvedValue({ ok: true });
    await POST(reqWith({ type: "blob.generate-client-token", payload: {} }));
    const opts = asMock(handleUpload).mock.calls[0][0];
    expect(opts.token).toBe("test-token");
    asMock(requireElder).mockResolvedValue({ role: "elder" });
    const result = await opts.onBeforeGenerateToken("forge-art-raw/x.tiff");
    expect(result.allowedContentTypes).toEqual(
      expect.arrayContaining(["image/tiff", "image/tif", "application/octet-stream"]),
    );
  });

  it("refuses to generate a token for a non-elder", async () => {
    asMock(requireElder).mockResolvedValue(null);
    asMock(handleUpload).mockImplementation(async ({ onBeforeGenerateToken }: any) => {
      await onBeforeGenerateToken("forge-art-raw/x.tiff");
    });
    const res = await POST(reqWith({ type: "blob.generate-client-token", payload: {} }));
    expect(res.status).toBe(400);
  });

  it("lets an elder through", async () => {
    asMock(requireElder).mockResolvedValue({ role: "elder" });
    asMock(handleUpload).mockImplementation(async ({ onBeforeGenerateToken }: any) =>
      onBeforeGenerateToken("forge-art-raw/x.tiff"),
    );
    const res = await POST(reqWith({ type: "blob.generate-client-token", payload: {} }));
    expect(res.status).toBe(200);
  });

  it("bounds the upload size and rejects a pathname outside forge-art-raw/", async () => {
    asMock(requireElder).mockResolvedValue({ role: "elder" });
    let onBeforeGenerateToken: any;
    asMock(handleUpload).mockImplementation(async (opts: any) => {
      onBeforeGenerateToken = opts.onBeforeGenerateToken;
      return { ok: true };
    });
    await POST(reqWith({ type: "blob.generate-client-token", payload: {} }));

    const result = await onBeforeGenerateToken("forge-art-raw/x.tiff");
    expect(result.maximumSizeInBytes).toBe(50 * 1024 * 1024);

    await expect(onBeforeGenerateToken("forge-art/someone-elses-key")).rejects.toThrow("Bad upload path");
  });
});
