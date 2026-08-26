import { describe, it, expect } from "vitest";
import { enforceLimits } from "../limits";
import { DeckCheckError } from "../errors";

const deck = (mainSize: number, reserveSize = 0) =>
  ({ main: new Map(), reserve: new Map(), mainSize, reserveSize }) as any;

describe("enforceLimits bypass=true (image/aod routes)", () => {
  it("caps main at 140", () =>
    expect(() => enforceLimits(deck(141), "type_1", true)).toThrowError(
      new DeckCheckError("Please load a deck that contains 140 or less cards in the main deck.")));
  it("caps reserve at 20", () =>
    expect(() => enforceLimits(deck(50, 21), "type_2", true)).toThrowError(
      new DeckCheckError("Please load a deck that contains 20 or less cards in the reserve.")));
  it("allows a 1-card deck (no minimum)", () =>
    expect(() => enforceLimits(deck(1), "type_1", true)).not.toThrow());
});

describe("enforceLimits bypass=false (PDF route)", () => {
  it("minimum 40 main", () =>
    expect(() => enforceLimits(deck(39), "type_1", false)).toThrowError(
      new DeckCheckError("Please load a deck that contains at least 40 cards in the main deck.")));
  it("T2 main cap 140", () =>
    expect(() => enforceLimits(deck(141), "type_2", false)).toThrowError(
      new DeckCheckError("Please load a deck that contains 140 or less cards in the main deck for type 2")));
  it("T1/Paragon main cap 70", () => {
    for (const t of ["type_1", "paragon"])
      expect(() => enforceLimits(deck(71), t, false)).toThrowError(
        new DeckCheckError("Please load a deck that contains 70 or less cards in the main deck for type 1"));
  });
  it("T1/Paragon reserve cap 10", () =>
    expect(() => enforceLimits(deck(50, 11), "type_1", false)).toThrowError(
      new DeckCheckError("Please load a deck that contains 10 or less cards in the reserve for type 1")));
  it("T2 reserve cap 20", () =>
    expect(() => enforceLimits(deck(140, 21), "type_2", false)).toThrowError(
      new DeckCheckError("Please load a deck that contains 20 or less cards in the reserve for type 2")));
  it("unknown deck_type gets min-40 but no caps (Python if/elif shape)", () =>
    expect(() => enforceLimits(deck(141, 30), "type_9", false)).not.toThrow());
});
