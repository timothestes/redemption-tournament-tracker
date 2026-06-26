# Forge Phase 2.2 — Mixed-Pool Deckbuilder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A granted playtester (or elder/superadmin) builds a Redemption deck from a mixed pool (public cards + granted approved Forge cards), validates it live, and saves/loads/edits/deletes it privately.

**Architecture:** A focused Forge builder under `/forge/play/decks` that reuses the *pure* deckbuilder modules (`validateDeck`, the `Card`/`DeckCard` types, `ForgeCardPreview`, `CardImage`) behind a thin Forge-specific shell. Forge cards are adapted into the existing `Card` shape with a `forge:{cardId}` `dataLine` identity, so the public `ALL_CARDS` pool and the Forge pool coexist without collision. Persistence is a new RLS-gated `forge_decks` table that stores Forge cards as opaque `card_id` refs (re-resolved live under the member's RLS) and public cards as `name|set`.

**Tech Stack:** Next.js 15 (App Router, RSC + server actions), React 19, TypeScript, Supabase (Postgres + RLS), Vitest, Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-25-forge-phase-2-2-mixed-pool-deckbuilder-design.md`

## Global Constraints

- **Leak boundary:** Forge card text never leaves Postgres-behind-RLS. `forge_decks` stores Forge cards as `card_id` UUID refs only; public cards as `name|set` strings. No blob keys cross to any client component.
- **404 not 403:** every `/forge/**` page/route calls its own gate (`requireForge()` from `@/app/forge/lib/auth`) and responds 404 for non-members. There is NO `/forge` middleware; the `__tests__/forge-gate-first.test.ts` guardrail fails any page/route that does not call a `requireForge*` gate.
- **No `next/image` for Forge art:** the `__tests__/forge-no-next-image.test.ts` guardrail scans `app/forge/**` and fails on any direct `next/image` import. Render Forge cards with `<ForgeCardPreview>` (plain `<img>` + the `/forge/api/art/{cardId}?v=approved` proxy). Public cards may use `CardImage` (which lives under `app/decklist`, not scanned).
- **`"use server"` files export only async functions.** Put shared types in a plain module (`app/forge/lib/deckTypes.ts`), NOT in the `"use server"` actions file.
- **`tsconfig` has `strict:false`** → discriminated-union narrowing on `if (r.ok)/else` is broken. Client consumers of `{ ok: true; ... } | { ok: false; error }` must narrow with `r.ok === false`. Only `npm run build` catches this (Vitest/esbuild does not typecheck).
- **Brigade enum** excludes Red, Teal, Evil Gold (no kit frame). `DesignCard` field is `brigades` (plural array); `cardType` is an array; `alignment` is one of `Good | Evil | Neutral | Good_Evil`.
- **Format strings** (reuse exactly): `'Type 1'`, `'Type 2'`, `'Paragon'`, `'Classic'`. `validateDeck` lowercases and substring-matches these.
- **Migration application is a sensitive prod action.** A subagent CREATES the SQL file; applying it to prod (via Supabase MCP `apply_migration`) is an orchestrator step that requires explicit user authorization (the auto-mode classifier blocks unattended prod migrations). Migrations are numbered sequentially; 055 is the latest applied, so this is **056**.
- **Commits:** end every commit message with the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Commit only files you created/changed for the task — never the untracked `nationals-history*` files.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/056_forge_decks.sql` | `forge_decks` table + owner-scoped RLS (create) |
| `app/forge/lib/deckTypes.ts` | Pure types: `ForgeDeckEntry`, `ForgeDeckSummary`, `ForgeDeckDetail`, `SaveForgeDeckInput` (create) |
| `app/forge/lib/deckAdapter.ts` | Pure: `designCardToCard()` + `forge:`-dataLine helpers (create) |
| `app/forge/lib/deckSerialize.ts` | Pure: `DeckCard[]`↔`ForgeDeckEntry[]`, `hydrateEntries`, `deckCardCount`, `toValidatableDeck` (create) |
| `app/forge/lib/deckMutations.ts` | Pure: `addToDeck`/`removeFromDeck`/`setQty` list helpers (create) |
| `app/forge/lib/forgeDecks.ts` | `"use server"` actions: list/get/save/delete (create) |
| `app/forge/lib/deckPool.ts` | Server-only loader: `listGrantedForgeCards()` (create) |
| `app/forge/play/decks/useForgeDeckState.ts` | Client hook wrapping the pure mutations (create) |
| `app/forge/play/decks/page.tsx` | Deck-list page (server) (create) |
| `app/forge/play/decks/DeckList.tsx` | Deck-list client (new/delete) (create) |
| `app/forge/play/decks/[deckId]/page.tsx` | Builder page (server: load pool + deck) (create) |
| `app/forge/play/decks/[deckId]/DeckBuilder.tsx` | Builder client shell (create) |
| `app/forge/play/decks/[deckId]/PoolSearch.tsx` | Mixed-pool search grid (create) |
| `app/forge/play/decks/[deckId]/DeckPanel.tsx` | Deck zones + qty + validation summary (create) |
| `app/forge/page.tsx` | Enable the "Build a deck" desk tile (modify) |
| `__tests__/forge-anon-leak.test.ts` | Add `forge_decks` to `FORGE_TABLES` (modify) |

---

### Task 1: Migration 056 — `forge_decks` table + leak guardrail

**Files:**
- Create: `supabase/migrations/056_forge_decks.sql`
- Modify: `__tests__/forge-anon-leak.test.ts:16-20`

**Interfaces:**
- Produces: table `public.forge_decks(id uuid, owner_id uuid, name text, format text, paragon text, cards jsonb, created_at, updated_at)` with owner-scoped RLS. Consumed by Task 5's server actions.

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/056_forge_decks.sql`:

```sql
-- 056_forge_decks.sql
-- Phase 2.2: private mixed-pool decks. Owner-scoped personal data.
-- Forge cards are stored as opaque card_id refs (resolved live under RLS on load);
-- public cards as name|set. Writes go through the owner's RLS client (server action),
-- NOT a definer RPC — single-owner data, no cross-author authz. Anon has no policy → 0 rows.

create table if not exists public.forge_decks (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  format     text not null default 'Type 1',
  paragon    text,
  cards      jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists forge_decks_owner_idx on public.forge_decks (owner_id);

alter table public.forge_decks enable row level security;

drop policy if exists "forge_decks_select" on public.forge_decks;
create policy "forge_decks_select" on public.forge_decks
  for select to authenticated
  using (owner_id = auth.uid() and public.is_forge_member());

drop policy if exists "forge_decks_insert" on public.forge_decks;
create policy "forge_decks_insert" on public.forge_decks
  for insert to authenticated
  with check (owner_id = auth.uid() and public.is_forge_member());

drop policy if exists "forge_decks_update" on public.forge_decks;
create policy "forge_decks_update" on public.forge_decks
  for update to authenticated
  using (owner_id = auth.uid() and public.is_forge_member())
  with check (owner_id = auth.uid() and public.is_forge_member());

drop policy if exists "forge_decks_delete" on public.forge_decks;
create policy "forge_decks_delete" on public.forge_decks
  for delete to authenticated
  using (owner_id = auth.uid() and public.is_forge_member());
```

- [ ] **Step 2: Add `forge_decks` to the anon-leak table list**

In `__tests__/forge-anon-leak.test.ts`, extend `FORGE_TABLES` (lines 16-20) — add `"forge_decks"` to the array:

```ts
const FORGE_TABLES = [
  "playtest_members", "forge_invites", "forge_audit", "forge_cards",
  "forge_sets", "forge_set_elders", "forge_set_grants", "card_versions",
  "card_proposals", "card_comments", "forge_decks",
];
```

- [ ] **Step 3: Verify the SQL parses and the test file still loads**

Run: `npx vitest run __tests__/forge-anon-leak.test.ts`
Expected: PASS or SKIP (the suite is `describe.runIf(ENABLED)` — it skips without `FORGE_LEAK_TEST=1` + creds; either way it must not error on load).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/056_forge_decks.sql __tests__/forge-anon-leak.test.ts
git commit -m "feat(forge): migration 056 — forge_decks table (owner-scoped RLS)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: ORCHESTRATOR — apply to prod**

Migration application is NOT a subagent step. The orchestrator applies `056_forge_decks.sql` via Supabase MCP `apply_migration` after explicit user authorization, then runs the live leak suite (`FORGE_LEAK_TEST=1 npm run test:security`) to confirm anon reads 0 rows from `forge_decks`. Record the result before continuing.

---

### Task 2: Pure types + DesignCard→Card adapter

**Files:**
- Create: `app/forge/lib/deckTypes.ts`
- Create: `app/forge/lib/deckAdapter.ts`
- Create: `app/forge/lib/__tests__/deckAdapter.test.ts`

**Interfaces:**
- Produces:
  - `type ForgeDeckEntry = { source:'public'; name:string; set:string; qty:number; zone:DeckZone } | { source:'forge'; cardId:string; qty:number; zone:DeckZone }`
  - `type SaveForgeDeckInput = { id?:string; name:string; format:string; paragon?:string|null; entries:ForgeDeckEntry[] }`
  - `type ForgeDeckSummary = { id:string; name:string; format:string; cardCount:number; updatedAt:string }`
  - `type ForgeDeckDetail = { id:string; name:string; format:string; paragon:string|null; entries:ForgeDeckEntry[] }`
  - `designCardToCard(data: DesignCard, cardId: string, setName: string): Card`
  - `forgeDataLine(cardId)`, `isForgeDataLine(dataLine)`, `cardIdFromDataLine(dataLine)`, const `FORGE_DATALINE_PREFIX = "forge:"`
- Consumes: `Card` from `@/app/decklist/card-search/utils`; `DeckZone` from `@/app/decklist/card-search/types/deck`; `DesignCard`, `CardType`, `Brigade` from `@/app/forge/lib/designCard`.

- [ ] **Step 1: Create the types module**

Create `app/forge/lib/deckTypes.ts`:

```ts
// Pure shared types for Forge decks. NOT a "use server" file (those may only export
// async functions), so the actions module + pure helpers can both import these.
import type { DeckZone } from "@/app/decklist/card-search/types/deck";

export type ForgeDeckEntry =
  | { source: "public"; name: string; set: string; qty: number; zone: DeckZone }
  | { source: "forge"; cardId: string; qty: number; zone: DeckZone };

export type SaveForgeDeckInput = {
  id?: string;
  name: string;
  format: string;
  paragon?: string | null;
  entries: ForgeDeckEntry[];
};

export type ForgeDeckSummary = { id: string; name: string; format: string; cardCount: number; updatedAt: string };
export type ForgeDeckDetail = { id: string; name: string; format: string; paragon: string | null; entries: ForgeDeckEntry[] };
```

- [ ] **Step 2: Write the failing adapter test**

Create `app/forge/lib/__tests__/deckAdapter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { designCardToCard, forgeDataLine, isForgeDataLine, cardIdFromDataLine } from "../deckAdapter";
import type { DesignCard } from "../designCard";

describe("designCardToCard", () => {
  it("maps a Lost Soul so validateDeck's type check matches", () => {
    const d: DesignCard = { name: "The Wait", cardType: ["LostSoul"] };
    const c = designCardToCard(d, "abc", "Test Set");
    expect(c.type.toLowerCase()).toContain("lost soul");
    expect(c.dataLine).toBe("forge:abc");
    expect(c.set).toBe("Forge");
    expect(c.officialSet).toBe("Test Set");
  });

  it("maps Good_Evil alignment to 'Good/Evil' and GoodGold brigade to 'Good Gold'", () => {
    const d: DesignCard = { name: "X", cardType: ["Hero"], alignment: "Good_Evil", brigades: ["GoodGold", "PaleGreen"] };
    const c = designCardToCard(d, "id1", "S");
    expect(c.alignment).toBe("Good/Evil");
    expect(c.brigade).toBe("Good Gold/Pale Green");
  });

  it("renders null stats as em-dash", () => {
    const d: DesignCard = { name: "Y", cardType: ["Dominant"], strength: null, toughness: null };
    const c = designCardToCard(d, "id2", "S");
    expect(c.strength).toBe("—");
    expect(c.toughness).toBe("—");
    expect(c.type.toLowerCase()).toContain("dominant");
  });

  it("dataLine helpers round-trip", () => {
    const dl = forgeDataLine("uuid-9");
    expect(isForgeDataLine(dl)).toBe(true);
    expect(isForgeDataLine("Angel|Pa|Angel_(Pa)")).toBe(false);
    expect(cardIdFromDataLine(dl)).toBe("uuid-9");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run app/forge/lib/__tests__/deckAdapter.test.ts`
Expected: FAIL with "Cannot find module '../deckAdapter'".

- [ ] **Step 4: Implement the adapter**

Create `app/forge/lib/deckAdapter.ts`:

```ts
// Pure adapter: a Forge approved card (DesignCard) → the deckbuilder's Card shape.
// No "use client"/"use server" — importable on both sides. Maps enum values to the
// human-readable strings validateDeck/deckcheck expect, and stamps a collision-proof
// `forge:{cardId}` dataLine identity.
import type { Card } from "@/app/decklist/card-search/utils";
import type { DesignCard, CardType, Brigade } from "@/app/forge/lib/designCard";

export const FORGE_DATALINE_PREFIX = "forge:";
export function forgeDataLine(cardId: string): string { return FORGE_DATALINE_PREFIX + cardId; }
export function isForgeDataLine(dataLine: string): boolean { return dataLine.startsWith(FORGE_DATALINE_PREFIX); }
export function cardIdFromDataLine(dataLine: string): string { return dataLine.slice(FORGE_DATALINE_PREFIX.length); }

const TYPE_DISPLAY: Record<CardType, string> = {
  Hero: "Hero", EvilCharacter: "Evil Character", GE: "Good Enhancement", EE: "Evil Enhancement",
  LostSoul: "Lost Soul", Artifact: "Artifact", Dominant: "Dominant", Fortress: "Fortress",
  Site: "Site", City: "City", Curse: "Curse", Covenant: "Covenant",
};

const BRIGADE_DISPLAY: Record<Brigade, string> = {
  Blue: "Blue", Clay: "Clay", GoodGold: "Good Gold", Green: "Green", Purple: "Purple",
  Silver: "Silver", White: "White", Black: "Black", Brown: "Brown", Crimson: "Crimson",
  Gray: "Gray", Orange: "Orange", PaleGreen: "Pale Green",
};

function alignmentDisplay(a?: string): string {
  return a === "Good_Evil" ? "Good/Evil" : (a ?? "");
}

export function designCardToCard(data: DesignCard, cardId: string, setName: string): Card {
  const types = data.cardType ?? [];
  const brigades = data.brigades ?? [];
  return {
    dataLine: forgeDataLine(cardId),
    name: data.name ?? "Untitled",
    set: "Forge",
    imgFile: "",
    officialSet: setName,
    type: types.map((t) => TYPE_DISPLAY[t] ?? t).join("/"),
    brigade: brigades.map((b) => BRIGADE_DISPLAY[b] ?? b).join("/") || "—",
    strength: data.strength != null ? String(data.strength) : "—",
    toughness: data.toughness != null ? String(data.toughness) : "—",
    class: (data.class ?? []).join("/"),
    identifier: (data.identifiers ?? []).join(", "),
    specialAbility: data.specialAbility ?? "",
    rarity: data.rarity ?? "",
    reference: data.reference ?? "",
    alignment: alignmentDisplay(data.alignment),
    legality: data.legality ?? "",
    testament: "",
    isGospel: false,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run app/forge/lib/__tests__/deckAdapter.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add app/forge/lib/deckTypes.ts app/forge/lib/deckAdapter.ts app/forge/lib/__tests__/deckAdapter.test.ts
git commit -m "feat(forge): DesignCard→Card deck adapter + shared deck types

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Pure serialize / hydrate / count / validatable-deck

**Files:**
- Create: `app/forge/lib/deckSerialize.ts`
- Create: `app/forge/lib/__tests__/deckSerialize.test.ts`

**Interfaces:**
- Consumes: `Card` (`@/app/decklist/card-search/utils`), `DeckCard` (`@/app/decklist/card-search/types/deck`), `Deck` (`@/app/decklist/card-search/types/deck`), `ForgeDeckEntry` (`./deckTypes`), `isForgeDataLine`/`cardIdFromDataLine` (`./deckAdapter`).
- Produces:
  - `entriesFromDeckCards(cards: DeckCard[]): ForgeDeckEntry[]`
  - `hydrateEntries(entries, resolveForge:(cardId)=>Card|undefined, resolvePublic:(name,set)=>Card|undefined): { cards: DeckCard[]; dropped: number }`
  - `deckCardCount(entries: ForgeDeckEntry[], zone?: DeckZone): number`
  - `toValidatableDeck(cards: DeckCard[], name: string, format: string, paragon?: string|null): Deck`

- [ ] **Step 1: Write the failing test**

Create `app/forge/lib/__tests__/deckSerialize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { entriesFromDeckCards, hydrateEntries, deckCardCount, toValidatableDeck } from "../deckSerialize";
import { designCardToCard } from "../deckAdapter";
import type { Card } from "@/app/decklist/card-search/utils";
import type { DeckCard } from "@/app/decklist/card-search/types/deck";
import { validateDeck } from "@/app/decklist/card-search/utils/deckValidation";

const pub = (name: string, set: string): Card => ({
  dataLine: `${name}|${set}|${name}_(${set})`, name, set, imgFile: `${name}_(${set})`,
  officialSet: set, type: "Hero", brigade: "Blue", strength: "5", toughness: "5",
  class: "", identifier: "", specialAbility: "", rarity: "Common", reference: "",
  alignment: "Good", legality: "Rotation", testament: "OT", isGospel: false,
});
const forge = designCardToCard({ name: "FC", cardType: ["Hero"], brigades: ["Blue"] }, "cid", "S");

describe("deck serialize / hydrate", () => {
  it("round-trips public + forge entries", () => {
    const cards: DeckCard[] = [
      { card: pub("Angel", "Pa"), quantity: 2, zone: "main" },
      { card: forge, quantity: 1, zone: "reserve" },
    ];
    const entries = entriesFromDeckCards(cards);
    expect(entries).toEqual([
      { source: "public", name: "Angel", set: "Pa", qty: 2, zone: "main" },
      { source: "forge", cardId: "cid", qty: 1, zone: "reserve" },
    ]);
  });

  it("hydrate drops entries that no longer resolve (revoked grant / un-approved card)", () => {
    const entries = entriesFromDeckCards([
      { card: pub("Angel", "Pa"), quantity: 1, zone: "main" },
      { card: forge, quantity: 1, zone: "main" },
    ]);
    const { cards, dropped } = hydrateEntries(
      entries,
      () => undefined,                         // forge card no longer granted → drop
      (name, set) => (name === "Angel" && set === "Pa" ? pub("Angel", "Pa") : undefined),
    );
    expect(cards).toHaveLength(1);
    expect(dropped).toBe(1);
  });

  it("deckCardCount sums main-zone quantities by default", () => {
    const entries = entriesFromDeckCards([
      { card: pub("A", "Pa"), quantity: 3, zone: "main" },
      { card: pub("B", "Pa"), quantity: 5, zone: "reserve" },
    ]);
    expect(deckCardCount(entries)).toBe(3);
  });

  it("toValidatableDeck produces a Deck that validateDeck can score", () => {
    const deck = toValidatableDeck([{ card: pub("Angel", "Pa"), quantity: 1, zone: "main" }], "My Deck", "Type 1");
    const result = validateDeck(deck);
    expect(result.stats.mainDeckSize).toBe(1);
    expect(typeof result.isValid).toBe("boolean");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/forge/lib/__tests__/deckSerialize.test.ts`
Expected: FAIL with "Cannot find module '../deckSerialize'".

- [ ] **Step 3: Implement the module**

Create `app/forge/lib/deckSerialize.ts`:

```ts
// Pure: convert between the builder's DeckCard[] and the stored ForgeDeckEntry[],
// hydrate stored entries back into DeckCard[] via injected resolvers (forge cards
// that no longer resolve under the caller's RLS are dropped — fail-closed), and
// build a validateDeck-compatible Deck.
import type { Card } from "@/app/decklist/card-search/utils";
import type { DeckCard, DeckZone, Deck } from "@/app/decklist/card-search/types/deck";
import type { ForgeDeckEntry } from "./deckTypes";
import { isForgeDataLine, cardIdFromDataLine } from "./deckAdapter";

export function entriesFromDeckCards(cards: DeckCard[]): ForgeDeckEntry[] {
  return cards.map((dc) =>
    isForgeDataLine(dc.card.dataLine)
      ? { source: "forge", cardId: cardIdFromDataLine(dc.card.dataLine), qty: dc.quantity, zone: dc.zone }
      : { source: "public", name: dc.card.name, set: dc.card.set, qty: dc.quantity, zone: dc.zone }
  );
}

export function hydrateEntries(
  entries: ForgeDeckEntry[],
  resolveForge: (cardId: string) => Card | undefined,
  resolvePublic: (name: string, set: string) => Card | undefined,
): { cards: DeckCard[]; dropped: number } {
  const cards: DeckCard[] = [];
  let dropped = 0;
  for (const e of entries) {
    const card = e.source === "forge" ? resolveForge(e.cardId) : resolvePublic(e.name, e.set);
    if (!card) { dropped++; continue; }
    cards.push({ card, quantity: e.qty, zone: e.zone });
  }
  return { cards, dropped };
}

export function deckCardCount(entries: ForgeDeckEntry[], zone: DeckZone = "main"): number {
  return entries.reduce((n, e) => n + (e.zone === zone ? e.qty : 0), 0);
}

export function toValidatableDeck(
  cards: DeckCard[], name: string, format: string, paragon?: string | null,
): Deck {
  return {
    name,
    cards,
    format,
    paragon: paragon ?? undefined,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/forge/lib/__tests__/deckSerialize.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/forge/lib/deckSerialize.ts app/forge/lib/__tests__/deckSerialize.test.ts
git commit -m "feat(forge): pure deck serialize/hydrate/validatable-deck helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Pure deck mutations + client deck-state hook

**Files:**
- Create: `app/forge/lib/deckMutations.ts`
- Create: `app/forge/lib/__tests__/deckMutations.test.ts`
- Create: `app/forge/play/decks/useForgeDeckState.ts`

**Interfaces:**
- Produces (pure, keyed by `dataLine|zone`):
  - `addToDeck(cards: DeckCard[], card: Card, zone: DeckZone): DeckCard[]`
  - `removeFromDeck(cards: DeckCard[], dataLine: string, zone: DeckZone): DeckCard[]`
  - `setQty(cards: DeckCard[], dataLine: string, zone: DeckZone, qty: number): DeckCard[]`
- Produces (hook): `useForgeDeckState(initial: DeckCard[]) → { cards, addCard, removeCard, setQuantity, setCards }`

- [ ] **Step 1: Write the failing test**

Create `app/forge/lib/__tests__/deckMutations.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { addToDeck, removeFromDeck, setQty } from "../deckMutations";
import type { Card } from "@/app/decklist/card-search/utils";
import type { DeckCard } from "@/app/decklist/card-search/types/deck";

const card = (dataLine: string): Card => ({
  dataLine, name: dataLine, set: "Forge", imgFile: "", officialSet: "", type: "Hero",
  brigade: "Blue", strength: "1", toughness: "1", class: "", identifier: "",
  specialAbility: "", rarity: "", reference: "", alignment: "Good", legality: "",
  testament: "", isGospel: false,
});

describe("deck mutations (keyed by dataLine|zone)", () => {
  it("addToDeck appends new and increments existing", () => {
    let cards: DeckCard[] = [];
    cards = addToDeck(cards, card("forge:a"), "main");
    cards = addToDeck(cards, card("forge:a"), "main");
    cards = addToDeck(cards, card("forge:a"), "reserve");
    expect(cards).toHaveLength(2);
    expect(cards.find((c) => c.card.dataLine === "forge:a" && c.zone === "main")?.quantity).toBe(2);
  });

  it("removeFromDeck decrements then deletes", () => {
    let cards = addToDeck(addToDeck([], card("forge:a"), "main"), card("forge:a"), "main");
    cards = removeFromDeck(cards, "forge:a", "main");
    expect(cards[0].quantity).toBe(1);
    cards = removeFromDeck(cards, "forge:a", "main");
    expect(cards).toHaveLength(0);
  });

  it("setQty sets exact and removes at <= 0", () => {
    let cards = addToDeck([], card("forge:a"), "main");
    cards = setQty(cards, "forge:a", "main", 4);
    expect(cards[0].quantity).toBe(4);
    cards = setQty(cards, "forge:a", "main", 0);
    expect(cards).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/forge/lib/__tests__/deckMutations.test.ts`
Expected: FAIL with "Cannot find module '../deckMutations'".

- [ ] **Step 3: Implement the pure mutations**

Create `app/forge/lib/deckMutations.ts`:

```ts
// Pure immutable list helpers for the Forge deck builder, keyed by dataLine|zone
// (public Cards have a unique name|set|imgFile dataLine; forge Cards use forge:{cardId}).
import type { Card } from "@/app/decklist/card-search/utils";
import type { DeckCard, DeckZone } from "@/app/decklist/card-search/types/deck";

const match = (dc: DeckCard, dataLine: string, zone: DeckZone) =>
  dc.card.dataLine === dataLine && dc.zone === zone;

export function addToDeck(cards: DeckCard[], card: Card, zone: DeckZone): DeckCard[] {
  const i = cards.findIndex((dc) => match(dc, card.dataLine, zone));
  if (i >= 0) {
    const next = [...cards];
    next[i] = { ...next[i], quantity: next[i].quantity + 1 };
    return next;
  }
  return [...cards, { card, quantity: 1, zone }];
}

export function removeFromDeck(cards: DeckCard[], dataLine: string, zone: DeckZone): DeckCard[] {
  const i = cards.findIndex((dc) => match(dc, dataLine, zone));
  if (i < 0) return cards;
  if (cards[i].quantity > 1) {
    const next = [...cards];
    next[i] = { ...next[i], quantity: next[i].quantity - 1 };
    return next;
  }
  return cards.filter((_, j) => j !== i);
}

export function setQty(cards: DeckCard[], dataLine: string, zone: DeckZone, qty: number): DeckCard[] {
  if (qty <= 0) return cards.filter((dc) => !match(dc, dataLine, zone));
  const i = cards.findIndex((dc) => match(dc, dataLine, zone));
  if (i < 0) return cards;
  const next = [...cards];
  next[i] = { ...next[i], quantity: qty };
  return next;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/forge/lib/__tests__/deckMutations.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement the client hook**

Create `app/forge/play/decks/useForgeDeckState.ts`:

```ts
"use client";

import { useCallback, useState } from "react";
import type { Card } from "@/app/decklist/card-search/utils";
import type { DeckCard, DeckZone } from "@/app/decklist/card-search/types/deck";
import { addToDeck, removeFromDeck, setQty } from "@/app/forge/lib/deckMutations";

export function useForgeDeckState(initial: DeckCard[]) {
  const [cards, setCards] = useState<DeckCard[]>(initial);
  const addCard = useCallback((card: Card, zone: DeckZone = "main") => setCards((c) => addToDeck(c, card, zone)), []);
  const removeCard = useCallback((dataLine: string, zone: DeckZone) => setCards((c) => removeFromDeck(c, dataLine, zone)), []);
  const setQuantity = useCallback((dataLine: string, zone: DeckZone, qty: number) => setCards((c) => setQty(c, dataLine, zone, qty)), []);
  return { cards, setCards, addCard, removeCard, setQuantity };
}
```

- [ ] **Step 6: Commit**

```bash
git add app/forge/lib/deckMutations.ts app/forge/lib/__tests__/deckMutations.test.ts app/forge/play/decks/useForgeDeckState.ts
git commit -m "feat(forge): pure deck mutations + useForgeDeckState hook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Server actions + granted-pool loader

**Files:**
- Create: `app/forge/lib/forgeDecks.ts`
- Create: `app/forge/lib/deckPool.ts`

**Interfaces:**
- Consumes: `requireForge` (`@/app/forge/lib/auth`), `listSets` (`@/app/forge/lib/sets`), `listSetApprovedCards` (`@/app/forge/lib/play`), the types from `./deckTypes`, `deckCardCount` (`./deckSerialize`).
- Produces:
  - `listForgeDecks(): Promise<ForgeDeckSummary[]>`
  - `getForgeDeck(id: string): Promise<ForgeDeckDetail | null>`
  - `saveForgeDeck(input: SaveForgeDeckInput): Promise<{ ok:true; id:string } | { ok:false; error:string }>`
  - `deleteForgeDeck(id: string): Promise<{ ok:boolean; error?:string }>`
  - `type GrantedForgeCard = { cardId:string; setId:string; setName:string; data:DesignCard; hasApprovedArt:boolean }`
  - `listGrantedForgeCards(): Promise<GrantedForgeCard[]>`

- [ ] **Step 1: Implement the server actions**

Create `app/forge/lib/forgeDecks.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireForge } from "@/app/forge/lib/auth";
import { deckCardCount } from "@/app/forge/lib/deckSerialize";
import type { ForgeDeckSummary, ForgeDeckDetail, SaveForgeDeckInput, ForgeDeckEntry } from "@/app/forge/lib/deckTypes";

export async function listForgeDecks(): Promise<ForgeDeckSummary[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data } = await ctx.supabase
    .from("forge_decks")
    .select("id, name, format, cards, updated_at")
    .eq("owner_id", ctx.user.id)
    .order("updated_at", { ascending: false });
  return (data ?? []).map((d: any): ForgeDeckSummary => ({
    id: d.id, name: d.name, format: d.format,
    cardCount: deckCardCount((d.cards ?? []) as ForgeDeckEntry[]),
    updatedAt: d.updated_at,
  }));
}

export async function getForgeDeck(id: string): Promise<ForgeDeckDetail | null> {
  const ctx = await requireForge();
  if (!ctx) return null;
  const { data } = await ctx.supabase
    .from("forge_decks")
    .select("id, name, format, paragon, cards")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id, name: data.name, format: data.format,
    paragon: data.paragon ?? null, entries: (data.cards ?? []) as ForgeDeckEntry[],
  };
}

export async function saveForgeDeck(
  input: SaveForgeDeckInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await requireForge();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const isParagon = input.format.toLowerCase().includes("paragon");
  const row = {
    owner_id: ctx.user.id,
    name: input.name.trim() || "Untitled deck",
    format: input.format,
    paragon: isParagon ? (input.paragon ?? null) : null,
    cards: input.entries,
    updated_at: new Date().toISOString(),
  };
  if (input.id) {
    const { error } = await ctx.supabase.from("forge_decks").update(row).eq("id", input.id);
    if (error) return { ok: false, error: "Could not save deck" };
    revalidatePath("/forge/play/decks");
    return { ok: true, id: input.id };
  }
  const { data, error } = await ctx.supabase.from("forge_decks").insert(row).select("id").maybeSingle();
  if (error || !data?.id) return { ok: false, error: "Could not save deck" };
  revalidatePath("/forge/play/decks");
  return { ok: true, id: data.id };
}

export async function deleteForgeDeck(id: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireForge();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.from("forge_decks").delete().eq("id", id);
  if (error) return { ok: false, error: "Could not delete deck" };
  revalidatePath("/forge/play/decks");
  return { ok: true };
}
```

- [ ] **Step 2: Implement the granted-pool loader**

Create `app/forge/lib/deckPool.ts`:

```ts
// SERVER-ONLY: gathers the approved Forge cards across every set granted to the caller,
// reusing the 2.1 RLS-scoped readers. Carries only DesignCard + ids + hasApprovedArt
// (never a blob key — render via /forge/api/art/{cardId}?v=approved).
import { listSets } from "@/app/forge/lib/sets";
import { listSetApprovedCards } from "@/app/forge/lib/play";
import type { DesignCard } from "@/app/forge/lib/designCard";

export type GrantedForgeCard = {
  cardId: string; setId: string; setName: string; data: DesignCard; hasApprovedArt: boolean;
};

export async function listGrantedForgeCards(): Promise<GrantedForgeCard[]> {
  const sets = await listSets(); // RLS → only sets the caller may see (a playtester's granted sets)
  const out: GrantedForgeCard[] = [];
  for (const s of sets) {
    const cards = await listSetApprovedCards(s.id);
    for (const c of cards) {
      out.push({ cardId: c.cardId, setId: s.id, setName: s.name, data: c.data, hasApprovedArt: c.hasApprovedArt });
    }
  }
  return out;
}
```

- [ ] **Step 3: Verify it typechecks and builds**

Run: `npm run build`
Expected: build succeeds (no type errors). This is the authoritative typecheck for `strict:false` union issues.

- [ ] **Step 4: Commit**

```bash
git add app/forge/lib/forgeDecks.ts app/forge/lib/deckPool.ts
git commit -m "feat(forge): forge_decks server actions + granted-pool loader

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Deck-list page (`/forge/play/decks`)

**Files:**
- Create: `app/forge/play/decks/page.tsx`
- Create: `app/forge/play/decks/DeckList.tsx`

**Interfaces:**
- Consumes: `requireForge`, `listForgeDecks`, `deleteForgeDeck`.

- [ ] **Step 1: Implement the server page**

Create `app/forge/play/decks/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { listForgeDecks } from "@/app/forge/lib/forgeDecks";
import DeckList from "./DeckList";

export const dynamic = "force-dynamic";

export default async function ForgeDecksPage() {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const decks = await listForgeDecks();
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl" style={{ fontFamily: "Cinzel, serif" }}>Your decks</h1>
      <p className="mt-1 text-sm text-muted-foreground">Build with the cards shared with you, plus the full card pool.</p>
      <DeckList decks={decks} />
    </main>
  );
}
```

- [ ] **Step 2: Implement the list client**

Create `app/forge/play/decks/DeckList.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { deleteForgeDeck } from "@/app/forge/lib/forgeDecks";
import type { ForgeDeckSummary } from "@/app/forge/lib/deckTypes";

export default function DeckList({ decks }: { decks: ForgeDeckSummary[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onDelete = (id: string) => {
    if (!confirm("Delete this deck?")) return;
    startTransition(async () => {
      await deleteForgeDeck(id);
      router.refresh();
    });
  };

  return (
    <div className="mt-6">
      <Link href="/forge/play/decks/new" className="inline-block rounded-md border px-4 py-2 text-sm hover:bg-muted/50">
        + New deck
      </Link>
      {decks.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">No decks yet. Start one above.</p>
      ) : (
        <ul className="mt-6 divide-y rounded-lg border">
          {decks.map((d) => (
            <li key={d.id} className="flex items-center justify-between p-4">
              <Link href={`/forge/play/decks/${d.id}`} className="min-w-0 flex-1 hover:underline">
                <div className="truncate font-medium">{d.name}</div>
                <div className="text-sm text-muted-foreground">{d.format} · {d.cardCount} card{d.cardCount === 1 ? "" : "s"}</div>
              </Link>
              <button onClick={() => onDelete(d.id)} disabled={pending}
                className="ml-4 rounded-md border px-3 py-1 text-sm text-muted-foreground hover:bg-muted/50">
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify gate-first + build**

Run: `npx vitest run __tests__/forge-gate-first.test.ts`
Expected: PASS (the new `page.tsx` calls `requireForge`).
Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/forge/play/decks/page.tsx app/forge/play/decks/DeckList.tsx
git commit -m "feat(forge): /forge/play/decks list page (new + delete)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Mixed-pool search grid + deck panel components

**Files:**
- Create: `app/forge/play/decks/[deckId]/PoolSearch.tsx`
- Create: `app/forge/play/decks/[deckId]/DeckPanel.tsx`

**Interfaces:**
- Consumes: `Card`, `DeckCard`, `DeckZone`, `isForgeDataLine`/`cardIdFromDataLine` (`@/app/forge/lib/deckAdapter`), `CardImage` (`@/app/decklist/card-search/components/CardImage`), `ForgeCardPreview` (`@/app/forge/components/ForgeCardPreview`), `DeckValidation` (`@/app/decklist/card-search/utils/deckValidation`).
- Produces:
  - `<PoolSearch pool={Card[]} forgeData={Map<string, DesignCard>} onAdd={(card)=>void} />`
  - `<DeckPanel cards={DeckCard[]} forgeData={Map<string, DesignCard>} validation={DeckValidation} onAdd onRemove onZone />`
  - `<MixedThumb card={Card} forgeData={Map<string, DesignCard>} />` (exported from PoolSearch for reuse by DeckPanel)

- [ ] **Step 1: Implement the thumbnail + search grid**

Create `app/forge/play/decks/[deckId]/PoolSearch.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import type { Card } from "@/app/decklist/card-search/utils";
import type { DesignCard } from "@/app/forge/lib/designCard";
import { isForgeDataLine, cardIdFromDataLine } from "@/app/forge/lib/deckAdapter";
import CardImage from "@/app/decklist/card-search/components/CardImage";
import ForgeCardPreview from "@/app/forge/components/ForgeCardPreview";

const RENDER_CAP = 60;

// Forge cards render via ForgeCardPreview (plain <img> + ?v=approved proxy — never
// next/image). Public cards render via CardImage. This keeps Forge art off the image
// optimizer (forge-no-next-image guardrail).
export function MixedThumb({ card, forgeData }: { card: Card; forgeData: Map<string, DesignCard> }) {
  if (isForgeDataLine(card.dataLine)) {
    const id = cardIdFromDataLine(card.dataLine);
    const data = forgeData.get(id);
    if (!data) return null;
    return <ForgeCardPreview card={data} artUrl={`/forge/api/art/${id}?v=approved`} className="w-full rounded-md" />;
  }
  return <CardImage imgFile={card.imgFile} alt={card.name} />;
}

export default function PoolSearch({
  pool, forgeData, onAdd,
}: { pool: Card[]; forgeData: Map<string, DesignCard>; onAdd: (card: Card) => void }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [source, setSource] = useState<"all" | "forge" | "public">("all");

  const types = useMemo(
    () => Array.from(new Set(pool.map((c) => c.type).filter(Boolean))).sort(),
    [pool],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return pool.filter((c) => {
      const isForge = isForgeDataLine(c.dataLine);
      if (source === "forge" && !isForge) return false;
      if (source === "public" && isForge) return false;
      if (type && c.type !== type) return false;
      if (!needle) return true;
      return (
        c.name.toLowerCase().includes(needle) ||
        c.brigade.toLowerCase().includes(needle) ||
        c.specialAbility.toLowerCase().includes(needle)
      );
    });
  }, [pool, q, type, source]);

  const shown = filtered.slice(0, RENDER_CAP);

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search cards…"
          className="flex-1 rounded-md border px-3 py-2 text-sm" />
        <select value={source} onChange={(e) => setSource(e.target.value as any)} className="rounded-md border px-2 py-2 text-sm">
          <option value="all">All</option>
          <option value="forge">Forge only</option>
          <option value="public">Public only</option>
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-md border px-2 py-2 text-sm">
          <option value="">All types</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {filtered.length} match{filtered.length === 1 ? "" : "es"}{filtered.length > RENDER_CAP ? ` (showing ${RENDER_CAP})` : ""}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {shown.map((c) => (
          <button key={c.dataLine} onClick={() => onAdd(c)} className="block w-full text-left" title={`Add ${c.name}`}>
            <MixedThumb card={c} forgeData={forgeData} />
            <div className="mt-1 truncate text-xs">{c.name}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement the deck panel**

Create `app/forge/play/decks/[deckId]/DeckPanel.tsx`:

```tsx
"use client";

import type { DeckCard, DeckZone } from "@/app/decklist/card-search/types/deck";
import type { DesignCard } from "@/app/forge/lib/designCard";
import type { DeckValidation } from "@/app/decklist/card-search/utils/deckValidation";

const ZONES: { key: DeckZone; label: string }[] = [
  { key: "main", label: "Main deck" },
  { key: "reserve", label: "Reserve" },
  { key: "maybeboard", label: "Maybeboard" },
];

export default function DeckPanel({
  cards, validation, onAdd, onRemove, onZone,
}: {
  cards: DeckCard[];
  forgeData: Map<string, DesignCard>;
  validation: DeckValidation;
  onAdd: (dataLine: string, zone: DeckZone) => void;
  onRemove: (dataLine: string, zone: DeckZone) => void;
  onZone: (dataLine: string, from: DeckZone, to: DeckZone) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border p-3 text-sm">
        <div className="font-medium">{validation.isValid ? "Legal" : "Issues"} · {validation.stats.mainDeckSize} main / {validation.stats.reserveSize} reserve</div>
        {validation.issues.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-muted-foreground">
            {validation.issues.slice(0, 8).map((iss, i) => <li key={i}>{iss.message}</li>)}
          </ul>
        )}
      </div>
      {ZONES.map(({ key, label }) => {
        const zoneCards = cards.filter((c) => c.zone === key);
        const count = zoneCards.reduce((n, c) => n + c.quantity, 0);
        return (
          <div key={key}>
            <h3 className="text-sm font-semibold">{label} ({count})</h3>
            {zoneCards.length === 0 ? (
              <p className="text-xs text-muted-foreground">Empty</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {zoneCards.map((c) => (
                  <li key={c.card.dataLine} className="flex items-center gap-2 text-sm">
                    <span className="w-6 text-right tabular-nums">{c.quantity}×</span>
                    <span className="min-w-0 flex-1 truncate">{c.card.name}</span>
                    <button onClick={() => onRemove(c.card.dataLine, key)} className="rounded border px-1.5">−</button>
                    <button onClick={() => onAdd(c.card.dataLine, key)} className="rounded border px-1.5">+</button>
                    {ZONES.filter((z) => z.key !== key).map((z) => (
                      <button key={z.key} onClick={() => onZone(c.card.dataLine, key, z.key)}
                        className="rounded border px-1.5 text-xs text-muted-foreground" title={`Move to ${z.label}`}>
                        {z.label[0]}
                      </button>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Verify no-next-image guardrail + build**

Run: `npx vitest run __tests__/forge-no-next-image.test.ts`
Expected: PASS (these components do not import `next/image` directly).
Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add "app/forge/play/decks/[deckId]/PoolSearch.tsx" "app/forge/play/decks/[deckId]/DeckPanel.tsx"
git commit -m "feat(forge): mixed-pool search grid + deck panel components

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Builder shell + builder page (wire it all together)

**Files:**
- Create: `app/forge/play/decks/[deckId]/DeckBuilder.tsx`
- Create: `app/forge/play/decks/[deckId]/page.tsx`

**Interfaces:**
- Consumes: `useForgeDeckState`, `designCardToCard`, `entriesFromDeckCards`, `hydrateEntries`, `toValidatableDeck`, `validateDeck`, `saveForgeDeck`, `getForgeDeck`, `listGrantedForgeCards`, `ALL_CARDS` (`@/app/decklist/card-search/data/cardIndex`), `PoolSearch`, `DeckPanel`.

- [ ] **Step 1: Implement the builder shell client**

Create `app/forge/play/decks/[deckId]/DeckBuilder.tsx`:

```tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Card } from "@/app/decklist/card-search/utils";
import type { DeckCard, DeckZone } from "@/app/decklist/card-search/types/deck";
import type { DesignCard } from "@/app/forge/lib/designCard";
import { ALL_CARDS } from "@/app/decklist/card-search/data/cardIndex";
import { validateDeck } from "@/app/decklist/card-search/utils/deckValidation";
import { designCardToCard } from "@/app/forge/lib/deckAdapter";
import { entriesFromDeckCards, hydrateEntries, toValidatableDeck } from "@/app/forge/lib/deckSerialize";
import { useForgeDeckState } from "@/app/forge/play/decks/useForgeDeckState";
import { saveForgeDeck } from "@/app/forge/lib/forgeDecks";
import type { ForgeDeckEntry } from "@/app/forge/lib/deckTypes";
import type { GrantedForgeCard } from "@/app/forge/lib/deckPool";
import PoolSearch from "./PoolSearch";
import DeckPanel from "./DeckPanel";

const FORMATS = ["Type 1", "Type 2", "Paragon", "Classic"];

export default function DeckBuilder({
  deckId, initialName, initialFormat, initialEntries, granted,
}: {
  deckId: string | null;          // null = new deck
  initialName: string;
  initialFormat: string;
  initialEntries: ForgeDeckEntry[];
  granted: GrantedForgeCard[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initialName);
  const [format, setFormat] = useState(initialFormat);

  // Forge cards → Card[], plus a cardId→DesignCard map for thumbnail rendering.
  const { forgeCards, forgeData, forgeById } = useMemo(() => {
    const forgeData = new Map<string, DesignCard>();
    const forgeById = new Map<string, Card>();
    const forgeCards = granted.map((g) => {
      const card = designCardToCard(g.data, g.cardId, g.setName);
      forgeData.set(g.cardId, g.data);
      forgeById.set(g.cardId, card);
      return card;
    });
    return { forgeCards, forgeData, forgeById };
  }, [granted]);

  // Public lookup by name|set for hydration.
  const publicByKey = useMemo(() => {
    const m = new Map<string, Card>();
    for (const c of ALL_CARDS) m.set(`${c.name}|${c.set}`, c);
    return m;
  }, []);

  const pool = useMemo(() => [...forgeCards, ...ALL_CARDS], [forgeCards]);

  const initialCards = useMemo(
    () => hydrateEntries(initialEntries, (id) => forgeById.get(id), (n, s) => publicByKey.get(`${n}|${s}`)).cards,
    [initialEntries, forgeById, publicByKey],
  );

  const { cards, addCard, removeCard, setQuantity } = useForgeDeckState(initialCards);

  const validation = useMemo(() => validateDeck(toValidatableDeck(cards, name, format)), [cards, name, format]);

  const moveZone = (dataLine: string, from: DeckZone, to: DeckZone) => {
    const dc = cards.find((c) => c.card.dataLine === dataLine && c.zone === from);
    if (!dc) return;
    for (let i = 0; i < dc.quantity; i++) addCard(dc.card, to);
    setQuantity(dataLine, from, 0);
  };

  const onSave = () => {
    startTransition(async () => {
      const res = await saveForgeDeck({
        id: deckId ?? undefined,
        name,
        format,
        paragon: null,
        entries: entriesFromDeckCards(cards),
      });
      if (res.ok === false) { alert(res.error); return; }
      if (!deckId) router.replace(`/forge/play/decks/${res.id}`);
      else router.refresh();
    });
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Deck name"
          className="flex-1 rounded-md border px-3 py-2 text-sm" />
        <select value={format} onChange={(e) => setFormat(e.target.value)} className="rounded-md border px-2 py-2 text-sm">
          {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <button onClick={onSave} disabled={pending}
          className="rounded-md border bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50">
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <PoolSearch pool={pool} forgeData={forgeData} onAdd={(c) => addCard(c, "main")} />
        <DeckPanel
          cards={cards} forgeData={forgeData} validation={validation}
          onAdd={(dataLine, zone) => { const dc = cards.find((c) => c.card.dataLine === dataLine && c.zone === zone); if (dc) addCard(dc.card, zone); }}
          onRemove={removeCard}
          onZone={moveZone}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement the builder page**

Create `app/forge/play/decks/[deckId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { getForgeDeck } from "@/app/forge/lib/forgeDecks";
import { listGrantedForgeCards } from "@/app/forge/lib/deckPool";
import DeckBuilder from "./DeckBuilder";

export const dynamic = "force-dynamic";

export default async function ForgeDeckBuilderPage({ params }: { params: Promise<{ deckId: string }> }) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const { deckId } = await params;
  const isNew = deckId === "new";

  const granted = await listGrantedForgeCards();
  const deck = isNew ? null : await getForgeDeck(deckId);
  if (!isNew && !deck) notFound();

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="text-xl font-semibold">{isNew ? "New deck" : deck!.name}</h1>
      <DeckBuilder
        deckId={isNew ? null : deck!.id}
        initialName={isNew ? "" : deck!.name}
        initialFormat={isNew ? "Type 1" : deck!.format}
        initialEntries={isNew ? [] : deck!.entries}
        granted={granted}
      />
    </main>
  );
}
```

- [ ] **Step 3: Verify gate-first + no-next-image + build**

Run: `npx vitest run __tests__/forge-gate-first.test.ts __tests__/forge-no-next-image.test.ts`
Expected: PASS (the builder page calls `requireForge`; `DeckBuilder` imports `ALL_CARDS` + `CardImage` but no direct `next/image`).
Run: `npm run build`
Expected: build succeeds, incl. the `/forge/play/decks/[deckId]` route. Confirm the `res.ok === false` narrowing compiles (strict:false).

- [ ] **Step 4: Commit**

```bash
git add "app/forge/play/decks/[deckId]/DeckBuilder.tsx" "app/forge/play/decks/[deckId]/page.tsx"
git commit -m "feat(forge): mixed-pool deck builder shell + route

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Enable the desk tile + full-suite verification

**Files:**
- Modify: `app/forge/page.tsx:23-26`

**Interfaces:**
- Consumes: nothing new.

- [ ] **Step 1: Enable the "Build a deck" tile**

In `app/forge/page.tsx`, replace the disabled playtester "Build a deck" tile (lines 23-26):

```tsx
            <div className="rounded-lg border border-dashed p-4 opacity-60" aria-disabled="true">
              <div className="font-medium">Build a deck</div>
              <div className="text-sm text-muted-foreground">Coming soon.</div>
            </div>
```

with an enabled link:

```tsx
            <Link href="/forge/play/decks" className="rounded-lg border p-4 hover:bg-muted/50">
              <div className="font-medium">Build a deck</div>
              <div className="text-sm text-muted-foreground">Mix the cards shared with you and the full pool.</div>
            </Link>
```

(Leave the "Find a game" tile disabled — that is Phase 2.3.)

- [ ] **Step 2: Run the full Forge-relevant suites**

Run: `npx vitest run app/forge/lib/__tests__/ __tests__/forge-gate-first.test.ts __tests__/forge-no-next-image.test.ts`
Expected: PASS (adapter 4 + serialize 4 + mutations 3 + gate-first + no-next-image).

- [ ] **Step 3: Full build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/forge/page.tsx
git commit -m "feat(forge): enable the Build a deck desk tile

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: ORCHESTRATOR — manual signed-in smoke (no creds in session)**

After merge of migration 056, manually as a granted playtester: open the desk → "Build a deck" → "New deck"; confirm the search grid shows public + the granted set's approved cards (Forge-only toggle works), approved Forge art renders via the proxy; build a deck across zones, watch live validation, Save; reload the list, re-open, edit, Delete. Confirm a revoked grant drops that set's cards on reload (fail-closed). Confirm a non-member 404s at `/forge/play/decks`.

---

## Self-Review

**Spec coverage:**
- Mixed pool (public + granted approved Forge) → Task 5 loader + Task 8 `pool` merge. ✓
- `forge_decks` (UUID refs, RLS, server-action write path) → Task 1 + Task 5. ✓
- Live re-resolution + fail-closed drop → Task 3 `hydrateEntries` + Task 8 hydration. ✓
- Reuse `validateDeck` unchanged → Task 3/8 `toValidatableDeck` + `validateDeck`. ✓
- Private art via `?v=approved`, no blob keys client-side → Task 7 `MixedThumb`; loader carries only `hasApprovedArt`. ✓
- Routes under `/forge/play/decks`, playtester-allowed, `requireForge` gate → Tasks 6/8 + gate-first checks. ✓
- Desk tile enabled → Task 9. ✓
- Leak guardrail (`forge_decks` in `FORGE_TABLES`) → Task 1. ✓
- Out of scope (games, republish, promotion, import/export, legality stamp) → not implemented. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows assertions. ✓

**Type consistency:** `ForgeDeckEntry`/`SaveForgeDeckInput`/`ForgeDeckSummary`/`ForgeDeckDetail` defined in Task 2 (`deckTypes.ts`) and consumed verbatim in Tasks 3/5/6/8. `designCardToCard(data, cardId, setName)` signature consistent across Tasks 2/8. `forge:` dataLine helpers consistent across Tasks 2/3/7. `GrantedForgeCard` defined in Task 5, consumed in Task 8. Deck mutation signatures `(cards, …)` consistent Tasks 4/8. ✓

**Note for the implementer:** the `moveZone`/`onAdd` callbacks in Task 8 reference the freshest `cards` via closure each render — acceptable for this UI. If a stale-closure bug surfaces during smoke, lift the lookups into the hook. Not a blocker.
