import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { sectionZone } from "../deckZones";
import { parseDeckContents, buildAliasCandidates } from "../deckContentsParser";

describe("sectionZone", () => {
  it("maps the Reserve section to 'reserve', everything else to 'main'", () => {
    expect(sectionZone("Reserve")).toBe("reserve");
    expect(sectionZone("RESERVE")).toBe("reserve");
    expect(sectionZone("Heroes")).toBe("main");
    expect(sectionZone("Lost Souls")).toBe("main");
    expect(sectionZone("Fortresses/Sites/Cities")).toBe("main");
    expect(sectionZone(null)).toBe("main"); // pre-section lines are main
  });

  it("catches Reserve inside a slash-composed header", () => {
    expect(sectionZone("Reserve/Misc")).toBe("reserve");
  });
});

describe("fixture: fiery-furnace.html section→zone derivation", () => {
  // READ-ONLY use of the parser. Section attribution doesn't depend on alias
  // rows, so an empty seed (carddata identity entries only) is enough here.
  const fixture = readFileSync(
    path.join(__dirname, "fixtures", "fiery-furnace.html"), "utf8");
  const lines = parseDeckContents(fixture, buildAliasCandidates([]));

  it("maps the fixture's Reserve-section lines to 'reserve', the rest to 'main'", () => {
    const reserve = lines.filter((l) => sectionZone(l.section) === "reserve");
    expect(reserve.length).toBeGreaterThan(0);
    expect(reserve.every((l) => l.section === "Reserve")).toBe(true);
    expect(reserve.map((l) => l.raw)).toContain("Scattered (RoA)");

    const dominants = lines.filter((l) => l.section === "Dominants");
    expect(dominants.length).toBeGreaterThan(0);
    expect(dominants.every((l) => sectionZone(l.section) === "main")).toBe(true);
  });
});
