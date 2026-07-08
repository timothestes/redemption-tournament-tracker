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

describe("playerProfile career history fieldSize", () => {
  it("counts distinct Round 1 participants when match data exists, independent of drops before standings", () => {
    const key = "2025_T1 2-Player";
    const [year, format] = [2025, "T1 2-Player"];
    const expected = new Set<string>();
    for (const m of data.matches[key]) {
      if (m.round !== "Round 1") continue;
      for (const n of [m.playerA, m.playerB]) {
        if (n && n.toLowerCase() !== "bye") expected.add(n);
      }
    }
    // Field size (Round 1 attendance) should exceed the results/standings
    // row count whenever players dropped before final standings.
    expect(expected.size).toBeGreaterThan(data.results[key].length);

    const player = data.results[key][0].playerName;
    const p = playerProfile(data, player);
    const entry = p.placements.find((h) => h.year === year && h.format === format);
    expect(entry?.fieldSize).toBe(expected.size);
  });

  it("is null when no match data exists for that year+format", () => {
    const key = "2016_T1 Multiplayer";
    expect(data.matches[key]).toBeUndefined();
    const player = data.results[key][0].playerName;
    const p = playerProfile(data, player);
    const entry = p.placements.find((h) => h.year === 2016 && h.format === "T1 Multiplayer");
    expect(entry?.fieldSize).toBeNull();
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

describe("playerProfile Teams record (per-round, not per-game)", () => {
  it("counts one W/L/D per team round for a clean player (no per-game doubling)", () => {
    // Chris Ericson has 22 Teams game records across 11 unanimous rounds.
    // Per-round = 9-2-0; the per-game bug would report 18-4-0.
    const p = playerProfile(data, "Chris Ericson");
    expect(p.matchStatsByFmt["Teams"]).toEqual({ wins: 9, losses: 2, draws: 0 });
  });

  it("resolves split Teams rounds by majority with ties as draws (order-independent)", () => {
    // Andrew Wills, 2013 Teams: three 2-2 rounds (each W/L split) -> 3 draws.
    // Per-round majority = 3-5-3; first-encountered (the PR bug) = 3-8-0;
    // raw per-game = 18-26-0.
    const p = playerProfile(data, "Andrew Wills");
    expect(p.matchStatsByFmt["Teams"]).toEqual({ wins: 3, losses: 5, draws: 3 });
  });

  it("keeps full per-game head-to-head credit for Teams cross-pairings", () => {
    // Head-to-head must not be collapsed per round: Wills met two distinct
    // opponents per 2013 round, so each is credited separately.
    const p = playerProfile(data, "Andrew Wills");
    const oppGames = Object.values(p.matchStatsByOpp).reduce(
      (s, v) => s + v.wins + v.losses + v.draws,
      0
    );
    // Per-round Teams total is 11 (3+5+3); per-game H2H must exceed it.
    expect(oppGames).toBeGreaterThan(11);
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
