import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/deckcheck", () => ({ // MUST match the implementation's "@/" specifier exactly or the mock silently doesn't apply
  checkDeck: vi.fn(async (cards, reserve) => ({
    valid: true,
    format: "Limited",
    issues: [{ type: "warning", rule: "card-not-found", message: "x", cards: ["Bogus"] }],
    stats: { mainDeckSize: cards.length, reserveSize: reserve.length },
  })),
}));
import { buildDeckSubmission } from "../deckSubmission";

function fakeAdmin(deckRow: any, cardRows: any[], calls: { in: any[] } = { in: [] }) {
  // Minimal PostgREST chain stub: .from().select().eq().single() for decks,
  // .from().select().eq().in() resolving cardRows for deck_cards.
  // Records .in() args so the maybeboard exclusion is actually asserted.
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: deckRow, error: deckRow ? null : { message: "not found" } }),
          in: async (col: string, vals: string[]) => {
            calls.in.push([col, vals]);
            return { data: cardRows, error: null };
          },
        }),
      }),
    }),
  } as any;
}

const deck = { id: "d1", user_id: "owner", name: "My Deck", format: "Limited", visibility: "private" };
const cards = [
  { card_name: "Son of God", card_set: "I/J", card_img_file: "sog.jpg", quantity: 1, zone: "main" },
  { card_name: "Burial", card_set: "I/J", card_img_file: null, quantity: 1, zone: "reserve" },
];

describe("buildDeckSubmission", () => {
  it("owner can submit a private deck; snapshot mirrors the validated rows; maybeboard excluded at the query", async () => {
    const calls = { in: [] as any[] };
    const r = await buildDeckSubmission(fakeAdmin(deck, cards, calls), "d1", "owner", "Limited");
    expect(r.success).toBe(true);
    if (r.success === true) {
      expect(r.snapshot.cards).toEqual([
        { name: "Son of God", set: "I/J", imgFile: "sog.jpg", quantity: 1, zone: "main" },
        { name: "Burial", set: "I/J", imgFile: null, quantity: 1, zone: "reserve" },
      ]);
      expect(r.hasUnresolvedCards).toBe(true); // card-not-found warning present
    }
    expect(calls.in).toContainEqual(["zone", ["main", "reserve"]]);
  });
  it("stranger blocked from private deck", async () => {
    const r = await buildDeckSubmission(fakeAdmin(deck, cards), "d1", "other", "Limited");
    expect(r.success).toBe(false);
    if (r.success === false) expect(r.error).toBe("deck_not_accessible");
  });
  it("stranger allowed on unlisted/public deck", async () => {
    const r = await buildDeckSubmission(
      fakeAdmin({ ...deck, visibility: "unlisted" }, cards), "d1", "other", "Limited");
    expect(r.success).toBe(true);
  });
  it("missing deck", async () => {
    const r = await buildDeckSubmission(fakeAdmin(null, []), "nope", "u", "Limited");
    expect(r.success).toBe(false);
  });
});
