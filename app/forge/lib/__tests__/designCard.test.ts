import { describe, it, expect } from "vitest";
import { cardApplicability, isStatBearing, validate, BRIGADES } from "../designCard";

describe("cardApplicability", () => {
  it("Hero requires brigade + stats", () => {
    const a = cardApplicability(["Hero"]);
    expect(a.brigades).toBe("required");
    expect(a.stats).toBe("required");
  });
  it("Artifact has no brigade/stats but requires ability", () => {
    const a = cardApplicability(["Artifact"]);
    expect(a.brigades).toBe("na");
    expect(a.stats).toBe("na");
    expect(a.specialAbility).toBe("required");
  });
  it("Site expects a brigade; Fortress treats it as optional", () => {
    expect(cardApplicability(["Site"]).brigades).toBe("required");
    expect(cardApplicability(["Fortress"]).brigades).toBe("optional");
  });
  it("dual-type unions field requirements (Hero/GE needs stats AND ability)", () => {
    const a = cardApplicability(["Hero", "GE"]);
    expect(a.stats).toBe("required");
    expect(a.specialAbility).toBe("required");
  });
});

describe("isStatBearing", () => {
  it("true for Hero/EvilCharacter, false for LostSoul", () => {
    expect(isStatBearing(["Hero"])).toBe(true);
    expect(isStatBearing(["EvilCharacter"])).toBe(true);
    expect(isStatBearing(["LostSoul"])).toBe(false);
  });
});

describe("validate (advisory only)", () => {
  it("hints a missing required field but never throws / blocks", () => {
    const hints = validate({ cardType: ["Hero"] }); // no brigade, no stats, no name
    expect(hints.some((h) => h.field === "brigades")).toBe(true);
    expect(Array.isArray(hints)).toBe(true);
  });
  it("returns no hints for an empty napkin card (zero required fields demanded)", () => {
    expect(validate({})).toEqual([]);
  });
});

describe("BRIGADES enum", () => {
  it("excludes the ambiguous Multi sentinels", () => {
    expect(BRIGADES).not.toContain("GoodMulti");
    expect(BRIGADES).not.toContain("EvilMulti");
  });
});
