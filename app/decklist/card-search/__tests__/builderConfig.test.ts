import { describe, it, expect } from "vitest";
import { getPublicImageUrl } from "../hooks/useCardImageUrl";
import { PUBLIC_BUILDER_CONFIG } from "../builderConfig";
import type { Card } from "../utils";

// Minimal Card stub — resolveCardImage only reads imgFile (public config ignores dataLine).
const card = (imgFile: string, dataLine = ""): Card =>
  ({ imgFile, dataLine, name: "x", set: "x" } as unknown as Card);

describe("getPublicImageUrl", () => {
  it("strips a duplicate extension and builds the blob URL", () => {
    expect(getPublicImageUrl("foo")).toBe(getPublicImageUrl("foo.jpg"));
    expect(getPublicImageUrl("foo.JPEG")).toBe(getPublicImageUrl("foo"));
  });

  it("returns a string even for an empty imgFile (forge cards have imgFile='')", () => {
    expect(typeof getPublicImageUrl("")).toBe("string");
  });
});

describe("PUBLIC_BUILDER_CONFIG.resolveCardImage — public invariant", () => {
  it("always resolves to a URL equal to getPublicImageUrl(imgFile)", () => {
    const r = PUBLIC_BUILDER_CONFIG.resolveCardImage(card("abc"));
    expect(r).toEqual({ kind: "url", url: getPublicImageUrl("abc") });
  });

  it("never returns an element — even for a forge-shaped dataLine (public has no forge knowledge)", () => {
    const r = PUBLIC_BUILDER_CONFIG.resolveCardImage(card("", "forge:123"));
    expect(r.kind).toBe("url");
  });
});

describe("PUBLIC_BUILDER_CONFIG defaults", () => {
  it("keeps localStorage drafts enabled for the public builder", () => {
    expect(PUBLIC_BUILDER_CONFIG.features?.localStoragePersist).toBe(true);
  });

  it("injects no persistence override (useDeckState uses the decks-table default)", () => {
    expect(PUBLIC_BUILDER_CONFIG.persistence).toBeUndefined();
  });
});
