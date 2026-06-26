import { describe, it, expect } from "vitest";
import seed from "../../public/data/nationals-history.json";
import { buildChampionData } from "./selectors";
import { globalSearch } from "./search";

const data = seed as any;

describe("globalSearch", () => {
  it("empty query returns empty results", () => {
    const result = globalSearch(data, "");
    expect(result.players).toHaveLength(0);
    expect(result.tournaments).toHaveLength(0);
  });

  it("whitespace-only query returns empty results", () => {
    const result = globalSearch(data, "   ");
    expect(result.players).toHaveLength(0);
    expect(result.tournaments).toHaveLength(0);
  });

  it("a known champion's surname returns that player", () => {
    const champs = buildChampionData(data);
    expect(champs.length).toBeGreaterThan(0);
    const championName = champs[0].name;
    const lastName = championName.split(" ").at(-1)!;
    const result = globalSearch(data, lastName);
    const found = result.players.some((p) => p.name === championName);
    expect(found).toBe(true);
  });

  it("case-insensitive player search", () => {
    const champs = buildChampionData(data);
    const championName = champs[0].name;
    const lastName = championName.split(" ").at(-1)!.toUpperCase();
    const result = globalSearch(data, lastName);
    const found = result.players.some((p) => p.name === championName);
    expect(found).toBe(true);
  });

  it("tournament search by year string", () => {
    // There should be at least one tournament with a 4-digit year
    expect(data.tournaments.length).toBeGreaterThan(0);
    const t = data.tournaments[0];
    const result = globalSearch(data, String(t.year));
    const found = result.tournaments.some((r) => r.id === t.id);
    expect(found).toBe(true);
  });

  it("no-match query returns empty arrays", () => {
    const result = globalSearch(data, "xyzzy_no_match_8675309");
    expect(result.players).toHaveLength(0);
    expect(result.tournaments).toHaveLength(0);
  });

  it("returns Player objects with a name field", () => {
    const champs = buildChampionData(data);
    const result = globalSearch(data, champs[0].name.split(" ")[0]);
    for (const p of result.players) {
      expect(typeof p.name).toBe("string");
    }
  });

  it("returns Tournament objects with id and year", () => {
    const t = data.tournaments[0];
    const result = globalSearch(data, String(t.year));
    for (const r of result.tournaments) {
      expect(typeof r.id).toBe("string");
      expect(typeof r.year).toBe("number");
    }
  });
});
