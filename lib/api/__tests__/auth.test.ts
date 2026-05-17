import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractBearerToken, hashKey, parseKey } from "../auth";

describe("extractBearerToken", () => {
  it("returns the token from 'Bearer <token>'", () => {
    expect(extractBearerToken("Bearer rtt_abc")).toBe("rtt_abc");
  });
  it("returns null for missing header", () => {
    expect(extractBearerToken(null)).toBeNull();
  });
  it("returns null for non-bearer schemes", () => {
    expect(extractBearerToken("Basic abc")).toBeNull();
  });
  it("returns null for malformed Bearer header", () => {
    expect(extractBearerToken("Bearer")).toBeNull();
    expect(extractBearerToken("Bearer  ")).toBeNull();
  });
});

describe("parseKey", () => {
  it("accepts rtt_ + 43-char base64url", () => {
    const key = "rtt_" + "A".repeat(43);
    expect(parseKey(key)).toEqual({ prefix: "AAAAAAAA", full: key });
  });
  it("rejects keys without the rtt_ prefix", () => {
    expect(parseKey("xyz_" + "A".repeat(43))).toBeNull();
  });
  it("rejects keys with wrong random-portion length", () => {
    expect(parseKey("rtt_" + "A".repeat(20))).toBeNull();
    expect(parseKey("rtt_" + "A".repeat(50))).toBeNull();
  });
  it("rejects keys with non-base64url characters", () => {
    expect(parseKey("rtt_" + "!".repeat(43))).toBeNull();
  });
});

describe("hashKey", () => {
  it("produces a 64-char lowercase hex sha256", () => {
    const h = hashKey("rtt_test");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
  it("is deterministic", () => {
    expect(hashKey("rtt_test")).toBe(hashKey("rtt_test"));
  });
  it("differs for different inputs", () => {
    expect(hashKey("rtt_a")).not.toBe(hashKey("rtt_b"));
  });
});

import { verifyApiKey } from "../auth";

vi.mock("@supabase/supabase-js", () => {
  const maybeSingle = vi.fn();
  const builder = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    limit: () => builder,
    maybeSingle,
  };
  return {
    createClient: () => ({
      from: () => builder,
    }),
    __setMaybeSingle: (impl: any) => maybeSingle.mockImplementation(impl),
  };
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
});

describe("verifyApiKey", () => {
  it("returns null for a malformed key", async () => {
    expect(await verifyApiKey("nope")).toBeNull();
  });

  it("returns null when the DB has no matching active row", async () => {
    const mod = await import("@supabase/supabase-js") as any;
    mod.__setMaybeSingle(async () => ({ data: null, error: null }));
    const validKey = "rtt_" + "A".repeat(43);
    expect(await verifyApiKey(validKey)).toBeNull();
  });

  it("returns the verified key on a DB hit", async () => {
    const mod = await import("@supabase/supabase-js") as any;
    mod.__setMaybeSingle(async () => ({
      data: { id: "abc", user_id: "u1", key_prefix: "AAAAAAAA" },
      error: null,
    }));
    const validKey = "rtt_" + "A".repeat(43);
    expect(await verifyApiKey(validKey)).toEqual({
      id: "abc",
      user_id: "u1",
      key_prefix: "AAAAAAAA",
    });
  });
});
