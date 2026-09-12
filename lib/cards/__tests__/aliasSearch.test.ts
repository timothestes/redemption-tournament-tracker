import { describe, it, expect, vi, beforeEach } from "vitest";

// The alias tests that walk CARD_ALIASES only cover whatever the curator has
// committed, and go vacuous the moment that list is empty. These supply their
// own overlay instead — real catalog cards, real resolution, fixture data.
//
// The fixture is deliberately a HARD case: the four "Aaron's Rod" printings all
// share a stem, type, brigade and alignment, so the picker collapses them into
// ONE row whose representative is "Aaron's Rod (C)". An alias naming a
// different printing of that row is exactly where a naive implementation
// reports the representative's art instead of the one that was curated.
const FIXTURE = [
  { alias: "ARODG", name: "Aaron's Rod (G)", set: "10A" },
  { alias: "LAFS", name: "Love at First Sight (LoC)", set: "LoC" },
];

vi.mock("../generated/cardAliases.json", () => ({ default: FIXTURE }));

let searchCardNames: typeof import("../search").searchCardNames;
let resolveCardRef: typeof import("@/app/articles/lib/cardRefs").resolveCardRef;
let findCard: typeof import("../lookup").findCard;

beforeEach(async () => {
  // search.ts and aliases.ts both memoise at module scope.
  vi.resetModules();
  ({ searchCardNames } = await import("../search"));
  ({ resolveCardRef } = await import("@/app/articles/lib/cardRefs"));
  ({ findCard } = await import("../lookup"));
});

const hitFor = (alias: string) => searchCardNames(alias, 50).find((h) => h.alias === alias);

describe("the picker's alias row", () => {
  it.each(FIXTURE)("shows the printing $alias names, not another from its row", (entry) => {
    const target = findCard(entry.name, entry.set)!;
    const hit = hitFor(entry.alias);
    expect(hit, `alias "${entry.alias}" is not searchable`).toBeDefined();
    expect(hit!.imgFile).toBe(target.imgFile);
    expect(hit!.set).toBe(target.set);
  });

  it.each(FIXTURE)("inserts text that resolves back to the card $alias names", (entry) => {
    const target = findCard(entry.name, entry.set)!;
    const hit = hitFor(entry.alias)!;
    // Whatever the picker writes into `[[ ]]` must land on the curated
    // printing — otherwise picking the row silently means another card.
    expect(resolveCardRef(hit.name)?.imgFile).toBe(target.imgFile);
  });

  it.each(FIXTURE)("never writes a mention that cannot parse for $alias", (entry) => {
    expect(hitFor(entry.alias)!.name).not.toMatch(/[[\]|\n]/);
  });

  it("leads the results", () => {
    expect(searchCardNames("ARODG", 50)[0]?.alias).toBe("ARODG");
  });

  it("lists the card once, even when the alias is also a substring of its name", () => {
    const hits = searchCardNames("ARODG", 50);
    expect(new Set(hits.map((h) => h.imgFile)).size).toBe(hits.length);
  });

  it("honours the limit with the alias row prepended", () => {
    expect(searchCardNames("ARODG", 1)).toHaveLength(1);
    expect(searchCardNames("ARODG", 1)[0].alias).toBe("ARODG");
  });

  it("leaves alias unset on an ordinary name match", () => {
    expect(searchCardNames("son of god")[0].alias).toBeUndefined();
  });
});

describe("resolveCardRef with a fixture overlay", () => {
  it.each(FIXTURE)("resolves $alias to the printing it names", (entry) => {
    const target = findCard(entry.name, entry.set)!;
    expect(resolveCardRef(entry.alias)).toEqual({ name: target.name, imgFile: target.imgFile });
  });

  it("still prefers a real card over an alias", () => {
    // "Aaron's Rod (C)" is a printed name; resolution must reach it directly
    // rather than through the row the ARODG alias also points into.
    expect(resolveCardRef("Aaron's Rod (C)")!.imgFile).toBe(findCard("Aaron's Rod (C)", "2E")!.imgFile);
  });

  it("resolves nothing for an alias nobody curated", () => {
    expect(resolveCardRef("NOTANALIAS")).toBeUndefined();
  });
});
