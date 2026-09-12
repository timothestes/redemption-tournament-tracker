import { describe, it, expect } from "vitest";
import { linkCardMentions } from "../linkCards";

const cands = (names: string[]) => names.map((name) => ({ name, target: name }));
const link = (md: string, names: string[]) => linkCardMentions(md, cands(names)).markdown;

// Stands in for the real card index in the "longer card name" tests.
const knows = (...names: string[]) => {
  const set = new Set(names.map((n) => n.toLowerCase().replace(/[\u2019]/g, "'")));
  return (text: string) => set.has(text.toLowerCase().replace(/[\u2019]/g, "'"));
};

describe("linkCardMentions", () => {
  it("wraps a card the deck actually plays", () => {
    expect(link("I run Son of God here.", ["Son of God"])).toBe("I run [[Son of God]] here.");
  });

  it("reports what it wrapped", () => {
    const out = linkCardMentions("Son of God and Mayhem.", cands(["Son of God", "Mayhem"]));
    expect(out.added).toEqual(["Son of God", "Mayhem"]);
  });

  it("is case-sensitive, so ordinary prose is left alone", () => {
    expect(link("the mayhem of turn three", ["Mayhem"])).toBe("the mayhem of turn three");
  });

  it("matches whole words only", () => {
    expect(link("Isaacs everywhere", ["Isaac"])).toBe("Isaacs everywhere");
    expect(link("pre-Isaac era", ["Isaac"])).toBe("pre-Isaac era");
  });

  it("allows a possessive after the name", () => {
    expect(link("Son of God's ability", ["Son of God"])).toBe("[[Son of God]]'s ability");
    expect(link("Son of God’s ability", ["Son of God"])).toBe("[[Son of God]]’s ability");
  });

  it("prefers the longest candidate", () => {
    expect(link("The Angel of the Lord blocks.", ["Angel", "The Angel of the Lord"])).toBe(
      "[[The Angel of the Lord]] blocks.",
    );
  });

  it("links a card once per paragraph, not once per description", () => {
    const md = "Mayhem is great. Mayhem again.\n\nStill Mayhem in a later paragraph.";
    expect(link(md, ["Mayhem"])).toBe(
      "[[Mayhem]] is great. Mayhem again.\n\nStill [[Mayhem]] in a later paragraph.",
    );
  });

  it("leaves fenced code and inline code alone", () => {
    expect(link("```\nMayhem\n```", ["Mayhem"])).toBe("```\nMayhem\n```");
    expect(link("Type `Mayhem` to search.", ["Mayhem"])).toBe("Type `Mayhem` to search.");
  });

  it("leaves an existing mention alone", () => {
    expect(link("[[Mayhem]] is already linked.", ["Mayhem"])).toBe("[[Mayhem]] is already linked.");
  });

  it("never links inside a markdown link or a bare URL", () => {
    expect(link("[Mayhem](https://x.y/Mayhem) rules", ["Mayhem"])).toBe("[Mayhem](https://x.y/Mayhem) rules");
    expect(link("see https://x.y/Mayhem now", ["Mayhem"])).toBe("see https://x.y/Mayhem now");
    expect(link("![Mayhem](https://x.y/m.png)", ["Mayhem"])).toBe("![Mayhem](https://x.y/m.png)");
  });

  it("leaves headings unlinked", () => {
    expect(link("## Mayhem\n\nMayhem below.", ["Mayhem"])).toBe("## Mayhem\n\n[[Mayhem]] below.");
  });

  it("treats regex characters in a card name literally", () => {
    expect(link("I play Mary (Promo) turn one.", ["Mary (Promo)"])).toBe("I play [[Mary (Promo)]] turn one.");
  });

  it("does not wrap a name inside a name it already wrapped", () => {
    const out = linkCardMentions("The Angel of the Lord is here.", cands(["The Angel of the Lord", "Angel"]));
    expect(out.markdown).toBe("[[The Angel of the Lord]] is here.");
    expect(out.added).toEqual(["The Angel of the Lord"]);
  });

  it("keeps a description with nothing to link byte-identical", () => {
    const md = "No cards named here.\n\nJust prose.";
    const out = linkCardMentions(md, cands(["Mayhem"]));
    expect(out.markdown).toBe(md);
    expect(out.added).toEqual([]);
  });
});

describe("linkCardMentions: names inside longer card names", () => {
  it("leaves a short name that is part of a longer card the author meant", () => {
    const known = knows("Faith of Samuel");
    expect(linkCardMentions("I cut Faith of Samuel late.", cands(["Faith"]), { knownName: known }).markdown).toBe(
      "I cut Faith of Samuel late.",
    );
  });

  it("handles the possessive shape of a longer name", () => {
    const known = knows("Goliath's Curse");
    expect(linkCardMentions("Goliath’s Curse underdecks it.", cands(["Goliath"]), { knownName: known }).markdown).toBe(
      "Goliath’s Curse underdecks it.",
    );
  });

  it("still links the short name where no longer card name surrounds it", () => {
    const known = knows("Faith of Samuel");
    expect(linkCardMentions("Faith wins games.", cands(["Faith"]), { knownName: known }).markdown).toBe(
      "[[Faith]] wins games.",
    );
  });

  it("links a later clean occurrence when the first is inside a longer name", () => {
    const known = knows("Amazing Faith");
    expect(linkCardMentions("Amazing Faith is fine, but Faith is the tutor.", cands(["Faith"]), { knownName: known }).markdown).toBe(
      "Amazing Faith is fine, but [[Faith]] is the tutor.",
    );
  });

  it("ignores trailing punctuation when testing the longer span", () => {
    const known = knows("Faith of Samuel");
    expect(linkCardMentions("I run Faith of Samuel, mostly.", cands(["Faith"]), { knownName: known }).markdown).toBe(
      "I run Faith of Samuel, mostly.",
    );
  });
});

describe("linkCardMentions: scripture references", () => {
  it("leaves a book name that is part of a verse reference", () => {
    expect(link('"…for his friends." John 15:13', ["John"])).toBe('"…for his friends." John 15:13');
    expect(link("see John 15:13-14 there", ["John"])).toBe("see John 15:13-14 there");
  });
  it("still links the card elsewhere", () => {
    expect(link("John blocks well.", ["John"])).toBe("[[John]] blocks well.");
  });
  it("leaves a numbered book reference", () => {
    expect(link("1 Samuel 3:10 says", ["Samuel"])).toBe("1 Samuel 3:10 says");
  });
});

describe("linkCardMentions: shorthand for a longer card", () => {
  it("leaves a one-word card that is followed by 'of'", () => {
    expect(link("negate the ability on Faith of Abe there", ["Faith"])).toBe("negate the ability on Faith of Abe there");
  });
  it("keeps linking a multi-word card followed by 'of'", () => {
    expect(link("Angel of the Lord of course works.", ["Angel of the Lord"])).toBe(
      "[[Angel of the Lord]] of course works.",
    );
  });
});

describe("linkCardMentions: how the author actually typed it", () => {
  it("matches a curly apostrophe against a card stored with a straight one", () => {
    // With no resolvesTo to vouch for the author's spelling, the mention carries
    // the card as its target — safe, and the page still reads as written.
    expect(link("I tutor with Crowd’s Choice.", ["Crowd's Choice"])).toBe(
      "I tutor with [[Crowd's Choice|Crowd’s Choice]].",
    );
  });
  it("matches when the author dropped the card's comma", () => {
    expect(linkCardMentions("Moses the Servant blocks.", [{ name: "Moses, the Servant", target: "Moses, the Servant" }]).markdown).toBe(
      "[[Moses, the Servant|Moses the Servant]] blocks.",
    );
  });
  it("matches the British spelling of Judgment", () => {
    expect(linkCardMentions("An Impartial Judgement of 7.", [{ name: "Impartial Judgment", target: "Impartial Judgment" }]).markdown).toBe(
      "An [[Impartial Judgment|Impartial Judgement]] of 7.",
    );
  });
  it("writes what the author wrote when that resolves on its own", () => {
    const resolvesTo = (written: string, target: string) => written.replace(/’/g, "'") === target;
    expect(
      linkCardMentions("I tutor with Crowd’s Choice.", [{ name: "Crowd's Choice", target: "Crowd's Choice" }], { resolvesTo }).markdown,
    ).toBe("I tutor with [[Crowd’s Choice]].");
  });
});

describe("linkCardMentions: pointing at the deck's own printing", () => {
  it("aliases when the plain name belongs to a different card", () => {
    expect(linkCardMentions("Jacob draws.", [{ name: "Jacob", target: "Jacob (FooF)" }]).markdown).toBe(
      "[[Jacob (FooF)|Jacob]] draws.",
    );
  });
});

describe("linkCardMentions: running it twice", () => {
  it("leaves a paragraph that already mentions the card alone", () => {
    const md = "I run [[Mayhem]] and later Mayhem again.";
    const out = linkCardMentions(md, cands(["Mayhem"]));
    expect(out.markdown).toBe(md);
    expect(out.added).toEqual([]);
  });
  it("sees through an alias when checking what is already mentioned", () => {
    const md = "[[Jacob (FooF)|Jacob]] and Jacob.";
    expect(linkCardMentions(md, [{ name: "Jacob", target: "Jacob (FooF)" }]).markdown).toBe(md);
  });
});
