/**
 * Service-role deck-link operations for the YTG Decks tab (spec §Decks tab
 * pt. 5–6). Kept out of actions.ts so unit tests can inject a stub client.
 * The injected `admin` is getSupabaseAdmin() — RLS has no admin bypass on
 * decks/deck_cards and the decks belong to YTG_ACCOUNT_USER_ID.
 */
import { YTG_ACCOUNT_USER_ID } from "./constants";
import type { DeckZone } from "./deckZones";

export interface ResolvedEntry {
  cardKey: string;   // `${name}|${set}|${imgFile}`
  cardName: string;
  setCode: string;
  imgFile: string;   // raw carddata imgFile
  qty: number;
  // Derived by the wizard from the parsed line's section (Reserve section →
  // 'reserve', else 'main' — see lib/ytg/deckZones.ts); ops trust it.
  zone: DeckZone;
}

export type CreateDeckResult =
  | { success: true; deckId: string; deckName: string }
  | { success: false; conflict: true; existingDeckId: string | null; error: string }
  | { success: false; conflict?: false; error: string };

export type ReplaceResult =
  | { success: true; deckId: string; cardCount: number } // cardCount = main-zone qty (matches decks.card_count)
  | { success: false; error: string };

// Canonical format id — 'T1' is legacy (migration 081 retired it;
// normalizeFormat('T1') → 'Limited'), so we write the canonical value.
const DECK_FORMAT = "Limited";

export function cleanDeckName(title: string): string {
  return title.replace(/^\*New\*\s*/i, "").trim();
}

// Entries cross the client→server boundary; anything that isn't exactly
// 'reserve' lands in 'main' so the deck_cards CHECK can never reject a row.
const zoneOf = (r: ResolvedEntry): DeckZone => (r.zone === "reserve" ? "reserve" : "main");

function mergeRows(deckId: string, resolved: ResolvedEntry[]) {
  // deck_cards is UNIQUE (deck_id, card_name, card_set, zone); the same card
  // can repeat within a zone (e.g. two Heroes-section lines) — summed — while
  // a card in both Heroes AND Reserve keeps one row per zone.
  const byKey = new Map<string, {
    deck_id: string; card_name: string; card_set: string;
    card_img_file: string; quantity: number; zone: DeckZone;
  }>();
  for (const r of resolved) {
    const zone = zoneOf(r);
    const k = `${r.cardName}|${r.setCode}|${zone}`;
    const prev = byKey.get(k);
    if (prev) prev.quantity += r.qty;
    else byKey.set(k, {
      deck_id: deckId, card_name: r.cardName, card_set: r.setCode,
      card_img_file: r.imgFile, quantity: r.qty, zone,
    });
  }
  return [...byKey.values()];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createDeckLinkedOp(admin: any, args: {
  productId: string; handle: string; productTitle: string;
  createdBy: string | null; resolved: ResolvedEntry[];
}): Promise<CreateDeckResult> {
  const { productId, handle, productTitle, createdBy, resolved } = args;
  const conflictMsg = "product was linked while you worked — view or replace instead";

  // (1) Fast-fail if already linked.
  const { data: existing, error: existErr } = await admin
    .from("ytg_deck_links").select("deck_id")
    .eq("shopify_product_id", productId).maybeSingle();
  if (existErr) return { success: false, error: existErr.message };
  if (existing) return { success: false, conflict: true, existingDeckId: existing.deck_id, error: conflictMsg };

  // (2) Deck name: title minus '*New* '; on collision within the YTG account,
  // suffix with the product handle (old/new stock sells under near-identical
  // titles on purpose; decks has no unique-name constraint to catch it).
  let deckName = cleanDeckName(productTitle);
  const { data: nameHit, error: nameErr } = await admin
    .from("decks").select("id")
    .eq("user_id", YTG_ACCOUNT_USER_ID).eq("name", deckName).limit(1);
  if (nameErr) return { success: false, error: nameErr.message };
  if (nameHit && nameHit.length > 0) deckName = `${deckName} — ${handle}`;

  const deckId = crypto.randomUUID();
  // card_count is MAIN-only app-wide (app/decklist/actions.ts convention);
  // previews likewise come from main-zone entries.
  const mains = resolved.filter((r) => zoneOf(r) === "main");
  const mainQty = mains.reduce((s, r) => s + r.qty, 0);

  // (3) Insert the deck. True link-first (per the spec's wording) is
  // impossible: links.deck_id is NOT NULL REFERENCES decks(id). The link
  // INSERT below (ON CONFLICT DO NOTHING) is the atomic claim; a lost race
  // deletes this deck — no orphan survives either ordering.
  const { error: deckErr } = await admin.from("decks").insert({
    id: deckId,
    user_id: YTG_ACCOUNT_USER_ID,
    name: deckName,
    description: `Contents of the YTG product "${productTitle}" — source of truth for store inventory.`,
    format: DECK_FORMAT,
    visibility: "public",
    card_count: mainQty,
    preview_card_1: mains[0]?.imgFile ?? null,
    preview_card_2: mains[1]?.imgFile ?? null,
  });
  if (deckErr) return { success: false, error: `deck insert failed: ${deckErr.message}` };

  // (4) Atomic claim: INSERT … ON CONFLICT DO NOTHING RETURNING.
  const { data: claimed, error: claimErr } = await admin
    .from("ytg_deck_links")
    .upsert(
      { shopify_product_id: productId, deck_id: deckId, handle, product_title: productTitle, created_by: createdBy },
      { onConflict: "shopify_product_id", ignoreDuplicates: true },
    )
    .select("shopify_product_id");
  if (claimErr) {
    await admin.from("decks").delete().eq("id", deckId);
    return { success: false, error: `link insert failed: ${claimErr.message}` };
  }
  if (!claimed || claimed.length === 0) {
    // Another tab won the claim — compensate before reporting.
    await admin.from("decks").delete().eq("id", deckId);
    const { data: winner } = await admin
      .from("ytg_deck_links").select("deck_id")
      .eq("shopify_product_id", productId).maybeSingle();
    return { success: false, conflict: true, existingDeckId: winner ? winner.deck_id : null, error: conflictMsg };
  }

  // (5) Bulk insert contents — per-entry zone (main/reserve), raw carddata img files.
  const { error: cardsErr } = await admin.from("deck_cards").insert(mergeRows(deckId, resolved));
  if (cardsErr) {
    // Compensate: link first (frees ON DELETE RESTRICT), then the deck.
    await admin.from("ytg_deck_links").delete().eq("shopify_product_id", productId);
    await admin.from("decks").delete().eq("id", deckId);
    return { success: false, error: `deck_cards insert failed: ${cardsErr.message}` };
  }

  return { success: true, deckId, deckName };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function replaceDeckContentsOp(admin: any, args: {
  productId: string; resolved: ResolvedEntry[];
}): Promise<ReplaceResult> {
  const { productId, resolved } = args;

  // Sale guard (WS-4 contract): never mutate contents while a sale for this
  // product is pending/applying — the sale snapshot and deck would diverge.
  const { data: activeSale, error: saleErr } = await admin
    .from("ytg_deck_sales").select("id")
    .eq("shopify_product_id", productId)
    .in("status", ["pending", "applying"]).limit(1);
  if (saleErr) return { success: false, error: saleErr.message };
  if (activeSale && activeSale.length > 0) {
    return { success: false, error: "a sale is being recorded for this product" };
  }

  const { data: link, error: linkErr } = await admin
    .from("ytg_deck_links").select("deck_id")
    .eq("shopify_product_id", productId).maybeSingle();
  if (linkErr) return { success: false, error: linkErr.message };
  if (!link) return { success: false, error: "product is not linked to a deck" };

  const deckId = link.deck_id;
  const rows = mergeRows(deckId, resolved);

  const { error: delErr } = await admin.from("deck_cards").delete().eq("deck_id", deckId);
  if (delErr) return { success: false, error: delErr.message };

  const { error: insErr } = await admin.from("deck_cards").insert(rows);
  if (insErr) {
    return { success: false, error: `re-insert failed — deck is now empty, re-run the wizard: ${insErr.message}` };
  }

  // MAIN-only count + previews, same convention as create.
  const mains = resolved.filter((r) => zoneOf(r) === "main");
  const mainQty = mains.reduce((s, r) => s + r.qty, 0);
  const { error: updErr } = await admin.from("decks").update({
    card_count: mainQty,
    preview_card_1: mains[0]?.imgFile ?? null,
    preview_card_2: mains[1]?.imgFile ?? null,
    // updated_at is maintained by the decks BEFORE UPDATE trigger (001).
  }).eq("id", deckId);
  if (updErr) return { success: false, error: updErr.message };

  return { success: true, deckId, cardCount: mainQty };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function unlinkProductOp(admin: any, productId: string): Promise<{ success: boolean; error?: string }> {
  // Deletes the link row only — the deck survives as a normal public deck
  // and ON DELETE RESTRICT no longer binds it.
  const { error } = await admin.from("ytg_deck_links").delete().eq("shopify_product_id", productId);
  if (error) return { success: false, error: error.message };
  return { success: true };
}
