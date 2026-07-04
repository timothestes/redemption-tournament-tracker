// Pure LackeyCCG plugin-format helpers for the Forge set importer.
// CLIENT-SAFE: no server-only imports. Column conventions mirror scripts/parse-carddata.js.

import type { Brigade, CardType, DesignCard } from "./designCard";

export interface LackeyRow {
  name: string; set: string; imageFile: string; officialSet: string;
  type: string; brigade: string; strength: string; toughness: string;
  class: string; identifier: string; specialAbility: string;
  rarity: string; reference: string; alignment: string; legality: string;
}

const REQUIRED_COLUMNS = ["name", "set", "imagefile"];

export function parseCarddata(text: string): LackeyRow[] {
  const lines = text.split(/\r?\n/);
  const header = (lines[0] ?? "").split("\t").map((h) => h.trim().toLowerCase());
  for (const req of REQUIRED_COLUMNS) {
    if (!header.includes(req)) throw new Error(`carddata.txt is missing the "${req}" column`);
  }
  const col = (name: string) => header.indexOf(name);
  const c = {
    name: col("name"), set: col("set"), imageFile: col("imagefile"),
    officialSet: col("officialset"), type: col("type"), brigade: col("brigade"),
    strength: col("strength"), toughness: col("toughness"), class: col("class"),
    identifier: col("identifier"), specialAbility: col("specialability"),
    rarity: col("rarity"), reference: col("reference"),
    alignment: col("alignment"), legality: col("legality"),
  };
  const rows: LackeyRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split("\t");
    const get = (j: number) => (j >= 0 && j < parts.length ? parts[j].trim() : "");
    const name = get(c.name);
    if (!name) continue; // blank / malformed line
    rows.push({
      name,
      set: get(c.set),
      imageFile: get(c.imageFile).replace(/\.jpe?g$/i, ""),
      officialSet: get(c.officialSet),
      type: get(c.type),
      brigade: get(c.brigade),
      strength: get(c.strength),
      toughness: get(c.toughness),
      class: get(c.class),
      identifier: get(c.identifier),
      specialAbility: get(c.specialAbility),
      rarity: get(c.rarity),
      reference: get(c.reference),
      alignment: get(c.alignment),
      legality: get(c.legality),
    });
  }
  return rows;
}

// Exact (case-insensitive) match on Set or OfficialSet; /…/ is a case-insensitive regex.
export function matchesFilter(row: LackeyRow, filter: string): boolean {
  const f = filter.trim();
  if (!f) return false;
  const slashes = f.match(/^\/(.*)\/$/);
  if (slashes) {
    let re: RegExp;
    try { re = new RegExp(slashes[1], "i"); } catch { return false; }
    return re.test(row.set) || re.test(row.officialSet);
  }
  const lower = f.toLowerCase();
  return row.set.toLowerCase() === lower || row.officialSet.toLowerCase() === lower;
}

export function distinctSets(rows: LackeyRow[]): { set: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.set) continue;
    counts.set(r.set, (counts.get(r.set) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([set, count]) => ({ set, count }))
    .sort((a, b) => b.count - a.count || a.set.localeCompare(b.set));
}

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp"];

// Zip entries are prefixed by a variable root folder — match by path suffix.
export function findImageEntry(row: LackeyRow, entryNames: string[]): string | null {
  if (!row.imageFile) return null;
  const wanted = IMAGE_EXTS.map(
    (ext) => `sets/setimages/general/${row.imageFile}${ext}`.toLowerCase(),
  );
  for (const entry of entryNames) {
    const lower = entry.toLowerCase();
    if (wanted.some((w) => lower === w || lower.endsWith(`/${w}`))) return entry;
  }
  return null;
}

const TYPE_MAP: Record<string, CardType> = {
  "hero": "Hero", "evil character": "EvilCharacter",
  "ge": "GE", "good enhancement": "GE",
  "ee": "EE", "evil enhancement": "EE",
  "lost soul": "LostSoul", "artifact": "Artifact",
  "dominant": "Dominant", "evil dominant": "Dominant",
  "fortress": "Fortress", "site": "Site", "city": "City",
  "curse": "Curse", "covenant": "Covenant",
};

const BRIGADE_MAP: Record<string, Brigade> = {
  "blue": "Blue", "clay": "Clay", "good gold": "GoodGold", "green": "Green",
  "purple": "Purple", "silver": "Silver", "white": "White",
  "black": "Black", "brown": "Brown", "crimson": "Crimson", "gray": "Gray",
  "orange": "Orange", "pale green": "PaleGreen",
};

const LEGALITIES = ["Rotation", "Classic", "Scrolls", "Paragon", "Banned"];

// "Purple (Crimson)" → Purple, Crimson; "Crimson/Orange/Pale Green" → three values.
function splitMulti(value: string): string[] {
  const parens = [...value.matchAll(/\(([^)]+)\)/g)].flatMap((m) => m[1].split("/"));
  const base = value.replace(/\([^)]*\)/g, " ").split("/");
  return [...base, ...parens].map((s) => s.trim()).filter((s) => s && s !== "-");
}

function clean(v: string): string {
  const t = (v ?? "").trim();
  return t === "-" ? "" : t;
}

function parseStat(v: string): number | null {
  const t = clean(v);
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// Best-effort structured mapping; full fidelity lives in the finished-card image + rawText.
export function lackeyRowToDesignCard(row: LackeyRow): DesignCard {
  const card: DesignCard = { name: row.name };

  const rawText = clean(row.specialAbility);
  if (rawText) {
    card.rawText = rawText;        // what the studio textarea edits
    card.specialAbility = rawText; // what the Phase-2.2 deckbuilder reads
  }

  const types = [...new Set(
    splitMulti(row.type).map((t) => TYPE_MAP[t.toLowerCase()]).filter(Boolean),
  )] as CardType[];
  if (types.length) card.cardType = types;

  const brigades = [...new Set(
    splitMulti(row.brigade).map((b) => BRIGADE_MAP[b.toLowerCase()]).filter(Boolean),
  )] as Brigade[];
  if (brigades.length) card.brigades = brigades;

  const strength = parseStat(row.strength);
  if (strength !== null) card.strength = strength;
  const toughness = parseStat(row.toughness);
  if (toughness !== null) card.toughness = toughness;

  for (const part of splitMulti(row.class)) {
    const p = part.toLowerCase();
    if (p === "warrior") card.class = [...(card.class ?? []), "Warrior"];
    else if (p === "weapon") card.class = [...(card.class ?? []), "Weapon"];
    else if (p === "territory") card.icons = [...(card.icons ?? []), "Territory"];
    else if (p === "star") card.icons = [...(card.icons ?? []), "Star"];
    else if (p === "cloud") card.icons = [...(card.icons ?? []), "Cloud"];
  }

  const identifier = clean(row.identifier);
  if (identifier) {
    const ids = identifier.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length) card.identifiers = ids;
  }

  const alignment = clean(row.alignment).toLowerCase();
  if (alignment === "good") card.alignment = "Good";
  else if (alignment === "evil") card.alignment = "Evil";
  else if (alignment === "neutral") card.alignment = "Neutral";
  else if (alignment === "good/evil") card.alignment = "Good_Evil";

  const legality = clean(row.legality);
  if (LEGALITIES.includes(legality)) card.legality = legality as DesignCard["legality"];

  const rarity = clean(row.rarity);
  if (rarity) card.rarity = rarity;
  const reference = clean(row.reference);
  if (reference) card.reference = reference;

  return card;
}
