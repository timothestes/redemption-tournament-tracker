import { describe, it, expect } from "vitest";
import { decklistPdfDownloadUrl, sanitizeDeckFilename } from "../pdfDownloadUrl";

const SUPABASE_URL =
  "https://dhxxsolhgvimxtusepht.supabase.co/storage/v1/object/public/decklists/cfc68382-413d-4a0a-bdd4-c04572f5a8c4?";

describe("sanitizeDeckFilename", () => {
  it("replaces whitespace with underscores", () => {
    expect(sanitizeDeckFilename("My Cool Deck")).toBe("My_Cool_Deck");
  });

  it("strips filename-illegal characters", () => {
    expect(sanitizeDeckFilename('Aggro/Control: "v2"?')).toBe("AggroControl_v2");
  });

  it("falls back to 'decklist' when empty or missing", () => {
    expect(sanitizeDeckFilename("")).toBe("decklist");
    expect(sanitizeDeckFilename("   ")).toBe("decklist");
    expect(sanitizeDeckFilename(null)).toBe("decklist");
    expect(sanitizeDeckFilename(undefined)).toBe("decklist");
  });
});

describe("decklistPdfDownloadUrl", () => {
  it("appends a download param named after the deck", () => {
    const result = decklistPdfDownloadUrl(SUPABASE_URL, "My Cool Deck");
    expect(new URL(result).searchParams.get("download")).toBe("My_Cool_Deck.pdf");
  });

  it("preserves the original object path and origin", () => {
    const result = new URL(decklistPdfDownloadUrl(SUPABASE_URL, "Deck"));
    expect(result.origin).toBe("https://dhxxsolhgvimxtusepht.supabase.co");
    expect(result.pathname).toBe(
      "/storage/v1/object/public/decklists/cfc68382-413d-4a0a-bdd4-c04572f5a8c4",
    );
  });

  it("uses the fallback filename when no deck name is given", () => {
    const result = decklistPdfDownloadUrl(SUPABASE_URL, null);
    expect(new URL(result).searchParams.get("download")).toBe("decklist.pdf");
  });

  it("returns the raw string unchanged when it is not a valid URL", () => {
    expect(decklistPdfDownloadUrl("not a url", "Deck")).toBe("not a url");
  });
});
