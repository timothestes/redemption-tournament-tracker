# Sister-API Fold-In + Zero-PR Releases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Python `redemption-tournament-api` (deck-check PDF, deck image, AoD count) into the tracker as TypeScript `/api/v1/*` routes with byte-for-byte contract parity (Part 1), then replace the Forge release's tracker-overlay PR with a build-time Supabase fetch + Vercel deploy hook (Part 2).

**Architecture:** Part 1 builds a server-only `lib/decksheets/` module family (parse → resolve → limits → counts → sort → render → upload) consumed by three thin route handlers; card data comes from the tracker catalog (`CARDS`), card art from public Vercel Blob at request time. Part 2 wires `scripts/prebuild-catalog.js` into the build command (with a kill switch and a monotonicity guard) and turns the release page's "Merge the catalog artifacts" card into a "Deploy catalog" button hitting a Vercel deploy hook.

**Tech Stack:** Next.js 15 App Router route handlers, `pdf-lib` (new dep), `sharp` ^0.35 (existing), Supabase Storage (`decklists` bucket), vitest.

**Spec:** `docs/superpowers/specs/2026-08-23-api-fold-in-and-zero-pr-releases-design.md` — read it first; every task argues from it. The Python source of truth is the sister repo at `/Users/timestes/projects/redemption-tournament-api` (absolute path; it is NOT inside this repo).

## Global Constraints

- **Worktree**: implementation happens in a git worktree per CLAUDE.md (`git worktree add ../rtt-decksheets -b feat/decksheets-port origin/main`), absolute paths only, never touch the main checkout. Copy `.env.local` from the main checkout into the worktree (gitignored, doesn't follow worktrees) — dev server and golden tests need it.
- **Git**: stage only your own files (never `git add -A`/`.`), sanity-check `git status` + branch before/after git commands, commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Parity messages are verbatim**: every user-facing error string in `lib/decksheets/` is copied character-for-character from the Python (they surface in UIs as 400 bodies). Never "improve" them.
- **String comparison**: the Python sorts/compares by raw code points. Use `a < b ? -1 : a > b ? 1 : 0` — **never `localeCompare`** (locale-sensitive, breaks fixture parity).
- **New dependencies**: `pdf-lib` only. Everything else uses existing deps (`sharp`, `@supabase/supabase-js`). No p-limit — write the 6-line concurrency helper inline.
- **Frozen port**: `lib/decksheets/` must not import `normalizeBrigadeField` from `cardHelpers.ts` or the brigade orders from `defaultSort.ts` — it carries its own frozen copies (spec §2.2/§4: the near-mirrors diverge).
- **Test runner**: `npx vitest run lib/decksheets` (repo test script is `vitest run`). Route tests follow the existing pattern in `app/api/v1/__tests__/decks-route.test.ts` (vi.mock of `@/lib/api/rateLimit`).
- **Python fixtures**: several tasks generate a JSON fixture by running the Python once from `/Users/timestes/projects/redemption-tournament-api`. Never run `make json`/`make webp` there (stale-Lackey landmine, deletes newer sets). Fixture scripts only read.
- **Success/error envelopes** (contract, from `routes/decklists.py` + `routes/decklist_images.py`): non-JSON body or missing `decklist`/`decklist_type` → 400 `{"error": "invalid request"}`; `DeckCheckError` → 400 `{"status": "error", "message": <msg>}`; anything else → 500 `{"status": "error", "message": "something unexpected happened"}`; success → 201 (generators) / 200 (aod) `{"status": "success", "message": <msg>, "data": {...}}`.

---

## Part 1 — the TypeScript port

### Task 1: Font spike — sharp SVG text on Vercel

The spec's only real platform risk (§7): all raster text (seal labels, deck-image M/AoD text) renders via sharp's SVG path, which needs fontconfig to find a bundled font on Vercel. Decide the strategy before any rendering code exists.

**Files:**
- Create: `assets/decksheets/fonts/DejaVuSans-Bold.ttf` (copy from `/Users/timestes/projects/redemption-tournament-api/assets/fonts/DejaVuSans-Bold.ttf` — check the exact filename with `ls` there first; the repo has one DejaVu bold ttf)
- Create: `assets/decksheets/fonts/fonts.conf`
- Create: `lib/decksheets/svgText.ts`
- Create: `app/api/decksheets-spike/route.ts` (throwaway — deleted in Task 12)
- Modify: `next.config.js:45-48` (add tracing includes for the spike route)

**Interfaces:**
- Produces: `renderSvgToPng(svg: string): Promise<Buffer>` and `configureFontconfig(): void` in `svgText.ts` — Tasks 7 and 8 consume these.

- [ ] **Step 1: Copy the font, write fonts.conf and svgText.ts**

`assets/decksheets/fonts/fonts.conf`:
```xml
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>ASSETS_FONT_DIR</dir>
  <cachedir>/tmp/fonts-cache</cachedir>
</fontconfig>
```
(`ASSETS_FONT_DIR` is replaced at runtime — fontconfig needs an absolute dir, which differs between dev and the Vercel bundle.)

`lib/decksheets/svgText.ts`:
```ts
import path from "path";
import fs from "fs";
import os from "os";

const FONT_DIR = path.join(process.cwd(), "assets", "decksheets", "fonts");

/** Point fontconfig at the bundled DejaVu before sharp's first SVG text render. */
export function configureFontconfig(): void {
  if (process.env.FONTCONFIG_PATH) return; // already configured this instance
  const confDir = path.join(os.tmpdir(), "decksheets-fontconfig");
  fs.mkdirSync(confDir, { recursive: true });
  const template = fs.readFileSync(path.join(FONT_DIR, "fonts.conf"), "utf8");
  fs.writeFileSync(path.join(confDir, "fonts.conf"), template.replace("ASSETS_FONT_DIR", FONT_DIR));
  process.env.FONTCONFIG_PATH = confDir;
}

export async function renderSvgToPng(svg: string): Promise<Buffer> {
  configureFontconfig();
  const sharp = (await import("sharp")).default;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
```

- [ ] **Step 2: Write the spike route**

`app/api/decksheets-spike/route.ts`:
```ts
import { renderSvgToPng } from "@/lib/decksheets/svgText";

export const runtime = "nodejs";

export async function GET() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120">
    <rect width="400" height="120" fill="#1e202b"/>
    <text x="20" y="70" font-family="DejaVu Sans" font-weight="bold" font-size="40" fill="#ffffff">M: 3.42 AoD 1.7</text>
  </svg>`;
  const png = await renderSvgToPng(svg);
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png" } });
}
```

Add to `next.config.js` `outputFileTracingIncludes` (follow the existing `/threshingfloor/outline` entries at lines 45-48):
```js
'/api/decksheets-spike': ['./assets/decksheets/fonts/**'],
```

- [ ] **Step 3: Verify locally** — `npm run dev`, `curl -s localhost:3000/api/decksheets-spike -o /tmp/spike.png`, then Read `/tmp/spike.png` — the text must be crisp DejaVu Bold, not a blank box or fallback serif.

- [ ] **Step 4: Verify on Vercel** — commit, push the branch, open a draft PR so Vercel builds a preview, then `curl` the preview URL's `/api/decksheets-spike` and Read the PNG. (Note: pushing any branch triggers the SpacetimeDB CI workflow — known and harmless, it's path-scoped to `spacetimedb/**`.)

- [ ] **Step 5: Record the outcome.** If text renders: done, Tasks 7-8 build on `renderSvgToPng`. If it does NOT render (blank/tofu): the fallback is pre-baking text to SVG `<path>` outlines — add dev-dependency `opentype.js`, write `textToPathD(text, sizePx): string` in `svgText.ts` using the bundled ttf, and re-verify on the preview. Either way, note the chosen strategy in the commit message and update the seal/deck-image tasks' SVG snippets to use it.

- [ ] **Step 6: Commit**
```bash
git add assets/decksheets/fonts lib/decksheets/svgText.ts app/api/decksheets-spike/route.ts next.config.js
git commit -m "spike(decksheets): sharp SVG text with bundled DejaVu + fontconfig"
```

### Task 2: parse.ts — Lackey text parser

**Files:**
- Create: `lib/decksheets/errors.ts`, `lib/decksheets/types.ts`, `lib/decksheets/parse.ts`
- Test: `lib/decksheets/__tests__/parse.test.ts`

**Interfaces:**
- Produces:
  - `class DeckCheckError extends Error` (errors.ts) — the AssertionError-parity error; routes map it to 400 `{status:"error", message}`.
  - `interface DeckEntry { quantity: number; name: string }`, `interface ParsedDeck { main: DeckEntry[]; reserve: DeckEntry[]; hasReserve: boolean }` (types.ts).
  - `normalizeApostrophes(text: string): string` and `parseDecklistText(text: string): ParsedDeck` (parse.ts).
- Source of truth: `_load_txt_file` in `/Users/timestes/projects/redemption-tournament-api/src/utilities/decklist.py:111-136`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { parseDecklistText, normalizeApostrophes } from "../parse";
import { DeckCheckError } from "../errors";

describe("parseDecklistText", () => {
  it("parses qty<TAB>name lines into main deck", () => {
    const deck = parseDecklistText("2\tSon of God\n1\tAngel of the Lord\n");
    expect(deck.main).toEqual([
      { quantity: 2, name: "Son of God" },
      { quantity: 1, name: "Angel of the Lord" },
    ]);
    expect(deck.reserve).toEqual([]);
    expect(deck.hasReserve).toBe(false);
  });

  it("routes lines after Reserve: into the reserve", () => {
    const deck = parseDecklistText("1\tSon of God\nReserve:\n1\tBurial\n");
    expect(deck.main).toEqual([{ quantity: 1, name: "Son of God" }]);
    expect(deck.reserve).toEqual([{ quantity: 1, name: "Burial" }]);
    expect(deck.hasReserve).toBe(true);
  });

  it("stops at Tokens:", () => {
    const deck = parseDecklistText("1\tSon of God\nTokens:\n1\tSome Token\n");
    expect(deck.main).toEqual([{ quantity: 1, name: "Son of God" }]);
  });

  it("skips lines without a tab (blank lines, headers)", () => {
    const deck = parseDecklistText("My Deck\n\n1\tSon of God\n");
    expect(deck.main).toEqual([{ quantity: 1, name: "Son of God" }]);
  });

  it("normalizes curly apostrophes in names", () => {
    const deck = parseDecklistText("1\tKing’s Pomp\n");
    expect(deck.main[0].name).toBe("King's Pomp");
  });

  it("throws the exact Python message for an empty main deck", () => {
    expect(() => parseDecklistText("Tokens:\n1\tX\n")).toThrowError(
      new DeckCheckError("Please load a deck_file that contains at least one card in the main deck.")
    );
  });
});

describe("normalizeApostrophes", () => {
  it("replaces U+2019 only", () => {
    expect(normalizeApostrophes("a’b'c")).toBe("a'b'c");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run lib/decksheets` — FAIL (modules don't exist).

- [ ] **Step 3: Implement**

`errors.ts`:
```ts
/** Parity with Python AssertionError: routes map this to 400 {status:"error", message}. */
export class DeckCheckError extends Error {}
```

`types.ts`:
```ts
import type { CardData } from "@/lib/cards/lookup";

export interface DeckEntry { quantity: number; name: string }
export interface ParsedDeck { main: DeckEntry[]; reserve: DeckEntry[]; hasReserve: boolean }

export interface ResolvedCard extends CardData {
  quantity: number;
  rawBrigade: string;
  brigades: string[];
}
export interface ResolvedDeck {
  main: Map<string, ResolvedCard>;
  reserve: Map<string, ResolvedCard>;
  mainSize: number;
  reserveSize: number;
}
export type DeckType = string; // "type_1" | "type_2" | "paragon" pass through untyped, like the Python
```

`parse.ts` — transcribe `_load_txt_file` exactly: iterate lines, `trim()`, `startsWith("Tokens:")` → break, `startsWith("Reserve:")` → `hasReserve = true; continue`, split on first tab (`line.split("\t")` then rejoin the tail with `"\t"` — Python is `split("\t", 1)`), `parseInt(parts[0].trim(), 10)` for quantity (a non-numeric quantity yields `NaN` — throw a plain `Error` so it becomes the 500 envelope, matching Python's `ValueError` → 500), `normalizeApostrophes(rest.trim())` for the name. Empty `main` at the end → `throw new DeckCheckError("Please load a deck_file that contains at least one card in the main deck.")`.

- [ ] **Step 4: Run to verify pass** — `npx vitest run lib/decksheets` — PASS.

- [ ] **Step 5: Commit**
```bash
git add lib/decksheets/errors.ts lib/decksheets/types.ts lib/decksheets/parse.ts lib/decksheets/__tests__/parse.test.ts
git commit -m "feat(decksheets): Lackey text parser with Python-parity messages"
```

### Task 3: brigades.ts — frozen brigades.py port + full-catalog fixture

**Files:**
- Create: `lib/decksheets/brigades.ts`
- Create: `lib/decksheets/__tests__/fixtures/generate_fixtures.py` (committed, rerunnable)
- Create: `lib/decksheets/__tests__/fixtures/brigades.json` (generated, committed)
- Test: `lib/decksheets/__tests__/brigades.test.ts`

**Interfaces:**
- Produces: `GOOD_BRIGADES: string[]`, `EVIL_BRIGADES: string[]`, `normalizeBrigadesFrozen(brigade: string, alignment: string, cardName: string): string[]` — throws `DeckCheckError` with the Python assert message on an invalid brigade. Task 4 consumes.
- Source of truth: `/Users/timestes/projects/redemption-tournament-api/src/utilities/brigades.py` (113 lines, port ALL of it verbatim) and `vars.py:5-24` for the two brigade lists.

- [ ] **Step 1: Write the fixture generator** — `generate_fixtures.py` (this file grows in Tasks 5-6; start it now):

```python
#!/usr/bin/env python3
"""Generate parity fixtures from the Python API. Run from the API repo root:
   cd /Users/timestes/projects/redemption-tournament-api && \
   PYTHONPATH=. python3 <tracker>/lib/decksheets/__tests__/fixtures/generate_fixtures.py
Reads only; never touches the Lackey-wired generators."""
import json, os, sys

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

from src.utilities.brigades import normalize_brigade_field

def load_jsonl():
    cards = []
    with open("assets/carddata/carddata.jsonl", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                cards.append(json.loads(line))
    return cards

def gen_brigades(cards):
    rows = []
    for c in cards:
        rows.append({
            "name": c["name"], "brigade": c.get("brigade", ""),
            "alignment": c.get("alignment", ""),
            "expected": normalize_brigade_field(c.get("brigade", ""), c.get("alignment", ""), c["name"]),
        })
    with open(os.path.join(OUT_DIR, "brigades.json"), "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=1)

if __name__ == "__main__":
    cards = load_jsonl()
    gen_brigades(cards)
    print(f"brigades.json: {len(cards)} rows")
```

- [ ] **Step 2: Generate and eyeball the fixture** — run the command from the docstring; confirm ~5,692 rows and that the `"City of Refuge"` row has `"expected": []` (empty brigade wins over the complex map — the exact divergence from the tracker's `normalizeBrigadeField`).

- [ ] **Step 3: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { normalizeBrigadesFrozen } from "../brigades";
import { DeckCheckError } from "../errors";
import fixture from "./fixtures/brigades.json";

describe("normalizeBrigadesFrozen", () => {
  it("matches brigades.py over the full catalog", () => {
    for (const row of fixture as Array<{ name: string; brigade: string; alignment: string; expected: string[] }>) {
      expect(normalizeBrigadesFrozen(row.brigade, row.alignment, row.name), row.name).toEqual(row.expected);
    }
  });

  it("City of Refuge (empty brigade) returns [] — the frozen divergence", () => {
    expect(normalizeBrigadesFrozen("", "Neutral", "City of Refuge")).toEqual([]);
  });

  it("throws DeckCheckError with the Python assert message on an invalid brigade", () => {
    expect(() => normalizeBrigadesFrozen("Chartreuse", "Good", "Fake Card")).toThrowError(
      new DeckCheckError("Card Fake Card has an invalid brigade: Chartreuse.")
    );
  });
});
```

- [ ] **Step 4: Run to verify failure**, then **implement** `brigades.ts`: transcribe `brigades.py` function-for-function (`handleComplexBrigades` with the full 33-entry map, `handleSimpleBrigades`, `replaceBrigades`, `replaceMultiBrigades`, `handleGoldBrigade`, `normalizeBrigadesFrozen`). Order is behavior: the `if (!brigade) return [];` early-return comes FIRST; Multi replacement uses `multiReplacements[cardName] ?? multiReplacements[alignment]`; final validation loops with `throw new DeckCheckError(\`Card ${cardName} has an invalid brigade: ${b}.\`)`; return `sorted` = `[...list].sort()` (default JS sort = code-point sort, same as Python `sorted` for these ASCII strings). `GOOD_BRIGADES`/`EVIL_BRIGADES` copied from `vars.py` verbatim.

- [ ] **Step 5: Run to verify pass**, then **commit**
```bash
git add lib/decksheets/brigades.ts lib/decksheets/__tests__/brigades.test.ts lib/decksheets/__tests__/fixtures/generate_fixtures.py lib/decksheets/__tests__/fixtures/brigades.json
git commit -m "feat(decksheets): frozen brigades.py port, full-catalog parity fixture"
```

### Task 4: resolve.ts — name-keyed catalog resolution

**Files:**
- Create: `lib/decksheets/resolve.ts`
- Test: `lib/decksheets/__tests__/resolve.test.ts`

**Interfaces:**
- Consumes: `ParsedDeck`, `normalizeApostrophes` (Task 2), `normalizeBrigadesFrozen` (Task 3), `CARDS` from `@/lib/cards/lookup`.
- Produces: `buildNormalizedCardMap(): Map<string, CardData>` (module-level memoized) and `resolveDeck(parsed: ParsedDeck): ResolvedDeck`. Tasks 5-9 consume `ResolvedDeck`.
- Source of truth: `_map_card_metadata` + `_get_size_of` in `decklist.py:62-66,152-186`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { resolveDeck } from "../resolve";

const parsed = (main: Array<[number, string]>, reserve: Array<[number, string]> = []) => ({
  main: main.map(([quantity, name]) => ({ quantity, name })),
  reserve: reserve.map(([quantity, name]) => ({ quantity, name })),
  hasReserve: reserve.length > 0,
});

describe("resolveDeck", () => {
  it("resolves a known card and attaches quantity, rawBrigade, brigades", () => {
    const deck = resolveDeck(parsed([[2, "Son of God"]]));
    const card = deck.main.get("Son of God")!;
    expect(card.quantity).toBe(2);
    expect(typeof card.rawBrigade).toBe("string");
    expect(Array.isArray(card.brigades)).toBe(true);
    expect(deck.mainSize).toBe(2);
  });

  it("resolves a curly-apostrophe catalog name from straight-apostrophe input", () => {
    // Pick any of the 52: grep -m1 $'’' from the catalog. "King's Pomp" family —
    // replace with a real curly-name from lib/cards/generated/cardData.json at implementation time.
    const deck = resolveDeck(parsed([[1, "CURLY_NAME_STRAIGHTENED"]]));
    expect(deck.mainSize).toBe(1);
  });

  it("silently skips unknown names (print-and-skip parity)", () => {
    const deck = resolveDeck(parsed([[1, "Son of God"], [3, "Totally Fake Card"]]));
    expect(deck.mainSize).toBe(1);
    expect(deck.main.has("Totally Fake Card")).toBe(false);
  });

  it("merges duplicate lines by summing quantity", () => {
    const deck = resolveDeck(parsed([[1, "Son of God"], [2, "Son of God"]]));
    expect(deck.main.get("Son of God")!.quantity).toBe(3);
  });

  it("strips doubled and wrapping quotes like the Python", () => {
    // Python: card["name"].replace('""', '"').strip('"')
    const deck = resolveDeck(parsed([[1, '"Son of God"']]));
    expect(deck.mainSize).toBe(1);
  });
});
```
At implementation time replace `CURLY_NAME_STRAIGHTENED` with a real name: run `node -e "const c=require('./lib/cards/generated/cardData.json'); console.log(c.find(x=>x.name.includes('’')).name)"` and use it with the apostrophe straightened.

- [ ] **Step 2: Run to verify failure**, then **implement**:

```ts
import { CARDS, type CardData } from "@/lib/cards/lookup";
import { normalizeApostrophes } from "./parse";
import { normalizeBrigadesFrozen } from "./brigades";
import type { ParsedDeck, ResolvedCard, ResolvedDeck } from "./types";

let cardMap: Map<string, CardData> | null = null;

/** Name-keyed, apostrophe-normalized, last-wins (parity with the jsonl loader + getCardDatabase semantics). */
export function buildNormalizedCardMap(): Map<string, CardData> {
  if (cardMap) return cardMap;
  cardMap = new Map();
  for (const card of CARDS) cardMap.set(normalizeApostrophes(card.name), card);
  return cardMap;
}
```
`resolveDeck`: for each entry, `name.replace(/""/g, '"')` then strip leading/trailing `"` (Python `strip('"')` strips runs of quotes from both ends), look up in the map; hit → merge-or-insert a `ResolvedCard` spread from the `CardData` with `quantity`, `rawBrigade: card.brigade`, `brigades: normalizeBrigadesFrozen(card.brigade, card.alignment, entry.name)` (note: Python passes the *deck line's* name, not the catalog name — keep that); miss → `console.warn(\`Could not find ${entry.name}. Skipping loading it.\`)`. Sizes = sum of quantities per map.

- [ ] **Step 3: Run to verify pass**, then **commit**
```bash
git add lib/decksheets/resolve.ts lib/decksheets/__tests__/resolve.test.ts
git commit -m "feat(decksheets): catalog resolution with apostrophe-normalized last-wins map"
```

### Task 5: limits.ts — size assertions

**Files:**
- Create: `lib/decksheets/limits.ts`
- Test: `lib/decksheets/__tests__/limits.test.ts`

**Interfaces:**
- Consumes: `ResolvedDeck` (`mainSize`/`reserveSize`).
- Produces: `enforceLimits(deck: ResolvedDeck, deckType: string, bypassAssertions: boolean): void` — throws `DeckCheckError`. Routes consume (PDF: `bypassAssertions=false`; image + aod: `true`).
- Source of truth: `decklist.py:30-60` — replicate the exact if/elif structure and messages.

- [ ] **Step 1: Write the failing tests** — one test per message, exact strings:

```ts
import { describe, it, expect } from "vitest";
import { enforceLimits } from "../limits";
import { DeckCheckError } from "../errors";

const deck = (mainSize: number, reserveSize = 0) =>
  ({ main: new Map(), reserve: new Map(), mainSize, reserveSize }) as any;

describe("enforceLimits bypass=true (image/aod routes)", () => {
  it("caps main at 140", () =>
    expect(() => enforceLimits(deck(141), "type_1", true)).toThrowError(
      new DeckCheckError("Please load a deck that contains 140 or less cards in the main deck.")));
  it("caps reserve at 20", () =>
    expect(() => enforceLimits(deck(50, 21), "type_2", true)).toThrowError(
      new DeckCheckError("Please load a deck that contains 20 or less cards in the reserve.")));
  it("allows a 1-card deck (no minimum)", () =>
    expect(() => enforceLimits(deck(1), "type_1", true)).not.toThrow());
});

describe("enforceLimits bypass=false (PDF route)", () => {
  it("minimum 40 main", () =>
    expect(() => enforceLimits(deck(39), "type_1", false)).toThrowError(
      new DeckCheckError("Please load a deck that contains at least 40 cards in the main deck.")));
  it("T2 main cap 140", () =>
    expect(() => enforceLimits(deck(141), "type_2", false)).toThrowError(
      new DeckCheckError("Please load a deck that contains 140 or less cards in the main deck for type 2")));
  it("T1/Paragon main cap 70", () => {
    for (const t of ["type_1", "paragon"])
      expect(() => enforceLimits(deck(71), t, false)).toThrowError(
        new DeckCheckError("Please load a deck that contains 70 or less cards in the main deck for type 1"));
  });
  it("T1/Paragon reserve cap 10", () =>
    expect(() => enforceLimits(deck(50, 11), "type_1", false)).toThrowError(
      new DeckCheckError("Please load a deck that contains 10 or less cards in the reserve for type 1")));
  it("T2 reserve cap 20", () =>
    expect(() => enforceLimits(deck(140, 21), "type_2", false)).toThrowError(
      new DeckCheckError("Please load a deck that contains 20 or less cards in the reserve for type 2")));
  it("unknown deck_type gets min-40 but no caps (Python if/elif shape)", () =>
    expect(() => enforceLimits(deck(141, 30), "type_9", false)).not.toThrow());
});
```

- [ ] **Step 2: Run to verify failure**, then **implement** with the same control flow as the Python (bypass block returns early after the two caps; else `<40` check, then `>140 && type_2` / `else if >70 && (type_1||paragon)`, then reserve `>10 && (type_1||paragon)` / `else if >20 && type_2`).

- [ ] **Step 3: Run to verify pass**, then **commit**
```bash
git add lib/decksheets/limits.ts lib/decksheets/__tests__/limits.test.ts
git commit -m "feat(decksheets): size assertions with verbatim Python messages"
```

### Task 6: counts.ts — M count + AoD breakdown (Monte Carlo)

**Files:**
- Create: `lib/decksheets/counts.ts`
- Create: `lib/decksheets/__tests__/fixtures/decks/` — three committed battery decks: `t1_multi_brigade.txt` (~50 main, ≥4 brigades, a few Lost Souls, some Daniel references), `t2_with_reserve.txt` (~100 main + 15 reserve), `tiny_8.txt` (8 cards — exercises the `<9` AoD zero-path and `min(8, n)` M-count sampling). Build them from real catalog names (use the deck builder or hand-write; every name must resolve).
- Create: `lib/decksheets/__tests__/fixtures/counts.json` (generated)
- Modify: `lib/decksheets/__tests__/fixtures/generate_fixtures.py` (add `gen_counts`)
- Test: `lib/decksheets/__tests__/counts.test.ts`

**Interfaces:**
- Consumes: `ResolvedDeck.main`.
- Produces: `calculateMCount(main: Map<string, ResolvedCard>): number` and `calculateAodBreakdown(main: Map<string, ResolvedCard>): { aod_count: number; soul_aod_count: number; whiff_percentage: number }` (snake_case keys — they go straight into the response `data`).
- Source of truth: `decklist.py:196-334`.

- [ ] **Step 1: Extend the fixture generator** — add to `generate_fixtures.py`:

```python
def gen_counts():
    from src.utilities.decklist import Decklist
    out = {}
    deck_dir = os.path.join(OUT_DIR, "decks")
    for fname in sorted(os.listdir(deck_dir)):
        if not fname.endswith(".txt"):
            continue
        d = Decklist(os.path.join(deck_dir, fname), deck_type="type_2", bypass_assertions=True)
        out[fname] = {"m_count": d.calculate_m_count(), **d.calculate_aod_breakdown()}
    with open(os.path.join(OUT_DIR, "counts.json"), "w") as f:
        json.dump(out, f, indent=1)
```
Run it (same PYTHONPATH invocation as Task 3). Note: the Python resolves against ITS jsonl — if any battery-deck name prints "Could not find", fix the deck file until zero misses on both sides.

- [ ] **Step 2: Write the failing tests** — statistical, spec §6 tolerances (±0.15 counts, ±2 pp whiff):

```ts
import { describe, it, expect } from "vitest";
import fs from "fs"; import path from "path";
import { parseDecklistText } from "../parse";
import { resolveDeck } from "../resolve";
import { calculateMCount, calculateAodBreakdown } from "../counts";
import expected from "./fixtures/counts.json";

const load = (f: string) =>
  resolveDeck(parseDecklistText(fs.readFileSync(path.join(__dirname, "fixtures/decks", f), "utf8")));

describe("counts parity vs Python fixture", () => {
  for (const [file, exp] of Object.entries(expected as Record<string, any>)) {
    it(`${file}: m_count within ±0.15`, () => {
      expect(Math.abs(calculateMCount(load(file).main) - exp.m_count)).toBeLessThanOrEqual(0.15);
    });
    it(`${file}: aod breakdown within tolerance`, () => {
      const b = calculateAodBreakdown(load(file).main);
      expect(Math.abs(b.aod_count - exp.aod_count)).toBeLessThanOrEqual(0.15);
      expect(Math.abs(b.soul_aod_count - exp.soul_aod_count)).toBeLessThanOrEqual(0.15);
      expect(Math.abs(b.whiff_percentage - exp.whiff_percentage)).toBeLessThanOrEqual(2);
    });
  }
  it("tiny_8.txt: aod breakdown is all zeros (<9 cards)", () => {
    expect(calculateAodBreakdown(load("tiny_8.txt").main)).toEqual(
      { aod_count: 0, soul_aod_count: 0, whiff_percentage: 0 });
  });
});
```

- [ ] **Step 3: Run to verify failure**, then **implement** `counts.ts` — transcribe `calculate_m_count` and `calculate_aod_breakdown`:
  - Expand quantities into flat arrays. M count: non-Lost-Soul filter is `card.type.toLowerCase() !== "lost soul"`, per-copy entry is the card's `brigades` array; `sampleSize = Math.min(8, n)`; 10 000 sims; each sim = sample WITHOUT replacement (partial Fisher-Yates below), count `Set` of all brigades; return `Math.round((total / 10000) * 100) / 100`.
  - AoD: skip the card whose map key is exactly `"The Ancient of Days"`; per-copy tuple `[reference, isLostSoul]`; `<9` cards → all-zero object; per sim full shuffle, trigger = any of top 3 with `ref && ref.includes("Daniel")`; no trigger → whiff++ and continue; else tally Daniel refs in top 9 into soul/non-soul buckets. Round like the Python: counts to 2 dp, whiff = `Math.round((whiffs / 10000) * 100 * 100) / 100`.
  - Sampling helper (in-file):
```ts
function sampleWithoutReplacement<T>(arr: T[], k: number): T[] {
  const a = arr.slice();
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(Math.random() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}
```

- [ ] **Step 4: Run to verify pass** (run twice — statistical tests must pass both runs), then **commit**
```bash
git add lib/decksheets/counts.ts lib/decksheets/__tests__/counts.test.ts lib/decksheets/__tests__/fixtures/decks lib/decksheets/__tests__/fixtures/counts.json lib/decksheets/__tests__/fixtures/generate_fixtures.py
git commit -m "feat(decksheets): Monte Carlo M count + AoD breakdown with Python parity fixtures"
```

### Task 7: sheetSort.ts — the sheets' multi-field sort

**Files:**
- Create: `lib/decksheets/sheetSort.ts`
- Create: `lib/decksheets/__tests__/fixtures/sheet_sort.json` (generated)
- Modify: `generate_fixtures.py` (add `gen_sheet_sort`)
- Test: `lib/decksheets/__tests__/sheetSort.test.ts`

**Interfaces:**
- Consumes: `Map<string, ResolvedCard>`.
- Produces: `sheetSort(cards: Map<string, ResolvedCard>): Array<[string, ResolvedCard]>` — the `["type","alignment","brigade","name"]` order both renderers consume.
- Source of truth: `sort.py:13-40,311-328` — key tuple per entry is `(type raw string, alignmentPriority, rawBrigade string, name.toLowerCase())` where `alignmentPriority` = `{Good:0, Evil:1, Neutral:2}[alignment] ?? 3`. **Raw code-point string compares — no localeCompare, no brigade-order arrays** (spec §2.2).

- [ ] **Step 1: Extend the fixture generator**:

```python
def gen_sheet_sort(cards):
    from src.utilities.sort import sort_cards
    cards_dict = {}
    for c in cards:
        cards_dict[c["name"]] = {"type": c.get("type", ""), "alignment": c.get("alignment", ""),
                                 "raw_brigade": c.get("brigade", "")}
    ordered = sort_cards(cards_dict, sort_by=["type", "alignment", "brigade", "name"])
    with open(os.path.join(OUT_DIR, "sheet_sort.json"), "w", encoding="utf-8") as f:
        json.dump({"input": cards_dict, "expected_order": [name for name, _ in ordered]},
                  f, ensure_ascii=False, indent=1)
```
Run it. The fixture carries its own input, so the test is independent of catalog drift.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { sheetSort } from "../sheetSort";
import fixture from "./fixtures/sheet_sort.json";

describe("sheetSort", () => {
  it("matches sort.py's [type, alignment, brigade, name] order over the full catalog", () => {
    const map = new Map<string, any>();
    for (const [name, d] of Object.entries(fixture.input as Record<string, any>)) {
      map.set(name, { type: d.type, alignment: d.alignment, rawBrigade: d.raw_brigade });
    }
    expect(sheetSort(map).map(([name]) => name)).toEqual(fixture.expected_order);
  });
});
```

- [ ] **Step 3: Run to verify failure**, then **implement**: build `[name, card, key]` triples with `key = [card.type ?? "", alignmentPriority(card.alignment), card.rawBrigade ?? "", name.toLowerCase()]`, sort with a tuple comparator using code-point compares. Note Python `sorted` is stable — JS `Array.prototype.sort` is stable too (ES2019+); rely on it.

- [ ] **Step 4: Run to verify pass**, then **commit**
```bash
git add lib/decksheets/sheetSort.ts lib/decksheets/__tests__/sheetSort.test.ts lib/decksheets/__tests__/fixtures/sheet_sort.json lib/decksheets/__tests__/fixtures/generate_fixtures.py
git commit -m "feat(decksheets): sheet sort (raw-string multi-field, full-catalog fixture)"
```

### Task 8: seal.ts — legality seal renderer

**Files:**
- Create: `lib/decksheets/seal.ts`
- Test: `lib/decksheets/__tests__/seal.test.ts`

**Interfaces:**
- Consumes: `renderSvgToPng` (Task 1, or the path-outline variant if the spike chose the fallback).
- Produces: `renderSealPng(opts: { deckType: string; isLegal: boolean; sizePx: number }): Promise<Buffer>` — a PNG with transparency. Task 9 composites it; Task 10 embeds it.
- Source of truth: `/Users/timestes/projects/redemption-tournament-api/src/utilities/seal.py` (97 lines — read it fully). Port the geometry as SVG: two concentric circle strokes, translucent fill, the format label text and LEGAL/ILLEGAL status text with the same sizing formulas; colors forest green `rgb(34,139,34)` when legal, dark red `rgb(180,30,30)` when not. The format label mapping (deck_type → display text) is in `seal.py` — transcribe it exactly.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { renderSealPng } from "../seal";

describe("renderSealPng", () => {
  it("renders a square PNG at the requested size with alpha", async () => {
    const png = await renderSealPng({ deckType: "type_1", isLegal: true, sizePx: 200 });
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(200);
    expect(meta.hasAlpha).toBe(true);
  });

  it("legal and illegal seals differ (color + text)", async () => {
    const a = await renderSealPng({ deckType: "type_2", isLegal: true, sizePx: 120 });
    const b = await renderSealPng({ deckType: "type_2", isLegal: false, sizePx: 120 });
    expect(Buffer.compare(a, b)).not.toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**, then **implement**, then **eyeball**: write a scratch script that saves legal + illegal seals for `type_1`/`type_2` to the scratchpad directory and Read them next to reference seals produced by the Python (`PYTHONPATH=. python3 -c "from src.utilities.seal import ..."` — check `seal.py` for its entry function name and call it with the same args, saving to the scratchpad). Rings, label placement, and text weight should match closely; exact anti-aliasing will differ (PIL vs librsvg) — that's fine.

- [ ] **Step 3: Run tests to verify pass**, then **commit**
```bash
git add lib/decksheets/seal.ts lib/decksheets/__tests__/seal.test.ts
git commit -m "feat(decksheets): SVG legality seal (seal.py port)"
```

### Task 9: deckImage.ts — card-grid WebP renderer

**Files:**
- Create: `lib/decksheets/deckImage.ts`
- Test: `lib/decksheets/__tests__/deckImage.test.ts`

**Interfaces:**
- Consumes: `ResolvedDeck`, `sheetSort`, `renderSealPng`, `getCardImageUrl(imgFile)` from `@/app/shared/utils/cardImageUrl`, `renderSvgToPng` for the M/AoD separator text.
- Produces: `generateDeckImage(opts: { deckType: string; deck: ResolvedDeck; nCardColumns: number; mCountValue: number | null; aodCountValue: number | null; isLegal: boolean | null; fetchImage?: (imgFile: string) => Promise<Buffer | null> }): Promise<Buffer>` — a WebP buffer; `fetchImage` defaults to the Blob fetcher and exists so tests stay network-free. The route consumes (never passes `fetchImage`).
- Source of truth: `/Users/timestes/projects/redemption-tournament-api/src/utilities/text_to_webp.py` (510 lines — read fully before writing). Layout constants verified in the spec: 15 cards/row when `deckType === "type_2"` else `nCardColumns` (default 10); rows overlap 10% of card height; background `#1e202b`; separator bar `#141621` height 50 between main and reserve (doubled height when there is no reserve but counts are shown); M/AoD text in DejaVu Sans Bold on the separator; seal top-left, min 80 px; WebP quality 80. One grid cell per **copy** (quantities expand), main sorted by `sheetSort`, reserve too — confirm per-section details against the Python while porting.

**Deviation (spec §4.1(2)):** every fetched Blob JPEG is resized to a fixed 345×495 cell with `sharp(...).resize(345, 495, { fit: "fill" })` before compositing — Blob art is NOT uniform (many ~344×512) and un-resized overlays would overflow the canvas and make `composite()` throw.

- [ ] **Step 1: Write the failing test** (network-free: inject a fetcher):

Design `generateDeckImage` to accept an optional `fetchImage?: (imgFile: string) => Promise<Buffer | null>` (default = Blob fetch). Test with a stub:

```ts
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { parseDecklistText } from "../parse";
import { resolveDeck } from "../resolve";
import { generateDeckImage } from "../deckImage";
import fs from "fs"; import path from "path";

const fakeCard = () => sharp({ create: { width: 344, height: 512, channels: 3, background: "#888" } }).jpeg().toBuffer();

describe("generateDeckImage", () => {
  it("renders a WebP grid; 10-col layout for type_1", async () => {
    const deck = resolveDeck(parseDecklistText(
      fs.readFileSync(path.join(__dirname, "fixtures/decks/t1_multi_brigade.txt"), "utf8")));
    const webp = await generateDeckImage({
      deckType: "type_1", deck, nCardColumns: 10, mCountValue: 3.2, aodCountValue: null,
      isLegal: true, fetchImage: async () => fakeCard(),
    });
    const meta = await sharp(webp).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(10 * 345); // cols × fixed cell width
  });

  it("skips missing images without throwing (print-and-skip parity)", async () => {
    const deck = resolveDeck(parseDecklistText("1\tSon of God\n2\tBurial\n"));
    const webp = await generateDeckImage({
      deckType: "type_1", deck, nCardColumns: 10, mCountValue: null, aodCountValue: null,
      isLegal: null, fetchImage: async (f) => (f.includes("Burial") ? null : fakeCard()),
    });
    expect((await sharp(webp).metadata()).format).toBe("webp");
  });
});
```
(Adjust the width assertion to the Python's exact canvas formula — it may add margins; transcribe the formula, then fix the expected number, not the code.)

- [ ] **Step 2: Run to verify failure**, then **implement**: dedupe imgFiles, fetch with an inline concurrency limiter (~8 at a time):
```ts
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  }));
  return out;
}
```
Default fetcher: `fetch(getCardImageUrl(imgFile))` → non-OK → `console.warn` + null (print-and-skip). Resize every buffer to the fixed cell. Compose per the Python layout math onto a `sharp({create})` canvas; separator SVG text via `renderSvgToPng`; seal composite; `.webp({ quality: 80 })`.

- [ ] **Step 3: Run to verify pass**, then **eyeball with real art**: scratch script rendering `t2_with_reserve.txt` via the real Blob fetcher, save to scratchpad, Read it — grid aligned, overlap correct, separator text crisp, seal placed.

- [ ] **Step 4: Commit**
```bash
git add lib/decksheets/deckImage.ts lib/decksheets/__tests__/deckImage.test.ts
git commit -m "feat(decksheets): deck-image WebP renderer (text_to_webp.py port, fixed 345x495 cells)"
```

### Task 10: pdf.ts — deck-check PDF renderer

**Files:**
- Create: `assets/decksheets/t1_deck_check_v2.pdf`, `assets/decksheets/t2_deck_check_v2.pdf` (copy from `/Users/timestes/projects/redemption-tournament-api/assets/pdfs/`)
- Create: `lib/decksheets/cleanCardName.ts`, `lib/decksheets/pdf.ts`
- Create: `lib/decksheets/__tests__/fixtures/clean_card_name.json` (generated)
- Modify: `generate_fixtures.py` (add `gen_clean_card_name`), `package.json` (add `pdf-lib`), `next.config.js` (tracing includes for the routes — done here so the entry exists before Task 11 creates them)
- Test: `lib/decksheets/__tests__/cleanCardName.test.ts`, `lib/decksheets/__tests__/pdf.test.ts`

**Interfaces:**
- Consumes: `ResolvedDeck`, `sheetSort`, `renderSealPng`.
- Produces: `cleanCardName(name: string, card: ResolvedCard): string` and `generateDeckCheckPdf(opts: { deckType: string; deck: ResolvedDeck; name: string; event: string; showAlignment: boolean; mCountValue: number | null; aodCountValue: number | null; isLegal: boolean | null }): Promise<Uint8Array>`. The route consumes.
- Source of truth: `/Users/timestes/projects/redemption-tournament-api/src/utilities/text_to_pdf.py` (797 lines — read ALL of it before writing). The T1/T2 `section_mappings` coordinate tables, `T1_SECTION_LIMITS`/`T2_SECTION_LIMITS`, `T2_RESERVE_LINE_LIMIT = 20`, alignment colors (green `rgb(0,0.5,0)`, red `rgb(0.8,0,0)`, gray `rgb(0.3,0.3,0.3)`), line spacing 16, T2 header nudge `(+5,+5)`, overflow page (2 columns, margin 50), fonts Helvetica/Helvetica-Bold + Times-Roman (24/20 for name/event), seal 65 pt centered top, reserve rendered one line per copy (`add_quantity=False`) — transcribe ALL of these **verbatim** into `pdf.ts` as typed constants. Do not re-measure, do not round.

- [ ] **Step 1: Add pdf-lib** — `npm install pdf-lib` (from the worktree). Add to `next.config.js` tracing includes:
```js
'/api/v1/generate-decklist': ['./assets/decksheets/**'],
'/api/v1/generate-decklist-image': ['./assets/decksheets/fonts/**'],
```

- [ ] **Step 2: Generate the cleanCardName fixture** — add to `generate_fixtures.py` (guard the import; `text_to_pdf` pulls in reportlab, so if `import` fails, `pip install reportlab` into a scratch venv first):
```python
def gen_clean_card_name(cards):
    from src.utilities.text_to_pdf import clean_card_name
    rows = []
    for c in cards:
        rows.append({"name": c["name"], "type": c.get("type", ""),
                     "reference": c.get("reference", ""), "identifier": c.get("identifier", ""),
                     "expected": clean_card_name(c["name"], c)})
    with open(os.path.join(OUT_DIR, "clean_card_name.json"), "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=1)
```
**Check `clean_card_name`'s real signature/inputs in `text_to_pdf.py` first** and adapt the generator so it passes exactly what the sheet-rendering call sites pass (it may take the card dict, or name + fields).

- [ ] **Step 3: Failing tests** — `cleanCardName.test.ts` iterates the fixture (same shape as the brigades test: every row's `expected` must match). `pdf.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import fs from "fs"; import path from "path";
import { parseDecklistText } from "../parse";
import { resolveDeck } from "../resolve";
import { generateDeckCheckPdf } from "../pdf";

const load = (f: string) =>
  resolveDeck(parseDecklistText(fs.readFileSync(path.join(__dirname, "fixtures/decks", f), "utf8")));

describe("generateDeckCheckPdf", () => {
  it("renders a T1 sheet on the template (single page when nothing overflows)", async () => {
    const bytes = await generateDeckCheckPdf({
      deckType: "type_1", deck: load("t1_multi_brigade.txt"), name: "Test Player",
      event: "Test Event", showAlignment: true, mCountValue: 3.2, aodCountValue: 1.1, isLegal: true,
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(850);
    expect(Math.round(height)).toBe(1100);
  });

  it("adds an overflow page for a T2 deck that exceeds section limits", async () => {
    const bytes = await generateDeckCheckPdf({
      deckType: "type_2", deck: load("t2_with_reserve.txt"), name: "", event: "",
      showAlignment: false, mCountValue: null, aodCountValue: null, isLegal: null,
    });
    // t2_with_reserve.txt must be built to overflow ≥1 section; adjust the deck, not the assertion
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  });

  it("sanitizes non-WinAnsi user text instead of throwing", async () => {
    await expect(generateDeckCheckPdf({
      deckType: "type_1", deck: load("t1_multi_brigade.txt"), name: "Player 😀 Ω",
      event: "Ünïcode Event ✓", showAlignment: false, mCountValue: null, aodCountValue: null, isLegal: null,
    })).resolves.toBeInstanceOf(Uint8Array);
  });
});
```

- [ ] **Step 4: Implement** `pdf.ts`:
  - Load the template (`fs.readFileSync` the asset, `PDFDocument.load`), embed `StandardFonts.Helvetica`, `HelveticaBold`, `TimesRoman`, draw directly on page 0 at the transcribed coordinates (pdf-lib and reportlab share bottom-left-origin points — values transfer 1:1).
  - WinAnsi sanitizer (spec §4/§4.1(5)) applied to EVERY drawn string:
```ts
function sanitizeWinAnsi(font: PDFFont, text: string): string {
  try { font.encodeText(text); return text; } catch {
    return Array.from(text).map((ch) => {
      try { font.encodeText(ch); return ch; } catch { return "?"; }
    }).join("");
  }
}
```
  - Sections filled from `sheetSort` output, per-section line limits, overflow entries collected and rendered on an added blank page (2 columns, margin 50, same fonts) exactly as the Python's overflow function does.
  - Alignment coloring only when `showAlignment` (the three RGB constants above); seal: `renderSealPng` → `doc.embedPng` → 65 pt drawn centered top (transcribe the exact x/y math).
  - Return `doc.save()`.

- [ ] **Step 5: Run to verify pass**, then **eyeball**: scratch script writes a filled T1 + T2 PDF to the scratchpad; rasterize (`sips -s format png` on macOS) and Read next to the Python's output for the same decks (`PYTHONPATH=. DEBUG=1 python3 -c "from src.deck_generators import generate_pdf; generate_pdf(open('<deck>').read(), 'type_1', name='Test', event='E', show_alignment=True, m_count=True, aod_count=True, is_legal=True)"` — output lands in the API repo's `tmp/`). Every entry must sit on the same line of the same box.

- [ ] **Step 6: Commit**
```bash
git add assets/decksheets/t1_deck_check_v2.pdf assets/decksheets/t2_deck_check_v2.pdf lib/decksheets/cleanCardName.ts lib/decksheets/pdf.ts lib/decksheets/__tests__/cleanCardName.test.ts lib/decksheets/__tests__/pdf.test.ts lib/decksheets/__tests__/fixtures/clean_card_name.json lib/decksheets/__tests__/fixtures/generate_fixtures.py package.json package-lock.json next.config.js
git commit -m "feat(decksheets): deck-check PDF renderer (text_to_pdf.py port on v2 templates)"
```

### Task 11: upload.ts + the three routes

**Files:**
- Create: `lib/decksheets/upload.ts`
- Create: `app/api/v1/generate-decklist/route.ts`, `app/api/v1/generate-decklist-image/route.ts`, `app/api/v1/aod-count/route.ts`
- Test: `app/api/v1/__tests__/decksheets-routes.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2-10; `rateLimitForUnauthIp`, `extractClientIp` from `@/lib/api/rateLimit`.
- Produces: the three public endpoints, response contracts per Global Constraints. `uploadDeckArtifact(storagePath: string, body: Uint8Array, contentType: string): Promise<{ filename: string; downloadUrl: string; createdAt: string }>`.
- Contract details (from `routes/decklists.py:25-135`, `routes/decklist_images.py:21-79`, `deck_generators.py:23,122-125,185-188`): PDF storage path = **bare uuid, no extension**, content-type `application/pdf`; image path = `<uuid>.webp`, content-type `image/webp`; bucket `decklists`, upsert; `downloadUrl` = the bucket's public URL for the path; success messages: `"decklist generated successfully"` (PDF, 201), `"deck image generated successfully"` (image, 201), `"aod count calculated successfully"` (aod, 200); aod `data` = `{aod_count}` or the full breakdown when `include_breakdown` is truthy, plus `createdAt` in all three.

- [ ] **Step 1: Write the failing route tests** — follow `app/api/v1/__tests__/decks-route.test.ts`'s pattern (vi.mock `@/lib/api/rateLimit`; also mock `@/lib/decksheets/upload` to avoid live storage):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRateLimit = vi.fn(async () => ({ success: true, limit: 30, remaining: 29, reset: 0 }));
vi.mock("@/lib/api/rateLimit", () => ({
  rateLimitForUnauthIp: (ip: string) => mockRateLimit(),
  extractClientIp: () => "1.2.3.4",
}));
vi.mock("@/lib/decksheets/upload", () => ({
  uploadDeckArtifact: vi.fn(async (path: string) => ({
    filename: path, downloadUrl: `https://example.test/${path}`, createdAt: "2026-08-23T00:00:00.000Z",
  })),
}));

import { POST as aodPost } from "@/app/api/v1/aod-count/route";
import { POST as pdfPost } from "@/app/api/v1/generate-decklist/route";

const req = (body: unknown, raw = false) =>
  new Request("http://x/api/v1/x", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });

const DECK_40 = Array.from({ length: 40 }, () => "1\tSon of God").join("\n"); // resolver merges to qty 40

describe("contract parity", () => {
  beforeEach(() => mockRateLimit.mockResolvedValue({ success: true, limit: 30, remaining: 29, reset: 0 }));

  it("missing fields → 400 {error:'invalid request'}", async () => {
    const res = await aodPost(req({ decklist: "1\tSon of God" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid request" });
  });

  it("non-JSON body → 400 {error:'invalid request'}", async () => {
    const res = await aodPost(req("not json", true));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid request" });
  });

  it("limit violation → 400 {status:'error', message:<verbatim>}", async () => {
    const res = await pdfPost(req({ decklist: "1\tSon of God", decklist_type: "type_1" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      status: "error",
      message: "Please load a deck that contains at least 40 cards in the main deck.",
    });
  });

  it("aod success → 200 with aod_count + createdAt", async () => {
    const res = await aodPost(req({ decklist: DECK_40, decklist_type: "type_1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.message).toBe("aod count calculated successfully");
    expect(typeof body.data.aod_count).toBe("number");
    expect(typeof body.data.createdAt).toBe("string");
  });

  it("include_breakdown adds soul_aod_count + whiff_percentage", async () => {
    const res = await aodPost(req({ decklist: DECK_40, decklist_type: "type_1", include_breakdown: true }));
    const body = await res.json();
    expect(Object.keys(body.data).sort()).toEqual(["aod_count", "createdAt", "soul_aod_count", "whiff_percentage"]);
  });

  it("PDF success → 201 with bare-uuid filename (no extension)", async () => {
    const res = await pdfPost(req({ decklist: DECK_40, decklist_type: "type_1", deck_id: "ignored" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.message).toBe("decklist generated successfully");
    expect(body.data.filename).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rate-limited → 429 {status:'error', message}", async () => {
    mockRateLimit.mockResolvedValue({ success: false, limit: 30, remaining: 0, reset: 0 });
    const res = await aodPost(req({ decklist: DECK_40, decklist_type: "type_1" }));
    expect(res.status).toBe(429);
    expect((await res.json()).status).toBe("error");
  });

  it("limiter throwing fails open (200, not 500)", async () => {
    mockRateLimit.mockRejectedValue(new Error("KV env missing"));
    const res = await aodPost(req({ decklist: DECK_40, decklist_type: "type_1" }));
    expect(res.status).toBe(200);
  });
});
```
Add an equivalent image-route success test (mock `fetchImage`? No — the image route hits Blob; instead assert only the error paths for the image route in unit tests and leave its success path to Task 12's golden run).

- [ ] **Step 2: Implement** `upload.ts`:
```ts
import { createClient } from "@supabase/supabase-js";

export async function uploadDeckArtifact(storagePath: string, body: Uint8Array, contentType: string) {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { error } = await supabase.storage.from("decklists")
    .upload(storagePath, body, { contentType, upsert: true });
  if (error) throw new Error(`decklists upload failed: ${error.message}`);
  const { data } = supabase.storage.from("decklists").getPublicUrl(storagePath);
  return { filename: storagePath, downloadUrl: data.publicUrl, createdAt: new Date().toISOString() };
}
```
(Known micro-deviation: Python's `createdAt` was timezone-less local time; no call site reads it — `GeneratePDFModal` reads only `data.downloadUrl`.)

Then the three routes, shared shape (`export const runtime = "nodejs"`):
```ts
import { NextResponse } from "next/server";
import { rateLimitForUnauthIp, extractClientIp } from "@/lib/api/rateLimit";
import { DeckCheckError } from "@/lib/decksheets/errors";

async function guard(req: Request): Promise<NextResponse | null> {
  try {
    const rl = await rateLimitForUnauthIp(extractClientIp(req));
    if (rl.success === false)
      return NextResponse.json({ status: "error", message: "Too many requests. Please try again shortly." }, { status: 429 });
  } catch { /* fail open: limiter must never 500 (join/actions.ts pattern) */ }
  return null;
}
```
Handler skeleton (PDF route; the others differ only in the generate/upload middle):
```ts
export async function POST(req: Request) {
  const limited = await guard(req);
  if (limited) return limited;
  let data: any;
  try { data = await req.json(); } catch { return NextResponse.json({ error: "invalid request" }, { status: 400 }); }
  if (!data || typeof data !== "object" || !("decklist" in data) || !("decklist_type" in data))
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  try {
    const deck = resolveDeck(parseDecklistText(String(data.decklist)));
    enforceLimits(deck, String(data.decklist_type), false); // image + aod routes pass true
    const mCountValue = data.m_count ? calculateMCount(deck.main) : null;
    const aodCountValue = data.aod_count ? calculateAodBreakdown(deck.main).aod_count : null;
    const bytes = await generateDeckCheckPdf({
      deckType: String(data.decklist_type), deck, name: String(data.name ?? ""),
      event: String(data.event ?? ""), showAlignment: Boolean(data.show_alignment),
      mCountValue, aodCountValue, isLegal: data.is_legal ?? null,
    });
    const uuid = crypto.randomUUID();
    const uploaded = await uploadDeckArtifact(uuid, bytes, "application/pdf");
    return NextResponse.json(
      { status: "success", message: "decklist generated successfully", data: uploaded }, { status: 201 });
  } catch (err) {
    if (err instanceof DeckCheckError)
      return NextResponse.json({ status: "error", message: err.message }, { status: 400 });
    console.error(err);
    return NextResponse.json({ status: "error", message: "something unexpected happened" }, { status: 500 });
  }
}
```
Image route: `enforceLimits(..., true)`, `generateDeckImage` with `nCardColumns: Number(data.n_card_columns ?? 10)`, upload path `` `${uuid}.webp` ``, message `"deck image generated successfully"`. Aod route: `enforceLimits(..., true)`, no upload, 200, `include_breakdown` switch per the contract test.

- [ ] **Step 3: Run to verify pass** — `npx vitest run app/api/v1/__tests__/decksheets-routes.test.ts lib/decksheets`.

- [ ] **Step 4: Manual smoke** — `npm run dev`, POST all three endpoints with `t1_multi_brigade.txt` content via curl; open the returned `downloadUrl`s in a browser (real Supabase Storage round-trip).

- [ ] **Step 5: Commit**
```bash
git add lib/decksheets/upload.ts app/api/v1/generate-decklist app/api/v1/generate-decklist-image app/api/v1/aod-count app/api/v1/__tests__/decksheets-routes.test.ts
git commit -m "feat(decksheets): /api/v1 routes with byte-for-byte Flask contract parity"
```

### Task 12: Golden-output battery vs the live Flask API

**Files:**
- Create: `scripts/decksheets-golden.mjs` (committed; useful for future regressions)
- Delete: `app/api/decksheets-spike/route.ts` + its `next.config.js` tracing entry (spike served its purpose)

**Interfaces:**
- Consumes: the deployed Flask API at `NEXT_PUBLIC_TOURNAMENT_API_ENDPOINT` (read from `.env.local`) and the local dev server.

- [ ] **Step 1: Write the battery script.** For each battery case, POST the same body to `http://localhost:3000/api/v1/<ep>` and `${FLASK}/v1/<ep>`, download both artifacts into `<scratchpad>/golden/<case>-{ts,py}.{pdf,webp}`, and print the AoD/M JSON pairs side by side. Battery (spec §6): (a) T1 with reserve, alignment on, M+AoD on, legal seal; (b) T2 overflowing ≥2 sections + reserve overflow, illegal seal; (c) deck with Lost Soul nickname names; (d) deck containing one unresolvable name; (e) `tiny_8.txt` on aod-count. Reuse/extend the Task 6 fixture decks for these.
- [ ] **Step 2: Run it** (dev server up). For PDFs: rasterize both (`sips -s format png`) and Read them pairwise — every card entry on the same line of the same section box, seal in the same spot. For WebPs: Read pairwise — same order, same grid shape (cell aspect will differ slightly per the §4.1(2) deviation — that is expected and fine). For aod/M: numbers within the §6 tolerances.
- [ ] **Step 3: Fix discrepancies and re-run until clean.** Coordinate parity is the release gate for the PDF route (spec §6) — do not rationalize offsets; fix them.
- [ ] **Step 4: Delete the spike route + its tracing entry.**
- [ ] **Step 5: Commit**
```bash
git add scripts/decksheets-golden.mjs next.config.js
git rm -r app/api/decksheets-spike
git commit -m "test(decksheets): golden-output battery vs live Flask API; drop spike route"
```

### Task 13: Flip the call sites + PR

**Files:**
- Modify: `app/decklist/card-search/components/GeneratePDFModal.tsx:82` (path may differ — locate by grepping for `NEXT_PUBLIC_TOURNAMENT_API_ENDPOINT`)
- Modify: `GenerateDeckImageModal.tsx:70`, `app/decklist/generate/page.tsx:146,195`, `AodCountCard.tsx:89` (same grep finds all five fetches in four files)

- [ ] **Step 1: Flip all five fetches** — each is `` fetch(`${process.env.NEXT_PUBLIC_TOURNAMENT_API_ENDPOINT}/v1/<ep>`, ... `` → `fetch("/api/v1/<ep>", ...`. Change nothing else in those files (request bodies and response handling already match the parity contract). Verify with `grep -rn "NEXT_PUBLIC_TOURNAMENT_API_ENDPOINT" app/` → zero code hits (`.env.example` keeps the var until cutover cleanup).
- [ ] **Step 2: Type-check** — `npx tsc --noEmit` (never `next build` while dev runs — shared `.next`).
- [ ] **Step 3: Manual UI smoke** — dev server: generate a PDF and a deck image from a real deck via the modals, run the AoD card. All three artifacts open.
- [ ] **Step 4: Commit, push, finalize the PR** — title `feat(api): fold the sister decklist API into the tracker (Part 1 of zero-PR releases)`, body links the spec; PR base `origin/main` (fetch first). Full test suite green first: `npx vitest run lib/decksheets app/api/v1`.
- [ ] **Step 5: After merge + Vercel deploy: production smoke** — same three UI flows on the deployed site. Then start the retirement clock: the Flask app idles; check its Vercel logs weekly; archive the repo + delete its Vercel project + remove `NEXT_PUBLIC_TOURNAMENT_API_ENDPOINT` from tracker envs only after ~a week of ZERO traffic (spec §6 — traffic-based, not calendar-based; stale cached clients keep hitting it until they reload).

## Part 2 — zero-PR releases (start only after Part 1 is merged and deployed)

### Task 14: prebuild-catalog script + build wiring

**Files:**
- Create: `scripts/lib/fetch-forge-overlay.js` (extracted), `scripts/prebuild-catalog.js`
- Modify: `scripts/pull-forge-releases.js` (consume the extracted module), `package.json` (build script)
- Test: `scripts/__tests__/prebuild-catalog.test.ts`

**Interfaces:**
- Produces (CommonJS, like all `scripts/`):
  - `fetch-forge-overlay.js`: `async function fetchOverlayRows(supabase): Promise<{rows: object[], skipped: object[]}>` — exactly the release-query + row-mapping logic currently inline in `pull-forge-releases.js:45-95` (same `SYNCED_STATUSES`, same field mapping, same ordering), moved verbatim.
  - `prebuild-catalog.js`: exports pure `decideMode(env): "skip" | "fetch" | "noop"` and `missingReleasedKeys(committedRows, fetchedRows): string[]`; `main()` runs only when invoked directly (`require.main === module` guard).

- [ ] **Step 1: Extract `fetchOverlayRows`** — move the query/mapping block out of `pull-forge-releases.js` verbatim; `pull-forge-releases.js` keeps env loading, the write, and the `parse-carddata.js` exec. Run `make pull-forge-releases` from the MAIN checkout (worktrees lack `.env.local`) and `git diff scripts/data/` — the overlay must be byte-identical (pure refactor proof). Revert the data files if they changed for real upstream reasons; only commit the two script files.
- [ ] **Step 2: Failing tests** for the pure functions:

```ts
import { describe, it, expect } from "vitest";
// @ts-expect-error CJS script module
import { decideMode, missingReleasedKeys } from "../prebuild-catalog.js";

describe("decideMode (spec §5 gate order)", () => {
  it("CATALOG_PREBUILD=0 wins over everything (kill switch)", () =>
    expect(decideMode({ CATALOG_PREBUILD: "0", VERCEL: "1" })).toBe("skip"));
  it("VERCEL → fetch", () => expect(decideMode({ VERCEL: "1" })).toBe("fetch"));
  it("CATALOG_PREBUILD=1 forces fetch locally", () =>
    expect(decideMode({ CATALOG_PREBUILD: "1" })).toBe("fetch"));
  it("plain local/CI → noop", () => expect(decideMode({})).toBe("noop"));
});

describe("missingReleasedKeys (monotonicity guard)", () => {
  const committed = [{ name: "Might of Angels", set: "Pmo-2026" }];
  it("empty fetch reports the missing key", () =>
    expect(missingReleasedKeys(committed, [])).toEqual(["Might of Angels|Pmo-2026"]));
  it("superset fetch passes", () =>
    expect(missingReleasedKeys(committed, [...committed, { name: "New", set: "X" }])).toEqual([]));
});
```

- [ ] **Step 3: Implement `prebuild-catalog.js`**: `decideMode` per the spec §5 order (kill switch → fetch-on-Vercel/forced → noop). In fetch mode: load `.env.local` via dotenv (harmless no-op on Vercel); missing `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` → log + `process.exit(1)` (never a silent fallback — spec §5.2); `fetchOverlayRows`; guard: `missingReleasedKeys(JSON.parse(fs.readFileSync('scripts/data/forge-released.json')), rows)` non-empty → log the keys + exit 1; write the overlay; `execFileSync('node', ['scripts/parse-carddata.js'], {stdio:'inherit'})`. `noop`/`skip` → log one line and exit 0.
- [ ] **Step 4: Wire the build** — `package.json`: `"build": "node scripts/prebuild-catalog.js && next build"` (explicit chain, NOT an npm `prebuild` hook — spec §5.1). Verify locally: `npm run build` prints the noop line and builds (use `NEXT_DIST_DIR=.next-build` if a dev server is running); `CATALOG_PREBUILD=1 npm run build` from the main checkout fetches and passes the guard; `CATALOG_PREBUILD=1 NEXT_PUBLIC_SUPABASE_URL= npm run build` exits 1 before `next build` runs.
- [ ] **Step 5: Run tests, commit**
```bash
git add scripts/lib/fetch-forge-overlay.js scripts/prebuild-catalog.js scripts/pull-forge-releases.js scripts/__tests__/prebuild-catalog.test.ts package.json
git commit -m "feat(release): build-time catalog fetch with kill switch + monotonicity guard"
```

### Task 15: Deploy-catalog button, release-page copy, bundle-route deletion

**Files:**
- Modify: `app/forge/lib/promote.ts` (new `deployCatalog` action; `no_reference` warning copy at ~line 282)
- Modify: `app/forge/sets/[setId]/promote/PromoteClient.tsx` (MergeStep ~608-670, DoneStep ~713-760)
- Delete: `app/forge/api/promote/bundle/[releaseId]/route.ts` (+ any bundle-README helper module it alone imports — check its imports before deleting)
- Test: extend the existing promote tests if present (grep `app/forge` for existing `*.test.*` and follow suit); otherwise `tsc --noEmit` + manual dev-server pass gate this task.

**Interfaces:**
- Produces: `deployCatalog(): Promise<{ ok: boolean; error?: string }>` — server action, same superadmin gate as the sibling actions in `promote.ts` (match `verifyReleaseLive`'s auth pattern exactly); POSTs `VERCEL_DEPLOY_HOOK_URL`; missing env → `{ ok: false, error: "VERCEL_DEPLOY_HOOK_URL is not configured" }`; non-2xx hook response → `{ ok: false, error: \`deploy hook returned ${status}\` }`.

- [ ] **Step 1: Human setup (cannot be done by an agent)**: in the Vercel dashboard create a Deploy Hook for branch `main` (Project → Settings → Git → Deploy Hooks) and add its URL as `VERCEL_DEPLOY_HOOK_URL` (Production env at minimum) plus to `.env.local`. Record that it exists in the PR description.
- [ ] **Step 2: Implement `deployCatalog`** in `promote.ts` following the file's existing action structure (auth guard first, then `fetch(process.env.VERCEL_DEPLOY_HOOK_URL, { method: "POST" })`).
- [ ] **Step 3: Rewrite MergeStep** — replace the two-`<li>` ordered list ("Tracker: … make pull-forge-releases …" / "API repo: … download the release bundle …") with: a **Deploy catalog** button calling `deployCatalog` (busy state, error display, success note "Build triggered — watch it in the Vercel dashboard, then Verify below once it's live"), plus the static note "Any ordinary merge to main also picks this release up." Update the Verify panel's sentence "Passes only after the tracker PR above is deployed." → "Passes once a deployment built after this release went live."
- [ ] **Step 4: Copy + deletions** — `promote.ts` `no_reference` warning: `"…it will need a testament override in the overlay PR."` → `"…it will need a testament override (TESTAMENT_OVERRIDES) in a follow-up code PR."`. DoneStep: delete the "Bundle stays available" paragraph + its `<a>`; keep the follow-ups list (those are the honest still-PRs, spec §5.6). Delete the bundle route directory. `grep -rn "promote/bundle" app/ docs/ Makefile` → the only remaining hits should be historical docs/specs (leave those).
- [ ] **Step 5: Verify** — `npx tsc --noEmit`; dev server: open a released set's promote page (any `decks_migrated` release renders DoneStep — confirm no bundle link; MergeStep needs an `images_done` release — if none exists, verify the component renders via the code path review and rely on Task 17's drill).
- [ ] **Step 6: Commit**
```bash
git add app/forge/lib/promote.ts "app/forge/sets/[setId]/promote/PromoteClient.tsx"
git rm -r "app/forge/api/promote/bundle"
git commit -m "feat(release): Deploy-catalog button via Vercel deploy hook; drop the two-PR merge card"
```

### Task 16: Abort fires the deploy hook

**Files:**
- Modify: `app/forge/lib/promote.ts` — the abort action (find it: grep `forge_abort_release` in `app/forge`; blob deletion lives at ~promote.ts:574-589)
- Test: same gate as Task 15 (type-check + the Task 17 drill).

- [ ] **Step 1: Implement** — in the abort action, after the blob deletions and the `forge_abort_release` RPC both succeed, when the release's status was `images_done`: if `VERCEL_DEPLOY_HOOK_URL` is set, POST it; on failure (or unset env) return the abort as successful but include a warning string the AbortButton surfaces: `"Aborted, but the catalog redeploy could not be triggered — press Deploy catalog or merge to main to purge the aborted cards."` (spec §5.5: a build fetched during the images_done window shipped rows whose images just vanished; the hook rebuild purges them).
- [ ] **Step 2: Type-check, commit**
```bash
git add app/forge/lib/promote.ts
git commit -m "feat(release): abort triggers a catalog redeploy to purge in-flight fetches"
```

### Task 17: Part 2 PR + production pass and failure drills

- [ ] **Step 1: PR** — `feat(release): zero-PR catalog releases (Part 2)`, base `origin/main`, body links the spec + notes the deploy-hook env setup. Suite green: `npx vitest run`.
- [ ] **Step 2: After merge — first production pass** (spec §6; this IS production, there is no staging): with the next real wave at `images_done`, press **Deploy catalog**; watch the Vercel build log for the prebuild fetch lines; verify-live green; migrate decks.
- [ ] **Step 3: Failure drills** (safe: a failed build never becomes the serving deployment):
  - Bad key: temporarily set `SUPABASE_SERVICE_ROLE_KEY` to garbage in a PREVIEW-scoped env, push a throwaway branch, confirm the preview build exits 1 with the loud message, restore.
  - Monotonicity: run locally — `CATALOG_PREBUILD=1 NEXT_PUBLIC_SUPABASE_URL=<url-of-empty-branch-or-wrong-project> npm run build` → exit 1 listing the missing released keys. (If no safe wrong-project exists, simulate: point the guard at a hand-edited `forge-released.json` copy with an extra fake key via a temporary test, already covered by Task 14's unit test — note which form the drill took.)
- [ ] **Step 4: Documentation sweep** — update `prompt_context/forge_versioning.md` + CLAUDE.md's Forge-promotion row (drop `make pull-forge-releases` as a release step; it's now the dev-snapshot refresher), and the memory files per spec §7 ("new card = 3 places" collapses). Amending the catalog-admin-editor spec stays a SEPARATE piece of work before that project implements (spec §7) — do not fold it in here.

## Self-review notes (already applied)

- Spec §4 module table ↔ Tasks 2-11 one-to-one; §4.1 deviations land in Tasks 2 (.dek dropped — nothing to do, the parser only ever takes text), 9 (fixed cell), 10 (WinAnsi), 11 (429 envelope, `/`+`/about` unported); §5 bullets ↔ Tasks 14-16; §6 verification ↔ Tasks 6/11/12/17.
- Type names are consistent: `DeckCheckError`, `ParsedDeck`, `ResolvedDeck`, `ResolvedCard` (fields `quantity`/`rawBrigade`/`brigades`), `sheetSort`, `renderSealPng`, `generateDeckImage`, `generateDeckCheckPdf`, `uploadDeckArtifact`, `decideMode`, `missingReleasedKeys`, `fetchOverlayRows`.
- The five call-site line numbers are from 2026-08-23 HEAD; the flip task greps rather than trusting them.
