import { describe, it, expect } from "vitest";

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
