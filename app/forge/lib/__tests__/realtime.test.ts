import { describe, it, expect } from "vitest";
import { forgeCardTopic, forgeSetTopic } from "@/app/forge/lib/realtime";

describe("forge realtime topics", () => {
  it("builds a card topic with no sub-suffix", () => {
    expect(forgeCardTopic("abc-123")).toBe("forge:card:abc-123");
  });
  it("builds a set topic with no sub-suffix", () => {
    expect(forgeSetTopic("set-9")).toBe("forge:set:set-9");
  });
  it("topics have exactly 3 colon-separated parts (RLS parses split_part(.,3))", () => {
    expect(forgeCardTopic("u").split(":").length).toBe(3);
    expect(forgeSetTopic("u").split(":").length).toBe(3);
  });
});
