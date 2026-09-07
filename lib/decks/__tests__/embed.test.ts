import { describe, it, expect } from "vitest";
import { buildDeckEmbed, type CardInfoLookup, type DeckEmbedSource } from "../embed";

const INFO: Record<string, { type: string; alignment?: string; brigade?: string }> = {
  "Son of God": { type: "Dominant", alignment: "Good" },
  "Angel of the Lord": { type: "Dominant", alignment: "Good" },
  "Moses": { type: "Hero", alignment: "Good", brigade: "Blue" },
  "Abraham": { type: "Hero", alignment: "Good", brigade: "Blue" },
  "Herod": { type: "Evil Character", alignment: "Evil", brigade: "Gold" },
  "Lost Soul (John 8:3-4)": { type: "Lost Soul" },
  "Ark of the Covenant": { type: "Artifact" },
  "Storehouse": { type: "Fortress" },
  "Chariot": { type: "GE", alignment: "Good", brigade: "Blue" },
};
const lookup: CardInfoLookup = (name) => INFO[name];

const card = (name: string, quantity = 1, zone = "main") => ({ name, set: "X", card_img_file: `${name}.jpg`, quantity, zone });

const deck: DeckEmbedSource = {
  id: "d1",
  name: "Test",
  format: "Type 1",
  username: "tim",
  cards: [
    card("Moses"),
    card("Herod"),
    card("Son of God"),
    card("Lost Soul (John 8:3-4)", 2),
    card("Abraham"),
    card("Angel of the Lord"),
    card("Chariot", 3),
    card("Ark of the Covenant"),
    card("Storehouse"),
    card("Mystery", 1, "maybeboard"),
    card("Herod", 1, "reserve"),
    card("Moses", 2, "reserve"),
  ],
};

describe("buildDeckEmbed", () => {
  const out = buildDeckEmbed(deck, lookup);

  it("orders groups canonically and labels them", () => {
    expect(out.groups.map((g) => g.label)).toEqual([
      "Dominants",
      "Artifacts / Covenants / Curses",
      "Fortresses / Sites",
      "Lost Souls",
      "Heroes",
      "Good Enhancements",
      "Evil Characters",
    ]);
  });

  it("sorts inside a group by name and sums quantities", () => {
    const dom = out.groups[0];
    expect(dom.cards.map((c) => c.name)).toEqual(["Angel of the Lord", "Son of God"]);
    expect(dom.count).toBe(2);
    expect(out.groups.find((g) => g.label === "Good Enhancements")?.count).toBe(3);
  });

  it("counts main and reserve separately and drops the maybeboard", () => {
    expect(out.cardCount).toBe(12);
    expect(out.reserveCount).toBe(3);
    expect(out.reserve.map((c) => `${c.name}x${c.quantity}`)).toEqual(["Herodx1", "Mosesx2"]);
    expect(JSON.stringify(out)).not.toContain("Mystery");
  });

  it("keeps unknown cards in an Other bucket instead of dropping them", () => {
    const o = buildDeckEmbed({ ...deck, cards: [card("Unknown Card")] }, lookup);
    expect(o.groups).toEqual([{ label: "Other", count: 1, cards: [expect.objectContaining({ name: "Unknown Card", type: "" })] }]);
  });

  it("carries deck metadata through", () => {
    expect(out).toMatchObject({ id: "d1", name: "Test", format: "Type 1", username: "tim" });
  });
});
