import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@vercel/blob", () => ({ put: vi.fn(), get: vi.fn(), del: vi.fn() }));
vi.mock("@/app/forge/lib/imageNormalize", () => ({ normalizeCardImage: vi.fn() }));

import { put } from "@vercel/blob";
import { normalizeCardImage } from "@/app/forge/lib/imageNormalize";
import { validateArtFile, MAX_ART_BYTES, uploadForgeArt, uploadForgeFinished } from "../art";

describe("validateArtFile", () => {
  it("accepts a normal PNG", () => {
    expect(validateArtFile({ type: "image/png", size: 1024 })).toBeNull();
  });

  it("rejects a non-image type", () => {
    expect(validateArtFile({ type: "application/pdf", size: 1024 })).toMatch(/Invalid file type/);
  });

  it("rejects a file over the size cap", () => {
    expect(validateArtFile({ type: "image/png", size: MAX_ART_BYTES + 1 })).toMatch(/too large/i);
  });
});

const file = new File([new Uint8Array([1, 2, 3])], "art.png", { type: "image/png" });

beforeEach(() => {
  vi.clearAllMocks();
  (put as any).mockResolvedValue({ pathname: "forge-art/some-key" });
  (normalizeCardImage as any).mockResolvedValue({
    data: Buffer.from("normalized"),
    contentType: "image/jpeg",
  });
});

describe("uploadForgeArt / uploadForgeFinished", () => {
  it("uploads the NORMALIZED bytes as image/jpeg, not the original file", async () => {
    await uploadForgeArt(file);
    const [key, body, opts] = (put as any).mock.calls[0];
    expect(String(key)).toMatch(/^forge-art\//);
    expect(Buffer.from(body).toString()).toBe("normalized");
    expect(opts.contentType).toBe("image/jpeg");
  });

  it("uploadForgeFinished stores under forge-finished/ with normalized bytes", async () => {
    (put as any).mockResolvedValue({ pathname: "forge-finished/some-key" });
    await uploadForgeFinished(file);
    const [key, body, opts] = (put as any).mock.calls[0];
    expect(String(key)).toMatch(/^forge-finished\//);
    expect(Buffer.from(body).toString()).toBe("normalized");
    expect(opts.contentType).toBe("image/jpeg");
  });

  it("propagates decode failures without uploading anything", async () => {
    (normalizeCardImage as any).mockRejectedValue(new Error("unsupported image format"));
    await expect(uploadForgeArt(file)).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });
});
