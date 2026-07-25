# Format Restructure: Limited / Unlimited / T2 / Paragon

**Date:** 2026-07-25
**Status:** Approved (design); implementation pending
**Driver:** Official announcement — constructed categories restructure beginning August 2026.

## 1. Background

The official organized-play announcement restructures the constructed formats:

- **Type 1 – 2 Player "Limited"** (formerly "rotation"): today's Type 1, rotation card pool.
- **Type 1 – 2 Player "Unlimited"** (formerly "classic"): all cards ever released; offered at all
  tournament levels including State/Regional/National.
- **All Type 1 categories: deck size 50–70** (down from 50–154).
- **Type 2 – 2 Player**: simplified. Still the Limited (rotation) pool. Max 2 copies of a card
  regardless of brigade and type, except Dominants and Lost Souls. Deck 100–140 (down from
  100–252). Reserve 15 → 20. Good/evil balance still required. Experience credit dropped.
- **Every constructed category gets its own ban list** (contents to be published).
- **Teams**: adjustments still being vetted — out of scope here.
- **Paragon** (fan format) is unaffected by the announcement; Roots 2 became legal for it (and
  every other format) when PR #238 removed the temporary RR2 gate.

### Decisions made with Tim (2026-07-25)

| Question | Decision |
|---|---|
| Rollout timing | **Cut over now.** New formats replace the old ones immediately; no legacy-rules mode, no feature flag. |
| Canonical stored values | `Limited` / `Unlimited` / `T2` / `Paragon` in `decks.format`; **L / U / T2 / P** badges where space is tight. |
| T1 balance | No good/evil requirement (unchanged from today's T1). |
| T2 carryovers | Lost Soul chart, dominant caps, and exact good/evil balance carry over unchanged. |
| T2 Lost Souls "1 copy" | Souls **with a special ability: max 1** (was 2). **Generic no-ability souls stay exempt** (unlimited copies). |
| T2 special exceptions | Locust from the Pit / Legion / Faithful Witness / Angry Mob **keep their elevated allowances** in T2 (they override the flat 2). |
| T2 sites+cities cap | Kept (provisional — announcement is silent). |
| Roots 2 for Paragon | Already done on main (#238 removed the gate for all formats; the Paragon search filter never excluded Roots 2). |

## 2. Current state (what this replaces)

- Format is free text (`decks.format`), fuzzy-matched via `.includes('type 2')` /
  `.includes('paragon')` / else-T1 in ~8 places: `utils/deckcheck/index.ts`,
  `app/decklist/card-search/utils/deckValidation.ts` (legacy fallback),
  `DeckBuilderPanel.tsx`, `utils/tournament/categoryDefaults.ts`, `lib/deck-format.ts`
  (mirrored in `spacetimedb/src/index.ts` for matchmaking), and assorted UI.
- The authoritative validator is `utils/deckcheck` (`validateT1Rules` / `validateT2Rules` /
  `validateParagonRules`), run on save and via `app/api/deckcheck/route.ts`.
- **No pool validation exists.** `legality` from carddata.txt col 15 (`Rotation` 3187 cards,
  empty 2495, `Banned` 9) is only a search filter (`legalityMode`:
  Rotation/Classic/Banned/Scrolls/Paragon). A "Type 1" deck full of Classic-only cards passes
  validation today.
- One hardcoded `BANNED_CARDS` array (7 entries) applies to all three formats.
- Paragon's card pool is a hardcoded excluded-sets array inside
  `app/decklist/card-search/client.tsx` — search-only, never validated.
- "Experience credit" for T2 has never existed in this codebase — dropping it is a no-op.

## 3. Format registry (single source of truth)

New module `lib/formats.ts`:

```ts
export type FormatId = 'Limited' | 'Unlimited' | 'T2' | 'Paragon';

export interface FormatDef {
  id: FormatId;
  label: string;              // "Limited", "Unlimited", "T2", "Paragon"
  badge: string;              // "L", "U", "T2", "P"
  family: 'T1' | 'T2' | 'Paragon';   // which rules validator applies
  main: { min: number; max: number };
  reserveMax: number;
  pool: 'rotation' | 'all' | 'paragon';
  banList: BannedCardDef[];   // per-format; seeded with today's list
}

export function normalizeFormat(s: string | null | undefined): FormatId;
```

`normalizeFormat` maps every value ever stored or imported:
contains `paragon` → `Paragon`; contains `type 2` / `multi` / equals `t2` → `T2`;
contains `unlimited` → `Unlimited`; everything else (including `Type 1`, `T1`, `Single`,
`Limited`, empty) → `Limited`.

The registry:

| id | family | main | reserve | pool | ban list |
|---|---|---|---|---|---|
| Limited | T1 | 50–70 | 10 | rotation | `LIMITED_BANS` |
| Unlimited | T1 | 50–70 | 10 | all | `UNLIMITED_BANS` |
| T2 | T2 | 100–140 | 20 | rotation | `T2_BANS` |
| Paragon | Paragon | 40–40 | 10 | paragon | `PARAGON_BANS` |

All four ban lists are seeded with today's 7-entry list until the elders publish
per-category lists; the structure is the deliverable, the contents are a data update.

`lib/deck-format.ts` (multiplayer matchmaking tag) is **left exactly as is** — its
fallthrough already maps `Limited`/`Unlimited` → `T1` and `T2` matches `=== 't2'`, so the
client and the SpacetimeDB mirror stay in agreement with **zero module republish**.

## 4. Validator changes (`utils/deckcheck`)

`checkDeck()` normalizes the incoming format string to a `FormatId`, looks up the
`FormatDef`, and dispatches by `family`, passing the def so size/reserve/pool/ban-list
become parameters instead of constants.

### New shared rule: pool legality (`check-pool-legality`)

- `pool: 'rotation'` → every card (main + reserve) must have `legality === 'Rotation'`.
- `pool: 'all'` → no pool restriction.
- `pool: 'paragon'` → card's `officialSet` must not be in `PARAGON_EXCLUDED_SETS`, which
  **moves from `client.tsx` into the registry** so search and validation share one list.
  (This is a new enforcement for Paragon — previously search-only.)

Roots 2 cards carry `legality: 'Rotation'` (224 cards), so they are in the Limited/T2 pool
with no further work.

### Limited & Unlimited (family T1)

`validateT1Rules(def, …)` — one implementation, two formats:

- Main deck **50–70** (`def.main`), reserve ≤ 10.
- Lost Soul chart unchanged: 7 @ 50–56, 8 @ 57–63, 9 @ 64–70. Hoppers don't count.
- Everything else carries over verbatim: dominants unique and ≤ counting souls; no
  Dominants/Lost Souls in reserve; multi-brigade max 1; special-ability cards 1 per 50
  (= 1 at these sizes); ability Lost Souls max 1 with reference grouping + ability-name
  merging; vanilla max 3; sites+cities ≤ Lost Souls; mutual exclusions; character aliases;
  special exceptions (Faithful Witness flat 4, Locust 5/50, Legion 4/50, Angry Mob 4/50).
- Ban list + pool from `def`. The **only** differences between Limited and Unlimited are
  `pool` and `banList`.

### T2 (family T2) — rewritten copy rules

- Main deck **100–140**, reserve ≤ **20**.
- Lost Soul chart unchanged: 14 @ 100–105, +1 per 7 → 19 @ 134–140.
- Good/evil balance unchanged: exactly equal in main deck and reserve, separately,
  via `getEffectiveAlignment`.
- **The 4-tier brigade quantity system (`checkT2QuantityLimits`) is deleted**, replaced by:
  - **Flat max 2 per card** (same-card groups via `duplicate_card_groups`, as today),
    regardless of brigade count or card type;
  - **Dominants max 1** (existing `checkDominantUnique`);
  - **Lost Souls with a special ability max 1** (was 2), same reference/ability-identity
    grouping as T1; **no-ability souls exempt** (unlimited);
  - **Special exception cards keep their elevated allowances** and are excluded from the
    flat-2 check, exactly as they're excluded from today's tiers (per-50 scaling: at
    100–140 the multiplier is 2 → Locust 10, Legion 8, Angry Mob 8; Faithful Witness
    flat 4).
- Carried over: dominants ≤ counting souls; reserve contents; mutual exclusions;
  sites+cities ≤ Lost Souls (**provisional** — remove if the published rules drop it);
  character aliases (their per-50 base of 1 → 2 copies at 100+, consistent with flat 2).
- Experience credit: no code exists; nothing to remove.

### Paragon (family Paragon)

Rules unchanged (exactly 40, no Lost Souls, reserve ≤ 10, brigade quotas per paragon,
dominants ≤ 7, T1-style quantity rules) **plus** the new pool check from the centralized
excluded-sets list.

### Rule IDs

Existing `t1-*` rule IDs are kept for the T1 family (both Limited and Unlimited emit them);
new IDs: `pool-legality`, `t2-copy-limit`, `t2-ls-ability` replaces `t2-quantity-ls-ability`;
deleted: `t2-quantity-3plus-brigade`, `t2-quantity-2-brigade`, `t2-quantity-sa-site-city`,
`t2-quantity-2-brigade-site`, `t2-quantity-artifact-fortress`,
`t2-quantity-character-enhancement`, `t2-quantity-vanilla-site`,
`t2-quantity-same-card-combined` (the flat-2 group check subsumes it).

### Legacy client fallback

`app/decklist/card-search/utils/deckValidation.ts` (fast structural pre-check) reads sizes
and reserve caps from the registry instead of its inline `getMinimumDeckSize` /
`getMaximumDeckSize` / `getMaximumReserveSize` heuristics.

## 5. UI changes

- **Deck builder format toggle** (`DeckBuilderPanel.tsx`): three options → four
  (**L / U / T2 / P** badges, labels from the registry). Saving writes the canonical id
  to `deck.format`.
- **Search legality modes** (`FilterGrid.tsx`, `client.tsx`): rename for coherence —
  `Rotation` → **Limited**, `Classic` → **Unlimited**; `Banned` and `Scrolls` unchanged;
  `Paragon` mode now reads the shared excluded-sets list from the registry. Selecting a
  deck format auto-selects the matching pool filter (extends the existing
  Paragon-format→Paragon-filter behavior to Limited/Unlimited).
- **Format badges/labels** in my-decks, community, deck view, load-deck modal, PDF/image
  export modals: read from the registry via `normalizeFormat`, so legacy rows render
  correctly.
- **Import/export** (`deckImportExport.ts`): imported format strings pass through
  `normalizeFormat`; exports write canonical labels.
- Old decks that are now oversized (T1 > 70, T2 > 140) or violate new copy rules simply
  show validation errors in the builder — no forced migration, nothing deleted.

## 6. Tournament side

- `utils/tournament/categoryDefaults.ts`: `STANDARD_CATEGORIES` replaces `"Type 1"` with
  `"Type 1 Limited"` and `"Type 1 Unlimited"` (keeps `"Type 2"`, `"Booster Draft"`,
  `"Sealed Deck"`, `"Teams"`, `"Type A"`, `"Paragon"`). `categoryDefaults()` maps
  `unlimited` → `deck_format: 'Unlimited'`, `type 1`/default → `'Limited'`; `CategoryDefaults.deck_format`
  becomes `FormatId | 'Other'`.
- `tournaments.deck_format`: new tournaments store canonical ids; historical rows
  (`T1`/`T2`/`Paragon`/`Other`) are normalized on read. No backfill (history reflects the
  rules it was played under).
- **Decklist attachment** (`AttachDeckDialog`, `PublishDecklistsSection`): compatibility by
  normalized id, with one asymmetry — a **Limited deck is attachable to an Unlimited
  event** (its pool is a subset); the reverse is not.
- Teams keeps mapping to T1-family defaults until the elders publish its changes.

## 7. Database

One migration:

- **Backfill `decks.format`**: `'Type 1'` (and variants) → `'Limited'`, `'Type 2'` →
  `'T2'`, normalize `'Paragon Type 1'` etc. → `'Paragon'` — so community/my-decks
  filter-by-format works on one set of values. `normalizeFormat` still guards against
  stragglers at read time.

No schema changes (`format` stays text).

## 8. Sister repo (redemption-tournament-api) — separate PR

- `src/utilities/decklist.py`: T2 reserve cap 15 → 20. (Main-deck caps 154/252 are
  render-sanity limits and still exceed the new maxima; leave them.)
- Verify the T2 PDF/webp reserve section lays out 20 cards
  (`text_to_pdf.py` / `text_to_webp.py` section limits).
- API `deck_type` values stay `type_1` / `type_2` / `paragon`; the tracker maps
  Limited/Unlimited → `type_1`.

## 9. Explicitly out of scope / follow-ups

- **Ban list contents** per category — structure ships now, seeded with the current list;
  update the four arrays when published (data-only PR).
- **Teams adjustments** — pending elder details.
- **RNRS points** (`lib/rnrs/config.ts` keys `type1`/`teams`/`type2`) — display/label
  changes only when the third-party RNRS source splits T1; not blocked by this work.
- **Nationals config** (`app/config/nationals.ts`) — 2026 is over; 2027's event list will
  use the new category names when created.
- **Tracker XLS export** — verify during implementation that no format string is baked
  into the template; expected no-op.
- **SpacetimeDB** — verified no-op (see §3).

## 10. Provisional items (revisit when elders publish, by Aug 2026)

1. T2 sites+cities ≤ Lost Souls cap (kept; announcement silent).
2. T2 special-exception allowances (kept per Tim; if the published rules say flat 2 with
   no exceptions, delete the exception carve-out from the T2 copy check).
3. T2 ability-soul limit of 1 with generic souls exempt (Tim's reading of "Lost Souls
   limited to 1 copy"; literal-reading fallback is all souls max 1).
4. Ban list contents for all four categories.
