import { describe, it, expect } from "vitest";
import { searchableIdentifier, type Card } from "../utils";

// Minimal Card fixture — only type and identifier matter to searchableIdentifier.
const card = (over: Partial<Card>): Card => ({
  dataLine: "",
  name: "",
  set: "",
  imgFile: "",
  officialSet: "",
  type: "",
  brigade: "",
  strength: "",
  toughness: "",
  class: "",
  identifier: "",
  specialAbility: "",
  rarity: "",
  reference: "",
  alignment: "",
  legality: "",
  testament: "",
  isGospel: false,
  ...over,
});

// Flood survivors are Antediluvians in Redemption, but only newer printings
// (LoC, RR2) carry the explicit "Antediluvian" identifier. The searchable
// identifier appends it so a search for "Antediluvian" surfaces the older
// Flood survivor characters too.
describe("searchableIdentifier", () => {
  it("appends Antediluvian to a Flood survivor character", () => {
    // Shem (CoW)
    const c = card({ type: "Hero", identifier: "Flood survivor" });
    expect(searchableIdentifier(c)).toBe("Flood survivor, Antediluvian");
  });

  it("handles the capitalized 'Flood Survivor' variant", () => {
    // Ham's Wife (FoM)
    const c = card({ type: "Hero", identifier: "Flood Survivor" });
    expect(searchableIdentifier(c)).toBe("Flood Survivor, Antediluvian");
  });

  it("augments identifiers with additional clauses", () => {
    // Japheth (CoW)
    const c = card({
      type: "Hero",
      identifier: "Flood survivor, X = # of flood survivors you control",
    });
    expect(searchableIdentifier(c)).toBe(
      "Flood survivor, X = # of flood survivors you control, Antediluvian"
    );
  });

  it("leaves cards already identified as Antediluvian unchanged", () => {
    // Noah, the Righteous (LoC)
    const c = card({
      type: "Hero",
      identifier: "Antediluvian, Flood survivor, Prophet",
    });
    expect(searchableIdentifier(c)).toBe("Antediluvian, Flood survivor, Prophet");
  });

  it("does not augment non-character cards that merely reference flood survivors", () => {
    // A New Beginning (FoM) — a Good Enhancement, not an Antediluvian
    const c = card({ type: "GE", identifier: "Unity Heroes (Flood Survivors)" });
    expect(searchableIdentifier(c)).toBe("Unity Heroes (Flood Survivors)");
  });

  it("leaves ordinary identifiers unchanged", () => {
    expect(searchableIdentifier(card({ type: "Hero", identifier: "Prophet" }))).toBe("Prophet");
    expect(searchableIdentifier(card({ type: "Hero", identifier: "" }))).toBe("");
  });
});
