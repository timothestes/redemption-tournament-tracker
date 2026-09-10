import { describe, it, expect } from "vitest";
import { sortSetCards } from "../cardOrder";
import type { ForgeCardFull } from "../cards";
import type { DesignCard } from "../designCard";

let seq = 0;
const forgeCard = (title: string, snapshot: DesignCard): ForgeCardFull => ({
  id: `card-${++seq}`,
  title,
  snapshot,
  hasArt: false,
  hasFinished: false,
  isPlaceholder: false,
  status: "approved",
  updatedAt: "",
  setId: "eot",
  publishedVersionId: null,
  approvedVersionId: null,
  ownerId: "owner",
  createdAt: "",
});

const titles = (cards: ForgeCardFull[]): string[] => sortSetCards(cards).map((c) => c.title ?? "");

describe("sortSetCards — End of Times print order", () => {
  it("puts The Days of Noah (Purple/Blue) at the head of the Good section, not in the Purple slot", () => {
    const cards = [
      forgeCard("Beware of Abominations", { cardType: ["GE"], brigades: ["Purple"], alignment: "Good", strength: "5" }),
      forgeCard("Peter, Son of Jonah", { cardType: ["Hero"], brigades: ["Purple"], alignment: "Good", strength: "4" }),
      forgeCard("Paul, Church Planter", { cardType: ["Hero"], brigades: ["Clay"], alignment: "Good", strength: "11" }),
      forgeCard("The Days of Noah", { cardType: ["GE"], brigades: ["Purple", "Blue"], alignment: "Good", strength: "4" }),
    ];
    expect(titles(cards)).toEqual([
      "The Days of Noah", "Paul, Church Planter", "Peter, Son of Jonah", "Beware of Abominations",
    ]);
  });

  it("puts Tree of Life (Blue/Silver) first among covenants instead of last", () => {
    const cards = [
      forgeCard("No More Pain", { cardType: ["Covenant"], brigades: ["White"], alignment: "Good", strength: "4" }),
      forgeCard("Saved by Faith", { cardType: ["Covenant"], brigades: ["Clay"], alignment: "Good", strength: "5" }),
      forgeCard("Tree of Life", { cardType: ["Covenant"], brigades: ["Blue", "Silver"], alignment: "Good", strength: "4" }),
      forgeCard("Covenant of Prayer [EoT]", { cardType: ["Covenant"], brigades: ["Silver", "White"], alignment: "Good", strength: "3" }),
    ];
    expect(titles(cards)).toEqual(["Tree of Life", "Covenant of Prayer [EoT]", "Saved by Faith", "No More Pain"]);
  });

  it("passes toughness through so same-strength cards keep the printed tie order", () => {
    const cards = [
      forgeCard("The Lawless One", { cardType: ["EvilCharacter"], brigades: ["PaleGreen"], alignment: "Evil", strength: "4", toughness: "2" }),
      forgeCard("Meddling Mage", { cardType: ["EvilCharacter"], brigades: ["PaleGreen"], alignment: "Evil", strength: "4", toughness: "4" }),
    ];
    // Alphabetical would put "Lawless One" first; toughness 4 beats 2.
    expect(titles(cards)).toEqual(["Meddling Mage", "The Lawless One"]);
  });

  it("re-reads the snapshot on every sort, so a brigade change moves the card without a manual step", () => {
    const noah = forgeCard("The Days of Noah", { cardType: ["GE"], brigades: ["Purple"], alignment: "Good", strength: "4" });
    const cards = [
      forgeCard("Paul, Church Planter", { cardType: ["Hero"], brigades: ["Clay"], alignment: "Good", strength: "11" }),
      noah,
    ];
    expect(titles(cards)).toEqual(["Paul, Church Planter", "The Days of Noah"]);
    noah.snapshot = { ...noah.snapshot, brigades: ["Purple", "Blue"] };
    expect(titles(cards)).toEqual(["The Days of Noah", "Paul, Church Planter"]);
  });
});
