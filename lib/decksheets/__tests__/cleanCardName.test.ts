import { describe, it, expect } from "vitest";
import { cleanCardName } from "../cleanCardName";
import fixture from "./fixtures/clean_card_name.json";

describe("cleanCardName", () => {
  it("matches text_to_pdf.py's clean_card_name over the full catalog", () => {
    for (const row of fixture as Array<{ name: string; type: string; expected: string }>) {
      expect(cleanCardName(row.name, { type: row.type }), row.name).toBe(row.expected);
    }
  });
});
