import { describe, it, expect } from "vitest";
import { normalizeBrigadesFrozen } from "../brigades";
import { DeckCheckError } from "../errors";
import fixture from "./fixtures/brigades.json";

describe("normalizeBrigadesFrozen", () => {
  it("matches brigades.py over the full catalog", () => {
    for (const row of fixture as Array<{ name: string; brigade: string; alignment: string; expected: string[] }>) {
      expect(normalizeBrigadesFrozen(row.brigade, row.alignment, row.name), row.name).toEqual(row.expected);
    }
  });

  it("City of Refuge (empty brigade) returns [] — the frozen divergence", () => {
    expect(normalizeBrigadesFrozen("", "Neutral", "City of Refuge")).toEqual([]);
  });

  it("throws DeckCheckError with the Python assert message on an invalid brigade", () => {
    expect(() => normalizeBrigadesFrozen("Chartreuse", "Good", "Fake Card")).toThrowError(
      new DeckCheckError("Card Fake Card has an invalid brigade: Chartreuse.")
    );
  });
});
