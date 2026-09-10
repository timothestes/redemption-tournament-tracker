import { describe, it, expect } from "vitest";
import {
  compareCardsDefault,
  compareCardsEndOfTimes,
  compareCardsByType,
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
  it("orders all sections: dominants, artifacts, covenants, curses, cities, fortresses, sites, lost souls, duals, good, evil, misc", () => {
    const cards = [
      card({ name: "Token", type: "Hero Token" }),
      card({ name: "EvilChar", type: "Evil Character", brigade: "Brown", alignment: "Evil" }),
      card({ name: "GoodEnh", type: "GE", brigade: "Blue", alignment: "Good" }),
      card({ name: "Dual", type: "GE/EE", brigade: "Gold (Gold/Gold)" }),
      card({ name: "Soul", type: "Lost Soul", reference: "Genesis 1:1" }),
      card({ name: "Site", type: "Site", brigade: "Black" }),
      card({ name: "Fort", type: "Fortress" }),
      card({ name: "City", type: "City", brigade: "Blue" }),
      card({ name: "Curse", type: "Curse" }),
      card({ name: "Cov", type: "Covenant" }),
      card({ name: "Art", type: "Artifact" }),
      card({ name: "Dom", type: "Dominant", alignment: "Good" }),
    ];
    expect(sortNames(cards)).toEqual([
      "Dom", "Art", "Cov", "Curse", "City", "Fort", "Site", "Soul", "Dual", "GoodEnh", "EvilChar", "Token",
    ]);
  });

  it("first type part decides the section for mixed non-dual types", () => {
    const cards = [
      card({ name: "FortEC", type: "Fortress / Evil Character", brigade: "Black", alignment: "Evil" }),
      card({ name: "ECFort", type: "Evil Character/Fortress", brigade: "Black", alignment: "Evil" }),
    ];
    // "Fortress / Evil Character" → Fortress section (5), before evil section (10)
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

  it("puts Cities in their own section before Fortresses, Sites after", () => {
    const cards = [
      card({ name: "Aeneas Site", type: "Site" }),
      card({ name: "Babylon", type: "City", brigade: "Red" }),
      card({ name: "Ark Fortress", type: "Fortress" }),
      card({ name: "City of Enoch", type: "City", brigade: "Blue" }),
      card({ name: "Zion Fortress", type: "Fortress" }),
    ];
    expect(sortNames(cards)).toEqual([
      "City of Enoch", "Babylon", "Ark Fortress", "Zion Fortress", "Aeneas Site",
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
  it("puts type-spanning duals (GE/EE, Hero/Evil Character) in the dual section, characters first", () => {
    const cards = [
      card({ name: "Blue Hero", type: "Hero", brigade: "Blue", alignment: "Good", strength: "9" }),
      card({ name: "Zeta Dual", type: "Hero/Evil Character", brigade: "Gold (Good Gold/Evil Gold)" }),
      card({ name: "Alpha Dual", type: "GE/EE", brigade: "Green/White and Brown/Crimson" }),
      card({ name: "Soul", type: "Lost Soul", reference: "Acts 2:21" }),
    ];
    expect(sortNames(cards)).toEqual(["Soul", "Zeta Dual", "Alpha Dual", "Blue Hero"]);
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
  it("orders good brigades Multi → Blue → Clay → Gold → Green → Purple → Red → Silver → Teal → White", () => {
    const brigades = ["White", "Teal", "Silver", "Red", "Purple", "Multi", "Green", "Gold", "Clay", "Blue"];
    const cards = brigades.map((b) =>
      card({ name: `${b} Hero`, type: "Hero", brigade: b, alignment: "Good", strength: "5" })
    );
    expect(sortNames(cards)).toEqual([
      "Multi Hero", "Blue Hero", "Clay Hero", "Gold Hero", "Green Hero",
      "Purple Hero", "Red Hero", "Silver Hero", "Teal Hero", "White Hero",
    ]);
    expect([...GOOD_BRIGADE_ORDER]).toEqual([
      "Multi", "Blue", "Clay", "Gold", "Green", "Purple", "Red", "Silver", "Teal", "White",
    ]);
  });

  it("orders evil brigades Multi → Black → Brown → Crimson → Gold → Gray → Orange → Pale Green", () => {
    const brigades = ["Pale Green", "Orange", "Multi", "Gray", "Gold", "Crimson", "Brown", "Black"];
    const cards = brigades.map((b) =>
      card({ name: `${b} EC`, type: "Evil Character", brigade: b, alignment: "Evil", strength: "5" })
    );
    expect(sortNames(cards)).toEqual([
      "Multi EC", "Black EC", "Brown EC", "Crimson EC", "Gold EC", "Gray EC", "Orange EC", "Pale Green EC",
    ]);
    expect([...EVIL_BRIGADE_ORDER]).toEqual([
      "Multi", "Black", "Brown", "Crimson", "Gold", "Gray", "Orange", "Pale Green",
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

  it("reads brigades outside parentheses: two bare tokens are multi, a paren-only alternate is not", () => {
    const cards = [
      card({ name: "GreenTeal", type: "Hero", brigade: "Green/Teal", alignment: "Good", strength: "5" }),
      card({ name: "GoldParen", type: "Hero", brigade: "Gold (Gold/Red)", alignment: "Good", strength: "5" }),
      card({ name: "BlueFirst", type: "Hero", brigade: "Blue/Green (Multi)", alignment: "Good", strength: "5" }),
    ];
    // Green/Teal and Blue/Green are multi (alpha among themselves); "Gold (Gold/Red)"
    // is a single Gold brigade — the LoC back-side note in parens doesn't count.
    expect(sortNames(cards)).toEqual(["BlueFirst", "GreenTeal", "GoldParen"]);
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

describe("alphabetization ignores a leading \"The \"", () => {
  it("sorts a leading article as if absent (Times to Come artifact order)", () => {
    // Real print order: Abomination of Desolation, The Book of Knowledge,
    // Darius' Decree, Idol of Nebuchadnezzar — only possible if "The Book
    // of Knowledge" alphabetizes as "Book of Knowledge".
    const cards = [
      card({ name: "Idol of Nebuchadnezzar", type: "Artifact" }),
      card({ name: "Darius' Decree", type: "Artifact" }),
      card({ name: "The Book of Knowledge", type: "Artifact" }),
      card({ name: "Abomination of Desolation", type: "Artifact" }),
    ];
    expect(sortNames(cards)).toEqual([
      "Abomination of Desolation", "The Book of Knowledge", "Darius' Decree", "Idol of Nebuchadnezzar",
    ]);
  });

  it("sorts two \"The\"-prefixed names by their word after the article (Times to Come fortresses)", () => {
    // Real print order: Babylon, Kingdom of the Divine, The Realm of
    // Greece, The Restored Land — "Realm" < "Restored" once "The" drops.
    const cards = [
      card({ name: "The Restored Land", type: "Fortress" }),
      card({ name: "The Realm of Greece", type: "Fortress" }),
      card({ name: "Kingdom of the Divine", type: "Fortress" }),
      card({ name: "Babylon", type: "Fortress" }),
    ];
    expect(sortNames(cards)).toEqual([
      "Babylon", "Kingdom of the Divine", "The Realm of Greece", "The Restored Land",
    ]);
  });

  it("is case-insensitive and only strips the article, not names that merely start with those letters", () => {
    const cards = [
      card({ name: "Theodore's Ledger", type: "Artifact" }),
      card({ name: "the gods of Egypt", type: "Artifact" }),
      card({ name: "Israel's Rebellion", type: "Artifact" }),
    ];
    // "the gods of Egypt" -> alphabetizes as "gods of Egypt" (g), before
    // "Israel's Rebellion" (i); "Theodore's Ledger" keeps its leading "The"
    // since it isn't followed by a word boundary + space forming the article,
    // so it alphabetizes under "t", after both.
    expect(sortNames(cards)).toEqual(["the gods of Egypt", "Israel's Rebellion", "Theodore's Ledger"]);
  });

  it("matches the real Israel's Rebellion dominant order (Neutral, Good, then Evil alpha with the article dropped)", () => {
    const cards = [
      card({ name: "Israel's Rebellion", type: "Dominant", alignment: "Evil" }),
      card({ name: "the gods of Egypt", type: "Dominant", alignment: "Evil" }),
      card({ name: "Out of Their Hands", type: "Dominant", alignment: "Good" }),
      card({ name: "Forty Years", type: "Dominant", alignment: "Neutral" }),
    ];
    expect(sortNames(cards)).toEqual([
      "Forty Years", "Out of Their Hands", "the gods of Egypt", "Israel's Rebellion",
    ]);
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

describe("compareCardsByType", () => {
  const sortByType = (cards: SortableCard[]): string[] =>
    [...cards].sort(compareCardsByType).map((c) => c.name);

  it("sorts by raw type alphabetically first", () => {
    const cards = [
      card({ name: "Soul", type: "Lost Soul" }),
      card({ name: "HeroA", type: "Hero", brigade: "Blue", alignment: "Good" }),
      card({ name: "EnhA", type: "GE", brigade: "Blue", alignment: "Good" }),
      card({ name: "Dom", type: "Dominant", alignment: "Good" }),
      card({ name: "Art", type: "Artifact" }),
    ];
    // Artifact < Dominant < GE < Hero < Lost Soul
    expect(sortByType(cards)).toEqual(["Art", "Dom", "EnhA", "HeroA", "Soul"]);
  });

  it("breaks type ties by alignment Good > Evil > Neutral", () => {
    const cards = [
      card({ name: "Neutral", type: "Dominant", alignment: "Neutral" }),
      card({ name: "Evil", type: "Dominant", alignment: "Evil" }),
      card({ name: "Good", type: "Dominant", alignment: "Good" }),
      card({ name: "Blank", type: "Dominant" }),
    ];
    // Missing alignment ranks with Neutral; "Blank" < "Neutral" by name
    expect(sortByType(cards)).toEqual(["Good", "Evil", "Blank", "Neutral"]);
  });

  it("breaks alignment ties by brigade, then name case-insensitively", () => {
    const cards = [
      card({ name: "RedHero", type: "Hero", brigade: "Red", alignment: "Good" }),
      card({ name: "blueB", type: "Hero", brigade: "Blue", alignment: "Good" }),
      card({ name: "BlueA", type: "Hero", brigade: "Blue", alignment: "Good" }),
    ];
    expect(sortByType(cards)).toEqual(["BlueA", "blueB", "RedHero"]);
  });

  it("orders name-only sortables alphabetically within a type", () => {
    const cards = [
      card({ name: "Zeta", type: "" }),
      card({ name: "Alpha", type: "" }),
    ];
    expect(sortByType(cards)).toEqual(["Alpha", "Zeta"]);
  });
});

describe("designers' print order (issue #383)", () => {
  it("multi-brigade heroes and enhancements lead the Good section, characters then enhancements by strength (Times to Come)", () => {
    const cards = [
      card({ name: "Daniel, the Treasured", type: "Hero", brigade: "White", alignment: "Good", strength: "12" }),
      card({ name: "Gabriel, Sent by God", type: "Hero", brigade: "Silver", alignment: "Good", strength: "10" }),
      card({ name: "Pride Laid Low", type: "GE", brigade: "Green", alignment: "Good", strength: "7" }),
      card({ name: "Amos of Tekoa", type: "Hero", brigade: "Green", alignment: "Good", strength: "9" }),
      card({ name: "Shattered and Scorched", type: "GE", brigade: "Silver/White", alignment: "Good", strength: "5" }),
      card({ name: "Michael, the Guardian", type: "Hero", brigade: "Silver/White", alignment: "Good", strength: "12" }),
    ];
    expect(sortNames(cards)).toEqual([
      "Michael, the Guardian", "Shattered and Scorched",
      "Amos of Tekoa", "Pride Laid Low",
      "Gabriel, Sent by God", "Daniel, the Treasured",
    ]);
  });

  it("The Days of Noah (Purple/Blue) leads End of Times' Good section ahead of every single brigade", () => {
    const cards = [
      card({ name: "Beware of Abominations", type: "GE", brigade: "Purple", alignment: "Good", strength: "5" }),
      card({ name: "Peter, Son of Jonah", type: "Hero", brigade: "Purple", alignment: "Good", strength: "4" }),
      card({ name: "Paul, Church Planter", type: "Hero", brigade: "Clay", alignment: "Good", strength: "11" }),
      card({ name: "Asher, the Rich", type: "Hero", brigade: "Blue", alignment: "Good", strength: "5" }),
      card({ name: "The Days of Noah", type: "GE", brigade: "Purple/Blue", alignment: "Good", strength: "4" }),
    ];
    expect(sortNames(cards)).toEqual([
      "The Days of Noah", "Asher, the Rich", "Paul, Church Planter", "Peter, Son of Jonah", "Beware of Abominations",
    ]);
  });

  it("multi evil characters form one group by strength regardless of brigade mix (Times to Come), then single brigades", () => {
    const cards = [
      card({ name: "Cyrus, the Great", type: "Evil Character", brigade: "Brown", alignment: "Evil", strength: "11" }),
      card({ name: "Greek Forces", type: "Evil Character", brigade: "Black", alignment: "Evil", strength: "12" }),
      card({ name: "Chaldeans", type: "Evil Character", brigade: "Crimson/Pale Green", alignment: "Evil", strength: "2" }),
      card({ name: "The Ram with Two Horns", type: "Evil Character", brigade: "Brown/Orange", alignment: "Evil", strength: "5" }),
      card({ name: "The Prince of Persia", type: "Evil Character", brigade: "Brown/Orange", alignment: "Evil", strength: "7" }),
      card({ name: "The Prince of Greece", type: "Evil Character", brigade: "Black/Orange", alignment: "Evil", strength: "8" }),
      card({ name: "The Goat with a Horn", type: "Evil Character", brigade: "Black/Orange", alignment: "Evil", strength: "11" }),
    ];
    expect(sortNames(cards)).toEqual([
      "The Goat with a Horn", "The Prince of Greece", "The Prince of Persia", "The Ram with Two Horns", "Chaldeans",
      "Greek Forces", "Cyrus, the Great",
    ]);
  });

  it("End of Times' multi evil cards lead the Evil section (forge-style compact names)", () => {
    const cards = [
      card({ name: "Conquer, the White Rider", type: "EvilCharacter", brigade: "PaleGreen", alignment: "Evil", strength: "10" }),
      card({ name: "Crushing Carnivores", type: "EvilCharacter", brigade: "Crimson", alignment: "Evil", strength: "9" }),
      card({ name: "Out of the Mouths", type: "EE", brigade: "Crimson/Orange/PaleGreen", alignment: "Evil", strength: "3" }),
      card({ name: "The False Prophet", type: "EvilCharacter", brigade: "PaleGreen/Crimson", alignment: "Evil", strength: "2" }),
    ];
    expect(sortNames(cards)).toEqual([
      "The False Prophet", "Out of the Mouths", "Crushing Carnivores", "Conquer, the White Rider",
    ]);
  });

  it("a literal Multi token counts as multi, even alongside a named brigade", () => {
    const cards = [
      card({ name: "Blue Hero", type: "Hero", brigade: "Blue", alignment: "Good", strength: "12" }),
      card({ name: "Multi Enh", type: "GE", brigade: "Multi", alignment: "Good", strength: "3" }),
      card({ name: "Black EC", type: "Evil Character", brigade: "Black", alignment: "Evil", strength: "12" }),
      card({ name: "Gray Multi EC", type: "Evil Character", brigade: "Gray/Multi", alignment: "Evil", strength: "5" }),
    ];
    expect(sortNames(cards)).toEqual(["Multi Enh", "Blue Hero", "Gray Multi EC", "Black EC"]);
  });

  it("only recognized brigade tokens count toward multi; a dirty extra token does not", () => {
    const cards = [
      card({ name: "Blue Hero", type: "Hero", brigade: "Blue", alignment: "Good", strength: "5" }),
      card({ name: "Dirty White", type: "Hero", brigade: "Good/White", alignment: "Good", strength: "5" }),
    ];
    // "Good/White" carries one real brigade (White) → single, after Blue.
    expect(sortNames(cards)).toEqual(["Blue Hero", "Dirty White"]);
  });

  it("covenants group by brigade (multi first), then strength descending, then name", () => {
    // End of Times covenants.
    const eot = [
      card({ name: "No More Pain", type: "Covenant", brigade: "White", alignment: "Good", strength: "4" }),
      card({ name: "Saved by Faith", type: "Covenant", brigade: "Clay", alignment: "Good", strength: "5" }),
      card({ name: "Tree of Life", type: "Covenant", brigade: "Blue/Silver", alignment: "Good", strength: "4" }),
      card({ name: "Covenant of Prayer", type: "Covenant", brigade: "Silver/White", alignment: "Good", strength: "3" }),
    ];
    expect(sortNames(eot)).toEqual(["Tree of Life", "Covenant of Prayer", "Saved by Faith", "No More Pain"]);
    // Times to Come print order runs Green → Silver → White: brigade beats strength.
    const t2c = [
      card({ name: "Seventy Weeks", type: "Covenant", brigade: "White", alignment: "Good", strength: "7" }),
      card({ name: "God's Judgment", type: "Covenant", brigade: "Silver", alignment: "Good", strength: "2" }),
      card({ name: "Covenant of Time", type: "Covenant", brigade: "Green", alignment: "Good", strength: "5" }),
    ];
    expect(sortNames(t2c)).toEqual(["Covenant of Time", "God's Judgment", "Seventy Weeks"]);
    // Same brigade: strength beats name.
    const blue = [
      card({ name: "Covenant of Noah", type: "Covenant", brigade: "Blue", alignment: "Good", strength: "2" }),
      card({ name: "I am Holy", type: "Covenant", brigade: "Blue", alignment: "Good", strength: "5" }),
    ];
    expect(sortNames(blue)).toEqual(["I am Holy", "Covenant of Noah"]);
  });

  it("curses group the same way (End of Times)", () => {
    const cards = [
      card({ name: "Prohibit Progress", type: "Curse", brigade: "PaleGreen", alignment: "Evil", strength: "0" }),
      card({ name: "Sinful Semiosis", type: "Curse", brigade: "PaleGreen", alignment: "Evil", strength: "5" }),
      card({ name: "From the Abyss", type: "Curse", brigade: "Orange", alignment: "Evil", strength: "1" }),
      card({ name: "Evil Authority", type: "Curse", brigade: "Orange", alignment: "Evil", strength: "4" }),
      card({ name: "Killed by Animals", type: "Curse", brigade: "Crimson", alignment: "Evil", strength: "5" }),
      card({ name: "Last Curse", type: "Curse", brigade: "Orange/PaleGreen", alignment: "Evil", strength: "3" }),
    ];
    expect(sortNames(cards)).toEqual([
      "Last Curse", "Killed by Animals", "Evil Authority", "From the Abyss", "Sinful Semiosis", "Prohibit Progress",
    ]);
  });

  it("cities sit between curses and fortresses, grouped by brigade (multi first) then name", () => {
    const cards = [
      card({ name: "Ark Fortress", type: "Fortress" }),
      card({ name: "Hebron", type: "City", brigade: "Red", alignment: "Good" }),
      card({ name: "Ashkelon", type: "City", brigade: "Gold", alignment: "Evil" }),
      card({ name: "City of Enoch", type: "City", brigade: "Blue", alignment: "Evil" }),
      card({ name: "Babel", type: "City", brigade: "Blue", alignment: "Evil" }),
      card({ name: "Bethlehem", type: "City", brigade: "Gold/White", alignment: "Good" }),
      card({ name: "Zeal Curse", type: "Curse", brigade: "Black", strength: "1" }),
    ];
    expect(sortNames(cards)).toEqual([
      "Zeal Curse", "Bethlehem", "Babel", "City of Enoch", "Ashkelon", "Hebron", "Ark Fortress",
    ]);
  });

  it("sites group by brigade (multi first) then name", () => {
    const cards = [
      card({ name: "Caesarea Philippi", type: "Site", brigade: "Red" }),
      card({ name: "Ashdod", type: "Site", brigade: "Red" }),
      card({ name: "Assyria", type: "Site", brigade: "Purple" }),
      card({ name: "Babylonian Banquet Hall", type: "Site", brigade: "Green" }),
      card({ name: "New Jerusalem", type: "Site", brigade: "Multi" }),
      card({ name: "Babylon The Harlot", type: "Site", brigade: "Silver/Red/Crimson/Orange" }),
    ];
    expect(sortNames(cards)).toEqual([
      "Babylon The Harlot", "New Jerusalem", "Babylonian Banquet Hall", "Assyria", "Ashdod", "Caesarea Philippi",
    ]);
  });

  it("breaks same-strength ties by toughness descending, as the printed sets do", () => {
    // Times to Come print order: Patrollers of the Earth 9/6 before The
    // Interceder 9/3; Persian Presidents 6/7 before The Depraved [Brown] 6/5;
    // Told to Take 3/3 before Axe 3/2 — alphabetical would flip all three.
    const cards = [
      card({ name: "The Interceder", type: "Hero", brigade: "Silver", alignment: "Good", strength: "9", toughness: "3" }),
      card({ name: "Patrollers of the Earth", type: "Hero", brigade: "Silver", alignment: "Good", strength: "9", toughness: "6" }),
      card({ name: "The Depraved [Brown]", type: "Evil Character", brigade: "Brown", alignment: "Evil", strength: "6", toughness: "5" }),
      card({ name: "Persian Presidents", type: "Evil Character", brigade: "Brown", alignment: "Evil", strength: "6", toughness: "7" }),
      card({ name: "Axe", type: "EE", brigade: "Crimson", alignment: "Evil", strength: "3", toughness: "2" }),
      card({ name: "Told to Take", type: "EE", brigade: "Crimson", alignment: "Evil", strength: "3", toughness: "3" }),
    ];
    expect(sortNames(cards)).toEqual([
      "Patrollers of the Earth", "The Interceder",
      "Persian Presidents", "The Depraved [Brown]",
      "Told to Take", "Axe",
    ]);
  });

  it("dual section: characters, then character/enhancement dual-types, then enhancements, each by strength", () => {
    const cards = [
      card({ name: "Inherit Canaan", type: "GE/EE", brigade: "Green (Black)", strength: "2 (4)" }),
      card({ name: "War in Heaven", type: "GE/EE", brigade: "Silver/Orange", alignment: "Good_Evil", strength: "5" }),
      card({ name: "Quake in Edom", type: "GE/EE", brigade: "Green (Crimson)", strength: "6 (0)" }),
      card({ name: "Goats & Sheep", type: "GE/EvilCharacter", brigade: "Purple/Crimson", alignment: "Good_Evil", strength: "" }),
      card({ name: "Blood Avenger", type: "Hero/Evil Character", brigade: "White/Brown", strength: "3 (2)" }),
      card({ name: "Joab, the General", type: "Hero/Evil Character", brigade: "Purple (Brown)", strength: "12 (6)" }),
    ];
    expect(sortNames(cards)).toEqual([
      "Joab, the General", "Blood Avenger", "Goats & Sheep", "Quake in Edom", "War in Heaven", "Inherit Canaan",
    ]);
  });
});

describe("compareCardsEndOfTimes — End of Times' one-off rules", () => {
  const sortNamesEot = (cards: SortableCard[]): string[] =>
    [...cards].sort(compareCardsEndOfTimes).map((c) => c.name);

  it("counts a leading 'The' as a real word instead of ignoring it", () => {
    // Real EoT print order (6-10): "The"-titled cards sort after "Letters"
    // and "Stumbling", unlike compareCardsDefault's ignore-"The" rule.
    const cards = [
      card({ name: "The Book of Life", type: "Artifact" }),
      card({ name: "Stumbling Block", type: "Artifact" }),
      card({ name: "Letters to Thessalonica", type: "Artifact" }),
    ];
    expect(sortNamesEot(cards)).toEqual(["Letters to Thessalonica", "Stumbling Block", "The Book of Life"]);
  });

  it("still ignores 'The' under the default comparator on the same cards", () => {
    const cards = [
      card({ name: "The Book of Life", type: "Artifact" }),
      card({ name: "Stumbling Block", type: "Artifact" }),
      card({ name: "Letters to Thessalonica", type: "Artifact" }),
    ];
    expect(sortNames(cards)).toEqual(["The Book of Life", "Letters to Thessalonica", "Stumbling Block"]);
  });

  it("breaks same-strength Good Enhancement ties by toughness ascending, opposite of the default comparator", () => {
    // Real EoT print order (49-50): Risen by Christ (2/3) prints before
    // Stand Firm (2/5) — lower toughness first, unlike every other set.
    const cards = [
      card({ name: "Stand Firm", type: "GE", brigade: "Clay", alignment: "Good", strength: "2", toughness: "5" }),
      card({ name: "Risen by Christ", type: "GE", brigade: "Clay", alignment: "Good", strength: "2", toughness: "3" }),
    ];
    expect(sortNamesEot(cards)).toEqual(["Risen by Christ", "Stand Firm"]);
    // The default comparator breaks the same tie the other way.
    expect(sortNames(cards)).toEqual(["Stand Firm", "Risen by Christ"]);
  });

  it("does NOT extend the ascending rule to Evil Enhancements, Heroes, or Evil Characters — only GE", () => {
    // Real EoT: Great Feast (0/6) prints before Filled with Flesh (0/0) —
    // Evil Enhancements still descend, unlike Good Enhancements.
    const eeCards = [
      card({ name: "Filled with Flesh", type: "EE", brigade: "Crimson", alignment: "Evil", strength: "0", toughness: "0" }),
      card({ name: "Great Feast", type: "EE", brigade: "Crimson", alignment: "Evil", strength: "0", toughness: "6" }),
    ];
    expect(sortNamesEot(eeCards)).toEqual(["Great Feast", "Filled with Flesh"]);

    // Real EoT: Seven Trumpet Sounders (7/7) prints before The Third
    // Creature (7/5) — higher toughness first, same as compareCardsDefault.
    const heroes = [
      card({ name: "The Third Creature", type: "Hero", brigade: "Silver", alignment: "Good", strength: "7", toughness: "5" }),
      card({ name: "Seven Trumpet Sounders", type: "Hero", brigade: "Silver", alignment: "Good", strength: "7", toughness: "7" }),
    ];
    expect(sortNamesEot(heroes)).toEqual(["Seven Trumpet Sounders", "The Third Creature"]);

    // Same rule for Evil Characters (real EoT pair, PaleGreen).
    const evilCharacters = [
      card({ name: "The Lawless One", type: "Evil Character", brigade: "PaleGreen", alignment: "Evil", strength: "4", toughness: "2" }),
      card({ name: "Meddling Mage", type: "Evil Character", brigade: "PaleGreen", alignment: "Evil", strength: "4", toughness: "4" }),
    ];
    expect(sortNamesEot(evilCharacters)).toEqual(["Meddling Mage", "The Lawless One"]);
  });
});
