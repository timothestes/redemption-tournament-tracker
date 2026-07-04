# Forge Lackey Set Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Forge elder upload a LackeyCCG plugin zip, filter its `sets/carddata.txt` by set code (e.g. `EoT`), and populate a Forge set with those cards (full-card scans as private finished-card images) — plus fast set-grid rendering and a confirm-dialog on image-replace-without-field-edit.

**Architecture:** The zip (37MB, over Vercel's ~4.5MB request cap) is unpacked **in the browser** with fflate; carddata.txt is parsed/filtered client-side with a pure module; preview renders from zip bytes via object URLs; then one server action call per card (~200KB) composes **existing** definer RPCs (`forge_create_card` → `forge_save_card` → `forge_set_working_finished` → `forge_share_card_to_set`). Zero migrations, zero new RPCs, zero anon-leak surface change.

**Tech Stack:** Next.js 15 App Router, React 19, fflate ^0.8.3 (existing dep), Supabase RPCs behind RLS, private Vercel Blob via existing `app/forge/lib/art.ts`, Playwright e2e with service-role seeding.

**Spec:** `docs/superpowers/specs/2026-07-03-forge-lackey-set-import-design.md`

## Global Constraints

- Work in `/Users/timestes/projects/redemption-tournament-tracker` on branch `forge-lackey-set-import`. Use ABSOLUTE paths. IGNORE any sibling checkout under `.claude/worktrees/`.
- **NEVER commit anything from `tmp/`** (the real EoT zip lives there and is gitignored). Test fixtures must be fully synthetic — no real playtest card names/text.
- `tsconfig.json` has `strict: false` → discriminated-union narrowing via `if (r.ok)` is broken; always narrow with `r.ok === false`.
- Every `/forge` page must call `requireForge()`/`requireElder()` itself (the `forge-gate-first` vitest test enforces this on all `app/forge/**/page.tsx` + `route.ts`).
- No `next/image` under `app/forge/**` (`forge-no-next-image` test) — plain `<img>` only.
- Match existing Forge styling: Tailwind utilities, `text-muted-foreground`, `rounded-md border`, emerald accent for primary actions.
- Server-only blob keys must never reach the client; images are referenced only as `/forge/api/art/{cardId}` proxy URLs.
- Do not modify `FullModeForm.tsx` / `ForgeCardPreview.tsx` (kept-on-disk descope leftovers).

---

### Task 1: Pure Lackey parser/mapper (`lackey.ts`) — TDD

**Files:**
- Create: `app/forge/lib/lackey.ts`
- Test: `__tests__/forge-lackey.test.ts`

**Interfaces (later tasks rely on these exact names):**
```ts
export interface LackeyRow {
  name: string; set: string; imageFile: string; officialSet: string;
  type: string; brigade: string; strength: string; toughness: string;
  class: string; identifier: string; specialAbility: string;
  rarity: string; reference: string; alignment: string; legality: string;
}
export function parseCarddata(text: string): LackeyRow[];      // throws Error on missing header cols
export function matchesFilter(row: LackeyRow, filter: string): boolean;
export function distinctSets(rows: LackeyRow[]): { set: string; count: number }[];
export function findImageEntry(row: LackeyRow, entryNames: string[]): string | null;
export function lackeyRowToDesignCard(row: LackeyRow): DesignCard;
```

- [ ] **Step 1: Write the failing tests** — `__tests__/forge-lackey.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseCarddata, matchesFilter, distinctSets, findImageEntry, lackeyRowToDesignCard,
} from "@/app/forge/lib/lackey";

const HEADER =
  "Name\tSet\tImageFile\tOfficialSet\tType\tBrigade\tStrength\tToughness\tClass\tIdentifier\tSpecialAbility\tRarity\tReference\tSound\tAlignment\tLegality";

function row(overrides: Partial<Record<string, string>> = {}): string {
  const cols: Record<string, string> = {
    Name: "Test Hero", Set: "TST", ImageFile: "Test-Hero", OfficialSet: "Test Set",
    Type: "Hero", Brigade: "Silver", Strength: "9", Toughness: "9", Class: "Warrior",
    Identifier: "-", SpecialAbility: "Test ability.", Rarity: "-",
    Reference: "Genesis 1:1", Sound: "-", Alignment: "Good", Legality: "Rotation",
    ...overrides,
  };
  return [
    cols.Name, cols.Set, cols.ImageFile, cols.OfficialSet, cols.Type, cols.Brigade,
    cols.Strength, cols.Toughness, cols.Class, cols.Identifier, cols.SpecialAbility,
    cols.Rarity, cols.Reference, cols.Sound, cols.Alignment, cols.Legality,
  ].join("\t");
}

describe("parseCarddata", () => {
  it("parses rows from a headered TSV", () => {
    const rows = parseCarddata([HEADER, row()].join("\n"));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Test Hero");
    expect(rows[0].set).toBe("TST");
    expect(rows[0].imageFile).toBe("Test-Hero");
    expect(rows[0].specialAbility).toBe("Test ability.");
  });
  it("tolerates CRLF, trailing tabs, and skips blank/nameless lines", () => {
    const text = [HEADER, row() + "\t\t\t\t", "", "\t\t\t"].join("\r\n");
    expect(parseCarddata(text)).toHaveLength(1);
  });
  it("strips .jpg/.jpeg from ImageFile", () => {
    const rows = parseCarddata([HEADER, row({ ImageFile: "Test-Hero.JPG" })].join("\n"));
    expect(rows[0].imageFile).toBe("Test-Hero");
  });
  it("throws when required columns are missing", () => {
    expect(() => parseCarddata("Foo\tBar\nx\ty")).toThrow(/missing/i);
  });
});

describe("matchesFilter", () => {
  const r = parseCarddata([HEADER, row()].join("\n"))[0];
  it("matches Set exactly, case-insensitively", () => {
    expect(matchesFilter(r, "tst")).toBe(true);
    expect(matchesFilter(r, "TS")).toBe(false);
  });
  it("matches OfficialSet exactly", () => {
    expect(matchesFilter(r, "test set")).toBe(true);
  });
  it("supports /regex/ against Set and OfficialSet", () => {
    expect(matchesFilter(r, "/^ts/")).toBe(true);
    expect(matchesFilter(r, "/^zz/")).toBe(false);
  });
  it("invalid regex and empty filter match nothing", () => {
    expect(matchesFilter(r, "/[/")).toBe(false);
    expect(matchesFilter(r, "  ")).toBe(false);
  });
});

describe("distinctSets", () => {
  it("counts by Set column, sorted by count desc then name", () => {
    const rows = parseCarddata([
      HEADER, row({ Name: "A" }), row({ Name: "B" }), row({ Name: "C", Set: "ZZZ" }),
    ].join("\n"));
    expect(distinctSets(rows)).toEqual([
      { set: "TST", count: 2 }, { set: "ZZZ", count: 1 },
    ]);
  });
});

describe("findImageEntry", () => {
  const r = parseCarddata([HEADER, row()].join("\n"))[0];
  const entries = [
    "Test Plugin V1/sets/setimages/general/Test-Hero.jpg",
    "Test Plugin V1/sets/setimages/general/Another-Test-Hero.jpg",
    "Test Plugin V1/packs/Test-Hero.jpg",
  ];
  it("finds the image under sets/setimages/general at any depth, case-insensitively", () => {
    expect(findImageEntry(r, entries)).toBe("Test Plugin V1/sets/setimages/general/Test-Hero.jpg");
    expect(findImageEntry({ ...r, imageFile: "test-hero" }, entries))
      .toBe("Test Plugin V1/sets/setimages/general/Test-Hero.jpg");
  });
  it("does not suffix-match a longer filename or other dirs", () => {
    expect(findImageEntry({ ...r, imageFile: "Hero" }, entries)).toBeNull();
  });
  it("returns null when missing or imageFile empty", () => {
    expect(findImageEntry({ ...r, imageFile: "Nope" }, entries)).toBeNull();
    expect(findImageEntry({ ...r, imageFile: "" }, entries)).toBeNull();
  });
});

describe("lackeyRowToDesignCard", () => {
  const parse = (o: Partial<Record<string, string>>) =>
    lackeyRowToDesignCard(parseCarddata([HEADER, row(o)].join("\n"))[0]);

  it("maps a full hero row", () => {
    const c = parse({});
    expect(c.name).toBe("Test Hero");
    expect(c.rawText).toBe("Test ability.");
    expect(c.specialAbility).toBe("Test ability.");
    expect(c.cardType).toEqual(["Hero"]);
    expect(c.brigades).toEqual(["Silver"]);
    expect(c.strength).toBe(9);
    expect(c.toughness).toBe(9);
    expect(c.class).toEqual(["Warrior"]);
    expect(c.alignment).toBe("Good");
    expect(c.legality).toBe("Rotation");
    expect(c.reference).toBe("Genesis 1:1");
    expect(c.rarity).toBeUndefined();
    expect(c.identifiers).toBeUndefined();
  });
  it("maps long-form and dual types", () => {
    expect(parse({ Type: "Evil Character" }).cardType).toEqual(["EvilCharacter"]);
    expect(parse({ Type: "Good Enhancement / Evil Enhancement" }).cardType).toEqual(["GE", "EE"]);
    expect(parse({ Type: "GE/EE" }).cardType).toEqual(["GE", "EE"]);
    expect(parse({ Type: "Lost Soul" }).cardType).toEqual(["LostSoul"]);
    expect(parse({ Type: "Evil Dominant / Artifact" }).cardType).toEqual(["Dominant", "Artifact"]);
    expect(parse({ Type: "Weird Unknown" }).cardType).toBeUndefined();
  });
  it("maps multi and parenthetical brigades, dropping unknowns", () => {
    expect(parse({ Brigade: "Pale Green" }).brigades).toEqual(["PaleGreen"]);
    expect(parse({ Brigade: "Good Gold" }).brigades).toEqual(["GoodGold"]);
    expect(parse({ Brigade: "Crimson/Orange/Pale Green" }).brigades).toEqual(["Crimson", "Orange", "PaleGreen"]);
    expect(parse({ Brigade: "Purple (Crimson)" }).brigades).toEqual(["Purple", "Crimson"]);
    expect(parse({ Brigade: "Red" }).brigades).toBeUndefined();
    expect(parse({ Brigade: "-" }).brigades).toBeUndefined();
  });
  it("maps '-' stats to absent and Territory class to icons", () => {
    const c = parse({ Strength: "-", Toughness: "", Class: "Territory" });
    expect(c.strength).toBeUndefined();
    expect(c.toughness).toBeUndefined();
    expect(c.class).toBeUndefined();
    expect(c.icons).toEqual(["Territory"]);
  });
  it("maps alignments incl. Good/Evil and splits identifiers", () => {
    expect(parse({ Alignment: "Good/Evil" }).alignment).toBe("Good_Evil");
    expect(parse({ Alignment: "Neutral" }).alignment).toBe("Neutral");
    expect(parse({ Identifier: "Demon, Giant" }).identifiers).toEqual(["Demon", "Giant"]);
  });
  it("omits unknown legality and '-' fields", () => {
    const c = parse({ Legality: "Whatever", SpecialAbility: "-", Reference: "-" });
    expect(c.legality).toBeUndefined();
    expect(c.rawText).toBeUndefined();
    expect(c.specialAbility).toBeUndefined();
    expect(c.reference).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run __tests__/forge-lackey.test.ts`
Expected: FAIL — module `app/forge/lib/lackey.ts` not found.

- [ ] **Step 3: Implement `app/forge/lib/lackey.ts`**

```ts
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
```

Note: check `app/forge/lib/designCard.ts` for the exact exported type names (`DesignCard`, `CardType`, `Brigade`) before writing imports; adjust if the export names differ.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run __tests__/forge-lackey.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add app/forge/lib/lackey.ts __tests__/forge-lackey.test.ts
git commit -m "feat(forge): pure Lackey carddata parser/filter/DesignCard mapper"
```

---

### Task 2: Import server action (`importSet.ts`)

**Files:**
- Create: `app/forge/lib/importSet.ts`

**Interfaces:**
- Consumes: `requireElder` (auth.ts), `uploadForgeFinished`/`validateArtFile` (art.ts), `DesignCard`.
- Produces (Task 3 + Task 6 depend on this exact shape):
```ts
export interface ImportCardInput { name: string; snapshot: DesignCard; }
export type ImportCardResult =
  | { ok: true; cardId: string; skipped: boolean }
  | { ok: false; error: string };
export async function importLackeyCard(
  setId: string, input: ImportCardInput, formData: FormData,
): Promise<ImportCardResult>;
```

- [ ] **Step 1: Implement `app/forge/lib/importSet.ts`**

```ts
"use server";

// Lackey set import: creates one Forge card from a parsed carddata row + optional
// finished-card image. Elder-gated; every write goes through the existing SECURITY
// DEFINER RPCs, which re-check authorization — same trust model as cards.ts.

import { revalidatePath } from "next/cache";
import { requireElder } from "./auth";
import { uploadForgeFinished, validateArtFile } from "./art";
import type { DesignCard } from "./designCard";

const MAX_NAME_LENGTH = 200;
const MAX_SNAPSHOT_BYTES = 32_000; // forge_save_card enforces 64KB; fail earlier & clearer

export interface ImportCardInput { name: string; snapshot: DesignCard; }
export type ImportCardResult =
  | { ok: true; cardId: string; skipped: boolean }
  | { ok: false; error: string };

export async function importLackeyCard(
  setId: string,
  input: ImportCardInput,
  formData: FormData,
): Promise<ImportCardResult> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not available" };

  const name = (input?.name ?? "").trim();
  if (!name || name.length > MAX_NAME_LENGTH) return { ok: false, error: "Invalid card name" };

  let snapshotBytes = 0;
  try {
    snapshotBytes = new TextEncoder().encode(JSON.stringify(input.snapshot ?? {})).length;
  } catch {
    return { ok: false, error: "Invalid card data" };
  }
  if (snapshotBytes > MAX_SNAPSHOT_BYTES) return { ok: false, error: "Card data too large" };

  const file = formData.get("file");
  if (file !== null && !(file instanceof File)) return { ok: false, error: "Invalid image" };
  if (file) {
    const invalid = validateArtFile(file);
    if (invalid) return { ok: false, error: invalid };
  }

  // Idempotency: a card with this title already in the target set → skip (safe re-runs).
  const { data: existing, error: existErr } = await ctx.supabase
    .from("forge_cards")
    .select("id")
    .eq("set_id", setId)
    .eq("title", name)
    .limit(1);
  if (existErr) return { ok: false, error: existErr.message };
  if (existing && existing.length > 0) {
    return { ok: true, cardId: existing[0].id as string, skipped: true };
  }

  const { data: cardId, error: createErr } = await ctx.supabase
    .rpc("forge_create_card", { p_title: name });
  if (createErr || !cardId) {
    return { ok: false, error: createErr?.message ?? "Failed to create card" };
  }

  const { error: saveErr } = await ctx.supabase
    .rpc("forge_save_card", { p_card_id: cardId, p_snapshot: input.snapshot ?? {} });
  if (saveErr) return { ok: false, error: saveErr.message };

  if (file) {
    let key: string;
    try {
      key = await uploadForgeFinished(file);
    } catch {
      return { ok: false, error: "Image upload failed" };
    }
    const { error: artErr } = await ctx.supabase
      .rpc("forge_set_working_finished", { p_card_id: cardId, p_key: key });
    if (artErr) return { ok: false, error: artErr.message };
  }

  const { error: shareErr } = await ctx.supabase
    .rpc("forge_share_card_to_set", { p_card_id: cardId, p_set_id: setId });
  if (shareErr) return { ok: false, error: shareErr.message };

  revalidatePath(`/forge/sets/${setId}/cards`);
  return { ok: true, cardId: cardId as string, skipped: false };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep -i importSet || echo OK`
Expected: `OK` (no importSet errors; ignore pre-existing unrelated errors elsewhere).

- [ ] **Step 3: Commit**

```bash
git add app/forge/lib/importSet.ts
git commit -m "feat(forge): elder-gated per-card Lackey import server action (existing RPCs only)"
```

---

### Task 3: `/forge/import` page + ImportWizard + entry link

**Files:**
- Create: `app/forge/import/page.tsx`
- Create: `app/forge/import/ImportWizard.tsx`
- Modify: `app/forge/sets/page.tsx` (add "Import a set" link for elders)

**Interfaces:**
- Consumes: everything from Tasks 1–2, `createSet`/`listSets` + `ForgeSetSummary` from `app/forge/lib/sets.ts`, `unzipSync` from fflate.
- Produces: UI labels the e2e spec (Task 6) selects on — keep these EXACT:
  - zip input: `aria-label="Lackey zip file"`
  - filter input: `aria-label="Set filter"`, placeholder `Set code, e.g. EoT — or /regex/`
  - match count line: `{n} cards match` (`1 card matches` for n=1)
  - destination radios: labels `Create a new set` / `Add to an existing set`
  - new-set name input: `aria-label="New set name"`
  - import button text: `Import {n} cards` (disabled while running)
  - per-card statuses rendered as text: `queued` / `importing` / `imported` / `skipped` / `failed: {error}`
  - summary line: `Imported {a} · Skipped {b} · Failed {c}`
  - post-import link: `View set →` href `/forge/sets/{setId}/cards`

- [ ] **Step 1: Create `app/forge/import/page.tsx`**

```tsx
import { notFound, redirect } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { listSets } from "@/app/forge/lib/sets";
import ImportWizard from "./ImportWizard";

export const metadata = { title: "Import a set — The Forge" };

export default async function ForgeImportPage() {
  const ctx = await requireForge();
  if (!ctx) notFound(); // non-members must not learn this exists
  if (ctx.role === "playtester") redirect("/forge/play");
  const sets = await listSets();
  return <ImportWizard sets={sets} />;
}
```

- [ ] **Step 2: Create `app/forge/import/ImportWizard.tsx`**

```tsx
"use client";

// Lackey zip import wizard. The zip NEVER goes to the server (37MB > Vercel's ~4.5MB
// request cap): fflate unpacks it in the browser, carddata.txt is parsed/filtered
// locally, preview renders from zip bytes, and only the matched cards (each ~200KB)
// are sent — one importLackeyCard server-action call per card, concurrency 3.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { unzipSync } from "fflate";
import {
  parseCarddata, matchesFilter, distinctSets, findImageEntry,
  lackeyRowToDesignCard, type LackeyRow,
} from "@/app/forge/lib/lackey";
import { importLackeyCard } from "@/app/forge/lib/importSet";
import { createSet, type ForgeSetSummary } from "@/app/forge/lib/sets";

const CONCURRENCY = 3;

type CardStatus = "queued" | "importing" | "imported" | "skipped" | "failed";
interface ImportItem {
  row: LackeyRow;
  entryName: string | null; // zip entry for the finished-card image, if present
  status: CardStatus;
  error?: string;
}

function mimeFor(entryName: string): string {
  const lower = entryName.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function baseName(entryName: string): string {
  return entryName.split("/").pop() ?? entryName;
}

export default function ImportWizard({ sets }: { sets: ForgeSetSummary[] }) {
  const zipBytes = useRef<Uint8Array | null>(null);
  const [zipName, setZipName] = useState<string | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);
  const [rows, setRows] = useState<LackeyRow[] | null>(null);
  const [entryNames, setEntryNames] = useState<string[]>([]);

  const [filter, setFilter] = useState("");
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [newSetName, setNewSetName] = useState("");
  const [existingSetId, setExistingSetId] = useState(sets[0]?.id ?? "");

  const [items, setItems] = useState<ImportItem[] | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [doneSetId, setDoneSetId] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Map<string, string>>(new Map());

  async function onPickZip(file: File) {
    setZipError(null); setRows(null); setItems(null); setDoneSetId(null); setFilter("");
    setZipName(file.name);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      zipBytes.current = bytes;
      // Single pass: collect every entry name, decompress ONLY carddata.txt.
      const names: string[] = [];
      const unzipped = unzipSync(bytes, {
        filter: (f) => {
          if (!f.name.endsWith("/")) names.push(f.name);
          return f.name.toLowerCase().endsWith("sets/carddata.txt");
        },
      });
      const carddataEntry = Object.keys(unzipped)[0];
      if (!carddataEntry) {
        setZipError("No sets/carddata.txt found in this zip — is it a Lackey plugin export?");
        return;
      }
      const text = new TextDecoder("utf-8").decode(unzipped[carddataEntry]);
      setRows(parseCarddata(text));
      setEntryNames(names);
    } catch (e) {
      setZipError(e instanceof Error ? e.message : "Could not read this zip file.");
    }
  }

  const matched = useMemo(
    () => (rows ?? []).filter((r) => matchesFilter(r, filter)),
    [rows, filter],
  );
  const zipSets = useMemo(() => distinctSets(rows ?? []), [rows]);

  // Changing the filter starts a fresh selection — clear any previous run.
  function onFilterChange(value: string) {
    setFilter(value);
    setItems(null);
    setDoneSetId(null);
    setRunError(null);
  }
  const invalidRegex = useMemo(() => {
    const m = filter.trim().match(/^\/(.*)\/$/);
    if (!m) return false;
    try { new RegExp(m[1], "i"); return false; } catch { return true; }
  }, [filter]);

  // Decompress matched images once per filter change; expose object URLs for preview.
  useEffect(() => {
    if (!zipBytes.current || matched.length === 0) { setPreviews(new Map()); return; }
    const wanted = new Set(
      matched.map((r) => findImageEntry(r, entryNames)).filter(Boolean) as string[],
    );
    const files = unzipSync(zipBytes.current, { filter: (f) => wanted.has(f.name) });
    const urls = new Map<string, string>();
    for (const [name, bytes] of Object.entries(files)) {
      urls.set(name, URL.createObjectURL(new Blob([bytes.slice()], { type: mimeFor(name) })));
    }
    setPreviews(urls);
    return () => { for (const u of urls.values()) URL.revokeObjectURL(u); };
  }, [matched, entryNames]);

  // Prefill the new-set name with the (non-regex) filter value.
  useEffect(() => {
    if (filter && !filter.startsWith("/")) setNewSetName(filter.trim());
  }, [filter]);

  async function runImport() {
    if (running || matched.length === 0) return;
    setRunError(null);
    setRunning(true);
    try {
      let setId = existingSetId;
      if (mode === "new") {
        const name = newSetName.trim();
        if (!name) { setRunError("Name the new set first."); return; }
        const r = await createSet(name);
        if (r.ok === false) { setRunError(r.error); return; }
        setId = r.id;
      }
      if (!setId) { setRunError("Pick a destination set."); return; }

      const work: ImportItem[] = matched.map((row) => ({
        row, entryName: findImageEntry(row, entryNames), status: "queued" as CardStatus,
      }));
      setItems([...work]);

      const bytes = zipBytes.current!;
      const wanted = new Set(work.map((w) => w.entryName).filter(Boolean) as string[]);
      const images = unzipSync(bytes, { filter: (f) => wanted.has(f.name) });

      let cursor = 0;
      const runOne = async () => {
        for (;;) {
          const i = cursor++;
          if (i >= work.length) return;
          work[i].status = "importing";
          setItems([...work]);
          try {
            const fd = new FormData();
            const entry = work[i].entryName;
            if (entry && images[entry]) {
              fd.set("file", new File([images[entry].slice()], baseName(entry), { type: mimeFor(entry) }));
            }
            const r = await importLackeyCard(setId, {
              name: work[i].row.name,
              snapshot: lackeyRowToDesignCard(work[i].row),
            }, fd);
            if (r.ok === false) {
              work[i].status = "failed"; work[i].error = r.error;
            } else {
              work[i].status = r.skipped ? "skipped" : "imported";
            }
          } catch (e) {
            work[i].status = "failed";
            work[i].error = e instanceof Error ? e.message : "Unexpected error";
          }
          setItems([...work]);
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, runOne));
      setDoneSetId(setId);
    } finally {
      setRunning(false);
    }
  }

  async function retryFailed() {
    if (!items || !doneSetId || running) return;
    setRunning(true);
    try {
      const bytes = zipBytes.current!;
      const failed = items.map((it, i) => [it, i] as const).filter(([it]) => it.status === "failed");
      const wanted = new Set(failed.map(([it]) => it.entryName).filter(Boolean) as string[]);
      const images = unzipSync(bytes, { filter: (f) => wanted.has(f.name) });
      for (const [it, i] of failed) {
        items[i] = { ...it, status: "importing", error: undefined };
        setItems([...items]);
        const fd = new FormData();
        if (it.entryName && images[it.entryName]) {
          fd.set("file", new File([images[it.entryName].slice()], baseName(it.entryName), { type: mimeFor(it.entryName) }));
        }
        const r = await importLackeyCard(doneSetId, {
          name: it.row.name, snapshot: lackeyRowToDesignCard(it.row),
        }, fd);
        if (r.ok === false) items[i] = { ...it, status: "failed", error: r.error };
        else items[i] = { ...it, status: r.skipped ? "skipped" : "imported" };
        setItems([...items]);
      }
    } finally {
      setRunning(false);
    }
  }

  const counts = useMemo(() => {
    const c = { imported: 0, skipped: 0, failed: 0 };
    for (const it of items ?? []) {
      if (it.status === "imported") c.imported++;
      else if (it.status === "skipped") c.skipped++;
      else if (it.status === "failed") c.failed++;
    }
    return c;
  }, [items]);
  const finished = !!items && !running && items.every((it) =>
    it.status === "imported" || it.status === "skipped" || it.status === "failed");

  return (
    <div className="mx-auto max-w-4xl p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Import a set</h1>
        <Link href="/forge/sets" className="text-sm text-muted-foreground hover:underline">← Sets</Link>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Upload a Lackey plugin zip. It’s unpacked in your browser — only the cards you
        select are uploaded, privately, to the Forge.
      </p>

      {/* 1 — zip */}
      <fieldset className="rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">1 · Lackey zip</legend>
        <input type="file" accept=".zip,application/zip" aria-label="Lackey zip file"
          className="block w-full text-xs"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickZip(f); e.target.value = ""; }} />
        {zipName && !zipError && rows && (
          <p className="mt-2 text-xs text-muted-foreground">
            {zipName} — {rows.length} cards across {zipSets.length} sets.
          </p>
        )}
        {zipError && <p className="mt-2 text-xs text-red-500">{zipError}</p>}
      </fieldset>

      {/* 2 — filter */}
      {rows && (
        <fieldset className="mt-4 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">2 · Which set?</legend>
          <div className="mb-2 flex flex-wrap gap-1">
            {zipSets.slice(0, 12).map(({ set, count }) => (
              <button key={set} type="button" onClick={() => onFilterChange(set)}
                className={`rounded-full border px-2 py-0.5 text-xs ${filter === set ? "border-emerald-600 bg-emerald-600/10" : "hover:bg-muted"}`}>
                {set} <span className="text-muted-foreground">({count})</span>
              </button>
            ))}
          </div>
          <input value={filter} onChange={(e) => onFilterChange(e.target.value)}
            aria-label="Set filter" placeholder="Set code, e.g. EoT — or /regex/"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          {invalidRegex && <p className="mt-1 text-xs text-red-500">Invalid regular expression.</p>}
          <p className="mt-2 text-sm">
            {matched.length === 1 ? "1 card matches" : `${matched.length} cards match`}
            {matched.length > 0 && (
              <span className="text-muted-foreground">
                {" "}· {matched.filter((r) => !findImageEntry(r, entryNames)).length} without an image
              </span>
            )}
          </p>
        </fieldset>
      )}

      {/* 3 — preview */}
      {matched.length > 0 && !items && (
        <fieldset className="mt-4 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">3 · Preview</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {matched.map((r) => {
              const entry = findImageEntry(r, entryNames);
              const url = entry ? previews.get(entry) : null;
              return (
                <div key={`${r.name}|${r.imageFile}`}>
                  <div className="relative w-full overflow-hidden rounded-md border bg-muted/30" style={{ aspectRatio: "2.5 / 3.5" }}>
                    {url ? (
                      <img src={url} alt={r.name} loading="lazy" decoding="async"
                        className="absolute inset-0 h-full w-full object-contain" />
                    ) : (
                      <div className="flex h-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
                        No image
                      </div>
                    )}
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{r.name}</p>
                </div>
              );
            })}
          </div>
        </fieldset>
      )}

      {/* 4 — destination + run (hidden once a run starts; filter change resets) */}
      {matched.length > 0 && !items && (
        <fieldset className="mt-4 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">4 · Destination</legend>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="dest" checked={mode === "new"} onChange={() => setMode("new")} />
              Create a new set
            </label>
            {mode === "new" && (
              <input value={newSetName} onChange={(e) => setNewSetName(e.target.value)}
                aria-label="New set name" placeholder="Set name"
                className="ml-6 w-64 rounded-md border bg-background px-2 py-1 text-sm" />
            )}
            <label className="flex items-center gap-2">
              <input type="radio" name="dest" checked={mode === "existing"} onChange={() => setMode("existing")}
                disabled={sets.length === 0} />
              Add to an existing set
            </label>
            {mode === "existing" && (
              <select value={existingSetId} onChange={(e) => setExistingSetId(e.target.value)}
                aria-label="Existing set" className="ml-6 w-64 rounded-md border bg-background px-2 py-1 text-sm">
                {sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </div>
          {runError && <p className="mt-2 text-sm text-red-500">{runError}</p>}
          <button type="button" onClick={runImport} disabled={running || matched.length === 0}
            className="mt-3 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {matched.length === 1 ? "Import 1 card" : `Import ${matched.length} cards`}
          </button>
        </fieldset>
      )}

      {/* 5 — progress + summary */}
      {items && (
        <fieldset className="mt-4 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">5 · Import</legend>
          <p className="text-sm">
            Imported {counts.imported} · Skipped {counts.skipped} · Failed {counts.failed}
          </p>
          {finished && counts.failed > 0 && (
            <button type="button" onClick={retryFailed}
              className="mt-2 rounded-md border px-3 py-1 text-xs">Retry failed</button>
          )}
          {finished && doneSetId && (
            <Link href={`/forge/sets/${doneSetId}/cards`}
              className="mt-2 block text-sm text-emerald-600 hover:underline">
              View set →
            </Link>
          )}
          <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto text-xs">
            {items.map((it, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="truncate">{it.row.name}</span>
                <span className={
                  it.status === "failed" ? "text-red-500"
                    : it.status === "imported" ? "text-emerald-600"
                    : "text-muted-foreground"
                }>
                  {it.status === "failed" ? `failed: ${it.error ?? "unknown"}` : it.status}
                </span>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
    </div>
  );
}
```

Notes for the implementer:
- `bytes.slice()` when constructing `Blob`/`File` detaches a copy — needed because fflate returns views into a shared buffer.
- If `createSet`'s success shape differs (check `app/forge/lib/sets.ts`), adapt the `r.ok === false` / `r.id` usage — but keep `=== false` narrowing.
- Keep every label/text listed under **Interfaces** byte-exact; the e2e spec selects on them.

- [ ] **Step 3: Add the entry link on `/forge/sets`**

Read `app/forge/sets/page.tsx` and add, next to the existing "create set" affordance (match its styling and placement conventions):

```tsx
<Link href="/forge/import" className="rounded-md border px-3 py-1 text-sm hover:bg-muted">
  Import a set
</Link>
```

The sets page already redirects playtesters, so no extra gating is needed on the link.

- [ ] **Step 4: Verify build + gate test**

Run: `npx vitest run __tests__/forge-gate-first.test.ts && npm run build`
Expected: gate test passes (the new page calls `requireForge()` first); build clean.

- [ ] **Step 5: Commit**

```bash
git add app/forge/import app/forge/sets/page.tsx
git commit -m "feat(forge): /forge/import Lackey zip wizard (client-side unzip, per-card upload)"
```

---

### Task 4: Fast set preview — art-proxy browser caching + lazy grid

**Files:**
- Modify: `app/forge/api/art/[cardId]/route.ts` (Cache-Control branch)
- Modify: `app/forge/components/ForgeCardFace.tsx` (lazy imgs)
- Modify: `app/forge/components/ForgeCardGrid.tsx` (cache-busted URLs)

**Interfaces:**
- Produces: proxy honors `?t=<any>` → `Cache-Control: private, max-age=31536000, immutable` (never for downloads). Grid URLs: `/forge/api/art/{id}?kind=finished&t={Date.parse(updatedAt) || 0}`.

- [ ] **Step 1: Proxy caching branch** — in `app/forge/api/art/[cardId]/route.ts`, replace the headers block:

```ts
  // `t` is a cache-buster derived from forge_cards.updated_at (bumped on every image/
  // snapshot write), so a `t`-stamped response can be cached by the member's OWN browser
  // indefinitely. `private` forbids shared/CDN caches; auth + RLS above are unchanged.
  const cacheable = !download && url.searchParams.get("t") !== null;
  const headers = new Headers({
    "Content-Type": result.blob.contentType,
    "Cache-Control": cacheable ? "private, max-age=31536000, immutable" : "private, no-store",
  });
```

(The existing `download` const is currently declared after the blob read — reuse it; just ensure the `url` variable from the top of the handler is in scope.)

- [ ] **Step 2: Lazy images in `ForgeCardFace.tsx`** — add `loading="lazy" decoding="async"` to the `<img>` element(s) rendered by the `Img` helper / face markup.

- [ ] **Step 3: Cache-busted URLs in `ForgeCardGrid.tsx`**:

```tsx
{cards.map((c) => {
  const t = Date.parse(c.updatedAt) || 0;
  return (
    <Link key={c.id} href={`/forge/cards/${c.id}`} className="block transition hover:opacity-90">
      <ForgeCardFace
        name={c.snapshot.name ?? null}
        rawText={cardRawText(c.snapshot)}
        finishedUrl={c.hasFinished ? `/forge/api/art/${c.id}?kind=finished&t=${t}` : null}
        artUrl={c.hasArt ? `/forge/api/art/${c.id}?t=${t}` : null}
      />
      …existing footer unchanged…
    </Link>
  );
})}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run __tests__/forge-gate-first.test.ts __tests__/forge-no-next-image.test.ts && npx tsc --noEmit 2>&1 | grep -Ei "forge/(api|components)" || echo OK`
Expected: tests pass, `OK`.

- [ ] **Step 5: Commit**

```bash
git add "app/forge/api/art/[cardId]/route.ts" app/forge/components/ForgeCardFace.tsx app/forge/components/ForgeCardGrid.tsx
git commit -m "perf(forge): browser-cache t-stamped private art + lazy grid images"
```

---

### Task 5: StudioEditor — image-replace confirm dialog + cache-busted previews

**Files:**
- Modify: `app/forge/cards/[cardId]/StudioEditor.tsx`

**Interfaces:**
- Produces (e2e may assert): confirm dialog heading text `Replace image without updating the card fields?`, buttons `Replace anyway` / `Cancel`.

- [ ] **Step 1: Track field edits + intercept finished-image replacement**

In `StudioEditor.tsx`:

```tsx
const fieldsDirty = useRef(false);
const [pendingFinished, setPendingFinished] = useState<File | null>(null);

const update = (patch: Partial<DesignCard>) => {
  fieldsDirty.current = true;
  setSnapshot((s) => ({ ...s, ...patch }));
};
```

Change the finished-card file input's `onChange`:

```tsx
onChange={(e) => {
  const f = e.target.files?.[0];
  if (f) {
    // Replacing an existing finished image without touching any field this session
    // usually means the printed ability text changed — confirm before overwriting.
    if (card.hasFinished && !fieldsDirty.current) setPendingFinished(f);
    else onUpload(f, "finished");
  }
  e.target.value = "";
}}
```

Below the finished-card fieldset's file input, render the inline dialog:

```tsx
{pendingFinished && (
  <div role="alertdialog" className="mt-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-xs">
    <p className="font-medium">Replace image without updating the card fields?</p>
    <p className="mt-1 text-muted-foreground">
      You’re replacing the finished card image but haven’t changed any card fields this
      session. If the new image changed the ability text, update the fields to match.
    </p>
    <div className="mt-2 flex gap-2">
      <button type="button"
        onClick={() => { const f = pendingFinished; setPendingFinished(null); if (f) onUpload(f, "finished"); }}
        className="rounded-md bg-amber-600 px-3 py-1 font-medium text-white">
        Replace anyway
      </button>
      <button type="button" onClick={() => setPendingFinished(null)} className="rounded-md border px-2 py-1">
        Cancel
      </button>
    </div>
  </div>
)}
```

- [ ] **Step 2: Cache-busted studio face URLs** — in the `<ForgeCardFace>` call:

```tsx
const t = Date.parse(card.updatedAt) || 0;
…
finishedUrl={card.hasFinished ? `/forge/api/art/${card.id}?kind=finished&t=${t}` : null}
artUrl={card.hasArt ? `/forge/api/art/${card.id}?t=${t}` : null}
```

(After an upload, `router.refresh()` delivers a new `updatedAt`, so the face swaps to the fresh image immediately.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit 2>&1 | grep -i StudioEditor || echo OK`
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add "app/forge/cards/[cardId]/StudioEditor.tsx"
git commit -m "feat(forge): confirm dialog when replacing finished image without field edits"
```

---

### Task 6: Playwright e2e — seed helpers, synthetic fixture, import spec

**Files:**
- Create: `e2e/forge/forgeSeed.ts`
- Create: `e2e/forge/lackeyFixture.ts`
- Create: `e2e/forge/import.spec.ts`

**Interfaces:**
- Consumes: UI labels from Task 3 (byte-exact), `/sign-in` form (existing), service-role admin pattern from `e2e/seed.ts`.

- [ ] **Step 1: `e2e/forge/forgeSeed.ts`** — BEFORE writing, read `supabase/migrations/048_forge_access_foundation.sql` and `049_*.sql` for the exact `playtest_members` columns (and any NOT NULLs like `invited_by`), plus `052_*.sql` for `forge_sets`/`forge_cards` ownership columns (`created_by` vs `owner_id`), and `forge_audit`'s actor column in 049. Adjust the inserts/deletes to the real column names:

```ts
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const adminAvailable = !!URL && !!SERVICE;
export const admin = adminAvailable
  ? createClient(URL, SERVICE, { auth: { persistSession: false } })
  : null;

export interface SeededForgeMember {
  userId: string; email: string; password: string; role: "elder" | "playtester";
}

export async function seedForgeMember(role: "elder" | "playtester"): Promise<SeededForgeMember> {
  if (!admin) throw new Error("forge e2e seed requires SUPABASE_SERVICE_ROLE_KEY");
  const email = `forge-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@e2e.test`;
  const password = "Testpass12345";
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (error || !data?.user) throw new Error(`createUser failed: ${error?.message}`);
  const { error: mErr } = await admin.from("playtest_members").insert({
    user_id: data.user.id,
    role,
    display_name: `E2E ${role}`,
    nda_agreed_at: new Date().toISOString(),
    // add any NOT NULL columns found in migrations 048/049 here
  });
  if (mErr) {
    await admin.auth.admin.deleteUser(data.user.id);
    throw new Error(`playtest_members insert failed: ${mErr.message}`);
  }
  return { userId: data.user.id, email, password, role };
}

// Deletes everything the member created during the test, then the member + user.
// Order matters: versions → cards → set memberships/grants → sets → audit → member → user.
export async function cleanupForgeMember(seed: SeededForgeMember) {
  if (!admin) return;
  const { data: cards } = await admin.from("forge_cards").select("id").eq("owner_id", seed.userId);
  const cardIds = (cards ?? []).map((c: { id: string }) => c.id);
  if (cardIds.length) {
    await admin.from("card_comments").delete().in("card_id", cardIds);
    await admin.from("card_proposals").delete().in("card_id", cardIds);
    // published_version_id/approved_version_id FK-block card_versions deletes — clear first
    await admin.from("forge_cards").update({ published_version_id: null, approved_version_id: null }).in("id", cardIds);
    await admin.from("card_versions").delete().in("card_id", cardIds);
    await admin.from("forge_cards").delete().in("id", cardIds);
  }
  // sets created by this member (check 052 for the creator column name)
  const { data: ownSets } = await admin.from("forge_sets").select("id").eq("created_by", seed.userId);
  const setIds = (ownSets ?? []).map((s: { id: string }) => s.id);
  if (setIds.length) {
    await admin.from("forge_set_elders").delete().in("set_id", setIds);
    await admin.from("forge_set_grants").delete().in("set_id", setIds);
    await admin.from("forge_sets").delete().in("id", setIds);
  }
  await admin.from("forge_set_elders").delete().eq("user_id", seed.userId);
  await admin.from("forge_set_grants").delete().eq("user_id", seed.userId);
  await admin.from("forge_audit").delete().eq("actor", seed.userId); // check 049 column name
  await admin.from("playtest_members").delete().eq("user_id", seed.userId);
  try { await admin.auth.admin.deleteUser(seed.userId); } catch { /* best-effort */ }
}
```

(Private-store blobs uploaded by the test are orphaned — tiny 1×1 JPEGs; accepted + documented in the plan/PR.)

- [ ] **Step 2: `e2e/forge/lackeyFixture.ts`** — fully synthetic zip; NO real card data:

```ts
import { zipSync, strToU8 } from "fflate";

// Smallest valid JPEG (1×1 white) — renders with naturalWidth 1.
const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
  "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
  "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

export const FIXTURE_SET = "TST";
export const FIXTURE_CARDS = ["Test Hero Alpha", "Test Demon Beta", "Test Relic Gamma"];

const HEADER =
  "Name\tSet\tImageFile\tOfficialSet\tType\tBrigade\tStrength\tToughness\tClass\tIdentifier\tSpecialAbility\tRarity\tReference\tSound\tAlignment\tLegality";

const ROWS = [
  "Test Hero Alpha\tTST\tTest-Hero-Alpha\tTest Set\tHero\tSilver\t9\t9\tWarrior\t-\tTest ability alpha.\t-\tGenesis 1:1\t-\tGood\tRotation",
  "Test Demon Beta\tTST\tTest-Demon-Beta\tTest Set\tEvil Character\tOrange\t7\t7\t-\tDemon\tTest ability beta.\t-\tJob 1:1\t-\tEvil\tRotation",
  "Test Relic Gamma\tTST\tTest-Relic-Gamma\tTest Set\tArtifact\t-\t-\t-\t-\t-\tTest ability gamma.\t-\t-\t-\tNeutral\tRotation",
  "Other Card\tZZZ\tOther-Card\tOther Set\tHero\tBlue\t1\t1\t-\t-\tOther ability.\t-\t-\t-\tGood\tRotation",
];

export function buildFixtureZip(): Buffer {
  const jpeg = new Uint8Array(Buffer.from(TINY_JPEG_BASE64, "base64"));
  const files: Record<string, Uint8Array> = {
    "Test Plugin V1/sets/carddata.txt": strToU8([HEADER, ...ROWS].join("\n")),
    "Test Plugin V1/sets/setimages/general/Test-Hero-Alpha.jpg": jpeg,
    "Test Plugin V1/sets/setimages/general/Test-Demon-Beta.jpg": jpeg,
    // Test Relic Gamma deliberately has NO image (exercises the imageless path)
    "Test Plugin V1/sets/setimages/general/Other-Card.jpg": jpeg,
    "Test Plugin V1/packs/garbage.jpg": jpeg,
    "Test Plugin V1/version.txt": strToU8("v1"),
  };
  const zipped = zipSync(files, { level: 0 });
  return Buffer.from(zipped.buffer, zipped.byteOffset, zipped.byteLength);
}
```

- [ ] **Step 3: `e2e/forge/import.spec.ts`**

```ts
import { test, expect, type Page } from "@playwright/test";
import { adminAvailable, seedForgeMember, cleanupForgeMember, type SeededForgeMember } from "./forgeSeed";
import { buildFixtureZip, FIXTURE_CARDS } from "./lackeyFixture";

test.describe("forge lackey set import", () => {
  test.skip(!adminAvailable, "requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL");

  async function signIn(page: Page, seed: SeededForgeMember) {
    await page.goto("/sign-in");
    await page.getByLabel(/email/i).fill(seed.email);
    await page.getByLabel(/password/i).fill(seed.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 15_000 });
  }

  async function uploadFixture(page: Page) {
    await page.goto("/forge/import");
    await page.getByLabel("Lackey zip file").setInputFiles({
      name: "Test Plugin V1.zip", mimeType: "application/zip", buffer: buildFixtureZip(),
    });
    await page.getByLabel("Set filter").fill("TST");
    await expect(page.getByText("3 cards match")).toBeVisible();
  }

  test("anonymous visitors get a 404", async ({ page }) => {
    const resp = await page.goto("/forge/import");
    expect(resp?.status()).toBe(404);
  });

  test("playtesters are redirected to /forge/play", async ({ page }) => {
    const seed = await seedForgeMember("playtester");
    try {
      await signIn(page, seed);
      await page.goto("/forge/import");
      await page.waitForURL(/\/forge\/play/);
    } finally {
      await cleanupForgeMember(seed);
    }
  });

  test("elder imports a filtered set, images render, re-import skips", async ({ page }) => {
    test.setTimeout(180_000);
    const seed = await seedForgeMember("elder");
    try {
      await signIn(page, seed);
      await uploadFixture(page);

      // preview: 3 matched, 1 flagged without image
      await expect(page.getByText("1 without an image")).toBeVisible();

      // destination: new set (name is prefilled with the filter "TST")
      const setName = `E2E Import ${Date.now()}`;
      await page.getByLabel("New set name").fill(setName);
      await page.getByRole("button", { name: "Import 3 cards" }).click();

      await expect(page.getByText("Imported 3 · Skipped 0 · Failed 0")).toBeVisible({ timeout: 120_000 });

      // set grid shows all three cards; finished images render through the authed proxy
      await page.getByRole("link", { name: "View set →" }).click();
      for (const name of FIXTURE_CARDS) {
        await expect(page.getByText(name).first()).toBeVisible();
      }
      const img = page.locator('img[src*="kind=finished"]').first();
      await expect(img).toBeVisible();
      expect(await img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

      // idempotent re-run into the same (now-existing) set: everything skips
      await uploadFixture(page);
      await page.getByLabel("Add to an existing set").check();
      await page.getByLabel("Existing set").selectOption({ label: setName });
      await page.getByRole("button", { name: "Import 3 cards" }).click();
      await expect(page.getByText("Imported 0 · Skipped 3 · Failed 0")).toBeVisible({ timeout: 120_000 });
    } finally {
      await cleanupForgeMember(seed);
    }
  });
});
```

Selector note: if `getByLabel("Add to an existing set")` fails because the radio label isn't programmatically associated, associate it properly in the wizard (wrap input in `<label>` — Task 3 already does) rather than switching to brittle selectors.

- [ ] **Step 4: Run the spec** (dev server auto-starts via playwright.config webServer)

Run: `npx playwright test e2e/forge/import.spec.ts --project=chromium-desktop`
Expected: 3 passed. (This hits the LIVE Supabase + private blob store with synthetic data, then cleans up.)

Also run mobile: `npx playwright test e2e/forge/import.spec.ts --project=chromium-mobile`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add e2e/forge
git commit -m "test(forge): e2e Lackey import — seeded elder/playtester, synthetic zip, idempotent re-run"
```

---

### Task 7: Full gates

- [ ] Run: `npm test` — expected: green except the pre-existing unrelated `store-route`/`threshingfloor` failures noted in prior Forge phases.
- [ ] Run: `npm run build` — expected: clean (this is what catches `strict:false` narrowing bugs).
- [ ] Run: `npm run test:security` — expected: green; surface unchanged (no new tables/RPCs).
- [ ] Run: `npx playwright test e2e/forge/import.spec.ts` — expected: green on both projects.
- [ ] Commit any fixes.

---

### Task 8: UI/UX roughness follow-up doc (main session writes this)

- Create `docs/superpowers/specs/2026-07-03-forge-import-uiux-followup.md` documenting rough edges + proposed improvements (bulk publish/approve, reveal-grid caching, wizard polish, etc.). Committed with the branch.
