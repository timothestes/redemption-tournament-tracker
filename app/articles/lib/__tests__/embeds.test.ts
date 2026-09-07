import { describe, it, expect } from "vitest";
import { extractCardMentions, deckIdFromUrl, extractDeckIds, mentionKey, excerptFromMarkdown } from "../markdown";

const ID = "8b1a6d5a-1b6e-4d5e-9f2a-3c4d5e6f7a8b";

describe("mentionKey", () => {
  it("trims, collapses whitespace, straightens quotes, lowercases", () => {
    expect(mentionKey("  Son  of\tGod ")).toBe("son of god");
    expect(mentionKey("Abraham’s Servant")).toBe("abraham's servant");
    expect(mentionKey("Lost Soul “Hopper”")).toBe('lost soul "hopper"');
  });
});

describe("extractCardMentions", () => {
  it("collects distinct names in order, ignoring case duplicates", () => {
    const md = "Play [[Son of God]] then [[ Angel of the Lord ]] and [[son of god]] again.";
    expect(extractCardMentions(md)).toEqual(["Son of God", "Angel of the Lord"]);
  });
  it("skips code spans and fenced blocks", () => {
    const md = "`[[Not This]]`\n\n```\n[[Nor This]]\n```\n\n[[Yes]]";
    expect(extractCardMentions(md)).toEqual(["Yes"]);
  });
  it("ignores brackets and newlines inside", () => {
    expect(extractCardMentions("[[a\nb]] [[c[d]] [[]] [[ ]]")).toEqual([]);
  });
  it("caps the count", () => {
    const md = Array.from({ length: 5 }, (_, i) => `[[c${i}]]`).join(" ");
    expect(extractCardMentions(md, 3)).toHaveLength(3);
  });
});

describe("deckIdFromUrl", () => {
  it.each([
    [`https://landofredemption.com/decklist/${ID}`],
    [`https://www.landofredemption.com/decklist/${ID}/`],
    [`https://redemptionccg.app/decklist/${ID}`],
    [`http://localhost:3000/decklist/${ID}`],
    [`https://rtt-git-feat-x.vercel.app/decklist/${ID}?utm=1`],
    [`/decklist/${ID}`],
    [`  /decklist/${ID.toUpperCase()}  `],
  ])("accepts %s", (url) => {
    expect(deckIdFromUrl(url)).toBe(ID);
  });
  it.each([
    [`https://example.com/decklist/${ID}`],
    [`https://landofredemption.com/decklist/not-a-uuid`],
    [`https://landofredemption.com/decklist/${ID}/edit`],
    [`https://landofredemption.com/decklist/community`],
    [`decklist/${ID}`],
    [`https://landofredemption.com/articles/${ID}`],
    [""],
  ])("rejects %s", (url) => {
    expect(deckIdFromUrl(url)).toBeNull();
  });
});

describe("extractDeckIds", () => {
  it("finds absolute and relative deck links, deduped and lowercased", () => {
    const other = "11111111-2222-3333-4444-555555555555";
    const md = `See https://landofredemption.com/decklist/${ID}\n\n/decklist/${other}\n\nagain https://landofredemption.com/decklist/${ID.toUpperCase()}`;
    expect(extractDeckIds(md)).toEqual([ID, other]);
  });
  it("ignores foreign hosts and non-deck paths", () => {
    expect(extractDeckIds(`https://example.com/decklist/${ID} and /decklist/nope`)).toEqual([]);
  });
});

describe("excerptFromMarkdown with mentions", () => {
  it("keeps the card name and drops the brackets", () => {
    expect(excerptFromMarkdown("Open with [[Son of God]] every game.")).toBe("Open with Son of God every game.");
  });
});
