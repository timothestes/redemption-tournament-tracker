# Card Data Build-Time Codegen

## Summary

Replace 15 duplicate runtime fetches of `carddata.txt` (from GitHub raw) with a single build-time-generated TypeScript module. Consumers import a shared `findCard`/`CARDS` API instead of fetching and parsing a 1.2 MB TSV on every request or page load. Eliminates a runtime dependency on GitHub, eliminates drift between four parallel parsing implementations, and reduces client-side cold-page cost for the deck builder.

## Background

`carddata.txt` is the Redemption CCG card database — a ~1.2 MB / 5,461-row tab-separated file hosted at `https://raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/carddata.txt`. It changes occasionally (new sets, errata), read-only, read-mostly.

Today it is fetched and re-parsed by 15 call sites in this repo with at least four distinct parser implementations:

- `utils/deckcheck/cardDatabase.ts` (15 fields, permanent module cache)
- `app/play/actions.ts` (8 fields, newly-added TTL module cache — a bandaid being ripped out as part of this work)
- `app/goldfish/[deckId]/page.tsx` (8 fields, Next.js fetch revalidate 3600s — duplicated from `/play`)
- `lib/pricing/matching.ts` (7 fields, no cache)

Plus 5 other server call sites and 6 client call sites. The client callers fetch the full 1.2 MB TSV from GitHub on every deck-builder / deck-view / admin-page visit.

The repo already has a precedent for build-time codegen of external data: `make update-paragons` downloads a CSV, runs `scripts/parse-paragons.js`, writes `app/decklist/card-search/data/paragons.ts`. Both the CSV source and the generated TS file are committed to git.

### Brainstorm decisions

- **Scope: full sweep.** Migrate all 15 call sites (server + client).
- **Refresh cadence: manual.** A human runs `make update-cards` when upstream changes, same as paragons. No scheduled automation.
- **Raw TSV: committed to git.** PR diffs show card-level upstream changes. ~1.2 MB initial addition, grows slowly.
- **Delivery: single PR on a single branch.** Atomic swap over phased rollout.

## Architecture

### New files

| File | Type | Purpose |
|------|------|---------|
| `scripts/data/carddata.txt` | Committed artifact | Raw upstream TSV. Refreshed by `make update-cards`. |
| `scripts/parse-carddata.js` | Hand-written script | Reads the TSV, emits the generated TS module. Mirrors `scripts/parse-paragons.js`. |
| `lib/cards/generated/cardData.ts` | Generated artifact | Committed. Exports `CARDS`, the `CardData` interface, and three lookup Maps. |
| `lib/cards/lookup.ts` | Hand-written, stable | Single import surface for all callers. Re-exports `CARDS` and `CardData`, provides `findCard(name, set?, imgFile?)`. |

### Canonical `CardData` shape

The 15-field interface already defined in `utils/deckcheck/cardDatabase.ts` (lines 4-20) covers every known consumer's needs. Moved into the generated module:

```ts
export interface CardData {
  name: string;
  set: string;
  imgFile: string;      // `.jpg` / `.jpeg` extension stripped
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
```

### Generated module contents

`lib/cards/generated/cardData.ts` exports:

- `CARDS: readonly CardData[]` — the full array (5,461 entries).
- `CARD_BY_KEY: ReadonlyMap<string, CardData>` — keyed by `${name}|${set}|${imgFile}`. Exact printing match.
- `CARD_BY_NAME_SET: ReadonlyMap<string, CardData>` — keyed by `${name}|${set}`. Last-wins on collision (matches existing deckcheck behavior — stores the most recent printing).
- `CARD_BY_NAME: ReadonlyMap<string, CardData>` — keyed by `${name}` (exact case). Last-wins on collision.
- `CARD_BY_NAME_LOWER: ReadonlyMap<string, CardData>` — keyed by `${name.toLowerCase()}`. Last-wins. Used as the case-insensitive fallback to preserve existing `findCard` behavior.

Four Maps because three distinct lookup granularities are used across the call sites today, plus a case-insensitive fallback required to preserve existing deckcheck semantics. Building all four at module-load time costs a single pass over 5,461 rows (<10 ms), paid once per Node process / client bundle.

### Lookup API (`lib/cards/lookup.ts`)

```ts
export { CARDS, type CardData } from './generated/cardData';
import {
  CARD_BY_KEY,
  CARD_BY_NAME_SET,
  CARD_BY_NAME,
  CARD_BY_NAME_LOWER,
} from './generated/cardData';

export function findCard(
  name: string,
  set?: string,
  imgFile?: string,
): CardData | undefined {
  const lower = name.toLowerCase();
  if (name && set && imgFile) {
    return (
      CARD_BY_KEY.get(`${name}|${set}|${imgFile}`)
      ?? CARD_BY_NAME_SET.get(`${name}|${set}`)
      ?? CARD_BY_NAME.get(name)
      ?? CARD_BY_NAME_LOWER.get(lower)
    );
  }
  if (name && set) {
    return (
      CARD_BY_NAME_SET.get(`${name}|${set}`)
      ?? CARD_BY_NAME.get(name)
      ?? CARD_BY_NAME_LOWER.get(lower)
    );
  }
  return CARD_BY_NAME.get(name) ?? CARD_BY_NAME_LOWER.get(lower);
}
```

`findCard` extends the existing deckcheck function's `(name, set?)` signature with an optional third `imgFile?` parameter. The new function is **sync** (returns `CardData | undefined` directly), while the existing one is async (`Promise<CardData | undefined>`). This is backward-compatible with existing `await findCard(...)` callers — awaiting a non-Promise value is a no-op in TypeScript. The case-insensitive fallback (`CARD_BY_NAME_LOWER`) preserves the existing deckcheck behavior where mis-cased user input still resolves to a card.

### Why a separate `lookup.ts` instead of importing the generated file directly

Isolation. If the implementation ever moves (Postgres, edge config, different format), only `lookup.ts` changes. The generated file is a private artifact; callers never import from it directly.

### Derived fields policy

Callers that compute derived fields on top of the raw data (e.g. `app/decklist/card-search/hooks/useDeckState.ts` deriving `testament`/`isGospel` from `reference`) keep that logic **in the caller**. The generated module ships only the 15 raw fields. Rationale: deckbuilder-specific derivations don't belong in shared infrastructure, and precomputing them into the generated data would bloat the script and the artifact without benefiting the other 14 callers.

## Migration

Single PR on a single branch, single commit or small commits as convenient.

### Step A — Infrastructure (no behavior change)

1. Add `scripts/data/carddata.txt` (download from upstream, commit).
2. Add `scripts/parse-carddata.js`.
3. Add `makefile` targets (see below).
4. Run `make update-cards` to produce `lib/cards/generated/cardData.ts`.
5. Add `lib/cards/lookup.ts`.

After step A, the generated module exists alongside the old code. Nothing is migrated yet; nothing breaks.

### Step B — Server migrations

| File | Change |
|------|--------|
| `utils/deckcheck/cardDatabase.ts` | Reduce to a thin re-export of `lib/cards/lookup`. Keep its existing `findCard` / `getCardDatabase` / `CardData` export names so downstream callers are unaffected. |
| `app/play/actions.ts` | Remove the `CARD_DATA_URL` constant, `buildCardLookup`, `fetchCardLookup`, module TTL cache. Use `findCard` from lookup inside the deck-card enrichment loop. |
| `app/goldfish/[deckId]/page.tsx` | Remove the inline `fetchCardLookup` (duplicate of `/play`'s). Use `findCard`. |
| `lib/pricing/matching.ts` | Replace `loadCardData()` with a helper that maps `CARDS` into its `CardRow[]` shape, or inline the shape. Remove `CARD_DATA_URL`. |
| `app/admin/cards/actions.ts` | Replace fetch-and-parse with `CARDS` iteration. |
| `app/api/sync-card-images/route.ts` | Replace fetch-and-parse with `CARDS` iteration over `imgFile`. Keep `CARD_IMAGE_BASE_URL` — images are a separate concern. |
| `scripts/sync-duplicate-cards.ts` | Replace fetch with `CARDS` import. |
| `scripts/test-duplicate-lookups.ts` | Replace fetch with `CARDS` import. |

### Step C — Client migrations

| File | Change |
|------|--------|
| `app/decklist/card-search/client.tsx` | Replace `fetch(CARD_DATA_URL)` + `useEffect` parsing with `import { CARDS }`. Move the per-row `Card`-shape mapping to module scope (runs once per bundle load). |
| `app/decklist/[deckId]/client.tsx` | Same swap. |
| `app/decklist/card-search/hooks/useDeckState.ts` | Same swap. **Keep** the testament/gospel derivation logic — just iterate `CARDS` once instead of parsing TSV. Move it to module scope. |
| `app/decklist/card-search/random/client.tsx` | Replace `fetch` with `CARDS` import; pick a random entry from the array. |
| `app/admin/cards/page.tsx` | Replace the module-cached `fetchCardData` with a direct `CARDS` mapping. |
| `app/admin/rulings/page.tsx` | Replace fetch with `CARDS` import. |

### Step D — Cleanup

1. Remove `CARD_DATA_URL` export from `app/decklist/card-search/constants.ts`. Keep `CARD_IMAGE_BASE_URL`, `CARD_IMAGE_PROXY_URL`, the biblical book lists, and the brigade lists — all unrelated.
2. Grep the repo for any remaining `raw.githubusercontent.com/.../carddata.txt` or `CARD_DATA_URL` references; expect zero hits after cleanup.
3. Update `CLAUDE.md`:
   - Add `make update-cards` under Dev Commands.
   - Add a row in the Key References table pointing at `lib/cards/lookup.ts` as the canonical card-data access.
4. Update `makefile` `help` target to mention `update-cards` and `cards` alongside paragons.

## Script details

### `scripts/parse-carddata.js`

Structured identically to `scripts/parse-paragons.js`:

- `require('fs')`, `require('path')` — same import style as paragons (the existing script is CommonJS).
- Read `scripts/data/carddata.txt` via `fs.readFileSync`.
- Split on `\n`, skip the header row, filter empty lines.
- For each line: split on `\t`, extract the 15 columns by index (mapping below), strip `.jpg`/`.jpeg` suffix from img file via `.replace(/\.jpe?g$/i, '')`, trim strings.
- Skip rows where the name column is empty.
- Build the four Maps during the same pass.
- Emit `lib/cards/generated/cardData.ts` containing:
  - File-level header comment noting generation origin and the `make update-cards` regen command.
  - The `CardData` interface.
  - `export const CARDS: readonly CardData[] = [...]` — `JSON.stringify(cards, null, 2)` serialization.
  - Four `export const CARD_BY_*: ReadonlyMap<string, CardData> = new Map([...])` entries, each serialized as `Array.from(map.entries())`.
- **Diff summary**: before writing the new generated file, read the previous `CARDS` from the existing `lib/cards/generated/cardData.ts` (if present) and compute the set difference of `name|set|imgFile` keys. Log `➕ N cards added` / `➖ N cards removed` / `🔄 N cards modified` (any row whose full field tuple changed). This makes regen PRs reviewable at a glance without diffing a 1.2 MB file by eye.
- Log `✅ Generated lib/cards/generated/cardData.ts with N cards` at the end.
- Assert `cards.length >= 5000` before writing; fail with a clear error if the count is suspiciously low (guards against a truncated download).

Column index → field mapping (matches current parsers):

| Column | Field |
|--------|-------|
| 0 | name |
| 1 | set |
| 2 | imgFile *(suffix-stripped)* |
| 3 | officialSet |
| 4 | type |
| 5 | brigade |
| 6 | strength |
| 7 | toughness |
| 8 | class |
| 9 | identifier |
| 10 | specialAbility |
| 11 | rarity |
| 12 | reference |
| 14 | alignment |
| 15 | legality |

(Column 13 is intentionally skipped — matches the existing deckcheck parser at `utils/deckcheck/cardDatabase.ts:75-91`.)

### `makefile`

Add to the top, alongside existing paragon variables:

```make
CARD_DATA_URL = https://raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/carddata.txt
CARD_DATA_TXT_PATH = scripts/data/carddata.txt
CARD_DATA_TS_PATH = lib/cards/generated/cardData.ts
```

Add after `update-paragons`:

```make
update-cards:
	@echo "📥 Downloading latest card data from GitHub..."
	@mkdir -p $(dir $(CARD_DATA_TXT_PATH))
	@curl -sL "$(CARD_DATA_URL)" > $(CARD_DATA_TXT_PATH)
	@echo "✅ Downloaded to $(CARD_DATA_TXT_PATH)"
	@echo "🔄 Generating TypeScript data..."
	@node scripts/parse-carddata.js
	@echo "✅ Card data updated successfully!"

cards: update-cards
```

Add `update-cards` and `cards` to `.PHONY` and to the `help` target under a "Card Data:" section.

## Verification

1. **`npm run build` passes** end-to-end. Primary correctness signal — TypeScript will surface any caller where the shared `CardData` shape doesn't match what was previously inferred.
2. **Generated-module sanity**: `CARDS.length >= 5000` (asserted in the script; also spot-verifiable via `node -e "require('./lib/cards/generated/cardData.ts').CARDS.length"` after build).
3. **Hot-path smoke test — `/play` Create Game**: click Create Game on the /play screen, confirm a game loads without missing-field errors. This exercises the bandaid path being removed.
4. **Deck builder smoke test — `/decklist/card-search`**: filter by brigade, search by name, click a card, confirm the spotlight panel renders full fields. Exercises the largest client migration.
5. **Goldfish smoke test — `/goldfish/[deckId]`**: load a practice deck, confirm card types/abilities populate.
6. **Deckcheck smoke test**: save a deck with a known rule violation (e.g. out-of-format card), confirm the validator still flags it.
7. **Bundle inspection**: run `npm run build` and check the Next.js output. Confirm the card-data module lands in the shared chunk for routes that use it, at the expected ~300-600 KB gzipped. If a single route owns it in its own chunk, re-evaluate whether to route-split further.

## Edge cases and gotchas

- **Both artifacts must be in the same commit.** `scripts/data/carddata.txt` and `lib/cards/generated/cardData.ts` ship together. Omitting either makes the branch fail `npm run build` on clone.
- **New cards between regens are silently missing.** `findCard` returns `undefined` on miss. Every existing caller already handles this (falls back to empty strings). Same practical behavior as today's stale-cache case. If upstream drift becomes a real problem, revisit the manual-refresh decision with a scheduled GitHub Action.
- **Column-14 vs column-13 quirk.** The existing deckcheck parser intentionally skips column 13; the new script preserves that. If upstream ever rearranges columns, `make update-cards` will silently produce garbage fields — not breaking, just wrong. Mitigation: visual diff review when regenerating.
- **Client bundle cost.** Estimated 300-600 KB gzipped added to routes that import the module. Net vs today: lower, because the current live fetch is 1.2 MB TSV on every page visit to deck routes. Worth confirming via Next.js bundle output in verification step 7.

## Rollback

Revert the PR. Pre-bandaid runtime behavior (live GitHub fetch in every caller) was the state of the codebase for years; worst case is returning there. The bandaid being ripped out in this PR is a few days old, not load-bearing.

## Out of scope

- Moving card data into Postgres (a `cards` table) — explicitly rejected during brainstorm as more moving parts for no gain.
- Enriching `deck_cards` rows with denormalized fields at save time — explicitly rejected during brainstorm.
- Scheduled GitHub Action for auto-regen — explicitly deferred; may revisit if manual refresh proves unreliable.
- Changes to `CARD_IMAGE_BASE_URL` or the image sync cron job's fetch of the image CDN (separate concern from data).
- Changes to the biblical book lists or brigade lists in `app/decklist/card-search/constants.ts`.

## Critical files

Files touched in this PR, roughly in order:

### Added
- `scripts/data/carddata.txt`
- `scripts/parse-carddata.js`
- `lib/cards/generated/cardData.ts`
- `lib/cards/lookup.ts`

### Modified
- `makefile`
- `CLAUDE.md`
- `utils/deckcheck/cardDatabase.ts`
- `app/play/actions.ts`
- `app/goldfish/[deckId]/page.tsx`
- `lib/pricing/matching.ts`
- `app/admin/cards/actions.ts`
- `app/admin/cards/page.tsx`
- `app/admin/rulings/page.tsx`
- `app/api/sync-card-images/route.ts`
- `scripts/sync-duplicate-cards.ts`
- `scripts/test-duplicate-lookups.ts`
- `app/decklist/card-search/client.tsx`
- `app/decklist/card-search/constants.ts`
- `app/decklist/card-search/hooks/useDeckState.ts`
- `app/decklist/card-search/random/client.tsx`
- `app/decklist/[deckId]/client.tsx`
