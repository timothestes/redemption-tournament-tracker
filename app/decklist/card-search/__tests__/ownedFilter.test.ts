import { describe, it, expect } from "vitest";
import {
  cycleOwnedMode,
  parseOwnedMode,
  ownedModeParam,
  type OwnedFilterMode,
} from "../ownedFilter";

describe("cycleOwnedMode", () => {
  it("cycles off → owned → missing → off", () => {
    expect(cycleOwnedMode("off")).toBe("owned");
    expect(cycleOwnedMode("owned")).toBe("missing");
    expect(cycleOwnedMode("missing")).toBe("off");
  });

  it("returns to the start after three clicks", () => {
    const modes: OwnedFilterMode[] = ["off", "owned", "missing"];
    for (const start of modes) {
      expect(cycleOwnedMode(cycleOwnedMode(cycleOwnedMode(start)))).toBe(start);
    }
  });
});

describe("parseOwnedMode", () => {
  it("keeps the pre-missing-mode ?owned=true links working", () => {
    expect(parseOwnedMode("true")).toBe("owned");
  });

  it("reads false as the missing mode", () => {
    expect(parseOwnedMode("false")).toBe("missing");
  });

  it("treats absent or junk values as no filtering", () => {
    expect(parseOwnedMode(null)).toBe("off");
    expect(parseOwnedMode("")).toBe("off");
    expect(parseOwnedMode("yes")).toBe("off");
    expect(parseOwnedMode("missing")).toBe("off");
  });
});

describe("ownedModeParam", () => {
  it("omits the param when the filter is off", () => {
    expect(ownedModeParam("off")).toBeNull();
  });

  it("round-trips both active modes through the URL", () => {
    for (const mode of ["owned", "missing"] as const) {
      expect(parseOwnedMode(ownedModeParam(mode))).toBe(mode);
    }
  });
});
