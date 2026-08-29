/**
 * Pure state model for the tier list maker.
 *
 * A tier list is an ordered list of rows plus one "unranked" pool. Every slot
 * holds a *card key* (`name|set`) rather than a card object, so the same model
 * serializes to localStorage and to a share URL without carrying card data
 * that `make update-cards` may re-generate underneath it.
 */

/** The unranked pool's row id. Never collides with a tier index key. */
export const POOL_ID = "pool";

/** `name|set` — the stable half of a card's `dataLine` (imgFile is art-print detail). */
export type CardKey = string;

export interface TierRow {
  /** Stable within one session; regenerated on decode. */
  id: string;
  label: string;
  /** Row header background. Fixed per position so light/dark both stay legible. */
  color: string;
}

export interface TierListState {
  tiers: TierRow[];
  /** row id (or POOL_ID) -> ordered card keys. Every tier id has an entry. */
  placements: Record<string, CardKey[]>;
}

/**
 * Classic red-to-violet S-to-F ramp — the hue order is genre convention and
 * carries meaning, so it stays. What's tuned is luminance: the six bands are
 * held within a 1.42x spread so no single row (the old yellow) out-glows the
 * rest, and every band clears 6:1 against the near-black tier letter. The C
 * green leans olive so it can never be mistaken for the app's primary/CTA green.
 */
export const TIER_COLORS = [
  "#de7b72", // S — red
  "#dea267", // A — orange
  "#cbaf57", // B — yellow
  "#8cb46a", // C — olive green
  "#6fa2ce", // D — blue
  "#9c92c8", // F — violet
] as const;

const DEFAULT_LABELS = ["S", "A", "B", "C", "D", "F"] as const;

export function colorForIndex(i: number): string {
  return TIER_COLORS[i % TIER_COLORS.length];
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `t${idCounter}`;
}

export function makeTier(label: string, index: number): TierRow {
  return { id: nextId(), label, color: colorForIndex(index) };
}

export function createDefaultState(): TierListState {
  const tiers = DEFAULT_LABELS.map((label, i) => makeTier(label, i));
  const placements: Record<string, CardKey[]> = { [POOL_ID]: [] };
  for (const t of tiers) placements[t.id] = [];
  return { tiers, placements };
}

export function cardKey(card: { name: string; set: string }): CardKey {
  return `${card.name}|${card.set}`;
}

/** Which row currently holds `key`, or null when it isn't placed anywhere. */
export function findContainer(state: TierListState, key: CardKey): string | null {
  for (const [rowId, keys] of Object.entries(state.placements)) {
    if (keys.includes(key)) return rowId;
  }
  return null;
}

/**
 * Move `key` into `toRow` at `toIndex` (appending when `toIndex` is omitted or
 * out of range), removing it from wherever it was. Returns a new state; the
 * input is never mutated.
 */
export function moveCard(
  state: TierListState,
  key: CardKey,
  toRow: string,
  toIndex?: number,
): TierListState {
  if (!(toRow in state.placements)) return state;

  const placements: Record<string, CardKey[]> = {};
  for (const [rowId, keys] of Object.entries(state.placements)) {
    placements[rowId] = keys.filter((k) => k !== key);
  }

  const target = placements[toRow];
  const at = toIndex === undefined || toIndex < 0 || toIndex > target.length ? target.length : toIndex;
  target.splice(at, 0, key);

  return { ...state, placements };
}

/** Add a card to the unranked pool. A card already on the board stays put. */
export function addToPool(state: TierListState, key: CardKey): TierListState {
  if (findContainer(state, key) !== null) return state;
  return {
    ...state,
    placements: { ...state.placements, [POOL_ID]: [...state.placements[POOL_ID], key] },
  };
}

/** Remove a card from the board entirely. */
export function removeCard(state: TierListState, key: CardKey): TierListState {
  const placements: Record<string, CardKey[]> = {};
  for (const [rowId, keys] of Object.entries(state.placements)) {
    placements[rowId] = keys.filter((k) => k !== key);
  }
  return { ...state, placements };
}

export function renameTier(state: TierListState, tierId: string, label: string): TierListState {
  return {
    ...state,
    tiers: state.tiers.map((t) => (t.id === tierId ? { ...t, label } : t)),
  };
}

/** Append a new empty tier at the bottom. */
export function addTier(state: TierListState): TierListState {
  const tier = makeTier("", state.tiers.length);
  return {
    tiers: [...state.tiers, tier],
    placements: { ...state.placements, [tier.id]: [] },
  };
}

/**
 * Drop a tier, returning its cards to the pool so nothing silently disappears.
 * The last remaining tier is never removed.
 */
export function removeTier(state: TierListState, tierId: string): TierListState {
  if (state.tiers.length <= 1) return state;
  const displaced = state.placements[tierId] ?? [];
  const placements = { ...state.placements };
  delete placements[tierId];
  placements[POOL_ID] = [...placements[POOL_ID], ...displaced];
  const tiers = state.tiers
    .filter((t) => t.id !== tierId)
    .map((t, i) => ({ ...t, color: colorForIndex(i) }));
  return { tiers, placements };
}

/** Empty every row but keep the tier labels the user set up. */
export function clearCards(state: TierListState): TierListState {
  const placements: Record<string, CardKey[]> = { [POOL_ID]: [] };
  for (const t of state.tiers) placements[t.id] = [];
  return { ...state, placements };
}

export function totalPlaced(state: TierListState): number {
  return state.tiers.reduce((n, t) => n + (state.placements[t.id]?.length ?? 0), 0);
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Wire shape. Deliberately terse — this rides in a query string, and a 40-card
 * list has to stay inside a URL people can paste into Discord.
 *   v: schema version   l: tier labels   r: rows (parallel to `l`)   u: unranked
 */
interface Serialized {
  v: 1;
  l: string[];
  r: CardKey[][];
  u: CardKey[];
}

export function toSerializable(state: TierListState): Serialized {
  return {
    v: 1,
    l: state.tiers.map((t) => t.label),
    r: state.tiers.map((t) => state.placements[t.id] ?? []),
    u: state.placements[POOL_ID] ?? [],
  };
}

export function fromSerializable(raw: unknown): TierListState | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<Serialized>;
  if (s.v !== 1 || !Array.isArray(s.l) || !Array.isArray(s.r)) return null;
  if (s.l.length === 0 || s.l.length !== s.r.length) return null;
  if (!s.l.every((x) => typeof x === "string")) return null;

  const isKeyList = (x: unknown): x is CardKey[] =>
    Array.isArray(x) && x.every((k) => typeof k === "string" && k.includes("|"));
  if (!s.r.every(isKeyList)) return null;
  const unranked = isKeyList(s.u) ? s.u : [];

  const tiers = s.l.map((label, i) => makeTier(label, i));
  const placements: Record<string, CardKey[]> = { [POOL_ID]: [...unranked] };
  tiers.forEach((t, i) => {
    placements[t.id] = [...s.r![i]];
  });

  // A key duplicated across rows would render the same card twice and break
  // drag identity — first occurrence wins, later ones are dropped.
  const seen = new Set<CardKey>();
  for (const t of tiers) {
    placements[t.id] = placements[t.id].filter((k) => !seen.has(k) && seen.add(k));
  }
  placements[POOL_ID] = placements[POOL_ID].filter((k) => !seen.has(k) && seen.add(k));

  return { tiers, placements };
}

/** UTF-8 safe base64url — card names carry apostrophes and accented letters. */
export function encodeShare(state: TierListState): string {
  const json = JSON.stringify(toSerializable(state));
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeShare(encoded: string): TierListState | null {
  try {
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return fromSerializable(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}
