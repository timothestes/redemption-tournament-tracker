import { describe, it, expect } from "vitest";
import { deriveTestamentAndGospel, formatTestament, getTestamentForRef } from "../testament";

describe("deriveTestamentAndGospel", () => {
  it("classifies New Testament references", () => {
    expect(deriveTestamentAndGospel("Hebrews 10:25").testament).toBe("NT");
    expect(deriveTestamentAndGospel("Revelation 10:11").testament).toBe("NT");
    // Numbered book: "I Thessalonians" normalizes past the numeral prefix.
    expect(deriveTestamentAndGospel("I Thessalonians 4:13").testament).toBe("NT");
  });

  it("classifies Old Testament references", () => {
    expect(deriveTestamentAndGospel("Exodus 14:3").testament).toBe("OT");
    expect(deriveTestamentAndGospel("Psalm 60:5").testament).toBe("OT");
  });

  it("marks a card with both a NT and an OT reference as NT/OT", () => {
    // Lost Soul "Humble": main verse NT, parenthetical cross-ref OT.
    expect(deriveTestamentAndGospel("James 4:6 (Proverbs 3:34)").testament).toBe("NT/OT");
  });

  it("flags Gospel references", () => {
    const g = deriveTestamentAndGospel("Matthew 13:3");
    expect(g.testament).toBe("NT");
    expect(g.isGospel).toBe(true);
    expect(deriveTestamentAndGospel("Romans 1:1").isGospel).toBe(false);
  });

  it("returns empty testament for empty or unrecognized references", () => {
    expect(deriveTestamentAndGospel("").testament).toBe("");
    expect(deriveTestamentAndGospel("Hebrewz 10:25").testament).toBe("");
    expect(getTestamentForRef("nonsense")).toBe(null);
  });
});

describe("formatTestament", () => {
  it("maps codes to the game's N.T./O.T. convention", () => {
    expect(formatTestament("NT")).toBe("N.T.");
    expect(formatTestament("OT")).toBe("O.T.");
    expect(formatTestament("NT/OT")).toBe("N.T. / O.T.");
    expect(formatTestament("")).toBe("");
  });
});
