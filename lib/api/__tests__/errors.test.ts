import { describe, it, expect } from "vitest";
import { apiError, errorResponse, type ErrorCode } from "../errors";

describe("apiError", () => {
  it("returns the canonical envelope shape", () => {
    expect(apiError("deck_not_found", "Nope")).toEqual({
      error: { code: "deck_not_found", message: "Nope" },
    });
  });
});

describe("errorResponse", () => {
  it("maps known codes to the right HTTP status", () => {
    const r = errorResponse("invalid_request", "bad");
    expect(r.status).toBe(400);
  });
  it("returns 401 for unauthorized", () => {
    expect(errorResponse("unauthorized", "x").status).toBe(401);
  });
  it("returns 404 for deck_not_found", () => {
    expect(errorResponse("deck_not_found", "x").status).toBe(404);
  });
  it("returns 429 for rate_limit_exceeded", () => {
    expect(errorResponse("rate_limit_exceeded", "x").status).toBe(429);
  });
  it("returns 500 for internal_error", () => {
    expect(errorResponse("internal_error", "x").status).toBe(500);
  });
  it("attaches extra fields when provided", async () => {
    const r = errorResponse("rate_limit_exceeded", "x", { retry_after_seconds: 23 });
    const body = await r.json();
    expect(body.error.retry_after_seconds).toBe(23);
  });
});
