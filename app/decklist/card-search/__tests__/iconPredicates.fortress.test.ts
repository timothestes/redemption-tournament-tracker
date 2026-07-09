import { describe, it, expect } from "vitest";
import { iconPredicates, type Card } from "../utils";

// Minimal Card fixture — only the fields the Fortress/City predicates read matter.
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

const goodFortress = iconPredicates["Good Fortress"];
const evilFortress = iconPredicates["Evil Fortress"];

// In Redemption a City is a type of Fortress, so the Fortress filters should
// surface Cities of the matching alignment (Bethlehem, City of Refuge, etc.).
describe("Good/Evil Fortress filters include Cities", () => {
  it("Good Fortress filter surfaces Good Cities", () => {
    // Bethlehem (LoC) — a Good City
    expect(goodFortress(card({ type: "City", alignment: "Good" }))).toBe(true);
  });

  it("Evil Fortress filter surfaces Evil Cities", () => {
    // Sodom & Gomorrah — an Evil City
    expect(evilFortress(card({ type: "City", alignment: "Evil" }))).toBe(true);
  });

  it("does not surface a City under the opposite alignment's Fortress filter", () => {
    expect(evilFortress(card({ type: "City", alignment: "Good" }))).toBe(false);
    expect(goodFortress(card({ type: "City", alignment: "Evil" }))).toBe(false);
  });

  it("still matches ordinary Fortresses (regression guard)", () => {
    expect(goodFortress(card({ type: "Fortress", alignment: "Good" }))).toBe(true);
    expect(evilFortress(card({ type: "Fortress", alignment: "Evil" }))).toBe(true);
    // Dual-type fortress cards keep matching.
    expect(evilFortress(card({ type: "Evil Character/Fortress", alignment: "Evil" }))).toBe(true);
  });

  it("does not surface non-Fortress, non-City cards", () => {
    expect(goodFortress(card({ type: "Hero", alignment: "Good" }))).toBe(false);
    expect(evilFortress(card({ type: "Site", alignment: "Evil" }))).toBe(false);
  });
});
