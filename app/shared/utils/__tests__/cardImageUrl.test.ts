import { describe, it, expect, vi } from "vitest";

// The helper reads NEXT_PUBLIC_BLOB_BASE_URL at module load — set it before the
// dynamic import below.
process.env.NEXT_PUBLIC_BLOB_BASE_URL = "https://blob.example.com";
const { getCardImageUrl, getCardImageUrlOrNull, sanitizeImgFile } = await import(
  "../cardImageUrl"
);

describe("sanitizeImgFile", () => {
  it("strips .jpg/.jpeg and maps slashes to underscores", () => {
    expect(sanitizeImgFile("Foo.jpg")).toBe("Foo");
    expect(sanitizeImgFile("Foo.JPEG")).toBe("Foo");
    expect(sanitizeImgFile("Good/Evil_Card")).toBe("Good_Evil_Card");
    expect(sanitizeImgFile("Plain")).toBe("Plain");
  });
});

describe("getCardImageUrl", () => {
  it("builds the blob URL", () => {
    expect(getCardImageUrl("Angel_of_God_(I)")).toBe(
      "https://blob.example.com/card-images/Angel_of_God_(I).jpg",
    );
  });
  it("strips a stored extension instead of doubling it", () => {
    expect(getCardImageUrl("snap.jpg")).toBe("https://blob.example.com/card-images/snap.jpg");
  });
  it("passes through leading-slash local assets and blanks forge refs", () => {
    expect(getCardImageUrl("/goldfish/back.png")).toBe("/goldfish/back.png");
    expect(getCardImageUrl("forge:abc")).toBe("");
    expect(getCardImageUrl("")).toBe("");
  });
});

describe("getCardImageUrlOrNull", () => {
  it("nulls on nullish input, mirrors getCardImageUrl otherwise", () => {
    expect(getCardImageUrlOrNull(null)).toBeNull();
    expect(getCardImageUrlOrNull(undefined)).toBeNull();
    expect(getCardImageUrlOrNull("snap.jpg")).toBe(
      "https://blob.example.com/card-images/snap.jpg",
    );
  });
});

describe("image version cache-busting", () => {
  it("appends ?v= for a versioned image, keyed on the SANITIZED imgFile", async () => {
    vi.resetModules();
    vi.doMock("@/lib/cards/generated/imgVersions.json", () => ({
      default: { "Angel_of_God_(I)": 3 },
    }));
    const mod = await import("../cardImageUrl");
    expect(mod.getCardImageUrl("Angel_of_God_(I)")).toBe(
      "https://blob.example.com/card-images/Angel_of_God_(I).jpg?v=3",
    );
    // deck-stored values carry extensions — the map hit must survive that (F13)
    expect(mod.getCardImageUrlOrNull("Angel_of_God_(I).jpg")).toBe(
      "https://blob.example.com/card-images/Angel_of_God_(I).jpg?v=3",
    );
    expect(mod.getCardImageUrl("Unversioned_(X)")).toBe(
      "https://blob.example.com/card-images/Unversioned_(X).jpg",
    );
    vi.doUnmock("@/lib/cards/generated/imgVersions.json");
  });
});
