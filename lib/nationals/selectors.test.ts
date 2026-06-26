import { describe, it, expect } from "vitest";
import seed from "../../public/data/nationals-history.json";
import { buildChampionData, getAllFormats, headToHead, playerProfile } from "./selectors";

const data = seed as any;

it("champions have >=1 win and sane shape", () => {
  const champs = buildChampionData(data);
  expect(champs.length).toBeGreaterThan(0);
  for (const c of champs) {
    expect(c.wins).toBeGreaterThanOrEqual(1);
    expect(c.wins).toBe(c.years.length);
  }
});

it("getAllFormats returns non-empty unique list", () => {
  const f = getAllFormats(data);
  expect(f.length).toBeGreaterThan(0);
  expect(new Set(f).size).toBe(f.length);
});

it("headToHead is symmetric in totals", () => {
  const champs = buildChampionData(data);
  const [a, b] = [champs[0].name, champs[1].name];
  const ab = headToHead(data, a, b), ba = headToHead(data, b, a);
  expect(ab.wins).toBe(ba.losses);
  expect(ab.losses).toBe(ba.wins);
});

it("playerProfile returns appearances for a champion", () => {
  const champs = buildChampionData(data);
  const p = playerProfile(data, champs[0].name);
  expect(p.appearances).toBeGreaterThanOrEqual(1);
});

describe("buildChampionData extras", () => {
  it("champion formats lists all formats they won", () => {
    const champs = buildChampionData(data);
    for (const c of champs) {
      expect(c.formats.length).toBeGreaterThan(0);
      expect(c.years.length).toBe(c.wins);
    }
  });
});

describe("playerProfile shape", () => {
  it("has placements array and match stats", () => {
    const champs = buildChampionData(data);
    const p = playerProfile(data, champs[0].name);
    expect(Array.isArray(p.placements)).toBe(true);
    expect(typeof p.matchStatsByFmt).toBe("object");
    expect(typeof p.matchStatsByOpp).toBe("object");
    expect(typeof p.topCutWins).toBe("number");
    expect(typeof p.topCutLosses).toBe("number");
    expect(typeof p.championships).toBe("number");
    expect(p.championships).toBeGreaterThanOrEqual(1);
  });

  it("fantasy draft history is an array", () => {
    const champs = buildChampionData(data);
    const p = playerProfile(data, champs[0].name);
    expect(Array.isArray(p.fantasyDraftHistory)).toBe(true);
  });
});

describe("headToHead", () => {
  it("returns empty matches when players never met", () => {
    const h2h = headToHead(data, "NOBODY_A", "NOBODY_B");
    expect(h2h.wins).toBe(0);
    expect(h2h.losses).toBe(0);
    expect(h2h.draws).toBe(0);
    expect(h2h.matches.length).toBe(0);
  });
});

describe("playerProfile multiWL", () => {
  it("returns numeric totals and an object for a player with multiplayer data", () => {
    // Pick the first player listed in multiWL so we exercise the typed path
    const multiWLKeys = Object.keys(data.multiWL ?? {});
    expect(multiWLKeys.length).toBeGreaterThan(0);
    const playerName = multiWLKeys[0];
    const p = playerProfile(data, playerName);
    expect(typeof p.multiWins).toBe("number");
    expect(typeof p.multiLosses).toBe("number");
    expect(typeof p.multiDraws).toBe("number");
    expect(p.multiWins).toBeGreaterThanOrEqual(0);
    expect(p.multiLosses).toBeGreaterThanOrEqual(0);
    expect(p.multiDraws).toBeGreaterThanOrEqual(0);
    expect(typeof p.multiWLByFmt).toBe("object");
    expect(p.hasMulti).toBe(true);
  });
});
