# WS-3: Decks Tab — Deck Products as Decklists (Pull-Contents Wizard)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute this plan task-by-task with review checkpoints. Read `docs/superpowers/plans/2026-08-03-ytg-store/00-overview.md` first (shared contracts), then the spec `docs/superpowers/specs/2026-08-03-ytg-store-admin-design.md` §Decks tab + §Migration 089 — they are the behavioral authority for everything below.

**Goal:** Deck products in the `shopify_products` mirror become real, public decklists owned by the YTG account. The Decks tab lists deck products (linked/not-linked), and a pull-contents wizard parses each product's `body_html` into decklist lines, lets the admin resolve/drop every line, then creates the deck + `ytg_deck_links` row via the service-role client — with a race-safe claim protocol, a name-collision suffix, and a replace flow that refuses while a sale is pending/applying. Migration 089 (deck links + WS-4's sales ledger) ships as a committed file, never applied here.

**Architecture:** A pure, heavily unit-tested parser (`lib/ytg/deckContentsParser.ts`) turns HTML into `ParsedLine[]` resolved against `CARDS` using reversed `set_aliases` candidate lists plus carddata set-code identities. DB mutations live in `lib/ytg/deckLinkOps.ts` (injected admin client, so the create-conflict compensation is unit-testable without a live DB) and are wrapped by permission-checked server actions in `app/admin/ytg/decks/actions.ts`. UI is a server-rendered list page plus a route-page wizard at `/admin/ytg/decks/[productId]` (shareable URL), all inside the WS-0 shell.

**Tech stack:** Next.js 15 App Router, React 19, TS (`strict:false` — narrow unions with explicit `=== false`), Supabase service-role via `lib/pricing/supabase-admin`, Tailwind + shadcn/ui, vitest.

## Global constraints

All of overview §Global constraints, plus:

- **Branch:** `feat/ytg-deck-wizard`. **Worktree:** `../rtt-ytg-decks` (absolute path `/Users/timestes/projects/rtt-ytg-decks`). All work inside it, absolute paths, `git add` only your files, PR bases `origin/main`.
- **MIGRATION 089: commit the file, NEVER apply it.** No Supabase MCP `apply_migration`, no `execute_sql` DDL, from this workstream — the primary session applies 089 after this PR merges. Consequence: the DB-touching actions cannot be exercised end-to-end from this workstream; the parser and deckLinkOps unit suites are the verification core, plus a documented manual checklist for the primary session (Task 8).
- **Do not touch** `app/admin/ytg/layout.tsx`, `app/admin/ytg/components/*`, other workstreams' directories, or `lib/pricing/syncShopifyProducts.ts`. WS-3 owns only the files listed in tasks below.
- **Permission key** `manage_shopify_imports` re-checked inside every server action (layout gating does not protect actions). Never create a new permission.
- Deck writes go through `getSupabaseAdmin()` — RLS has no admin bypass on `decks`/`deck_cards`, and the decks belong to `YTG_ACCOUNT_USER_ID`, not the acting admin.
- Tests: `npx vitest run <path>`; type gate `npx tsc --noEmit`. Never `next build` while a dev server runs.
- Design: `prompt_context/design_system.md` — data-dense, mobile-first, no `focus:ring-2`, green accent only for live/CTA states.

## Interfaces produced (WS-4 consumes these — do not drift)

- **`ytg_deck_links`** (migration 089): `shopify_product_id TEXT PK`, `deck_id UUID UNIQUE NOT NULL REFERENCES decks(id) ON DELETE RESTRICT`, `handle TEXT`, `product_title TEXT`, `created_by UUID`, `created_at TIMESTAMPTZ DEFAULT now()`. Service-role only (RLS enabled, no policies, REVOKE anon/authenticated).
- **Sale-guard convention:** any contents mutation for a product first checks `ytg_deck_sales WHERE shopify_product_id = $1 AND status IN ('pending','applying')` and refuses with the exact error string `"a sale is being recorded for this product"`. WS-4's partial unique index enforces the single-active-sale invariant this reads.
- **`YTG_ACCOUNT_USER_ID`** in `lib/ytg/constants.ts` = `"81b987d2-f030-4559-aad1-e5cf7405e74a"`.
- Parser + action signatures exactly as written in Tasks 3–5.

## Interfaces consumed

- `getSupabaseAdmin()` — `lib/pricing/supabase-admin.ts`
- `hasPermission(permission)` — `utils/adminUtils.ts`
- `CARDS`, `CardData` — `lib/cards/lookup.ts`; `normalize`, `stripEmbeddedSet` — `lib/pricing/helpers.ts`
- `DECK_PRODUCT_TYPES` — `lib/ytg/constants.ts` (WS-0 created it)
- `syncShopifyProducts(): Promise<{ upserted: number; errors: number }>` — `lib/pricing/syncShopifyProducts.ts` (post-WS-0 signature)
- `getCardImageUrl(imgFile)` — `app/shared/utils/cardImageUrl.ts`
- Public deck view URL pattern: **`/decklist/${deckId}`** (verified in `app/decklist/community/client.tsx`); builder edit URL is `/decklist/card-search?deckId=${deckId}` (not used for viewing).
- Deck schema facts (verified): `decks` has `id, user_id, name, description, format, visibility, card_count, preview_card_1, preview_card_2` with an `updated_at` BEFORE UPDATE trigger (001/041); `deck_cards` is `UNIQUE (deck_id, card_name, card_set, zone)` with `zone IN ('main','reserve','maybeboard')` (028/029). Canonical deck formats are `Limited | Unlimited | T2 | Paragon` (migration 081 retired `'T1'`; `normalizeFormat('T1') → 'Limited'`) — **we write `format: 'Limited'`**, the canonical id for what the spec calls T1.

---

### Task 1: Worktree setup + WS-0 precondition check

**Files:** none created — environment only.

- [ ] Create the worktree and install deps:
  ```bash
  cd /Users/timestes/projects/redemption-tournament-tracker
  git fetch origin
  git worktree add ../rtt-ytg-decks -b feat/ytg-deck-wizard origin/main
  cd /Users/timestes/projects/rtt-ytg-decks
  npm install
  ```
- [ ] Verify WS-0 has merged (hard prerequisite). All four must exist:
  ```bash
  ls /Users/timestes/projects/rtt-ytg-decks/app/admin/ytg/decks/page.tsx
  ls /Users/timestes/projects/rtt-ytg-decks/lib/ytg/constants.ts
  grep -n "DECK_PRODUCT_TYPES" /Users/timestes/projects/rtt-ytg-decks/lib/ytg/constants.ts
  grep -n "upserted" /Users/timestes/projects/rtt-ytg-decks/lib/pricing/syncShopifyProducts.ts
  ```
  **If any is missing, STOP and report — WS-0 has not merged; this plan cannot start.**
- [ ] Baseline sanity: `npx vitest run lib/pricing/__tests__` and `npx tsc --noEmit` both pass on the fresh worktree.

---

### Task 2: Migration 089 (file only) + YTG account constant

**Files:**
- Create: `supabase/migrations/089_ytg_deck_links_and_sales.sql`
- Modify: `lib/ytg/constants.ts` (add one exported constant; do not touch `DECK_PRODUCT_TYPES`)

**Interfaces produced:** the three tables above; `YTG_ACCOUNT_USER_ID`.

- [ ] Create `supabase/migrations/089_ytg_deck_links_and_sales.sql` with exactly this content (spec §Migration 089 verbatim — `ytg_deck_sales`/`ytg_deck_sale_items` belong to WS-4 but ship in this migration by contract; RLS/REVOKE posture copied from `080_create_shopify_card_imports.sql`):

  ```sql
  -- 089_ytg_deck_links_and_sales.sql
  -- WS-3: deck-product ↔ decklist links. WS-4's sales ledger ships here too
  -- (shared migration per docs/superpowers/specs/2026-08-03-ytg-store-admin-design.md).
  -- Service-role access only — RLS enabled with NO policies, grants revoked,
  -- same posture as shopify_card_imports (080).
  --
  -- DO NOT APPLY from a workstream agent. The primary session applies this via
  -- Supabase MCP after the WS-3 PR merges (overview §Sequencing).

  CREATE TABLE public.ytg_deck_links (
    shopify_product_id TEXT PRIMARY KEY,
    -- ON DELETE RESTRICT, not CASCADE: once linked, the deck is store metadata.
    -- Deleting it from the deck builder fails until the product is unlinked here.
    deck_id            UUID UNIQUE NOT NULL REFERENCES public.decks(id) ON DELETE RESTRICT,
    handle             TEXT,
    product_title      TEXT,
    created_by         UUID,
    created_at         TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE public.ytg_deck_sales (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shopify_product_id TEXT NOT NULL,
    deck_id            UUID NOT NULL,  -- no FK: sale history outlives links
    qty                INT NOT NULL CHECK (qty > 0),
    status             TEXT CHECK (status IN ('pending','applying','applied','partial','failed',
                                              'dry_run','undoing','undone','undo_partial')),
    created_by         UUID,
    created_at         TIMESTAMPTZ DEFAULT now(),
    undone_by          UUID,
    undone_at          TIMESTAMPTZ
  );

  -- One active sale per product; also what the WS-3 replace-guard reads.
  CREATE UNIQUE INDEX idx_ytg_deck_sales_active_per_product
    ON public.ytg_deck_sales(shopify_product_id)
    WHERE status IN ('pending','applying');

  CREATE TABLE public.ytg_deck_sale_items (
    sale_id           UUID REFERENCES public.ytg_deck_sales(id) ON DELETE CASCADE,
    card_key          TEXT NOT NULL,
    card_name         TEXT,
    qty_per_deck      INT NOT NULL,
    delta             INT NOT NULL,
    qty_before        INT,            -- CAS anchors; also the resume oracle
    qty_after         INT,
    single_product_id TEXT,
    variant_id        TEXT,
    inventory_item_id TEXT,
    status            TEXT CHECK (status IN ('pending','applying','applied','skipped_unmapped',
                                             'skipped_untracked','error','conflict','undone','undo_conflict')),
    error             TEXT,
    PRIMARY KEY (sale_id, card_key)   -- quantities summed per card_key pre-insert
  );

  ALTER TABLE public.ytg_deck_links      ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.ytg_deck_sales      ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.ytg_deck_sale_items ENABLE ROW LEVEL SECURITY;

  REVOKE ALL ON public.ytg_deck_links      FROM anon, authenticated;
  REVOKE ALL ON public.ytg_deck_sales      FROM anon, authenticated;
  REVOKE ALL ON public.ytg_deck_sale_items FROM anon, authenticated;
  ```

- [ ] Append to `lib/ytg/constants.ts` (below the existing `DECK_PRODUCT_TYPES` export, exactly per overview §Constants):

  ```ts
  // yourturngamesin@gmail.com — Andy Fish's account; decks the store tooling creates live here
  export const YTG_ACCOUNT_USER_ID = "81b987d2-f030-4559-aad1-e5cf7405e74a";
  ```

- [ ] `npx tsc --noEmit` passes.
- [ ] Commit:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-decks
  git add supabase/migrations/089_ytg_deck_links_and_sales.sql lib/ytg/constants.ts
  git commit -m "feat(ytg): migration 089 (deck links + sales ledger, file only) + YTG account constant"
  ```

---

### Task 3: Real-store fixtures + deck-contents parser (TDD — the core deliverable)

**Files:**
- Create: `lib/ytg/__tests__/fixtures/fiery-furnace.html`
- Create: `lib/ytg/__tests__/fixtures/daniel-contender.html`
- Create: `lib/ytg/__tests__/deckContentsParser.test.ts`
- Create: `lib/ytg/deckContentsParser.ts`

**Interfaces produced (exact — the wizard and Task 5 consume these):**

```ts
export interface ParsedCandidate {
  cardKey: string;    // `${name}|${set}|${imgFile}` — canonical card key; imgFile derivable via cardKey.split('|')[2]
  cardName: string;
  setCode: string;
  confidence: number;
}
export interface ParsedLine {
  raw: string;
  qty: number;
  name: string;
  setAbbrev: string | null;
  candidates: ParsedCandidate[];
  status: "resolved" | "ambiguous" | "unresolved";
  section: string | null;
}
export function buildAliasCandidates(rows: { carddata_code: string; shopify_abbrev: string }[]): Map<string, string[]>;
export function parseDeckContents(bodyHtml: string, aliasCandidates: Map<string, string[]>): ParsedLine[];
export function htmlToLines(html: string): string[];        // exported for tests
export function sectionHeader(line: string): string | null; // exported for tests
```

**Interfaces consumed:** `CARDS` (`lib/cards/lookup.ts`), `normalize`/`stripEmbeddedSet` (`lib/pricing/helpers.ts`).

- [ ] **Fetch the real fixtures** (storefront `.js` `.description` field is the same HTML as REST `body_html`):
  ```bash
  mkdir -p /Users/timestes/projects/rtt-ytg-decks/lib/ytg/__tests__/fixtures
  curl -s "https://www.yourturngames.biz/products/the-fiery-furnace.js" \
    | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).description))" \
    > /Users/timestes/projects/rtt-ytg-decks/lib/ytg/__tests__/fixtures/fiery-furnace.html
  curl -s "https://www.yourturngames.biz/products/new-daniel-heroes-babylonians-contender-deck.js" \
    | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).description))" \
    > /Users/timestes/projects/rtt-ytg-decks/lib/ytg/__tests__/fixtures/daniel-contender.html
  ```
  Sanity: both files are non-empty HTML (`head -c 200` each; Fiery Furnace starts with `<div style=`). If either 404s or is empty, STOP — do not fabricate fixtures.
- [ ] **Write the failing test file** `lib/ytg/__tests__/deckContentsParser.test.ts`. Every fixture assertion below was verified against the live store description and `lib/cards/generated/cardData.json` on 2026-08-03; if the store edited a description since, inspect the fixture, confirm the parser behavior is still per-spec, and adjust only the drifted assertion (note it in the commit message).

  ```ts
  import { describe, it, expect } from "vitest";
  import { readFileSync } from "fs";
  import path from "path";
  import {
    parseDeckContents, buildAliasCandidates, htmlToLines, sectionHeader,
    type ParsedLine,
  } from "../deckContentsParser";

  // Full set_aliases seed (migration 011 L63-109) — tests must not need a DB.
  const SEED: { carddata_code: string; shopify_abbrev: string }[] = [
    { carddata_code: "Ki", shopify_abbrev: "Ki" },
    { carddata_code: "Pri", shopify_abbrev: "Pi" },
    { carddata_code: "Pat", shopify_abbrev: "Pa" },
    { carddata_code: "RR", shopify_abbrev: "Roots" },
    { carddata_code: "T2C", shopify_abbrev: "TtC" },
    { carddata_code: "War", shopify_abbrev: "Wa" },
    { carddata_code: "Wom", shopify_abbrev: "Wo" },
    { carddata_code: "FoOF", shopify_abbrev: "FooF" },
    { carddata_code: "TEC", shopify_abbrev: "EC" },
    { carddata_code: "TPC", shopify_abbrev: "PC" },
    { carddata_code: "Prp", shopify_abbrev: "Pr" },
    { carddata_code: "Pmo-P1", shopify_abbrev: "Promo" },
    { carddata_code: "Pmo-P2", shopify_abbrev: "Promo" },
    { carddata_code: "Pmo-P3", shopify_abbrev: "Promo" },
    { carddata_code: "I/J+", shopify_abbrev: "I & J+" },
    { carddata_code: "K", shopify_abbrev: "K Deck" },
    { carddata_code: "K1P", shopify_abbrev: "K Deck" },
    { carddata_code: "L", shopify_abbrev: "L Deck" },
    { carddata_code: "L1P", shopify_abbrev: "L Deck" },
    { carddata_code: "A", shopify_abbrev: "A Deck" },
    { carddata_code: "B", shopify_abbrev: "B Deck" },
    { carddata_code: "C", shopify_abbrev: "C Deck" },
    { carddata_code: "D", shopify_abbrev: "D Deck" },
    { carddata_code: "E", shopify_abbrev: "E Deck" },
    { carddata_code: "F", shopify_abbrev: "F Deck" },
    { carddata_code: "G", shopify_abbrev: "G Deck" },
    { carddata_code: "H", shopify_abbrev: "H Deck" },
    { carddata_code: "I", shopify_abbrev: "I Deck" },
    { carddata_code: "J", shopify_abbrev: "J Deck" },
    { carddata_code: "CoW (AB)", shopify_abbrev: "CoW AB" },
    { carddata_code: "RoJ (AB)", shopify_abbrev: "RoJ AB" },
    { carddata_code: "Ap", shopify_abbrev: "Ap" },
    { carddata_code: "GoC", shopify_abbrev: "GoC" },
    { carddata_code: "FoM", shopify_abbrev: "FoM" },
    { carddata_code: "LoC", shopify_abbrev: "LoC" },
    { carddata_code: "Di", shopify_abbrev: "Di" },
    { carddata_code: "Wo", shopify_abbrev: "Wo" },
    { carddata_code: "AW", shopify_abbrev: "AW" },
    { carddata_code: "CoW", shopify_abbrev: "CoW" },
    { carddata_code: "II", shopify_abbrev: "II" },
    { carddata_code: "IR", shopify_abbrev: "IR" },
    { carddata_code: "PoC", shopify_abbrev: "PoC" },
    { carddata_code: "RoA", shopify_abbrev: "RoA" },
    { carddata_code: "RoA 3", shopify_abbrev: "RoA" },
    { carddata_code: "RoJ", shopify_abbrev: "RoJ" },
    { carddata_code: "TxP", shopify_abbrev: "TxP" },
  ];
  const ALIASES = buildAliasCandidates(SEED);
  const fixture = (f: string) =>
    readFileSync(path.join(__dirname, "fixtures", f), "utf8");
  const byRaw = (lines: ParsedLine[], raw: string): ParsedLine => {
    const hit = lines.find((l) => l.raw === raw);
    if (!hit) throw new Error(`line not found in parse output: ${raw}`);
    return hit;
  };

  describe("buildAliasCandidates", () => {
    it("reverses set_aliases into candidate LISTS (non-injective abbrevs)", () => {
      expect(ALIASES.get("promo")).toEqual(["Pmo-P1", "Pmo-P2", "Pmo-P3"]);
      expect(ALIASES.get("k deck")).toEqual(["K", "K1P"]);
      expect(ALIASES.get("l deck")).toEqual(["L", "L1P"]);
      expect(ALIASES.get("roa")).toEqual(expect.arrayContaining(["RoA", "RoA 3"]));
      expect(ALIASES.get("roa")).toHaveLength(2);
      expect(ALIASES.get("wo")).toEqual(expect.arrayContaining(["Wom", "Wo"]));
    });
    it("adds identity entries for carddata set codes (store lines use them raw)", () => {
      expect(ALIASES.get("k")).toEqual(["K"]);
      expect(ALIASES.get("poc")).toContain("PoC");
      expect(ALIASES.get("i/j+")).toContain("I/J+");
    });
  });

  describe("htmlToLines / sectionHeader", () => {
    it("treats <br> and </p> as line breaks, decodes entities, drops empties", () => {
      expect(htmlToLines("<p>A &amp; B<br>C&rsquo;s</p><p>&nbsp;</p><p>D</p>"))
        .toEqual(["A & B", "C\u2019s", "D"]);
    });
    it("recognizes slash-composed section headers case-insensitively", () => {
      expect(sectionHeader("Artifacts/Covenants/Curses")).toBe("Artifacts/Covenants/Curses");
      expect(sectionHeader("FORTRESSES/SITES/CITIES")).toBe("FORTRESSES/SITES/CITIES");
      expect(sectionHeader("Lost Souls")).toBe("Lost Souls");
      expect(sectionHeader("Babylon (TtC)")).toBeNull();
      expect(sectionHeader("Deck strategy and tips:")).toBeNull();
    });
  });

  describe("line grammar", () => {
    it("parses qty prefixes (N), Nx, xN and defaults to 1", () => {
      const lines = parseDeckContents(
        "<p>(3) Told to Take (TtC)<br>2x Told to Take (TtC)<br>x4 Told to Take (TtC)<br>Told to Take (TtC)</p>",
        ALIASES,
      );
      expect(lines.map((l) => l.qty)).toEqual([3, 2, 4, 1]);
      expect(lines.every((l) => l.status === "resolved")).toBe(true);
      expect(lines[0].candidates[0].cardKey).toBe("Told to Take|T2C|123-Told-to-Take");
    });
    it("drops prose lines (>90 chars, no trailing paren)", () => {
      const prose = "This deck tells that story and the overall story of Judah's captivity in Babylon and beyond it".padEnd(95, "!");
      expect(parseDeckContents(`<p>${prose}</p>`, ALIASES)).toHaveLength(0);
    });
    it("flags ambiguous when BOTH parses resolve to different cards — never auto-picks", () => {
      // Handcrafted alias map: 'UL' aliases CoW, which contains "Samuel (CoW)"
      // (parse A), while "Samuel (UL)" itself is a real card in Main UL (parse B).
      const lines = parseDeckContents("<p>Samuel (UL)</p>", new Map([["ul", ["CoW"]]]));
      expect(lines).toHaveLength(1);
      expect(lines[0].status).toBe("ambiguous");
      const keys = lines[0].candidates.map((c) => c.cardKey);
      expect(keys).toContain("Samuel (CoW)|CoW|Samuel_(CoW)");
      expect(keys).toContain("Samuel (UL)|Main UL|Samuel_(UL)");
    });
  });

  describe("fixture: fiery-furnace.html (live store description)", () => {
    const lines = parseDeckContents(fixture("fiery-furnace.html"), ALIASES);

    it("parses exactly the 57 card lines (10 section headers + prose consumed)", () => {
      expect(lines).toHaveLength(57);
      expect(lines.reduce((s, l) => s + l.qty, 0)).toBe(59); // O.T. meek is x3
      expect(lines.some((l) => l.raw.startsWith("The story of Daniel"))).toBe(false);
    });
    it("resolves 'Son of God (K)' — identity set code + embedded-set card name", () => {
      const l = byRaw(lines, "Son of God (K)");
      expect(l.qty).toBe(1);
      expect(l.status).toBe("resolved");
      expect(l.section).toBe("Dominants");
      expect(l.candidates[0].cardKey).toBe("Son of God [K]|K|K1-Son-of-God");
    });
    it("'(3) O.T. meek (I)' → qty 3, set resolves but card unknown → unresolved", () => {
      const l = byRaw(lines, "(3) O.T. meek (I)");
      expect(l.qty).toBe(3);
      expect(l.name).toBe("O.T. meek");
      expect(l.setAbbrev).toBe("I");
      expect(l.status).toBe("unresolved");
      expect(l.section).toBe("Lost Souls");
    });
    it("resolves via TtC → T2C alias", () => {
      const l = byRaw(lines, "Perplexing Vision (TtC)");
      expect(l.status).toBe("resolved");
      expect(l.candidates[0].setCode).toBe("T2C");
    });
    it("handles smart quotes (U+2019)", () => {
      const l = byRaw(lines, "The King\u2019s Henchmen (TtC)");
      expect(l.status).toBe("resolved");
      expect(l.candidates[0].cardKey).toBe("The King's Henchmen|T2C|118-The-Kings-Henchmen");
    });
    it("'Grapes of Wrath (GoC LR)' — paren is NOT an alias → part of name → multi-hit ambiguous", () => {
      const l = byRaw(lines, "Grapes of Wrath (GoC LR)");
      expect(l.setAbbrev).toBeNull();
      expect(l.status).toBe("ambiguous");
      expect(l.candidates.length).toBeGreaterThanOrEqual(2); // TxP print + GoC LR print
    });
    it("'Christian Martyr (I/J)' — unknown paren stays in the name → unresolved", () => {
      const l = byRaw(lines, "Christian Martyr (I/J)");
      expect(l.setAbbrev).toBeNull();
      expect(l.name).toBe("Christian Martyr (I/J)");
      expect(l.status).toBe("unresolved");
    });
    it("ambiguous alias RoA←{RoA, RoA 3} disambiguated by containment", () => {
      const l = byRaw(lines, "Scattered (RoA)");
      expect(l.section).toBe("Reserve");
      expect(l.status).toBe("resolved");
      expect(l.candidates[0].setCode).toBe("RoA 3"); // only RoA 3 contains 'Scattered'
    });
    it("falls back across sets when the abbrev's sets lack the card", () => {
      // Store says Roots; the only print is RoA. Unique global hit → resolved.
      const l = byRaw(lines, "Nebuchadnezzar\u2019s Pride (Roots)");
      expect(l.status).toBe("resolved");
      expect(l.candidates[0].setCode).toBe("RoA");
      // T2C has no 'Nebuchadnezzar' → global fallback finds 3 prints → ambiguous.
      const n = byRaw(lines, "Nebuchadnezzar (TtC)");
      expect(n.status).toBe("ambiguous");
      expect(n.candidates.length).toBeGreaterThanOrEqual(2);
    });
    it("Lost Soul store-vs-carddata naming lands in manual resolution (spec expectation)", () => {
      expect(byRaw(lines, "Contempt (TtC)").status).toBe("unresolved");
    });
  });

  describe("fixture: daniel-contender.html (live store description)", () => {
    const lines = parseDeckContents(fixture("daniel-contender.html"), ALIASES);

    it("'Son of God (K Deck)' → ambiguous across K and K1P (both contain it)", () => {
      const l = byRaw(lines, "Son of God (K Deck)");
      expect(l.status).toBe("ambiguous");
      expect(l.candidates.map((c) => c.setCode).sort()).toEqual(["K", "K1P"]);
    });
    it("'New Jerusalem (I & J+ or Promo)' — prose-ish paren → unresolved, paren kept", () => {
      const l = byRaw(lines, "New Jerusalem (I & J+ or Promo)");
      expect(l.setAbbrev).toBeNull();
      expect(l.status).toBe("unresolved");
    });
    it("folds doubled straight quotes to match carddata curly-quote names", () => {
      const l = byRaw(lines, "Lost Soul ''Idolaters'' [Daniel 3:7] (TtC)");
      expect(l.status).toBe("resolved");
      expect(l.candidates[0].cardKey).toBe('Lost Soul "Idolaters" [Daniel 3:7]|T2C|021-Lost-Soul-Idolaters');
    });
    it("smart-double-quoted scripture Lost Souls with reordered names stay unresolved", () => {
      const l = byRaw(lines, "Lost Soul (Psalm 78:22) \u201CO.T. Only\u201D (FoM)");
      expect(l.setAbbrev).toBe("FoM");
      expect(l.status).toBe("unresolved"); // carddata: Lost Soul "O.T. Only" [Psalm 78:22]
    });
    it("attributes sections through 'Fortresses/Sites/Cities' and drops strategy prose", () => {
      expect(byRaw(lines, "Babylon (TtC)").section).toBe("Fortresses/Sites/Cities");
      expect(lines.some((l) => l.raw.includes("Banding is a central component"))).toBe(false);
      // Known noise: the recommended-cards tail parses as real lines; the
      // review screen's explicit resolve-or-drop gate is the mitigation.
      expect(lines.some((l) => l.raw === "Michael, the Guardian (TtC)")).toBe(true);
    });
  });
  ```

- [ ] Run and confirm FAIL (module doesn't exist yet):
  ```bash
  cd /Users/timestes/projects/rtt-ytg-decks && npx vitest run lib/ytg/__tests__/deckContentsParser.test.ts
  ```
  Expected: failure `Cannot find module '../deckContentsParser'` (or equivalent).
- [ ] Implement `lib/ytg/deckContentsParser.ts`:

  ```ts
  /**
   * Pure parser: YTG deck-product description HTML → decklist lines resolved
   * against carddata (spec §Decks tab). No DB, no I/O — aliasCandidates is
   * injected (reversed set_aliases + carddata set-code identities).
   *
   * Precedence rule (spec, verbatim): a trailing parenthetical is a set ONLY
   * if it resolves via aliasCandidates; otherwise it stays part of the name;
   * if BOTH parses resolve to different cards → 'ambiguous', never auto-pick.
   */
  import { CARDS, type CardData } from "@/lib/cards/lookup";
  import { normalize, stripEmbeddedSet } from "@/lib/pricing/helpers";

  export interface ParsedCandidate {
    cardKey: string;   // `${name}|${set}|${imgFile}`
    cardName: string;
    setCode: string;
    confidence: number;
  }

  export interface ParsedLine {
    raw: string;
    qty: number;
    name: string;
    setAbbrev: string | null;
    candidates: ParsedCandidate[];
    status: "resolved" | "ambiguous" | "unresolved";
    section: string | null;
  }

  /* ------------------------------------------------------------------ */
  /*  HTML → lines                                                       */
  /* ------------------------------------------------------------------ */

  const NAMED_ENTITIES: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    rsquo: "\u2019", lsquo: "\u2018", ldquo: "\u201C", rdquo: "\u201D",
    ndash: "\u2013", mdash: "\u2014", hellip: "\u2026",
  };

  function decodeEntities(s: string): string {
    return s
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
  }

  export function htmlToLines(html: string): string[] {
    const text = html
      .replace(/<(br|\/p|\/div|\/h[1-6]|\/li)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "");
    return decodeEntities(text)
      .split("\n")
      .map((l) => l.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim())
      .filter((l) => l.length > 0);
  }

  /* ------------------------------------------------------------------ */
  /*  Section headers                                                    */
  /* ------------------------------------------------------------------ */

  const SECTION_WORDS = new Set([
    "dominants", "dominant", "lost souls", "lost soul",
    "artifacts", "artifact", "covenants", "covenant", "curses", "curse",
    "fortresses", "fortress", "sites", "site", "cities", "city",
    "heroes", "hero", "good enhancements", "evil enhancements", "enhancements",
    "evil characters", "evil character", "dual-alignment", "dual alignment",
    "reserve", "misc",
  ]);

  export function sectionHeader(line: string): string | null {
    const stripped = line.replace(/:\s*$/, "").trim();
    if (!stripped || stripped.length > 60) return null;
    const parts = stripped.split("/").map((p) => p.trim().toLowerCase());
    return parts.every((p) => SECTION_WORDS.has(p)) ? stripped : null;
  }

  /* ------------------------------------------------------------------ */
  /*  Alias candidates                                                   */
  /* ------------------------------------------------------------------ */

  export function buildAliasCandidates(
    rows: { carddata_code: string; shopify_abbrev: string }[],
  ): Map<string, string[]> {
    const map = new Map<string, string[]>();
    const add = (abbrev: string, code: string) => {
      const key = normalize(abbrev);
      if (!key) return;
      const arr = map.get(key);
      if (arr) { if (!arr.includes(code)) arr.push(code); }
      else map.set(key, [code]);
    };
    for (const r of rows) add(r.shopify_abbrev, r.carddata_code);
    // Identity entries: store lines often use the carddata code itself —
    // "(K)", "(PoC)", "(I/J+)" — which set_aliases doesn't key (it maps
    // carddata → store abbrev, not the reverse).
    for (const card of CARDS) add(card.set, card.set);
    return map;
  }

  /* ------------------------------------------------------------------ */
  /*  Card name index (built once from CARDS)                            */
  /* ------------------------------------------------------------------ */

  function loose(s: string): string {
    return s.replace(/[.,'"\u2018\u2019\u201C\u201D]/g, "").replace(/\s+/g, " ").trim();
  }
  function bracketsToParens(s: string): string {
    return s.replace(/\[/g, "(").replace(/\]/g, ")");
  }

  /** Strict variants keep any parenthetical text — used for the "name-with-
   *  paren exists as a card" parse so it can't collapse into the set parse. */
  function strictVariants(name: string): string[] {
    const folded = name.replace(/''/g, '"');
    return [...new Set([normalize(folded), normalize(bracketsToParens(folded))])].filter(Boolean);
  }

  /** Full ladder, most-specific → loosest. Shared by the index and queries. */
  function nameKeyVariants(name: string): string[] {
    const folded = name.replace(/''/g, '"');
    const paren = bracketsToParens(folded);
    return [...new Set([
      normalize(folded),
      normalize(paren),
      normalize(stripEmbeddedSet(folded)),
      normalize(stripEmbeddedSet(paren)),
      loose(normalize(stripEmbeddedSet(paren))),
    ])].filter(Boolean);
  }

  interface CardIndex {
    bySet: Map<string, Map<string, CardData[]>>;
    global: Map<string, CardData[]>;
  }

  let INDEX: CardIndex | null = null;

  function pushKey(map: Map<string, CardData[]>, key: string, card: CardData) {
    const arr = map.get(key);
    if (arr) { if (!arr.includes(card)) arr.push(card); }
    else map.set(key, [card]);
  }

  function cardIndex(): CardIndex {
    if (INDEX) return INDEX;
    const bySet = new Map<string, Map<string, CardData[]>>();
    const global = new Map<string, CardData[]>();
    for (const card of CARDS) {
      if (!card.name) continue;
      let setMap = bySet.get(card.set);
      if (!setMap) { setMap = new Map(); bySet.set(card.set, setMap); }
      for (const key of nameKeyVariants(card.name)) {
        pushKey(setMap, key, card);
        pushKey(global, key, card);
      }
    }
    INDEX = { bySet, global };
    return INDEX;
  }

  function lookup(map: Map<string, CardData[]> | undefined, variants: string[]): CardData[] {
    if (!map) return [];
    for (const v of variants) {
      const hits = map.get(v);
      if (hits && hits.length > 0) return hits;
    }
    return [];
  }

  /* ------------------------------------------------------------------ */
  /*  Line grammar + resolution                                          */
  /* ------------------------------------------------------------------ */

  function parseQty(line: string): { qty: number; rest: string } {
    let m = /^\((\d+)\)\s+(.+)$/.exec(line);
    if (m) return { qty: parseInt(m[1], 10), rest: m[2] };
    m = /^(\d+)\s*[xX]\s+(.+)$/.exec(line);
    if (m) return { qty: parseInt(m[1], 10), rest: m[2] };
    m = /^[xX](\d+)\s+(.+)$/.exec(line);
    if (m) return { qty: parseInt(m[1], 10), rest: m[2] };
    return { qty: 1, rest: line };
  }

  const TRAILING_PAREN = /^(.*?)\s*\(([^()]+)\)$/;

  function toCandidates(hits: CardData[], confidence: number): ParsedCandidate[] {
    return hits.map((c) => ({
      cardKey: `${c.name}|${c.set}|${c.imgFile}`,
      cardName: c.name,
      setCode: c.set,
      confidence,
    }));
  }

  function dedupeCandidates(cands: ParsedCandidate[]): ParsedCandidate[] {
    const seen = new Map<string, ParsedCandidate>();
    for (const c of cands) {
      const prev = seen.get(c.cardKey);
      if (!prev || c.confidence > prev.confidence) seen.set(c.cardKey, c);
    }
    return [...seen.values()];
  }

  type Resolution = Omit<ParsedLine, "raw" | "qty" | "section">;

  function statusFor(n: number): ParsedLine["status"] {
    return n === 1 ? "resolved" : n > 1 ? "ambiguous" : "unresolved";
  }

  function resolveLine(
    rest: string,
    aliasCandidates: Map<string, string[]>,
    idx: CardIndex,
  ): Resolution {
    const paren = TRAILING_PAREN.exec(rest);
    const abbrev = paren ? paren[2].trim() : null;
    const aliasSets = abbrev ? aliasCandidates.get(normalize(abbrev)) : undefined;

    if (paren && aliasSets) {
      const innerName = paren[1].trim();
      // Parse A — trailing paren is a set: look the name up in each candidate set.
      let aliasHits: CardData[] = [];
      for (const setCode of aliasSets) {
        aliasHits.push(...lookup(idx.bySet.get(setCode), nameKeyVariants(innerName)));
      }
      aliasHits = [...new Set(aliasHits)];
      // Parse B — the whole line (paren included) is itself a card name.
      // Strict variants only: stripping variants would just re-derive parse A.
      const fullHits = lookup(idx.global, strictVariants(rest));

      if (aliasHits.length > 0) {
        const union = dedupeCandidates([
          ...toCandidates(aliasHits, aliasHits.length === 1 ? 0.95 : 0.5),
          ...toCandidates(fullHits, 0.6),
        ]);
        // If both parses agree on one card it's simply resolved; different
        // cards → ambiguous, both candidates listed (spec: never auto-pick).
        return { name: innerName, setAbbrev: abbrev, candidates: union, status: statusFor(union.length) };
      }

      // Set abbrev resolved but no candidate set contains the name — fall back
      // to a global search (full line first, then the paren-stripped name).
      const fallback = fullHits.length > 0 ? fullHits : lookup(idx.global, nameKeyVariants(rest));
      const cands = toCandidates(fallback, fallback.length === 1 ? 0.7 : 0.4);
      return { name: innerName, setAbbrev: abbrev, candidates: cands, status: statusFor(cands.length) };
    }

    // No trailing paren, or the paren is not a known set → whole line is the name.
    const hits = lookup(idx.global, nameKeyVariants(rest));
    const cands = toCandidates(hits, hits.length === 1 ? 0.7 : 0.4);
    return { name: rest, setAbbrev: null, candidates: cands, status: statusFor(cands.length) };
  }

  /* ------------------------------------------------------------------ */
  /*  Entry point                                                        */
  /* ------------------------------------------------------------------ */

  export function parseDeckContents(
    bodyHtml: string,
    aliasCandidates: Map<string, string[]>,
  ): ParsedLine[] {
    const idx = cardIndex();
    const out: ParsedLine[] = [];
    let section: string | null = null;

    for (const line of htmlToLines(bodyHtml)) {
      const header = sectionHeader(line);
      if (header) { section = header; continue; }
      // Prose/flavor-text heuristic: long sentence with no trailing paren.
      if (line.length > 90 && !/\)$/.test(line)) continue;
      if (!/[a-zA-Z]/.test(line)) continue;

      const { qty, rest } = parseQty(line);
      out.push({ raw: line, qty, section, ...resolveLine(rest, aliasCandidates, idx) });
    }
    return out;
  }
  ```

- [ ] Run to PASS:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-decks && npx vitest run lib/ytg/__tests__/deckContentsParser.test.ts
  ```
  If a fixture assertion fails, print the parsed line (`console.log(JSON.stringify(byRaw(...)))`), verify against the fixture HTML and `lib/cards/generated/cardData.json`, and fix parser bug vs. stale assertion accordingly — do not weaken the precedence/never-auto-pick assertions.
- [ ] `npx tsc --noEmit` passes.
- [ ] Commit:
  ```bash
  git add lib/ytg/deckContentsParser.ts lib/ytg/__tests__/deckContentsParser.test.ts lib/ytg/__tests__/fixtures/fiery-furnace.html lib/ytg/__tests__/fixtures/daniel-contender.html
  git commit -m "feat(ytg): deck-contents parser — precedence rule, alias candidate lists, real store fixtures"
  ```

---

### Task 4: `deckLinkOps` — claim-based create, sale-guarded replace (TDD, stub client)

**Files:**
- Create: `lib/ytg/__tests__/deckLinkOps.test.ts`
- Create: `lib/ytg/deckLinkOps.ts`

**Interfaces produced (Task 5 + WS-4 reference these):**

```ts
export interface ResolvedEntry { cardKey: string; cardName: string; setCode: string; imgFile: string; qty: number }
export type CreateDeckResult =
  | { success: true; deckId: string; deckName: string }
  | { success: false; conflict: true; existingDeckId: string | null; error: string }
  | { success: false; conflict?: false; error: string };
export function cleanDeckName(title: string): string;
export async function createDeckLinkedOp(admin, args: { productId; handle; productTitle; createdBy; resolved }): Promise<CreateDeckResult>;
export async function replaceDeckContentsOp(admin, args: { productId; resolved }): Promise<{ success: true; deckId: string; cardCount: number } | { success: false; error: string }>;
export async function unlinkProductOp(admin, productId: string): Promise<{ success: boolean; error?: string }>;
```

**Interfaces consumed:** `YTG_ACCOUNT_USER_ID` from `lib/ytg/constants.ts`. The injected `admin` is the `getSupabaseAdmin()` client (typed `any` — matches house style).

**Design note the code must carry as a comment:** the spec says "insert the link first, then the deck", but `ytg_deck_links.deck_id` is `NOT NULL REFERENCES decks(id)` — a true link-first insert violates the FK. The resolved protocol preserving the spec's no-orphan guarantee: (1) SELECT existing link (fast-fail), (2) insert the deck with a client-generated `crypto.randomUUID()`, (3) claim via `INSERT … ON CONFLICT DO NOTHING RETURNING` (supabase-js `upsert(..., { ignoreDuplicates: true }).select()`); empty result = lost the race → delete the just-created deck (no cards inserted yet, not linked, so RESTRICT doesn't bind) and return `{ conflict: true, existingDeckId }`.

- [ ] Write the failing test `lib/ytg/__tests__/deckLinkOps.test.ts`:

  ```ts
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
  ```

- [ ] `npx vitest run lib/ytg/__tests__/deckLinkOps.test.ts` → expected FAIL (module missing).
- [ ] Implement `lib/ytg/deckLinkOps.ts`:

  ```ts
  /**
   * Service-role deck-link operations for the YTG Decks tab (spec §Decks tab
   * pt. 5–6). Kept out of actions.ts so unit tests can inject a stub client.
   * The injected `admin` is getSupabaseAdmin() — RLS has no admin bypass on
   * decks/deck_cards and the decks belong to YTG_ACCOUNT_USER_ID.
   */
  import { YTG_ACCOUNT_USER_ID } from "./constants";

  export interface ResolvedEntry {
    cardKey: string;   // `${name}|${set}|${imgFile}`
    cardName: string;
    setCode: string;
    imgFile: string;   // raw carddata imgFile
    qty: number;
  }

  export type CreateDeckResult =
    | { success: true; deckId: string; deckName: string }
    | { success: false; conflict: true; existingDeckId: string | null; error: string }
    | { success: false; conflict?: false; error: string };

  export type ReplaceResult =
    | { success: true; deckId: string; cardCount: number }
    | { success: false; error: string };

  // Canonical format id — 'T1' is legacy (migration 081 retired it;
  // normalizeFormat('T1') → 'Limited'), so we write the canonical value.
  const DECK_FORMAT = "Limited";

  export function cleanDeckName(title: string): string {
    return title.replace(/^\*New\*\s*/i, "").trim();
  }

  function mergeRows(deckId: string, resolved: ResolvedEntry[]) {
    // deck_cards is UNIQUE (deck_id, card_name, card_set, zone); the same card
    // can appear in two description sections (e.g. Heroes AND Reserve) and
    // everything lands in zone 'main' (spec) — so duplicates must be summed.
    const byKey = new Map<string, {
      deck_id: string; card_name: string; card_set: string;
      card_img_file: string; quantity: number; zone: "main";
    }>();
    for (const r of resolved) {
      const k = `${r.cardName}|${r.setCode}`;
      const prev = byKey.get(k);
      if (prev) prev.quantity += r.qty;
      else byKey.set(k, {
        deck_id: deckId, card_name: r.cardName, card_set: r.setCode,
        card_img_file: r.imgFile, quantity: r.qty, zone: "main",
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
    const totalQty = resolved.reduce((s, r) => s + r.qty, 0);

    // (3) Insert the deck. True link-first is impossible: links.deck_id is
    // NOT NULL REFERENCES decks(id). The link INSERT below (ON CONFLICT DO
    // NOTHING) is the atomic claim; a lost race deletes this deck — no orphan
    // survives either ordering.
    const { error: deckErr } = await admin.from("decks").insert({
      id: deckId,
      user_id: YTG_ACCOUNT_USER_ID,
      name: deckName,
      description: `Contents of the YTG product "${productTitle}" — source of truth for store inventory.`,
      format: DECK_FORMAT,
      visibility: "public",
      card_count: totalQty,
      preview_card_1: resolved[0]?.imgFile ?? null,
      preview_card_2: resolved[1]?.imgFile ?? null,
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

    // (5) Bulk insert contents — zone 'main' only, raw carddata img files.
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

    const totalQty = resolved.reduce((s, r) => s + r.qty, 0);
    const { error: updErr } = await admin.from("decks").update({
      card_count: totalQty,
      preview_card_1: resolved[0]?.imgFile ?? null,
      preview_card_2: resolved[1]?.imgFile ?? null,
      // updated_at is maintained by the decks BEFORE UPDATE trigger (001).
    }).eq("id", deckId);
    if (updErr) return { success: false, error: updErr.message };

    return { success: true, deckId, cardCount: totalQty };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export async function unlinkProductOp(admin: any, productId: string): Promise<{ success: boolean; error?: string }> {
    // Deletes the link row only — the deck survives as a normal public deck
    // and ON DELETE RESTRICT no longer binds it.
    const { error } = await admin.from("ytg_deck_links").delete().eq("shopify_product_id", productId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  }
  ```

- [ ] `npx vitest run lib/ytg/__tests__/deckLinkOps.test.ts` → PASS. `npx tsc --noEmit` → clean.
- [ ] Commit:
  ```bash
  git add lib/ytg/deckLinkOps.ts lib/ytg/__tests__/deckLinkOps.test.ts
  git commit -m "feat(ytg): deck link ops — FK-safe claim protocol with compensation, sale-guarded replace"
  ```

---

### Task 5: Server actions

**Files:**
- Create: `app/admin/ytg/decks/actions.ts`

**Interfaces produced (UI + WS-4 consume):** `listDeckProducts`, `getParsedContents`, `resyncProduct`, `createDeckFromContents`, `replaceDeckContents`, `unlinkProduct` with the exact signatures below. Note: `"use server"` files may export only async functions at runtime — types are fine, no constants.

- [ ] Create `app/admin/ytg/decks/actions.ts`:

  ```ts
  "use server";

  import { hasPermission } from "@/utils/adminUtils";
  import { getSupabaseAdmin } from "@/lib/pricing/supabase-admin";
  import { syncShopifyProducts } from "@/lib/pricing/syncShopifyProducts";
  import { createClient } from "@/utils/supabase/server";
  import { DECK_PRODUCT_TYPES } from "@/lib/ytg/constants";
  import {
    parseDeckContents, buildAliasCandidates, type ParsedLine,
  } from "@/lib/ytg/deckContentsParser";
  import {
    createDeckLinkedOp, replaceDeckContentsOp, unlinkProductOp,
    type ResolvedEntry, type CreateDeckResult, type ReplaceResult,
  } from "@/lib/ytg/deckLinkOps";

  const PERM = "manage_shopify_imports";

  export interface DeckProductRow {
    productId: string;
    title: string;
    handle: string;
    productType: string;
    price: number | null;
    inventory: number;
    status: string | null;       // raw_json.status when present
    imageUrl: string | null;     // raw_json.images[0].src when present
    linkedDeckId: string | null;
    linkedAt: string | null;
  }

  export interface DeckProductMeta {
    productId: string;
    title: string;
    handle: string;
    price: number | null;
    inventory: number;
    imageUrl: string | null;
  }

  export type ParsedContentsResult =
    | {
        success: true;
        product: DeckProductMeta;
        lines: ParsedLine[];
        linked: { deckId: string; currentCardCount: number } | null;
      }
    | { success: false; error: string };

  export async function listDeckProducts(): Promise<
    { success: true; products: DeckProductRow[] } | { success: false; error: string }
  > {
    if (!(await hasPermission(PERM))) return { success: false, error: "forbidden" };
    const admin = getSupabaseAdmin();

    const { data: products, error } = await admin
      .from("shopify_products")
      .select("id, title, handle, product_type, price, inventory_quantity, raw_json")
      .in("product_type", [...DECK_PRODUCT_TYPES]);
    if (error) return { success: false, error: error.message };

    // No FK between the mirror and ytg_deck_links — merge in JS.
    const { data: links, error: linkErr } = await admin
      .from("ytg_deck_links")
      .select("shopify_product_id, deck_id, created_at");
    if (linkErr) return { success: false, error: linkErr.message };

    const linkByProduct = new Map<string, { deck_id: string; created_at: string }>();
    for (const l of links ?? []) linkByProduct.set(l.shopify_product_id, l);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: DeckProductRow[] = (products ?? []).map((p: any) => {
      const link = linkByProduct.get(p.id);
      return {
        productId: p.id,
        title: p.title,
        handle: p.handle,
        productType: p.product_type,
        price: p.price,
        inventory: p.inventory_quantity ?? 0,
        status: p.raw_json?.status ?? null,
        imageUrl: p.raw_json?.images?.[0]?.src ?? p.raw_json?.image?.src ?? null,
        linkedDeckId: link ? link.deck_id : null,
        linkedAt: link ? link.created_at : null,
      };
    });

    const live = (r: DeckProductRow) =>
      r.inventory > 0 && (r.status === null || r.status === "active");
    rows.sort((a, b) =>
      (live(b) ? 1 : 0) - (live(a) ? 1 : 0) || a.title.localeCompare(b.title));

    return { success: true, products: rows };
  }

  export async function getParsedContents(productId: string): Promise<ParsedContentsResult> {
    if (!(await hasPermission(PERM))) return { success: false, error: "forbidden" };
    const admin = getSupabaseAdmin();

    const { data: p, error } = await admin
      .from("shopify_products")
      .select("id, title, handle, price, inventory_quantity, body_html, raw_json")
      .eq("id", productId)
      .maybeSingle();
    if (error) return { success: false, error: error.message };
    if (!p) return { success: false, error: "not_found" };
    if (!p.body_html) {
      return { success: false, error: "No description synced for this product yet — use Re-sync (or run a product sync) and retry." };
    }

    const { data: aliasRows, error: aliasErr } = await admin
      .from("set_aliases")
      .select("carddata_code, shopify_abbrev");
    if (aliasErr) return { success: false, error: aliasErr.message };

    const lines = parseDeckContents(p.body_html, buildAliasCandidates(aliasRows ?? []));

    const { data: link } = await admin
      .from("ytg_deck_links").select("deck_id")
      .eq("shopify_product_id", productId).maybeSingle();
    let linked: { deckId: string; currentCardCount: number } | null = null;
    if (link) {
      const { data: cards } = await admin
        .from("deck_cards").select("quantity").eq("deck_id", link.deck_id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const count = (cards ?? []).reduce((s: number, c: any) => s + (c.quantity ?? 0), 0);
      linked = { deckId: link.deck_id, currentCardCount: count };
    }

    return {
      success: true,
      product: {
        productId: p.id,
        title: p.title,
        handle: p.handle,
        price: p.price,
        inventory: p.inventory_quantity ?? 0,
        imageUrl: p.raw_json?.images?.[0]?.src ?? p.raw_json?.image?.src ?? null,
      },
      lines,
      linked,
    };
  }

  export async function resyncProduct(productId: string): Promise<ParsedContentsResult> {
    if (!(await hasPermission(PERM))) return { success: false, error: "forbidden" };
    // v1 freshness: syncShopifyProducts() re-syncs ALL mirrored product types
    // (one REST pass per type). Acceptable for a manual refresh button; a
    // single-product fetch is a later optimization.
    await syncShopifyProducts();
    return getParsedContents(productId);
  }

  export async function createDeckFromContents(
    productId: string,
    resolved: ResolvedEntry[],
  ): Promise<CreateDeckResult> {
    if (!(await hasPermission(PERM))) return { success: false, error: "forbidden" };
    if (!resolved || resolved.length === 0) return { success: false, error: "no resolved cards — nothing to create" };
    const admin = getSupabaseAdmin();

    const { data: p, error } = await admin
      .from("shopify_products").select("id, title, handle")
      .eq("id", productId).maybeSingle();
    if (error) return { success: false, error: error.message };
    if (!p) return { success: false, error: "not_found" };

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    return createDeckLinkedOp(admin, {
      productId,
      handle: p.handle,
      productTitle: p.title,
      createdBy: user?.id ?? null,
      resolved,
    });
  }

  export async function replaceDeckContents(
    productId: string,
    resolved: ResolvedEntry[],
  ): Promise<ReplaceResult> {
    if (!(await hasPermission(PERM))) return { success: false, error: "forbidden" };
    if (!resolved || resolved.length === 0) return { success: false, error: "no resolved cards — nothing to replace" };
    return replaceDeckContentsOp(getSupabaseAdmin(), { productId, resolved });
  }

  export async function unlinkProduct(productId: string): Promise<{ success: boolean; error?: string }> {
    if (!(await hasPermission(PERM))) return { success: false, error: "forbidden" };
    return unlinkProductOp(getSupabaseAdmin(), productId);
  }
  ```

- [ ] `npx tsc --noEmit` → clean. `npx vitest run lib/ytg` → all green (no new tests here; ops/parser suites cover the logic — the wrappers are permission + I/O glue).
- [ ] Commit:
  ```bash
  git add app/admin/ytg/decks/actions.ts
  git commit -m "feat(ytg): decks tab server actions — list, parse, resync, create/replace/unlink"
  ```

---

### Task 6: Decks list UI (replace the WS-0 skeleton)

**Files:**
- Modify (replace content): `app/admin/ytg/decks/page.tsx`
- Create: `app/admin/ytg/decks/DeckProductList.tsx`

**Interfaces consumed:** `listDeckProducts`, `unlinkProduct`, `DeckProductRow` (type-only import in the client file). Public deck view URL `/decklist/${deckId}`.

- [ ] Replace `app/admin/ytg/decks/page.tsx` (server component; shell layout provides chrome + gate, list re-checks inside the action anyway):

  ```tsx
  import { listDeckProducts } from "./actions";
  import DeckProductList from "./DeckProductList";

  export const dynamic = "force-dynamic";

  export default async function DecksPage() {
    const res = await listDeckProducts();
    if (res.success === false) {
      return (
        <div className="px-4 py-2 rounded-md bg-destructive/10 text-destructive text-sm">
          {res.error}
        </div>
      );
    }
    return <DeckProductList products={res.products} />;
  }
  ```

- [ ] Create `app/admin/ytg/decks/DeckProductList.tsx`:

  ```tsx
  "use client";

  import { useMemo, useState, useTransition } from "react";
  import Link from "next/link";
  import { useRouter } from "next/navigation";
  import { Input } from "@/components/ui/input";
  import { Button } from "@/components/ui/button";
  import { unlinkProduct } from "./actions";
  import type { DeckProductRow } from "./actions";

  export default function DeckProductList({ products }: { products: DeckProductRow[] }) {
    const [q, setQ] = useState("");
    const [unlinkArm, setUnlinkArm] = useState<string | null>(null);
    const [error, setError] = useState("");
    const [pending, startTransition] = useTransition();
    const router = useRouter();

    const filtered = useMemo(() => {
      const needle = q.trim().toLowerCase();
      if (!needle) return products;
      return products.filter((p) => p.title.toLowerCase().includes(needle));
    }, [q, products]);

    const doUnlink = (productId: string) => {
      startTransition(async () => {
        const res = await unlinkProduct(productId);
        if (res.success === false) setError(res.error ?? "unlink failed");
        else { setError(""); router.refresh(); }
        setUnlinkArm(null);
      });
    };

    return (
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Deck products</h2>
            <p className="text-sm text-muted-foreground">
              Pull a product&apos;s contents into a public decklist — the deck becomes the
              source of truth for store inventory.
            </p>
          </div>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by title…"
            className="sm:max-w-xs"
          />
        </div>

        {error && (
          <div className="px-4 py-2 rounded-md bg-destructive/10 text-destructive text-sm">{error}</div>
        )}

        <div className="rounded-lg bg-muted/30 divide-y divide-background overflow-hidden">
          {filtered.map((p) => (
            <div key={p.productId} className="flex items-center gap-3 px-3 py-2">
              {p.imageUrl ? (
                <img src={p.imageUrl} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded bg-muted shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-sm">{p.title}</div>
                <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                  <span className="px-1.5 py-0.5 rounded bg-muted">{p.productType}</span>
                  {p.price != null && <span>${Number(p.price).toFixed(2)}</span>}
                  <span
                    className={`px-1.5 py-0.5 rounded ${
                      p.inventory > 0
                        ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {p.inventory} in stock
                  </span>
                  {p.status !== null && p.status !== "active" && (
                    <span className="px-1.5 py-0.5 rounded bg-muted">{p.status}</span>
                  )}
                </div>
              </div>
              {p.linkedDeckId ? (
                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                    href={`/decklist/${p.linkedDeckId}`}
                  >
                    View deck
                  </Link>
                  <Link className="text-sm hover:underline" href={`/admin/ytg/decks/${p.productId}`}>
                    Replace contents
                  </Link>
                  {unlinkArm === p.productId ? (
                    <Button size="sm" variant="destructive" disabled={pending} onClick={() => doUnlink(p.productId)}>
                      Confirm unlink
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setUnlinkArm(p.productId)}>
                      Unlink
                    </Button>
                  )}
                </div>
              ) : (
                <Link href={`/admin/ytg/decks/${p.productId}`} className="shrink-0">
                  <Button size="sm">Pull contents</Button>
                </Link>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              No deck products match. Deck products appear here after a product sync
              (types: Contender/Challenger/Champion Deck).
            </div>
          )}
        </div>
      </div>
    );
  }
  ```

- [ ] `npx tsc --noEmit` → clean.
- [ ] Commit:
  ```bash
  git add app/admin/ytg/decks/page.tsx app/admin/ytg/decks/DeckProductList.tsx
  git commit -m "feat(ytg): decks tab product list — live-first ordering, inventory badges, link states"
  ```

---

### Task 7: Pull-contents wizard (route page, Parse → Review → Create/Replace)

**Files:**
- Create: `app/admin/ytg/decks/[productId]/page.tsx`
- Create: `app/admin/ytg/decks/[productId]/ContentsWizard.tsx`
- Create: `app/admin/ytg/decks/[productId]/CardPickerInline.tsx`

**Interfaces consumed:** `getParsedContents`, `resyncProduct`, `createDeckFromContents`, `replaceDeckContents` (+ types, type-only), `ParsedLine`/`ParsedCandidate` (type-only — a value import would drag `CARDS` in unnecessarily), `CARDS` (deliberately, in the picker only — same precedent as `app/admin/cards/page.tsx`), `getCardImageUrl` from `app/shared/utils/cardImageUrl`.

- [ ] Create `app/admin/ytg/decks/[productId]/page.tsx`:

  ```tsx
  import { notFound } from "next/navigation";
  import { getParsedContents } from "../actions";
  import ContentsWizard from "./ContentsWizard";

  export const dynamic = "force-dynamic";

  export default async function DeckWizardPage({
    params,
  }: {
    params: Promise<{ productId: string }>;
  }) {
    const { productId } = await params;
    const res = await getParsedContents(productId);
    if (res.success === false) {
      if (res.error === "not_found") notFound();
      return (
        <div className="px-4 py-2 rounded-md bg-destructive/10 text-destructive text-sm">
          {res.error}
        </div>
      );
    }
    return <ContentsWizard product={res.product} initialLines={res.lines} linked={res.linked} />;
  }
  ```

- [ ] Create `app/admin/ytg/decks/[productId]/CardPickerInline.tsx` (imitates the module-scope `CARDS` typeahead in `app/admin/cards/page.tsx` — the simplest existing card-search pattern; the full deckbuilder picker in `app/decklist/card-search` is context-bound and too heavy here):

  ```tsx
  "use client";

  import { useEffect, useMemo, useRef, useState } from "react";
  import { CARDS } from "@/lib/cards/lookup";
  import { getCardImageUrl } from "@/app/shared/utils/cardImageUrl";
  import { Input } from "@/components/ui/input";

  export interface PickedCard {
    cardKey: string;
    cardName: string;
    setCode: string;
    imgFile: string;
  }

  const ALL: readonly PickedCard[] = CARDS
    .filter((c) => c.name && !c.imgFile.startsWith("forge:"))
    .map((c) => ({
      cardKey: `${c.name}|${c.set}|${c.imgFile}`,
      cardName: c.name,
      setCode: c.set,
      imgFile: c.imgFile,
    }));

  export default function CardPickerInline({
    preferredSets,
    initialQuery,
    onPick,
  }: {
    preferredSets: string[];
    initialQuery: string;
    onPick: (card: PickedCard) => void;
  }) {
    const [q, setQ] = useState(initialQuery);
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const onDown = (e: MouseEvent) => {
        if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
      };
      document.addEventListener("mousedown", onDown);
      return () => document.removeEventListener("mousedown", onDown);
    }, []);

    const results = useMemo(() => {
      const needle = q.trim().toLowerCase();
      if (needle.length < 2) return [];
      const pref = new Set(preferredSets);
      // Candidate sets rank first; falls back to the whole card pool.
      return ALL
        .filter((c) => c.cardName.toLowerCase().includes(needle))
        .sort(
          (a, b) =>
            (pref.has(b.setCode) ? 1 : 0) - (pref.has(a.setCode) ? 1 : 0) ||
            a.cardName.localeCompare(b.cardName),
        )
        .slice(0, 12);
    }, [q, preferredSets]);

    return (
      <div ref={wrapRef} className="relative w-full max-w-sm">
        <Input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search cards…"
          autoComplete="off"
          className="h-8 text-sm"
        />
        {open && results.length > 0 && (
          <div className="absolute mt-1 w-full bg-card rounded-lg shadow-lg max-h-72 overflow-y-auto z-20">
            {results.map((c) => (
              <button
                key={c.cardKey}
                type="button"
                className="flex items-center gap-2 w-full px-2 py-1.5 text-left hover:bg-muted"
                onClick={() => { onPick(c); setOpen(false); }}
              >
                <img src={getCardImageUrl(c.imgFile)} alt="" className="w-7 h-10 rounded-sm object-cover shrink-0" />
                <span className="min-w-0 flex-1 truncate text-sm">{c.cardName}</span>
                <span className="text-xs text-muted-foreground shrink-0">{c.setCode}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  ```

- [ ] Create `app/admin/ytg/decks/[productId]/ContentsWizard.tsx`:

  ```tsx
  "use client";

  import { useMemo, useState, useTransition } from "react";
  import Link from "next/link";
  import { getCardImageUrl } from "@/app/shared/utils/cardImageUrl";
  import { Button } from "@/components/ui/button";
  import {
    createDeckFromContents, replaceDeckContents, resyncProduct,
  } from "../actions";
  import type { DeckProductMeta } from "../actions";
  import type { ParsedLine, ParsedCandidate } from "@/lib/ytg/deckContentsParser";
  import type { ResolvedEntry } from "@/lib/ytg/deckLinkOps";
  import CardPickerInline, { type PickedCard } from "./CardPickerInline";

  const imgFileFromCardKey = (cardKey: string) => cardKey.split("|")[2] ?? "";

  interface RowState {
    line: ParsedLine;
    chosen: PickedCard | null;
    qty: number;
    dropped: boolean;
  }

  function toRows(lines: ParsedLine[]): RowState[] {
    return lines.map((line) => ({
      line,
      chosen:
        line.status === "resolved"
          ? {
              cardKey: line.candidates[0].cardKey,
              cardName: line.candidates[0].cardName,
              setCode: line.candidates[0].setCode,
              imgFile: imgFileFromCardKey(line.candidates[0].cardKey),
            }
          : null,
      qty: line.qty,
      dropped: false,
    }));
  }

  export default function ContentsWizard({
    product,
    initialLines,
    linked,
  }: {
    product: DeckProductMeta;
    initialLines: ParsedLine[];
    linked: { deckId: string; currentCardCount: number } | null;
  }) {
    const replaceMode = linked !== null;
    const [rows, setRows] = useState<RowState[]>(() => toRows(initialLines));
    const [error, setError] = useState("");
    const [conflictDeckId, setConflictDeckId] = useState<string | null>(null);
    const [done, setDone] = useState<{ deckId: string; deckName: string } | null>(null);
    const [pending, startTransition] = useTransition();

    const counts = useMemo(() => {
      const active = rows.filter((r) => !r.dropped);
      return {
        total: rows.length,
        resolved: active.filter((r) => r.chosen !== null).length,
        ambiguous: active.filter((r) => r.chosen === null && r.line.status === "ambiguous").length,
        unresolved: active.filter((r) => r.chosen === null && r.line.status !== "ambiguous").length,
        dropped: rows.filter((r) => r.dropped).length,
        qtyTotal: active.reduce((s, r) => s + (r.chosen ? r.qty : 0), 0),
      };
    }, [rows]);

    const allSettled = rows.every((r) => r.dropped || r.chosen !== null);
    const deckNamePreview = product.title.replace(/^\*New\*\s*/i, "").trim();

    const patch = (i: number, p: Partial<RowState>) =>
      setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

    const submit = () => {
      const resolved: ResolvedEntry[] = rows
        .filter((r) => !r.dropped && r.chosen !== null)
        .map((r) => ({
          cardKey: r.chosen!.cardKey,
          cardName: r.chosen!.cardName,
          setCode: r.chosen!.setCode,
          imgFile: r.chosen!.imgFile,
          qty: r.qty,
        }));
      startTransition(async () => {
        setError("");
        if (replaceMode) {
          const res = await replaceDeckContents(product.productId, resolved);
          if (res.success === false) { setError(res.error); return; }
          setDone({ deckId: res.deckId, deckName: deckNamePreview });
        } else {
          const res = await createDeckFromContents(product.productId, resolved);
          if (res.success === false) {
            if (res.conflict === true) setConflictDeckId(res.existingDeckId);
            else setError(res.error);
            return;
          }
          setDone({ deckId: res.deckId, deckName: res.deckName });
        }
      });
    };

    const resync = () => {
      startTransition(async () => {
        setError("");
        const res = await resyncProduct(product.productId);
        if (res.success === false) { setError(res.error); return; }
        setRows(toRows(res.lines));
      });
    };

    if (done) {
      return (
        <div className="max-w-xl space-y-4">
          <h2 className="text-lg font-semibold">
            {replaceMode ? "Contents replaced" : "Deck created"} — {done.deckName}
          </h2>
          <p className="text-sm text-muted-foreground">
            This deck is now the source of truth for &ldquo;{product.title}&rdquo;.
          </p>
          <div className="flex gap-3">
            <Link href={`/decklist/${done.deckId}`}><Button>View public deck</Button></Link>
            <Link href="/admin/ytg/decks"><Button variant="outline">Back to deck products</Button></Link>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {/* Stepper + product header */}
        <div className="flex flex-col gap-2">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">
            Parse ✓ &nbsp;→&nbsp; <span className="text-foreground font-medium">Review</span> &nbsp;→&nbsp; {replaceMode ? "Replace" : "Create"}
          </div>
          <div className="flex items-center gap-3">
            {product.imageUrl && (
              <img src={product.imageUrl} alt="" className="w-12 h-12 rounded object-cover" />
            )}
            <div className="min-w-0">
              <h2 className="text-lg font-semibold truncate">{product.title}</h2>
              <p className="text-sm text-muted-foreground">
                Deck name: <span className="font-medium">{deckNamePreview}</span>
                {" "}(a &ldquo;— handle&rdquo; suffix is added automatically on collision)
              </p>
            </div>
            <div className="ml-auto shrink-0">
              <Button size="sm" variant="outline" disabled={pending} onClick={resync}>
                Re-sync &amp; re-parse
              </Button>
            </div>
          </div>
        </div>

        {replaceMode && (
          <div className="px-4 py-2 rounded-md bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 text-sm">
            Replace mode: deck currently has {linked!.currentCardCount} cards; this parse
            resolves {counts.qtyTotal}. Replacing rewrites the deck&apos;s contents.
            {" "}<Link className="underline" href={`/decklist/${linked!.deckId}`}>View current deck</Link>
          </div>
        )}

        {conflictDeckId !== null && (
          <div className="px-4 py-2 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-sm">
            This product was linked while you worked — no duplicate deck was created.
            {" "}<Link className="underline" href={`/decklist/${conflictDeckId}`}>View the linked deck</Link>
            {" "}or reload this page to enter replace mode.
          </div>
        )}
        {error && (
          <div className="px-4 py-2 rounded-md bg-destructive/10 text-destructive text-sm">
            {error.includes("a sale is being recorded")
              ? "A sale is being recorded for this product — wait for it to finish (or fail), then retry."
              : error}
          </div>
        )}

        {/* Running header */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur px-1 py-2 text-sm">
          <span className="font-medium">{counts.resolved} of {counts.total} resolved</span>
          <span className="text-muted-foreground">
            {" "}· {counts.ambiguous} ambiguous · {counts.unresolved} unresolved · {counts.dropped} dropped · {counts.qtyTotal} cards total
          </span>
        </div>

        {/* Review table */}
        <div className="rounded-lg bg-muted/30 divide-y divide-background">
          {rows.map((r, i) => (
            <div key={i} className={`px-3 py-2 ${r.dropped ? "opacity-40" : ""}`}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="w-full sm:w-64 shrink-0">
                  <div className="text-xs text-muted-foreground font-mono truncate" title={r.line.raw}>
                    {r.line.raw}
                  </div>
                  {r.line.section && (
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                      {r.line.section}
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  {r.chosen !== null ? (
                    <div className="flex items-center gap-2">
                      <img src={getCardImageUrl(r.chosen.imgFile)} alt="" className="w-7 h-10 rounded-sm object-cover" />
                      <span className="truncate text-sm">{r.chosen.cardName}</span>
                      <span className="text-xs text-muted-foreground">{r.chosen.setCode}</span>
                      {!r.dropped && (
                        <button
                          type="button"
                          className="text-xs text-muted-foreground underline"
                          onClick={() => patch(i, { chosen: null })}
                        >
                          change
                        </button>
                      )}
                    </div>
                  ) : r.dropped ? (
                    <span className="text-sm text-muted-foreground">dropped</span>
                  ) : (
                    <div className="space-y-1">
                      {r.line.candidates.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {r.line.candidates.map((c: ParsedCandidate) => (
                            <button
                              key={c.cardKey}
                              type="button"
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted hover:bg-muted/70 text-xs"
                              onClick={() =>
                                patch(i, {
                                  chosen: {
                                    cardKey: c.cardKey, cardName: c.cardName,
                                    setCode: c.setCode, imgFile: imgFileFromCardKey(c.cardKey),
                                  },
                                })
                              }
                            >
                              <img src={getCardImageUrl(imgFileFromCardKey(c.cardKey))} alt="" className="w-5 h-7 rounded-sm object-cover" />
                              {c.cardName} <span className="text-muted-foreground">({c.setCode})</span>
                            </button>
                          ))}
                        </div>
                      )}
                      <CardPickerInline
                        preferredSets={[...new Set(r.line.candidates.map((c) => c.setCode))]}
                        initialQuery={r.line.name}
                        onPick={(card) => patch(i, { chosen: card })}
                      />
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`px-1.5 py-0.5 rounded text-xs ${
                      r.dropped
                        ? "bg-muted text-muted-foreground"
                        : r.chosen !== null
                          ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                          : r.line.status === "ambiguous"
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                            : "bg-destructive/10 text-destructive"
                    }`}
                  >
                    {r.dropped ? "dropped" : r.chosen !== null ? "resolved" : r.line.status}
                  </span>
                  <div className="flex items-center rounded bg-muted">
                    <button type="button" className="px-2 py-0.5 text-sm" disabled={r.dropped || r.qty <= 1}
                      onClick={() => patch(i, { qty: Math.max(1, r.qty - 1) })}>−</button>
                    <span className="px-1 text-sm tabular-nums">{r.qty}</span>
                    <button type="button" className="px-2 py-0.5 text-sm" disabled={r.dropped}
                      onClick={() => patch(i, { qty: r.qty + 1 })}>+</button>
                  </div>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline"
                    onClick={() => patch(i, { dropped: !r.dropped })}
                  >
                    {r.dropped ? "restore" : "drop"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Button disabled={!allSettled || pending || conflictDeckId !== null} onClick={submit}>
            {replaceMode ? `Replace contents (${counts.qtyTotal} cards)` : `Create deck (${counts.qtyTotal} cards)`}
          </Button>
          {!allSettled && (
            <span className="text-sm text-muted-foreground">
              Resolve or drop every line to continue.
            </span>
          )}
          <Link href="/admin/ytg/decks" className="ml-auto text-sm text-muted-foreground hover:underline">
            Cancel
          </Link>
        </div>
      </div>
    );
  }
  ```

- [ ] `npx tsc --noEmit` → clean. `npx vitest run lib/ytg` → still green.
- [ ] Visual smoke (no DB writes; list/wizard reads fail gracefully pre-089 with the error banner — that is expected and acceptable here): `npm run dev`, open `/admin/ytg/decks` as Tim's account; confirm the list renders deck products (mirror data exists post-WS-0 sync) and a "Pull contents" click reaches the wizard with parsed lines. **Do not press Create** (089 not applied → clean error banner is the expected result if pressed). Stop the dev server.
- [ ] Commit:
  ```bash
  git add "app/admin/ytg/decks/[productId]/page.tsx" "app/admin/ytg/decks/[productId]/ContentsWizard.tsx" "app/admin/ytg/decks/[productId]/CardPickerInline.tsx"
  git commit -m "feat(ytg): pull-contents wizard — review table, candidate quick-picks, inline card search, replace mode"
  ```

---

### Task 8: Verification, PR, and the post-apply manual checklist

**Files:** none new (PR only).

- [ ] Full gates, in the worktree:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-decks
  npx vitest run lib/ytg
  npm test
  npx tsc --noEmit
  ```
  All green before proceeding. (`npm test` runs the whole suite — confirm no pre-existing failures were introduced.)
- [ ] Push and open the PR:
  ```bash
  git push -u origin feat/ytg-deck-wizard
  gh pr create --base main --title "feat(ytg): Decks tab — deck products as decklists (WS-3)" --body "$(cat <<'EOF'
  ## Summary
  - **Migration 089** (`supabase/migrations/089_ytg_deck_links_and_sales.sql`): `ytg_deck_links` (PK shopify_product_id, deck_id UNIQUE NOT NULL → decks ON DELETE RESTRICT) plus WS-4's `ytg_deck_sales`/`ytg_deck_sale_items` ledger with exact status enums, qty_before/qty_after, and the partial unique active-sale index. RLS enabled, no policies, REVOKE anon/authenticated. **File only — DO NOT apply from CI/agents; the primary session applies it via Supabase MCP after merge, then dispatches WS-4.**
  - **Parser** `lib/ytg/deckContentsParser.ts`: pure HTML→ParsedLine[] with the spec's precedence rule (trailing paren is a set only if it resolves via reversed `set_aliases` + carddata set-code identities; both-parses-resolve → ambiguous, never auto-pick), qty grammar `(N)`/`Nx`/`xN`, section headers, prose dropping, smart-quote/entity handling. Unit-tested against two committed real store fixtures (Fiery Furnace + Daniel contender).
  - **Ops** `lib/ytg/deckLinkOps.ts`: FK-safe claim protocol (deck insert → link `INSERT … ON CONFLICT DO NOTHING RETURNING` → compensating delete on lost race; the spec's link-first ordering is impossible under the deck_id FK — no-orphan guarantee preserved either way), name-collision handle suffix, `zone:'main'` merged inserts, replace guarded by the WS-4 sale contract (`status IN ('pending','applying')` → exact error "a sale is being recorded for this product"), unlink leaves the deck alive.
  - **Actions** `app/admin/ytg/decks/actions.ts`: list/parse/resync/create/replace/unlink, each re-checking `manage_shopify_imports`, all writes via `getSupabaseAdmin()`.
  - **UI**: Decks tab list (live-first, inventory badges, linked → `/decklist/<id>`) + `/admin/ytg/decks/[productId]` wizard (Parse → Review → Create/Replace, per-line raw text + candidate quick-picks + inline card search, create gated on every line resolved-or-dropped, conflict + sale-pending banners).
  - Adds `YTG_ACCOUNT_USER_ID` to `lib/ytg/constants.ts` (overview contract).

  ## Test plan
  - `npx vitest run lib/ytg` — parser fixture suite (57-line Fiery Furnace parse, precedence/ambiguity/qty/smart-quote/section cases) + deckLinkOps claim/compensation/sale-guard suite (stubbed client, no live DB)
  - `npx tsc --noEmit`
  - Post-merge (primary session, after applying 089): manual two-tab conflict dry-run per the WS-3 plan Task 8 checklist

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```
- [ ] **Manual dry-run checklist — for the primary session AFTER it applies 089** (record this in the PR conversation if not run before merge; it is the live verification of the conflict compensation that the stub tests model):
  1. Apply `089_ytg_deck_links_and_sales.sql` via Supabase MCP (primary session only).
  2. Open `/admin/ytg/decks` and click "Pull contents" on *The Fiery Furnace* in **two browser tabs** (same wizard URL).
  3. Resolve-or-drop all lines in both tabs; click **Create deck** in tab A (expect success screen), then in tab B (expect the amber "product was linked while you worked" banner with a link to tab A's deck — no error toast, no second deck).
  4. Assert no orphan deck row:
     ```sql
     SELECT count(*) FROM decks
     WHERE user_id = '81b987d2-f030-4559-aad1-e5cf7405e74a'
       AND name LIKE '%Fiery Furnace%';
     -- expected: 1
     SELECT count(*) FROM ytg_deck_links WHERE shopify_product_id IN
       (SELECT id FROM shopify_products WHERE handle = 'the-fiery-furnace');
     -- expected: 1
     ```
  5. Open the public deck at `/decklist/<deckId>` — card count and previews render; attempt to delete the deck from the builder as the YTG user — expect failure (ON DELETE RESTRICT).
  6. Re-open the wizard for the same product — replace mode banner shows "deck currently has N cards"; run replace once; then insert a fake pending sale (`INSERT INTO ytg_deck_sales (shopify_product_id, deck_id, qty, status) VALUES ('<pid>', '<deckId>', 1, 'pending');`), retry replace, expect the inline "a sale is being recorded" banner; delete the fake sale row.
  7. Unlink, confirm the deck survives and is deletable again; re-create the link via the wizard if Andy wants it kept.

---

## Execution order & dependencies

Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8. Tasks 3 and 4 are independent of each other after Task 2 (both need `constants.ts`) but run them in order anyway — Task 5 needs both. Nothing here depends on WS-1/WS-2. WS-4 depends on this PR merging **and** the primary session applying 089.

## Known/accepted limitations (documented on purpose)

- Lost Soul lines with store scripture-paren naming bulk-land in manual resolution (spec calls this acceptable — that's what the review screen is for).
- The Daniel-style "recommended cards" tail parses as resolvable lines; the resolve-or-drop gate plus the replace diff callout are the mitigation.
- `resyncProduct` re-syncs all mirrored types (v1; noted in code).
- Mid-replace insert failure leaves the deck empty with a loud "re-run the wizard" error (sale guard prevents a sale from reading that window's contents; WS-4's snapshot-confirm protects the other direction).

### Critical Files for Implementation
- /Users/timestes/projects/redemption-tournament-tracker/docs/superpowers/specs/2026-08-03-ytg-store-admin-design.md
- /Users/timestes/projects/redemption-tournament-tracker/lib/pricing/helpers.ts
- /Users/timestes/projects/redemption-tournament-tracker/lib/cards/lookup.ts
- /Users/timestes/projects/redemption-tournament-tracker/supabase/migrations/011_create_price_tables.sql
- /Users/timestes/projects/redemption-tournament-tracker/app/tracker/tournaments/actions.ts
