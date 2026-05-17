import { describe, it, expect } from "vitest";
import { NextResponse } from "next/server";
import { withCors, preflightResponse } from "../cors";

describe("withCors", () => {
  it("adds the public-API CORS headers to an existing response", () => {
    const r = withCors(NextResponse.json({ ok: true }));
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
  it("does NOT set Access-Control-Allow-Credentials", () => {
    const r = withCors(NextResponse.json({ ok: true }));
    expect(r.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });
});

describe("preflightResponse", () => {
  it("returns a 204 with full CORS preflight headers", () => {
    const r = preflightResponse();
    expect(r.status).toBe(204);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(r.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
    expect(r.headers.get("Access-Control-Allow-Headers")).toBe("Authorization");
    expect(r.headers.get("Access-Control-Max-Age")).toBe("86400");
  });
});
