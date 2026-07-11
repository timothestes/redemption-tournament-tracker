import { describe, it, expect } from "vitest";
import {
  compareCardsDefault,
  compareTypeGroups,
  defaultTypeGroupRank,
  GOOD_BRIGADE_ORDER,
  EVIL_BRIGADE_ORDER,
  BIBLE_BOOK_ORDER,
  type SortableCard,
} from "../defaultSort";

const card = (partial: Partial<SortableCard> & { name: string; type: string }): SortableCard => ({
  brigade: "",
  alignment: "",
  strength: "",
  reference: "",
  ...partial,
});

const sortNames = (cards: SortableCard[]): string[] =>
  [...cards].sort(compareCardsDefault).map((c) => c.name);

describe("section ordering", () => {
  it("orders all sections: dominants, artifacts, covenants, curses, fortresses, sites, lost souls, duals, good, evil, misc", () => {
    const cards = [
      card({ name: "Token", type: "Hero Token" }),
      card({ name: "EvilChar", type: "Evil Character", brigade: "Brown", alignment: "Evil" }),
      card({ name: "GoodEnh", type: "GE", brigade: "Blue", alignment: "Good" }),
      card({ name: "Dual", type: "GE/EE", brigade: "Gold (Gold/Gold)" }),
      card({ name: "Soul", type: "Lost Soul", reference: "Genesis 1:1" }),
      card({ name: "Site", type: "Site", brigade: "Black" }),
      card({ name: "Fort", type: "Fortress" }),
      card({ name: "Curse", type: "Curse" }),
      card({ name: "Cov", type: "Covenant" }),
      card({ name: "Art", type: "Artifact" }),
      card({ name: "Dom", type: "Dominant", alignment: "Good" }),
    ];
    expect(sortNames(cards)).toEqual([
      "Dom", "Art", "Cov", "Curse", "Fort", "Site", "Soul", "Dual", "GoodEnh", "EvilChar", "Token",
    ]);
  });

  it("first type part decides the section for mixed non-dual types", () => {
    const cards = [
      card({ name: "FortEC", type: "Fortress / Evil Character", brigade: "Black", alignment: "Evil" }),
      card({ name: "ECFort", type: "Evil Character/Fortress", brigade: "Black", alignment: "Evil" }),
    ];
    // "Fortress / Evil Character" → Fortress section (4), before evil section (9)
    expect(sortNames(cards)).toEqual(["FortEC", "ECFort"]);
  });
});

describe("dominants", () => {
  it("sorts dual/neutral first, then good, then evil, alpha within each", () => {
    const cards = [
      card({ name: "Death", type: "Dominant", alignment: "Evil" }),
      card({ name: "Burial", type: "Dominant", alignment: "Evil" }),
      card({ name: "Son of God", type: "Dominant", alignment: "Good" }),
      card({ name: "Angel of the Lord", type: "Dominant", alignment: "Good" }),
      card({ name: "Falling Away", type: "Dominant", alignment: "Neutral" }),
      card({ name: "Ashes", type: "Dominant", alignment: "Neutral" }),
    ];
    expect(sortNames(cards)).toEqual([
      "Ashes", "Falling Away", "Angel of the Lord", "Son of God", "Burial", "Death",
    ]);
  });
});

describe("artifacts / covenants / curses / fortresses", () => {
  it("sorts artifacts, covenants, curses alphabetically within their sections", () => {
    const cards = [
      card({ name: "Zeal Cov", type: "Covenant" }),
      card({ name: "Ark Cov", type: "Covenant" }),
      card({ name: "Zeal Art", type: "Artifact" }),
      card({ name: "Ark Art", type: "Artifact" }),
      card({ name: "Zeal Curse", type: "Curse" }),
      card({ name: "Ark Curse", type: "Curse" }),
    ];
    expect(sortNames(cards)).toEqual([
      "Ark Art", "Zeal Art", "Ark Cov", "Zeal Cov", "Ark Curse", "Zeal Curse",
    ]);
  });

  it("interleaves Cities with Fortresses alphabetically, Sites after", () => {
    const cards = [
      card({ name: "Aeneas Site", type: "Site" }),
      card({ name: "Babylon", type: "City" }),
      card({ name: "Ark Fortress", type: "Fortress" }),
      card({ name: "City of Enoch", type: "City" }),
      card({ name: "Zion Fortress", type: "Fortress" }),
    ];
    expect(sortNames(cards)).toEqual([
      "Ark Fortress", "Babylon", "City of Enoch", "Zion Fortress", "Aeneas Site",
    ]);
  });
});

describe("lost souls — biblical reference order", () => {
  it("orders by book, then chapter, then verse", () => {
    const cards = [
      card({ name: "E", type: "Lost Soul", reference: "Revelation 22:21" }),
      card({ name: "D", type: "Lost Soul", reference: "Romans 3:23" }),
      card({ name: "C", type: "Lost Soul", reference: "Matthew 5:5" }),
      card({ name: "B", type: "Lost Soul", reference: "Ezekiel 34:16" }),
      card({ name: "A", type: "Lost Soul", reference: "Genesis 3:19" }),
      card({ name: "A2", type: "Lost Soul", reference: "Genesis 12:3" }),
      card({ name: "A0", type: "Lost Soul", reference: "Genesis 3:6" }),
    ];
    expect(sortNames(cards)).toEqual(["A0", "A", "A2", "B", "C", "D", "E"]);
  });

  it("handles the roman-numeral prefix gotchas: II Kings vs I Kings, John vs I/II/III John", () => {
    const cards = [
      card({ name: "3John", type: "Lost Soul", reference: "III John 1:2" }),
      card({ name: "1John", type: "Lost Soul", reference: "I John 4:8" }),
      card({ name: "John", type: "Lost Soul", reference: "John 3:16" }),
      card({ name: "2Kings", type: "Lost Soul", reference: "II Kings 4:8-37" }),
      card({ name: "1Kings", type: "Lost Soul", reference: "I Kings 17:9" }),
      card({ name: "2John", type: "Lost Soul", reference: "II John 1:1" }),
    ];
    // I Kings < II Kings < John (gospel) < I John < II John < III John
    expect(sortNames(cards)).toEqual(["1Kings", "2Kings", "John", "1John", "2John", "3John"]);
  });

  it("accepts singular Psalm as Psalms and puts unknown/empty references last", () => {
    const cards = [
      card({ name: "NoRef", type: "Lost Soul", reference: "" }),
      card({ name: "Odd", type: "Lost Soul", reference: "Apocrypha 1:1" }),
      card({ name: "Psalm", type: "Lost Soul", reference: "Psalm 22:26" }),
      card({ name: "Job", type: "Lost Soul", reference: "Job 30:25" }),
      card({ name: "Prov", type: "Lost Soul", reference: "Proverbs 16:19" }),
    ];
    expect(sortNames(cards)).toEqual(["Job", "Psalm", "Prov", "NoRef", "Odd"]);
  });

  it("book list is the full 66-book canon in order", () => {
    expect(BIBLE_BOOK_ORDER.length).toBe(66);
    expect(BIBLE_BOOK_ORDER[0]).toBe("Genesis");
    expect(BIBLE_BOOK_ORDER[39]).toBe("Matthew");
    expect(BIBLE_BOOK_ORDER[65]).toBe("Revelation");
  });
});

describe("dual characters and enhancements", () => {
  it("puts type-spanning duals (GE/EE, Hero/Evil Character) in the dual section, alpha by name", () => {
    const cards = [
      card({ name: "Blue Hero", type: "Hero", brigade: "Blue", alignment: "Good", strength: "9" }),
      card({ name: "Zeta Dual", type: "Hero/Evil Character", brigade: "Gold (Good Gold/Evil Gold)" }),
      card({ name: "Alpha Dual", type: "GE/EE", brigade: "Green/White and Brown/Crimson" }),
      card({ name: "Soul", type: "Lost Soul", reference: "Acts 2:21" }),
    ];
    expect(sortNames(cards)).toEqual(["Soul", "Alpha Dual", "Zeta Dual", "Blue Hero"]);
  });

  it("treats a single-type enhancement with brigades spanning both alignments as dual", () => {
    const cards = [
      card({ name: "Spanning", type: "GE", brigade: "Green/White and Brown/Crimson" }),
      card({ name: "Plain", type: "GE", brigade: "Green", alignment: "Good" }),
    ];
    expect(sortNames(cards)).toEqual(["Spanning", "Plain"]);
  });
});

describe("good and evil brigade sections", () => {
  it("orders good brigades Blue → Clay → Gold → Green → Multi → Purple → Red → Silver → Teal → White", () => {
    const brigades = ["White", "Teal", "Silver", "Red", "Purple", "Multi", "Green", "Gold", "Clay", "Blue"];
    const cards = brigades.map((b) =>
      card({ name: `${b} Hero`, type: "Hero", brigade: b, alignment: "Good", strength: "5" })
    );
    expect(sortNames(cards)).toEqual([
      "Blue Hero", "Clay Hero", "Gold Hero", "Green Hero", "Multi Hero",
      "Purple Hero", "Red Hero", "Silver Hero", "Teal Hero", "White Hero",
    ]);
    expect([...GOOD_BRIGADE_ORDER]).toEqual([
      "Blue", "Clay", "Gold", "Green", "Multi", "Purple", "Red", "Silver", "Teal", "White",
    ]);
  });

  it("orders evil brigades Black → Brown → Crimson → Gold → Gray → Multi → Orange → Pale Green", () => {
    const brigades = ["Pale Green", "Orange", "Multi", "Gray", "Gold", "Crimson", "Brown", "Black"];
    const cards = brigades.map((b) =>
      card({ name: `${b} EC`, type: "Evil Character", brigade: b, alignment: "Evil", strength: "5" })
    );
    expect(sortNames(cards)).toEqual([
      "Black EC", "Brown EC", "Crimson EC", "Gold EC", "Gray EC", "Multi EC", "Orange EC", "Pale Green EC",
    ]);
    expect([...EVIL_BRIGADE_ORDER]).toEqual([
      "Black", "Brown", "Crimson", "Gold", "Gray", "Multi", "Orange", "Pale Green",
    ]);
  });

  it("within a brigade: characters (strength desc) before enhancements (strength desc)", () => {
    const cards = [
      card({ name: "Enh Weak", type: "GE", brigade: "Green", alignment: "Good", strength: "1" }),
      card({ name: "Enh Strong", type: "GE", brigade: "Green", alignment: "Good", strength: "4" }),
      card({ name: "Hero Weak", type: "Hero", brigade: "Green", alignment: "Good", strength: "3" }),
      card({ name: "Hero Strong", type: "Hero", brigade: "Green", alignment: "Good", strength: "10" }),
    ];
    expect(sortNames(cards)).toEqual(["Hero Strong", "Hero Weak", "Enh Strong", "Enh Weak"]);
  });

  it('sorts "X" / "*" / empty strength after numbered strength, alpha among themselves', () => {
    const cards = [
      card({ name: "Zed X", type: "Hero", brigade: "Red", alignment: "Good", strength: "X" }),
      card({ name: "Alf Star", type: "Hero", brigade: "Red", alignment: "Good", strength: "*" }),
      card({ name: "Empty", type: "Hero", brigade: "Red", alignment: "Good", strength: "" }),
      card({ name: "Neg", type: "Hero", brigade: "Red", alignment: "Good", strength: "-1" }),
      card({ name: "Paired", type: "Hero", brigade: "Red", alignment: "Good", strength: "4 (0)" }),
    ];
    expect(sortNames(cards)).toEqual(["Paired", "Neg", "Alf Star", "Empty", "Zed X"]);
  });

  it("parses primary brigade from parenthesized and multi forms", () => {
    const cards = [
      card({ name: "GreenTeal", type: "Hero", brigade: "Green/Teal", alignment: "Good", strength: "5" }),
      card({ name: "GoldParen", type: "Hero", brigade: "Gold (Gold/Red)", alignment: "Good", strength: "5" }),
      card({ name: "BlueFirst", type: "Hero", brigade: "Blue/Green (Multi)", alignment: "Good", strength: "5" }),
    ];
    // Primary brigades: Blue, Gold, Green
    expect(sortNames(cards)).toEqual(["BlueFirst", "GoldParen", "GreenTeal"]);
  });

  it("disambiguates Gold by alignment: good Gold with good brigades, evil Gold with evil brigades", () => {
    const cards = [
      card({ name: "Evil Gray", type: "Evil Character", brigade: "Gray", alignment: "Evil", strength: "5" }),
      card({ name: "Evil Gold", type: "Evil Character", brigade: "Gold", alignment: "Evil", strength: "5" }),
      card({ name: "Evil Crimson", type: "Evil Character", brigade: "Crimson", alignment: "Evil", strength: "5" }),
      card({ name: "Good Green", type: "Hero", brigade: "Green", alignment: "Good", strength: "5" }),
      card({ name: "Good Gold", type: "Hero", brigade: "Gold", alignment: "Good", strength: "5" }),
      card({ name: "Good Clay", type: "Hero", brigade: "Clay", alignment: "Good", strength: "5" }),
    ];
    // Good section: Clay < Gold < Green; evil section: Crimson < Gold < Gray
    expect(sortNames(cards)).toEqual([
      "Good Clay", "Good Gold", "Good Green", "Evil Crimson", "Evil Gold", "Evil Gray",
    ]);
  });

  it("sorts unknown/empty brigades after all known brigades of the alignment", () => {
    const cards = [
      card({ name: "NoBrigade", type: "Hero", brigade: "", alignment: "Good", strength: "5" }),
      card({ name: "White Hero", type: "Hero", brigade: "White", alignment: "Good", strength: "5" }),
    ];
    expect(sortNames(cards)).toEqual(["White Hero", "NoBrigade"]);
  });
});

describe("degraded input (name + type only)", () => {
  it("still yields section order then alphabetical", () => {
    const cards = [
      { name: "Zeal", type: "GE" },
      { name: "Axe", type: "EE" },
      { name: "Guard", type: "Hero" },
      { name: "Demon", type: "Evil Character" },
      { name: "Ark", type: "Artifact" },
      { name: "Soul", type: "Lost Soul" },
    ];
    expect(sortNames(cards)).toEqual(["Ark", "Soul", "Guard", "Zeal", "Demon", "Axe"]);
  });

  it("handles forge-style compact type/brigade names", () => {
    const cards = [
      card({ name: "PG", type: "EvilCharacter", brigade: "PaleGreen", strength: "5" }),
      card({ name: "Blk", type: "EvilCharacter", brigade: "Black", strength: "5" }),
      card({ name: "LS", type: "LostSoul", reference: "John 3:16" }),
      card({ name: "GG", type: "Hero", brigade: "GoodGold", strength: "5" }),
    ];
    expect(sortNames(cards)).toEqual(["LS", "GG", "Blk", "PG"]);
  });
});

describe("grouped views — bucket ordering", () => {
  it("ranks buckets Dominants, Artifacts, Fortresses, Lost Souls, Dual, Heroes, GE, EC, EE, misc", () => {
    const buckets = [
      "Evil Enhancement", "Evil Character", "Good Enhancement", "Hero",
      "Dual-Type", "Lost Soul", "Fortress/Site", "Artifact/Covenant/Curse",
      "Dominant", "Hero Token", "Forge Card",
    ];
    const sorted = [...buckets].sort(compareTypeGroups);
    expect(sorted).toEqual([
      "Dominant", "Artifact/Covenant/Curse", "Fortress/Site", "Lost Soul",
      "Dual-Type", "Hero", "Good Enhancement", "Evil Character", "Evil Enhancement",
      "Forge Card", "Hero Token",
    ]);
  });

  it("ranks raw deck-builder type keys, including raw dual types", () => {
    const buckets = ["GE/EE", "Site", "GE", "Curse", "Covenant", "Artifact", "Hero", "Lost Soul", "City", "Fortress"];
    const sorted = [...buckets].sort(compareTypeGroups);
    expect(sorted).toEqual([
      "Artifact", "Covenant", "Curse", "City", "Fortress", "Site", "Lost Soul", "GE/EE", "Hero", "GE",
    ]);
    expect(defaultTypeGroupRank("GE/EE")).toBe(4);
    expect(defaultTypeGroupRank("Hero/Evil Character")).toBe(4);
  });

  it("keeps token buckets in the trailing misc rank", () => {
    expect(defaultTypeGroupRank("Lost Soul Token")).toBe(9);
    expect(defaultTypeGroupRank("Hero Token")).toBe(9);
    expect(defaultTypeGroupRank("Lost Soul")).toBe(3);
  });
});
