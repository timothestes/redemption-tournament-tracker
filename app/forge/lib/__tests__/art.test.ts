import { describe, it, expect } from "vitest";
import { validateArtFile, MAX_ART_BYTES } from "@/app/forge/lib/art";

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
