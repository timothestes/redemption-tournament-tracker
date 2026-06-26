# Forge ↔ main deck builder unification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Forge reuse the main player-facing deck builder by parameterizing the existing builder with an injected `DeckBuilderConfig`, instead of maintaining a bespoke Forge fork.

**Architecture:** Invert control on the three things hardwired to the public world — card **pool**, card-image **rendering** (`renderThumb`), and **persistence** — plus `features`/`formats` flags. The public builder injects today's values (zero behavior change); the Forge injects a mixed pool + a forge-aware thumb renderer + a `forge_decks` persistence adapter. The builder is written once; both surfaces inherit every feature forever. Source design: [docs/forge-deckbuilder-unification.md](../../forge-deckbuilder-unification.md).

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Vitest (node env), Tailwind. Card data via `ALL_CARDS` (`app/decklist/card-search/data/cardIndex`).

## Global Constraints

- **`next/image` is banned under `app/forge/**`** — enforced by `__tests__/forge-no-next-image.test.ts` (recursive static string scan in `npm test`). Private Blob art shares the storage domain `next.config.js` wildcards, so `<Image>` could CDN-cache an optimized variant of secret art. Forge art uses plain `<img>` against the `/forge/api/art/<id>` proxy only.
- **The live public builder must work at every step.** This is a multi-phase refactor of a working, player-facing surface on a security boundary — land it as one reviewed PR per phase, never a blind blast.
- **Behavior-preserving phases must be exactly that.** Phase 0/1/2 change *who supplies* a value, never *which* value the public surface gets. The public injection must be reference-identical to today.
- **No new runtime dependencies** without calling it out. There is currently no component-render test infra (no jsdom / `@testing-library`); vitest runs node-environment logic tests only.
- **Exact type sources:** `Card` from `app/decklist/card-search/utils.ts`; `Deck`/`DeckZone`/`DeckCard`/`DeckVisibility` from `app/decklist/card-search/types/deck.ts`.

---

## Verification note (read before Task 0.x)

Phase 0 is a **pure inversion-of-control refactor with zero new behavior**. There is no failing-test-first target that isn't test-theater on a static value, and there is no component-render harness installed. Its verification is therefore:

1. `npm test` stays green (full existing suite — no regressions).
2. `npx tsc --noEmit` (or `npm run build`) is green — proves the IoC wiring is type-correct.
3. A browser smoke check of `/decklist/card-search`: the search grid populates with the full card catalog exactly as before.

This is a deliberate, judgment-based deviation from "write the failing test first" — that discipline applies to behavior changes; Phase 0 has none. Later phases (1–3) *do* introduce behavior (forge cards rendering through the seam, forge persistence) and get real tests, listed in the roadmap.

---

## Phase 0 — Introduce the `pool` seam (zero behavior change)

The simplest of the three hardwired couplings. The pool is read at exactly **one** site (`setCards(...)` in `client.tsx`), so it needs no React context — a default-valued prop is sufficient IoC. (Context arrives in Phase 1, where `renderThumb` is needed at ~17 leaf sites and prop-threading would be noisy.)

### Task 0.1: Create the builder config module + public default

**Files:**
- Create: `app/decklist/card-search/builderConfig.tsx`

**Interfaces:**
- Produces: `interface DeckBuilderConfig { pool: Card[] }` and `const PUBLIC_BUILDER_CONFIG: DeckBuilderConfig`. Later phases extend the interface with `renderThumb` (Phase 1), `persistence` (Phase 2), and `features`/`formats` (Phase 3) — each added alongside its first consumer, never speculatively.

- [ ] **Step 1: Write the config module**

```tsx
// app/decklist/card-search/builderConfig.tsx
"use client";

import type { Card } from "./utils";
import { ALL_CARDS } from "./data/cardIndex";

/**
 * Injection seams that let one builder serve both the public site and the Forge.
 * Phase 0 wires only `pool`; `renderThumb`, `persistence`, and `features`/`formats`
 * are added in later phases alongside their first consumer.
 */
export interface DeckBuilderConfig {
  /** Card pool the builder searches and renders. Public: ALL_CARDS. Forge: [...forgeCards, ...ALL_CARDS]. */
  pool: Card[];
}

/** Public default: the builder behaves exactly as it does today. */
export const PUBLIC_BUILDER_CONFIG: DeckBuilderConfig = {
  pool: ALL_CARDS,
};
```

- [ ] **Step 2: Typecheck the new module compiles**

Run: `npx tsc --noEmit`
Expected: PASS (no errors referencing `builderConfig.tsx`).

- [ ] **Step 3: Commit**

```bash
git add app/decklist/card-search/builderConfig.tsx
git commit -m "feat(builder): introduce DeckBuilderConfig pool seam + public default"
```

### Task 0.2: Inject the pool into `client.tsx` via config prop

**Files:**
- Modify: `app/decklist/card-search/client.tsx` (import line `:17`; component signature `:149`; `setCards(ALL_CARDS)` at `:871`)

**Interfaces:**
- Consumes: `DeckBuilderConfig`, `PUBLIC_BUILDER_CONFIG` from Task 0.1.
- Produces: `CardSearchClient` now accepts an optional `config?: DeckBuilderConfig` prop (defaulting to `PUBLIC_BUILDER_CONFIG`). The Forge wrapper (Phase 3) supplies its own config here.

- [ ] **Step 1: Confirm the public render site passes no props**

Run: `grep -rn "CardSearchClient" app/decklist/card-search/page.tsx`
Expected: a `<CardSearchClient />` usage with no props — confirming the new optional prop is backward-compatible. (If props are already passed, fold `config` in beside them.)

- [ ] **Step 2: Replace the `ALL_CARDS` import with the config import**

In `app/decklist/card-search/client.tsx`, remove line 17:
```tsx
import { ALL_CARDS } from "./data/cardIndex";
```
and add (next to the other local imports):
```tsx
import { DeckBuilderConfig, PUBLIC_BUILDER_CONFIG } from "./builderConfig";
```

- [ ] **Step 3: Add the optional `config` prop to the component**

Change the signature at line 149 from:
```tsx
export default function CardSearchClient() {
```
to:
```tsx
export default function CardSearchClient({
  config = PUBLIC_BUILDER_CONFIG,
}: { config?: DeckBuilderConfig } = {}) {
```

- [ ] **Step 4: Read the pool from config at the single load site**

Change line 871 from:
```tsx
    setCards(ALL_CARDS);
```
to:
```tsx
    setCards(config.pool);
```
And add `config.pool` to that `useEffect` dependency array (it is currently `[]`; becomes `[config.pool]`). The public pool is a stable module-level reference, so this still runs once.

- [ ] **Step 5: Verify no other `ALL_CARDS` references remain in client.tsx**

Run: `grep -n "ALL_CARDS" app/decklist/card-search/client.tsx`
Expected: no matches (the import and the one usage were the only references).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS — identical to the pre-change baseline (capture the baseline first with `npm test` on a clean tree if unsure).

- [ ] **Step 8: Browser smoke check (behavior-identical)**

Start the dev server, open `/decklist/card-search`, confirm the search grid populates with the full catalog and the count matches today. (Use Playwright or a manual check.)

- [ ] **Step 9: Commit**

```bash
git add app/decklist/card-search/client.tsx
git commit -m "refactor(builder): inject card pool via DeckBuilderConfig (no behavior change)"
```

---

## Roadmap — Phases 1–3 (detailed once Phase 0 lands)

These phases introduce real behavior and get real tests. They are scoped here but intentionally **not** expanded into bite-sized TDD steps yet: their exact shape depends on Phase 0's landed code and on per-call-site investigation (especially the image seam). Each is its own reviewed PR.

### Phase 1 — `renderThumb` seam (the hard one; the security boundary)

The design doc's "~17 CardImage call sites" is actually **~2 `<CardImage>` usages + ~18 plain `<img src={getImageUrl(card.imgFile)}>` sites** with per-site styling (className, sizes, opacity, objectFit) across ~7 files (`client.tsx`, `SpotlightPanel.tsx`, `DeckCardList.tsx`, `DeckBuilderPanel.tsx`, `FullDeckView.tsx`, `ModalWithClose.tsx`, `DragGhost.tsx`, `random/client.tsx`). A forge card (`imgFile=""`, `dataLine="forge:<id>"`) cannot render as a single `<img src>` — `ForgeCardPreview` is a composite — so **every** thumbnail site that could receive a forge card in Phase 3 must route through the seam.

- Introduce the React **context** here (this is what justifies context over prop-threading): `DeckBuilderConfigProvider` + `useBuilderConfig()`, extracting `CardSearchClient`'s body into an inner `<DeckBuilderRoot>` that reads the hook so leaves can call `useBuilderConfig().renderThumb(card, opts)`.
- Extend `DeckBuilderConfig` with `renderThumb: (card: Card, opts?: { className?: string; sizes?: string; priority?: boolean }) => ReactNode` (signature finalized against the real call sites — the `opts` shape is dictated by what the 18 plain-`<img>` sites need).
- Default `renderThumb` = today's `CardImage` (keeps `next/image`, lives under `app/decklist/` → legal). Migrate each call site to the seam; gate on a visual diff of the search grid + each deck zone + spotlight + modal nav + cover art + drag ghost.
- **Strongly recommended prerequisite:** add jsdom + `@testing-library/react` (a new dev dependency — flag it) so the seam can be unit-tested: "default renderThumb emits `<CardImage>` for a public card" and (Phase 3) "forge renderThumb emits `ForgeCardPreview` for a `forge:` dataLine and never `next/image`."

### Phase 2 — `persistence` seam

- Extend `DeckBuilderConfig` with `persistence: { load(id): Promise<Deck>; save(deck, name?): Promise<{ id: string }>; delete?(id): Promise<void> }`, shape finalized against how `useDeckState` actually calls `saveDeckAction` / `loadDeckByIdAction` today (`useDeckState.ts:4`).
- Default persistence wraps today's `saveDeckAction`/`loadDeckByIdAction` (the `decks` table) — reference-identical behavior.
- Replace the static imports in `app/decklist/card-search/hooks/useDeckState.ts` with `config.persistence`.
- Gate the `localStorage` autosave (STORAGE_KEY `"redemption-deck-builder-current-deck"`, `useDeckState.ts:8`, `:108-117`, `:801-812`) behind a `features.localStoragePersist` flag — **off for Forge** (forge decks are RLS-scoped, not browser drafts; a shared STORAGE_KEY would bleed a public draft into Forge).
- Existing save/load tests cover the default; add a test that an injected persistence adapter is the one invoked.

### Phase 3 — Point the Forge at the unified builder; delete the fork

- Extend `DeckBuilderConfig` with `features?: { import?; share?; tags?; tournament?; localStoragePersist? }` and `formats?: string[]`; **hard-disable** import/export, tournament deck-check, public share-links, and tags for Forge (each pulls in `decks`-table actions or a public token format with no Forge-UUID notion). Assert the disables in CI (extend a guardrail test).
- Forge wrapper `app/forge/play/decks/[deckId]/DeckBuilder.tsx` injects: mixed pool `[...forgeCards, ...ALL_CARDS]` (from `listGrantedForgeCards()` + `designCardToCard`), the `MixedThumb` renderer (forge → `ForgeCardPreview` via `/forge/api/art/<id>`, public → default), and a `forge_decks` persistence adapter wrapping `saveForgeDeck`/`getForgeDeck` + `entriesFromDeckCards`/`hydrateEntries`. The wrapper file must contain **no `next/image` string** so the static scan stays green.
- Delete the bespoke Forge UI: `PoolSearch.tsx` (~86 lines), `DeckPanel.tsx` (~62 lines), `useForgeDeckState.ts` (~15 lines).
- Keep every pure adapter (`deckAdapter.ts`, `deckSerialize.ts`, `deckPool.ts`, `deckTypes.ts`, `forgeDecks.ts`) — they *become* the Forge config's implementation.
- Extend `__tests__/forge-no-next-image.test.ts` to also assert the Forge wrapper renders forge cards via `ForgeCardPreview`.

---

## Risks & mitigations

- **Guardrail regression** — keep `next/image` out of every `app/forge/**` file; the Forge wrapper imports the shared builder but never `next/image`. CI scan must stay green and gain a positive assertion (Phase 3).
- **`localStorage` cross-talk** — a shared `STORAGE_KEY` would bleed a public draft into Forge; `localStoragePersist` must be off for Forge (Phase 2/3).
- **Feature creep on a security boundary** — `features` flags must *hard*-disable Forge-illegal features, asserted in CI (Phase 3).
- **Auditability** — keep each phase strictly to its one seam so the diff is reviewable. Phase 0 touches one new file + ~4 lines.

## Self-review notes

- Spec coverage: pool (Ph0), renderThumb + context + image call sites + guardrail (Ph1), persistence + localStorage gate (Ph2), features/formats + Forge wiring + deletes + adapters-kept (Ph3) — all four seams and every "Delete"/"Keep" item from the source design map to a phase.
- Deviation logged: source design says "introduce all four seams" in Phase 0; this plan wires only `pool` in Phase 0 and adds each remaining seam with its first consumer, for smaller auditable diffs (honors the source's own "keep Phase 0 strictly mechanical" risk note).
