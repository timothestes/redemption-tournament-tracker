import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { hashToken } from "../token";

describe("hashToken", () => {
  it("returns the sha256 hex of the input", () => {
    expect(hashToken("abc")).toBe(createHash("sha256").update("abc").digest("hex"));
  });
  it("is deterministic and 64 hex chars", () => {
    const h = hashToken("some-token");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("some-token")).toBe(h);
  });
});
