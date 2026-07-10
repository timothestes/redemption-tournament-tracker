import { describe, it, expect } from "vitest";
import { isChunkLoadError } from "@/lib/chunkReload";

describe("isChunkLoadError", () => {
  it("detects a webpack ChunkLoadError by name", () => {
    const err = Object.assign(new Error("Loading chunk 6791 failed."), {
      name: "ChunkLoadError",
    });
    expect(isChunkLoadError(err)).toBe(true);
  });

  it("detects the failed-chunk message form", () => {
    expect(isChunkLoadError(new Error("Loading chunk 6791 failed."))).toBe(true);
    expect(isChunkLoadError(new Error("Loading CSS chunk 42 failed"))).toBe(true);
    expect(
      isChunkLoadError("ChunkLoadError: Loading chunk app/register/page failed"),
    ).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError(new Error("Something else went wrong"))).toBe(false);
    // A generic fetch NetworkError is recovered by Next's router fallback and must
    // NOT trigger a reload, or ordinary API/RSC hiccups would reload the page.
    expect(
      isChunkLoadError(new TypeError("NetworkError when attempting to fetch resource")),
    ).toBe(false);
  });
});
