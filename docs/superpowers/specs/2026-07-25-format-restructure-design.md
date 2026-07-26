# Format Restructure: Limited / Unlimited / T2 / Paragon

**Date:** 2026-07-25
**Status:** Approved (design, rev 2); implementation pending
**Driver:** Official announcement — constructed categories restructure beginning August 2026.
**Rev 2:** incorporates two independent design reviews (codebase audit + rules-logic attack)
and Tim's ruling that Unlimited launches with an empty ban list. Key deltas from rev 1:
ban matcher retired in favor of data-driven pool legality; `'Classic'` → Unlimited;
attachment gate gets a null/'Other' escape; migration ordering made explicit; the
conversion surface is ~30 sites, not ~8; special-exception carve-out labeled as a fix.

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
| Unlimited ban list | **Empty at launch — "wild wild west."** Classic is killed as a concept; the previously-banned cards are all playable in Unlimited. Cards get added to its ban list eventually. |

## 2. Current state (what this replaces)

- Format is free text (`decks.format`), fuzzy-matched via `.includes('type 2')` /
  `.includes('paragon')` / else-T1. A repo-wide sweep found **~30 branch/compare sites across
  ~20 files** (see §5 checklist), including exact `=== "Type 1"` / `=== "Type 2"` comparisons
  in the public v1 decks API and threshingfloor export.
- The authoritative validator is `utils/deckcheck` (`validateT1Rules` / `validateT2Rules` /
  `validateParagonRules`), run on save and via `app/api/deckcheck/route.ts`.
- **No pool validation exists.** `legality` from carddata.txt col 15 (`Rotation` 3187 cards,
  empty 2495, `Banned` 9) is only a search filter (`legalityMode`:
  Rotation/Classic/Banned/Scrolls/Paragon). A "Type 1" deck full of Classic-only cards passes
  validation today.
- One hardcoded `BANNED_CARDS` array (7 entries) nominally applies to all three formats —
  but review verified **6 of its 7 matchers are dead code**: the entries key on full set names
  (`"Cloud of Witnesses"`) while `ResolvedCard.set` carries TSV codes (`CoW [Ban]`), and
  `duplicate_card_groups` has no canonical entries for those printings. Only the
  Proverbs 22:14 reference match works. All 7 entries correspond to the 9 rows carrying
  `legality: 'Banned'` in card data (the Proverbs 22:14 soul is the Main / Main Unlimited
  "Two Liner"/"Three Liner" rows, both flagged).
- Paragon's brigade quotas, no-Lost-Souls rule, and dominants ≤ 7 exist **only in the
  client-side pre-check** (`deckValidation.ts` `validateParagonDeck`); the server's
  `validateParagonRules` enforces none of them. Paragon's card pool is a hardcoded
  excluded-sets array duplicated across **three** files (`card-search/client.tsx`,
  `card-search/components/DuplicateCards.tsx`, `app/collection/client.tsx`) — search-only,
  never validated.
- "Experience credit" for T2 has never existed in this codebase — dropping it is a no-op.
- Prod data (checked during review): `decks.format` is null (1211) / 'Type 2' (250) /
  'Type 1' (205) / 'Paragon' (142) — no stragglers. `tournaments.deck_format` is null (250) /
  'T1' (12) / 'Other' (4) / 'T2' (4) / 'Type 1' (1) — two vocabularies (creation writes
  'T1'/'T2', the publish flow writes 'Type 1'/'Type 2').

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
  banList: BannedCardDef[];   // per-format; ALL FOUR START EMPTY (see below)
}

export function normalizeFormat(s: string | null | undefined): FormatId;
```

`normalizeFormat` precedence (order is load-bearing):
1. contains `paragon` → `Paragon`
2. contains `type 2` or equals `t2` → `T2`
3. contains `unlimited` **or `classic`** → `Unlimited` (Classic is the old name for this pool;
   must be tested before the default)
4. everything else (`Type 1`, `T1`, `Single`, `Limited`, null/empty) → `Limited`

The old `'multi' → T2` heuristic is **dropped** here: zero stored values need it (verified
against prod), and it would misclassify a hypothetical "Type 1 Multiplayer" string. The
matchmaking module keeps its own logic untouched (below).

The registry:

| id | family | main | reserve | pool | ban list |
|---|---|---|---|---|---|
| Limited | T1 | 50–70 | 10 | rotation | empty |
| Unlimited | T1 | 50–70 | 10 | all | empty (deliberate — wild west) |
| T2 | T2 | 100–140 | 20 | rotation | empty |
| Paragon | Paragon | 40–40 | 10 | paragon | empty |

**The hardcoded `BANNED_CARDS` array and `checkBannedCards` are retired.** Baseline card
exclusion becomes data-driven: the 9 `legality: 'Banned'` rows fail the Limited/T2 pool test
(`!== 'Rotation'`), their sets are all in Paragon's excluded list, and Unlimited allows them
by decision. The per-format `banList` arrays are the structure for the elders' future
per-category lists; when populated, entries must be keyed to **real TSV names/set codes**
with tests against actual card rows (the old list's full-set-name keys are why it was dead).

`lib/deck-format.ts` (multiplayer matchmaking tag) is **left exactly as is** — its
fallthrough already maps `Limited`/`Unlimited` → `T1` and `T2` matches `=== 't2'`, so the
client and the SpacetimeDB mirror stay in agreement with **zero module republish**
(review-verified against `spacetimedb/src/index.ts`).

`forge_decks.format` (DB default `'Type 1'`; defaults in `app/forge/lib/playDecks.ts` and
`forgeBuilderConfig.tsx`) is outside the `decks` backfill and handled by
normalize-on-read — `'Type 1'` → Limited is correct there.

## 4. Validator changes (`utils/deckcheck`)

`checkDeck()` normalizes the incoming format string to a `FormatId`, looks up the
`FormatDef`, and dispatches by `family`, passing the def so size/reserve/pool/ban-list
become parameters instead of constants.

### New shared rule: pool legality (rule id `pool-legality`)

- `pool: 'rotation'` → every card (main + reserve) must have `legality === 'Rotation'`.
- `pool: 'all'` → no pool restriction.
- `pool: 'paragon'` → card's `officialSet` must not be in `PARAGON_EXCLUDED_SETS`, which
  **moves into the registry** and is imported by all three current copies (search filters
  and validation share one list).
- The check **skips card-not-found stubs** (empty `legality` from a failed lookup) — those
  already emit the `card-not-found` warning and must not stack a false pool error.
- `ResolvedCard` gains a `legality` field (plumbed through `resolveCard`).

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
  special exceptions (Faithful Witness flat 4, Locust 5/50, Legion 4/50, Angry Mob 4/50 —
  all per-50 multipliers are exactly 1 across 50–70, review-verified).
- Pool + (empty) ban list from `def`. The **only** differences between Limited and
  Unlimited are `pool` and `banList`.

### T2 (family T2) — rewritten copy rules

- Main deck **100–140**, reserve ≤ **20**.
- Lost Soul chart unchanged: 14 @ 100–105, +1 per 7 → 19 @ 134–140.
- Good/evil balance unchanged: exactly equal in main deck and reserve, separately,
  via `getEffectiveAlignment`.
- **The 4-tier brigade quantity system (`checkT2QuantityLimits`) is deleted**, replaced by
  a flat check (rule id `t2-copy-limit`): **max 2 per same-card group**
  (`duplicate_card_groups`, as today), regardless of brigade count or card type.
  The flat-2 check **explicitly skips** three classes, each governed by its own rule
  (this prevents double-reporting and resolves the "regardless of type" wording against
  the Dominant/Lost-Soul exception):
  - **Dominants** — max 1 via existing `checkDominantUnique`;
  - **All Lost Souls** — ability souls max 1 (rule id `t2-ls-ability`, was 2, same
    reference/ability-identity grouping as T1); no-ability souls exempt (unlimited);
  - **Special exception cards** — keep `checkSpecialCards` allowances (per-50 multiplier
    is exactly 2 across 100–140: Locust 10, Legion 8, Angry Mob 8; Faithful Witness flat 4).
- ⚠️ **The exception carve-out is a deliberate behavior fix, not a carryover.** Today's
  tiers exclude `isSpecialExceptionCard` only in the 3+-brigade tier; the 2-brigade and
  single-brigade-character tiers do not — so current code actually caps Faithful Witness
  (Clay/White, dual-brigade) at 2 and Locust/Legion/Angry Mob at 4, contradicting
  `checkSpecialCards`. Do not copy the existing tier exclusions "as is."
- Carried over: dominants ≤ counting souls; reserve contents; mutual exclusions;
  sites+cities ≤ Lost Souls (**provisional**); character aliases (per-50 base 1 → 2 copies
  at 100+, consistent with flat 2).
- Experience credit: no code exists; nothing to remove.

### Paragon (family Paragon)

Rules unchanged **plus** the new pool check (server-side, from the centralized
excluded-sets list). Layering must be understood: exactly-40 and the shared quantity rules
are already server-side; **brigade quotas, the no-Lost-Souls rule, and dominants ≤ 7 are
client-only today** and remain so in this phase — porting them into `validateParagonRules`
is a named follow-up (§9), not silently in scope.

### Rule IDs

- Kept: all `t1-*` IDs (emitted by both Limited and Unlimited), `t2-deck-size`,
  `t2-lost-soul-count`, `t2-reserve-size`, `t2-good-evil-balance`, `paragon-deck-size`.
- New: `pool-legality`, `t2-copy-limit`; `t2-ls-ability` replaces `t2-quantity-ls-ability`.
- Deleted: `t1-banned-card`, `t2-quantity-3plus-brigade`, `t2-quantity-2-brigade`,
  `t2-quantity-sa-site-city`, `t2-quantity-2-brigade-site`,
  `t2-quantity-artifact-fortress`, `t2-quantity-character-enhancement`,
  `t2-quantity-vanilla-site`, `t2-quantity-same-card-combined`.
- **`DeckLegalityChecklist.tsx` hardcodes rule-id → category lists** including every
  deleted ID; it must be updated in the same change or new errors render uncategorized.

### Legacy client fallback

`app/decklist/card-search/utils/deckValidation.ts` (fast structural pre-check) reads sizes
and reserve caps from the registry instead of its inline heuristics.

## 5. Code conversion (must land BEFORE the backfill — see §7)

The sweep is larger than rev 1 stated: **~30 sites across ~20 files**. Canonical `'T2'`
does not match `.includes('type 2')`, so any missed site silently treats a `'T2'` deck as
Type 1 — the validator would apply T1 rules and the PDF exporters would render a Type 1
sheet. Implementation must run a repo-wide grep checklist and route every hit through
`normalizeFormat` / the registry:

```
includes('type 2')   includes('paragon')   === 't2'   includes('multi')
=== "Type 1"         === "Type 2"          'Rotation' 'Classic' (UI labels)
```

Known breaking sites (exact-match or includes-based, will misbehave on canonical values):

- `utils/deckcheck/index.ts` dispatch; `app/decklist/card-search/utils/deckValidation.ts`.
- `DeckBuilderPanel.tsx` — format toggle plus the T2-only replace buttons / stats branches.
- `DeckLegalityChecklist.tsx` (also rule-id lists, §4); `useDeckCheck.ts`; `LoadDeckModal.tsx`.
- `GeneratePDFModal.tsx` / `GenerateDeckImageModal.tsx` — compute the sister-API
  `deck_type`; Limited/Unlimited → `type_1`, T2 → `type_2`, Paragon → `paragon`.
- `app/threshingfloor/api/data/route.ts` — exact `=== "Type 2"` / `=== "Type 1"` export
  mapping (breaks to `""` on canonical values).
- Public v1 decks API: `lib/api/cache.ts` format filter and `app/decklist/actions.ts`
  community filter — exact `eq` on stored strings, with null-means-Type-1 special case.
  These must **accept and normalize legacy query params** (`format=Type 2` keeps working
  for external consumers) and treat null as Limited.
- `app/decklist/community/client.tsx` — hardcoded `<option>` values and `?format=` URL
  params move to canonical ids (legacy params normalized on read).
- `app/forge/lib/forgeDecks.ts`; goldfish deck conversion; my-decks / deck-view badges;
  `app/tracker/tournaments/page.tsx` (`deckFormatLabel` / `typePillClasses`).

### UI changes

- **Deck builder format toggle**: three options → four (**L / U / T2 / P** badges, labels
  from the registry). Saving writes the canonical id to `deck.format`.
- **Search pool modes**: rename **labels only** — `Rotation` → **Limited**, `Classic` →
  **Unlimited** (Classic dies as a name); `Banned` and `Scrolls` unchanged. This spans
  `FilterGrid.tsx`, `card-search/client.tsx`, `DuplicateCards.tsx`, **and
  `app/collection/client.tsx`** (which has its own copy of the mode UI and the Paragon
  excluded-sets list). The underlying card-data values `'Rotation'` / `'Banned'` and the
  forge frame/lackey `'Classic'` comparisons are **data, not labels — do not rename them**.
- Selecting a deck format auto-selects the matching pool filter (extends the existing
  Paragon behavior to Limited/Unlimited).
- Deck text import/export carries no format string (rev-1 claim corrected) — format comes
  from the builder toggle; nothing to normalize there.

### Cut-over blast radius (stated, accepted)

- Oversized decks (T1 > 70, T2 > 140) and old T2 copy counts show validation errors.
- **Pool legality is enforced for the first time ever** — this is the larger population:
  every legacy deck (1211 null-format rows default to Limited) containing any
  non-Rotation card flips invalid on next validation. Pool errors name the specific
  card and pool. (A one-click "switch this deck to Unlimited" hint was built, then
  removed per Tim's direction on 2026-07-25 — players change the format via the
  normal L/U/T2/P toggle instead.)
- Stored `is_legal` / `deckcheck_issues` (written on save, shown as community badges and
  PDF seals, snapshotted into tournament decklists) go stale at cutover and contain
  soon-deleted rule IDs. **Run `scripts/backfill-deck-legality.ts --all` after deploy** to
  recompute.
- Review-verified there are no hard gates elsewhere: PDF/image export degrades to a
  missing/illegal seal, multiplayer and goldfish never block on validity, attachment
  carries `is_legal` as a snapshot.

## 6. Tournament side

- `utils/tournament/categoryDefaults.ts`: `STANDARD_CATEGORIES` replaces `"Type 1"` with
  `"Type 1 Limited"` and `"Type 1 Unlimited"` (keeps `"Type 2"`, `"Booster Draft"`,
  `"Sealed Deck"`, `"Teams"`, `"Type A"`, `"Paragon"`). Mapping order is load-bearing:
  `paragon` → `teams` (stays ahead of the T2 test, as today) → `type 2` → `unlimited` →
  default Limited. `CategoryDefaults.deck_format` becomes `FormatId | 'Other'`.
- **Tournament format is `FormatId | 'Other' | null`** — `'Other'` is preserved, not fed
  through `normalizeFormat` (which never returns it); a tournament-side helper owns that
  mapping. Historical rows hold two vocabularies (`'T1'` from creation, `'Type 1'` from
  the publish flow — `PublishDecklistsSection.tsx` → `tracker/tournaments/actions.ts`);
  both normalize on read. No backfill (history reflects the rules it was played under).
- **Decklist attachment** (`AttachDeckDialog`, `PublishDecklistsSection`): today there is
  **no** format gate — adding one is new behavior, so it must not regress existing events.
  Gate **only when the tournament resolves to a recognized `FormatId`**; null and
  `'Other'` (the vast majority of real tournaments: 250 null + 4 'Other' in prod) allow
  any deck, as today. When gated: compatibility by normalized id, with one asymmetry — a
  **Limited deck is attachable to an Unlimited event** (its pool is a subset). This
  asymmetry is sound only while Unlimited's ban list is a subset of Limited's (trivially
  true now — both empty); if Unlimited ever bans a rotation-legal card, revalidate the
  deck under the event's `FormatDef` at attach.
- Teams keeps mapping to T1-family defaults until the elders publish its changes.

## 7. Database — strictly ordered

1. **First**: all code conversion from §5 deploys (every consumer normalizes).
2. **Then**: one backfill migration on `decks.format`:
   - `'Type 1'` → `'Limited'`; `'Type 2'` → `'T2'`; `'Classic'` → `'Unlimited'`;
     values containing `paragon` → `'Paragon'`.
   - **NULL rows stay NULL** (1211 of 1808 — they may predate format selection entirely);
     read-time `normalizeFormat` buckets them as Limited. UI filters must therefore
     compare `normalizeFormat(row.format)`, not raw stored values, or half the catalog
     vanishes from the Limited bucket.
3. **Then**: `scripts/backfill-deck-legality.ts --all` to refresh stored verdicts (§5).

No schema changes (`format` stays text).

## 8. Sister repo (redemption-tournament-api) — separate PR

- `src/utilities/decklist.py`: T2 reserve cap 15 → 20. (Main-deck caps 154/252 are
  render-sanity limits and still exceed the new maxima; leave them.)
- Verify the T2 PDF/webp reserve section lays out 20 cards
  (`text_to_pdf.py` / `text_to_webp.py` section limits).
- API `deck_type` values stay `type_1` / `type_2` / `paragon`; the tracker maps
  Limited/Unlimited → `type_1`.
- This repo's `/api/deckcheck` route currently maps only `decklist_type === "type_2"`.
  It gains the new explicit values (`limited` / `unlimited` / `t2` / `paragon`); legacy
  `type_1` maps to **Limited** (strict — a false pool error is visible and fixable,
  a silent pass is not), `type_2` → T2.

## 9. Explicitly out of scope / follow-ups

- **Ban list contents** per category — all four ship empty (Unlimited deliberately so);
  populate via data-only PR when the elders publish, keyed to real TSV names/set codes
  with tests against actual card rows.
- **Port Paragon's client-only rules server-side** (brigade quotas, no-LS, dominants ≤ 7)
  so `/api/deckcheck` and stored `is_legal` cover them.
- **Teams adjustments** — pending elder details.
- **August rotation data**: the Limited pool is only as correct as `carddata.txt` — run
  `make update-cards` when the rotation list changes.
- **RNRS points** (`lib/rnrs/config.ts` keys `type1`/`teams`/`type2`) — label changes only
  when the third-party RNRS source splits T1; not blocked by this work.
- **Nationals config** (`app/config/nationals.ts`) — 2026 is over; 2027's event list will
  use the new category names when created.
- **Tracker XLS export** — review-verified it keys off the soul cap, not format; no-op.
- **SpacetimeDB** — verified no-op (see §3).

## 10. Provisional items (revisit when elders publish, by Aug 2026)

1. T2 sites+cities ≤ Lost Souls cap (kept; announcement silent).
2. T2 special-exception allowances (kept per Tim; if the published rules say flat 2 with
   no exceptions, delete the carve-out from `t2-copy-limit`).
3. T2 ability-soul limit of 1 with generic souls exempt (Tim's reading of "Lost Souls
   limited to 1 copy"; literal-reading fallback is all souls max 1).
4. T2 flat-2 grouping granularity: current same-card grouping splits ungrouped same-name
   cards by brigade, so 2× Panic Demon (Black) + 2× Panic Demon (Brown) = 4 copies would
   be legal. If the elders mean brigade printings share one pool of 2, tighten the
   grouping for `t2-copy-limit`.
5. Ban list contents for all four categories (Unlimited stays empty until announced).
