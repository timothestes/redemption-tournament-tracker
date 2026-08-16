import type { ResolvedCard } from "./types";

/**
 * Official preconstructed decks, exempt from constructed deck-building rules.
 *
 * The R.A.I.D. decks are 25-card starter lists built by BaboonyTim from Roots
 * of Redemption and the K/L starter decks. They are far under the 50-card
 * Limited minimum, so the normal validator calls every one of them illegal.
 * Rather than teach the rules engine a new format — which would bless *any*
 * 25-card pile — the exemption is keyed to the exact contents of these four
 * lists. Someone who copies a deck and leaves it alone keeps the exemption;
 * someone who adds, removes, swaps, re-prints, or reserves a single card
 * falls straight back onto the format's rules and reads illegal.
 */

export interface OfficialDeckEntry {
  name: string;
  set: string;
  quantity: number;
}

export interface OfficialDeckDef {
  id: string;
  name: string;
  colors: string;
  cards: OfficialDeckEntry[];
}

export const OFFICIAL_DECKS: OfficialDeckDef[] = [
  {
    id: "raid-01",
    name: "R.A.I.D. 01 — Shepherd & Pharaoh",
    colors: "Purple/PaleGreen",
    cards: [
      { name: "King's Daughter (Roots)", set: "RR", quantity: 1 },
      { name: "Armor Bearer (Roots)", set: "RR", quantity: 1 },
      { name: "Abigail [K]", set: "K", quantity: 1 },
      { name: "David's Messengers [K]", set: "K", quantity: 1 },
      { name: "David, Giant Slayer [K]", set: "K", quantity: 1 },
      { name: "Battle Prayer (Roots)", set: "RR", quantity: 1 },
      { name: "Five Smooth Stones (Roots)", set: "RR", quantity: 1 },
      { name: "David's Victory [K]", set: "K", quantity: 1 },
      { name: "Given to Israel [K]", set: "K", quantity: 1 },
      { name: "Loyalty to David [K]", set: "K", quantity: 1 },
      { name: "Joseph in Prison (Roots)", set: "RR", quantity: 1 },
      { name: "Egyptian Spear [K]", set: "K", quantity: 1 },
      { name: "Moses kills Egyptian [K]", set: "K", quantity: 1 },
      { name: "Abandoned [K]", set: "K", quantity: 1 },
      { name: "Thrown into the Nile [K]", set: "K", quantity: 1 },
      { name: "Ruthless [K]", set: "K", quantity: 1 },
      { name: "Egyptian Soothsayers [K]", set: "K", quantity: 1 },
      { name: "Pharaoh's Army [K]", set: "K", quantity: 1 },
      { name: "Subjugating Egyptians [K]", set: "K", quantity: 1 },
      { name: "Huge Egyptian (Roots)", set: "RR", quantity: 1 },
      { name: "Lost Soul [Exodus 11:5- K]", set: "K", quantity: 5 },
    ],
  },
  {
    id: "raid-02",
    name: "R.A.I.D. 02 — Priest & Emperor",
    colors: "Clay/Gray",
    cards: [
      { name: "Amariah, the High Priest (Roots)", set: "RR", quantity: 1 },
      { name: "Generations of Priests [L]", set: "L", quantity: 1 },
      { name: "Aaron, Moses' Brother [L]", set: "L", quantity: 1 },
      { name: "Ithamar, Son of Aaron [L]", set: "L", quantity: 1 },
      { name: "Melchizedek, Bread Giver (Roots)", set: "RR", quantity: 1 },
      { name: "Holy Unto the Lord (Roots)", set: "RR", quantity: 1 },
      { name: "Zeal for the Lord (Roots)", set: "RR", quantity: 1 },
      { name: "Food for the Priests [L]", set: "L", quantity: 1 },
      { name: "Observe the Sabbath [L]", set: "L", quantity: 1 },
      { name: "Slain by Levites [L]", set: "L", quantity: 1 },
      { name: "Generous Giving (Roots)", set: "RR", quantity: 1 },
      { name: "Emperor Vitellius (Roots)", set: "RR", quantity: 1 },
      { name: "Emperor Otho (Roots)", set: "RR", quantity: 1 },
      { name: "Emperor Caius Caligula (Roots)", set: "RR", quantity: 1 },
      { name: "Emperor Augustus (Roots)", set: "RR", quantity: 1 },
      { name: "Balaam's Disobedience (Roots)", set: "RR", quantity: 1 },
      { name: "Casting Lots (Roots)", set: "RR", quantity: 1 },
      { name: "Heavy Taxes (Roots)", set: "RR", quantity: 1 },
      { name: "Mask of Pride (Roots)", set: "RR", quantity: 1 },
      { name: "Roman Horses (Roots)", set: "RR", quantity: 1 },
      { name: "Lost Soul [Exodus 10:10 - K]", set: "K", quantity: 5 },
    ],
  },
  {
    id: "raid-03",
    name: "R.A.I.D. 03 — Deliverer & Giant",
    colors: "White/Black",
    cards: [
      { name: "Hinds’ Feet (Roots)", set: "RR", quantity: 1 },
      { name: "Joshua, the Faithful [L]", set: "L", quantity: 1 },
      { name: "Women of Israel [L]", set: "L", quantity: 1 },
      { name: "The Tribal Elders [L]", set: "L", quantity: 1 },
      { name: "Swept into the Sea [L]", set: "L", quantity: 1 },
      { name: "Burning Bush [L]", set: "L", quantity: 1 },
      { name: "Daughters of Midian [L]", set: "L", quantity: 1 },
      { name: "Moses, the Deliverer [L]", set: "L", quantity: 1 },
      { name: "Water from a Rock [L]", set: "L", quantity: 1 },
      { name: "Consecration of Priests [L]", set: "L", quantity: 1 },
      { name: "Evade [L]", set: "L", quantity: 1 },
      { name: "Goliath's Spear [L]", set: "L", quantity: 1 },
      { name: "Philistine Army [L]", set: "L", quantity: 1 },
      { name: "Quaking with Fear [L]", set: "L", quantity: 1 },
      { name: "Terrifying Philistines [L]", set: "L", quantity: 1 },
      { name: "Lot's Wife (Roots)", set: "RR", quantity: 1 },
      { name: "The Twelve-Fingered Giant (Roots)", set: "RR", quantity: 1 },
      { name: "Stone of Thebez (Roots)", set: "RR", quantity: 1 },
      { name: "Rizpah’s Sackcloth (Roots)", set: "RR", quantity: 1 },
      { name: "Abandonment (Roots)", set: "RR", quantity: 1 },
      { name: "Lost Soul [I Samuel 2:23 - L]", set: "L", quantity: 5 },
    ],
  },
  {
    id: "raid-04",
    name: "R.A.I.D. 04 — Prophet & Usurper",
    colors: "Green/Brown",
    cards: [
      { name: "Company of Prophets [K]", set: "K", quantity: 1 },
      { name: "Samuel, the Anointer [K]", set: "K", quantity: 1 },
      { name: "The Prophet of God [K]", set: "K", quantity: 1 },
      { name: "David (Roots)", set: "RR", quantity: 1 },
      { name: "Iddo the Seer (Roots)", set: "RR", quantity: 1 },
      { name: "Repentance (Roots)", set: "RR", quantity: 1 },
      { name: "Swords to Plowshares (Roots)", set: "RR", quantity: 1 },
      { name: "Visions of Iddo the Seer (Roots)", set: "RR", quantity: 1 },
      { name: "David's Music [K]", set: "K", quantity: 1 },
      { name: "King Zimri (Roots)", set: "RR", quantity: 1 },
      { name: "King Zedekiah (Roots)", set: "RR", quantity: 1 },
      { name: "Adonijah, the Usurper (Roots)", set: "RR", quantity: 1 },
      { name: "Abner, the Commander (Roots)", set: "RR", quantity: 1 },
      { name: "Dungeon of Malchijah (Roots)", set: "RR", quantity: 1 },
      { name: "Haman's Plot (Roots)", set: "RR", quantity: 1 },
      { name: "Hunger (Roots)", set: "RR", quantity: 1 },
      { name: "Mask of Arrogance (Roots)", set: "RR", quantity: 1 },
      { name: "Cage (Roots)", set: "RR", quantity: 1 },
      { name: "Samuel's Edict [K]", set: "K", quantity: 1 },
      { name: "Consecration [K]", set: "K", quantity: 1 },
      { name: "Lost Soul [Exodus 12:33 - K]", set: "K", quantity: 5 },
    ],
  },];

/**
 * Content fingerprint of a deck: one `zone|name|set|quantity` line per distinct
 * card, sorted so row order never matters, with split rows for the same card
 * summed first. Built from RESOLVED cards, so a caller that submits a blank or
 * wrong set code still fingerprints against the card database's canonical
 * printing — the same list pasted as raw text checks out the same as the
 * stored deck.
 */
function fingerprint(
  cards: Pick<ResolvedCard, "name" | "set" | "quantity" | "isReserve">[]
): string {
  const totals = new Map<string, number>();
  for (const card of cards) {
    const key = `${card.isReserve ? "R" : "M"}|${card.name}|${card.set}`;
    totals.set(key, (totals.get(key) ?? 0) + card.quantity);
  }
  return Array.from(totals.entries())
    .map(([key, quantity]) => `${key}|${quantity}`)
    .sort()
    .join("\n");
}

// Built once at module load. The definitions carry the canonical name+set of
// every card, which is exactly what `resolveCard` produces for them.
const FINGERPRINTS = new Map<string, OfficialDeckDef>(
  OFFICIAL_DECKS.map((deck) => [
    fingerprint(deck.cards.map((c) => ({ ...c, isReserve: false }))),
    deck,
  ])
);

/** The official deck this exact card list is, or undefined if it is not one. */
export function matchOfficialDeck(
  cards: Pick<ResolvedCard, "name" | "set" | "quantity" | "isReserve">[]
): OfficialDeckDef | undefined {
  return FINGERPRINTS.get(fingerprint(cards));
}
