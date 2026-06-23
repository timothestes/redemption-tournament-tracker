import { describe, it, expect } from "vitest";
import { washPath, statBoxPath, iconPath, isPreviewApproximate, BRIGADE_HEX } from "../frameAssets";

describe("washPath", () => {
  it("maps a single good brigade to its Elements wash", () => {
    expect(washPath({ cardType: ["Hero"], brigades: ["Blue"] }))
      .toBe("/forge/frames/Elements/Background=blue.webp");
  });
  it("special types override brigade with a type wash", () => {
    expect(washPath({ cardType: ["LostSoul"] })).toBe("/forge/frames/Elements/Background=lost-soul.webp");
    expect(washPath({ cardType: ["Artifact"] })).toBe("/forge/frames/Elements/Background=artifact.webp");
    expect(washPath({ cardType: ["Dominant"], alignment: "Evil" })).toBe("/forge/frames/Elements/Background=evil-dom.webp");
  });
  it("returns null (=> solid fallback) when a brigadeless card has no brigade", () => {
    expect(washPath({ cardType: ["Hero"] })).toBeNull();
  });
  it("uses the dual wash when both brigades are available", () => {
    expect(washPath({ cardType: ["EvilCharacter"], brigades: ["Black", "Brown"] }))
      .toBe("/forge/frames/Elements/Background=black/brown.webp");
  });
});

describe("statBoxPath / iconPath", () => {
  it("stat-bearing types get a stat box; non-stat types do not", () => {
    expect(statBoxPath({ cardType: ["Hero"], brigades: ["Blue"] })).not.toBeNull();
    expect(statBoxPath({ cardType: ["LostSoul"] })).toBeNull();
  });
  it("maps the type icon", () => {
    expect(iconPath({ cardType: ["Hero"] })).toBe("/forge/frames/Icons/Cross Icon.png");
    expect(iconPath({ cardType: ["EvilCharacter"] })).toBe("/forge/frames/Icons/Evil Character.png");
  });
});

describe("isPreviewApproximate", () => {
  it("flags 3+ brigades and Classic frame as approximate", () => {
    expect(isPreviewApproximate({ cardType: ["Hero"], brigades: ["Blue", "Green", "Purple"] })).toBe(true);
    expect(isPreviewApproximate({ cardType: ["Hero"], legality: "Classic" })).toBe(true);
    expect(isPreviewApproximate({ cardType: ["Hero"], brigades: ["Blue"] })).toBe(false);
  });
});

describe("BRIGADE_HEX", () => {
  it("provides a fallback color for supported brigades", () => {
    expect(BRIGADE_HEX.Blue).toMatch(/^#/);
    expect(BRIGADE_HEX.Crimson).toMatch(/^#/);
  });
});
