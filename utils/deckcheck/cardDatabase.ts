const CARD_DATA_URL =
  "https://raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/carddata.txt";

export interface CardData {
  name: string;
  set: string;
  imgFile: string;
  officialSet: string;
  type: string;
  brigade: string;
  strength: string;
  toughness: string;
  class: string;
  identifier: string;
  specialAbility: string;
  rarity: string;
  reference: string;
  alignment: string;
  legality: string;
}

/**
 * Module-level cache so we only fetch once per server lifetime.
 */
let cachedDatabase: Map<string, CardData> | null = null;
let fetchPromise: Promise<Map<string, CardData>> | null = null;

/**
 * Fetch and parse the full Redemption card database TSV.
 * Returns a Map keyed by card name (case-preserved).
 *
 * Multiple cards can share the same name (different sets/printings).
 * The map stores the *last* entry encountered for each name, which is
 * typically the most recent printing. For exact set matching, use `findCard`.
 */
export async function getCardDatabase(): Promise<Map<string, CardData>> {
  if (cachedDatabase) return cachedDatabase;

  // Deduplicate concurrent calls during the initial fetch
  if (!fetchPromise) {
    fetchPromise = fetchAndParse();
  }

  cachedDatabase = await fetchPromise;
  return cachedDatabase;
}

async function fetchAndParse(): Promise<Map<string, CardData>> {
  const response = await fetch(CARD_DATA_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch card database: ${response.status} ${response.statusText}`
    );
  }

  const text = await response.text();
  const lines = text.split("\n");
  // First line is the header row; skip it
  const dataLines = lines.slice(1).filter((l) => l.trim());

  const cardMap = new Map<string, CardData>();

  for (const line of dataLines) {
    const cols = line.split("\t");

    const card: CardData = {
      name: cols[0] || "",
      set: cols[1] || "",
      imgFile: (cols[2] || "").replace(/\.jpe?g$/i, ""),
      officialSet: cols[3] || "",
      type: cols[4] || "",
      brigade: cols[5] || "",
      strength: cols[6] || "",
      toughness: cols[7] || "",
      class: cols[8] || "",
      identifier: cols[9] || "",
      specialAbility: cols[10] || "",
      rarity: cols[11] || "",
      reference: cols[12] || "",
      alignment: cols[14] || "",
      legality: cols[15] || "",
    };

    if (card.name) {
      cardMap.set(card.name, card);
    }
  }

  return cardMap;
}

/**
 * Case-insensitive card lookup.
 * If `set` is provided, prefer an exact name+set match; otherwise return
 * whichever entry matches the name.
 */
export async function findCard(
  name: string,
  set?: string
): Promise<CardData | undefined> {
  const db = await getCardDatabase();
  const nameLower = name.toLowerCase();

  // Fast path: exact case match
  const exact = db.get(name);
  if (exact) {
    if (!set || exact.set === set) return exact;
  }

  // Slow path: case-insensitive scan, collecting all name matches
  let fallback: CardData | undefined;

  for (const card of db.values()) {
    if (card.name.toLowerCase() !== nameLower) continue;

    // If a set was requested and this card matches it, return immediately
    if (set && card.set === set) return card;

    // Otherwise remember the first name match as a fallback
    if (!fallback) fallback = card;
  }

  return fallback;
}
