import { describe, it, expect } from "vitest";
import { extractClientIp } from "../rateLimit";

describe("extractClientIp", () => {
  function reqWith(headers: Record<string, string>) {
    return { headers: new Headers(headers) } as Request;
  }

  it("uses x-vercel-forwarded-for when present", () => {
    expect(extractClientIp(reqWith({ "x-vercel-forwarded-for": "1.2.3.4" })))
      .toBe("1.2.3.4");
  });

  it("returns the first IP if the header is a comma list", () => {
    expect(extractClientIp(reqWith({ "x-vercel-forwarded-for": "1.2.3.4, 10.0.0.1" })))
      .toBe("1.2.3.4");
  });

  it("falls back to x-forwarded-for (first value)", () => {
    expect(extractClientIp(reqWith({ "x-forwarded-for": "5.6.7.8, 10.0.0.1" })))
      .toBe("5.6.7.8");
  });

  it("returns 'unknown' when no forwarded header is present", () => {
    expect(extractClientIp(reqWith({}))).toBe("unknown");
  });
});
