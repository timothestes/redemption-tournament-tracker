import { describe, it, expect } from "vitest";
import {
  createDeckLinkedOp, replaceDeckContentsOp, cleanDeckName, type ResolvedEntry,
} from "../deckLinkOps";
import { YTG_ACCOUNT_USER_ID } from "../constants";

type Step = { table: string; result: { data?: unknown; error?: { message: string } | null } };

/** Minimal chainable stand-in for supabase-js. Each from(table) consumes the
 *  next scripted step (asserting table order — this is how we verify the
 *  claim/compensation sequence) and records ops + args; awaiting the chain
 *  yields the scripted result. */
function stubAdmin(script: Step[]) {
  const calls: { table: string; ops: string[]; args: unknown[][] }[] = [];
  const admin = {
    from(table: string) {
      const step = script.shift();
      if (!step) throw new Error(`unexpected query on ${table} — script exhausted`);
      if (step.table !== table) throw new Error(`expected query on ${step.table}, got ${table}`);
      const record = { table, ops: [] as string[], args: [] as unknown[][] };
      calls.push(record);
      const result = { data: step.result.data ?? null, error: step.result.error ?? null };
      const chain: Record<string, unknown> = {
        then(resolve: (v: unknown) => void) { resolve(result); },
      };
      for (const op of ["select", "insert", "upsert", "delete", "update", "eq", "in", "limit", "maybeSingle"]) {
        chain[op] = (...args: unknown[]) => { record.ops.push(op); record.args.push(args); return chain; };
      }
      return chain;
    },
  };
  return { admin, calls, script };
}

const RESOLVED: ResolvedEntry[] = [
  { cardKey: "Son of God [K]|K|K1-Son-of-God", cardName: "Son of God [K]", setCode: "K", imgFile: "K1-Son-of-God", qty: 1 },
  { cardKey: "Told to Take|T2C|123-Told-to-Take", cardName: "Told to Take", setCode: "T2C", imgFile: "123-Told-to-Take", qty: 2 },
  // Same card appears in a second section — must merge (deck_cards UNIQUE).
  { cardKey: "Told to Take|T2C|123-Told-to-Take", cardName: "Told to Take", setCode: "T2C", imgFile: "123-Told-to-Take", qty: 1 },
];
const ARGS = { productId: "p1", handle: "the-fiery-furnace", productTitle: "*New* The Fiery Furnace", createdBy: "admin-1", resolved: RESOLVED };

describe("cleanDeckName", () => {
  it("strips the leading '*New* ' prefix", () => {
    expect(cleanDeckName("*New* The Fiery Furnace")).toBe("The Fiery Furnace");
    expect(cleanDeckName("Plain Title")).toBe("Plain Title");
  });
});

describe("createDeckLinkedOp", () => {
  it("happy path: fast-fail select → deck insert → link claim → merged cards", async () => {
    const { admin, calls } = stubAdmin([
      { table: "ytg_deck_links", result: { data: null } },              // fast-fail
      { table: "decks", result: { data: [] } },                          // name collision check
      { table: "decks", result: { data: null } },                        // deck insert
      { table: "ytg_deck_links", result: { data: [{ shopify_product_id: "p1" }] } }, // claim won
      { table: "deck_cards", result: { data: null } },                   // cards insert
    ]);
    const res = await createDeckLinkedOp(admin, ARGS);
    if (res.success === false) throw new Error(res.error);
    expect(res.deckName).toBe("The Fiery Furnace");

    const deckRow = calls[2].args[0][0] as Record<string, unknown>;
    expect(deckRow.user_id).toBe(YTG_ACCOUNT_USER_ID);
    expect(deckRow.visibility).toBe("public");
    expect(deckRow.format).toBe("Limited");
    expect(deckRow.card_count).toBe(4);
    expect(deckRow.preview_card_1).toBe("K1-Son-of-God");
    expect(deckRow.preview_card_2).toBe("123-Told-to-Take");
    expect(deckRow.description).toBe('Contents of the YTG product "*New* The Fiery Furnace" — source of truth for store inventory.');

    const cardRows = calls[4].args[0][0] as Record<string, unknown>[];
    expect(cardRows).toHaveLength(2); // merged
    const ttt = cardRows.find((r) => r.card_name === "Told to Take")!;
    expect(ttt.quantity).toBe(3);
    expect(ttt.zone).toBe("main");
    expect(ttt.card_set).toBe("T2C");
    expect(ttt.card_img_file).toBe("123-Told-to-Take");
  });

  it("lost claim race: compensating deck delete, conflict result, NO cards insert", async () => {
    const { admin, calls, script } = stubAdmin([
      { table: "ytg_deck_links", result: { data: null } },
      { table: "decks", result: { data: [] } },
      { table: "decks", result: { data: null } },
      { table: "ytg_deck_links", result: { data: [] } },                 // claim LOST (ON CONFLICT DO NOTHING)
      { table: "decks", result: { data: null } },                        // compensating delete
      { table: "ytg_deck_links", result: { data: { deck_id: "winner-deck" } } }, // fetch winner
    ]);
    const res = await createDeckLinkedOp(admin, ARGS);
    expect(res.success).toBe(false);
    if (res.success === false) {
      expect(res.conflict).toBe(true);
      if (res.conflict === true) expect(res.existingDeckId).toBe("winner-deck");
    }
    expect(calls[4].ops).toContain("delete");
    expect(script).toHaveLength(0);
    expect(calls.some((c) => c.table === "deck_cards")).toBe(false);     // no orphan cards
  });

  it("deck_cards failure compensates link then deck", async () => {
    const { admin, calls } = stubAdmin([
      { table: "ytg_deck_links", result: { data: null } },
      { table: "decks", result: { data: [] } },
      { table: "decks", result: { data: null } },
      { table: "ytg_deck_links", result: { data: [{ shopify_product_id: "p1" }] } },
      { table: "deck_cards", result: { error: { message: "boom" } } },
      { table: "ytg_deck_links", result: { data: null } },               // compensate: link first (frees RESTRICT)
      { table: "decks", result: { data: null } },                        // then deck
    ]);
    const res = await createDeckLinkedOp(admin, ARGS);
    expect(res.success).toBe(false);
    if (res.success === false) expect(res.error).toContain("boom");
    expect(calls[5].table).toBe("ytg_deck_links");
    expect(calls[5].ops).toContain("delete");
    expect(calls[6].table).toBe("decks");
    expect(calls[6].ops).toContain("delete");
  });

  it("fast-fails when the product is already linked", async () => {
    const { admin, script } = stubAdmin([
      { table: "ytg_deck_links", result: { data: { deck_id: "d0" } } },
    ]);
    const res = await createDeckLinkedOp(admin, ARGS);
    expect(res.success).toBe(false);
    if (res.success === false && res.conflict === true) expect(res.existingDeckId).toBe("d0");
    expect(script).toHaveLength(0);
  });

  it("suffixes the deck name with the handle on collision within the YTG account", async () => {
    const { admin, calls } = stubAdmin([
      { table: "ytg_deck_links", result: { data: null } },
      { table: "decks", result: { data: [{ id: "existing" }] } },        // name taken
      { table: "decks", result: { data: null } },
      { table: "ytg_deck_links", result: { data: [{ shopify_product_id: "p1" }] } },
      { table: "deck_cards", result: { data: null } },
    ]);
    const res = await createDeckLinkedOp(admin, ARGS);
    if (res.success === false) throw new Error(res.error);
    expect(res.deckName).toBe("The Fiery Furnace — the-fiery-furnace");
    expect((calls[2].args[0][0] as Record<string, unknown>).name).toBe("The Fiery Furnace — the-fiery-furnace");
  });
});

describe("replaceDeckContentsOp", () => {
  it("refuses while a sale is pending/applying — exact WS-4 contract string", async () => {
    const { admin, script } = stubAdmin([
      { table: "ytg_deck_sales", result: { data: [{ id: "s1" }] } },
    ]);
    const res = await replaceDeckContentsOp(admin, { productId: "p1", resolved: RESOLVED });
    expect(res.success).toBe(false);
    if (res.success === false) expect(res.error).toBe("a sale is being recorded for this product");
    expect(script).toHaveLength(0); // nothing was touched
  });

  it("happy path: guard → link → delete → merged insert → deck update", async () => {
    const { admin, calls } = stubAdmin([
      { table: "ytg_deck_sales", result: { data: [] } },
      { table: "ytg_deck_links", result: { data: { deck_id: "d1" } } },
      { table: "deck_cards", result: { data: null } },                   // delete
      { table: "deck_cards", result: { data: null } },                   // insert
      { table: "decks", result: { data: null } },                        // update
    ]);
    const res = await replaceDeckContentsOp(admin, { productId: "p1", resolved: RESOLVED });
    if (res.success === false) throw new Error(res.error);
    expect(res.cardCount).toBe(4);
    const upd = calls[4].args[0][0] as Record<string, unknown>;
    expect(upd.card_count).toBe(4);
    expect(upd.preview_card_1).toBe("K1-Son-of-God");
  });
});
