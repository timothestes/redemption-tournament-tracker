# SpacetimeDB Energy Follow-ups

Backlog of remaining changes after PR #98 (`perf(spacetimedb): hoist CardInstance scan in move_card`). Ordered by impact-to-effort. Pick any item; they're independent unless noted.

## Background

On 2026-04-30 the `redemption-multiplayer` module consumed 1,773 TeV — ~71% of the 2,500 TeV/month free-tier allotment in a single day. The breakdown was telling:

| Metric | Volume | Energy (TeV) | % of total |
|---|---|---|---|
| **CPU Instructions** | 3.54T | **1,768.2** | **99.71%** |
| Bandwidth | 17.7 MB | 3.54 | 0.20% |
| Bytes Scanned | 56.7 MB | 1.13 | 0.06% |
| Bytes Written | 2.2 MB | 0.22 | 0.01% |
| Table Storage | 73.3 GB-s | 0.07 | <0.01% |
| Index Seeks | 6,920 | 0.003 | <0.01% |

Conclusion: **the cost is Wasm CPU instructions executed inside reducers**, not subscription fan-out, not row scans, not bandwidth. Optimization should target reducer logic that does redundant work per call — especially hot-path reducers called many times per game.

PR #98 is the validation ship: it tackles `move_card` only and is intentionally narrow. Watch the next-day TeV number against the 1,773 baseline. The rest of this doc assumes that diagnosis holds.

## SpacetimeDB billing reference

- Maincloud meters CPU instructions executed inside reducers AND inside per-commit subscription delta evaluation. Subscription compilation is one-shot per session (not per commit).
- Lifecycle hooks (`clientConnected`, `clientDisconnected`) and scheduled reducers count as reducer execution.
- There is **no per-reducer usage API**. The only authoritative view is the dashboard at `https://spacetimedb.com/@<owner>/redemption-multiplayer`. The HTTP `/v1/database/<id>/metrics` endpoint returns 404 on Maincloud.
- Source: <https://spacetimedb.com/blog/all-new-spacetimedb-pricing> and the subscriptions semantics doc.

---

## Priority 1 — Apply the same hoist to `move_cards_batch`

**File:** [spacetimedb/src/index.ts:2034](../spacetimedb/src/index.ts#L2034)

**Problem:** `move_cards_batch` materializes `[...ctx.db.CardInstance.card_instance_game_id.filter(gameId)]` ~8–15 separate times per call (lines 2079, 2148, 2202, 2232, 2344, 2362, 2375, 2443, 2449 in the pre-PR-98 numbering). For a 5-card batch move that's ~25–35 full-game scans.

**Change:** Same shape as PR #98. Materialize `gameCards` once at the top of the reducer, reuse for every read. Pass `gameCards` and the moving card ids through to `compactHandIndices` / `compactLobIndices` (helper signatures already accept the optional hint after PR #98).

**Caveats:** Some sites mutate cards mid-reducer (the soul-deck insert shift, accessory loops). For each scan, audit whether it must see the prior write — those stay live. Most don't.

**Expected impact:** Large. `move_cards_batch` is a hot reducer for batch attacks/blocks.
**Effort:** Small (~1 hour).
**Risk:** Pure refactor. No schema, no client regen.

---

## Priority 2 — Eliminate the per-drop full-game scan in `update_card_position`

**File:** [spacetimedb/src/index.ts:4018-4042](../spacetimedb/src/index.ts#L4018-L4042)

**Problem:** Every drag-end fires this reducer, which iterates every CardInstance in the game just to compute `maxIdx + 1` for `zoneIndex`. There's no `logAction` call, so the cost is invisible in `game_action` history — but call frequency is likely high (one per drop, multiplied across all active games).

**Change options (pick one):**

1. **Skip the scan when card stayed in its zone.** Only bump `zoneIndex` when the card actually changed zones. Most position updates are within-zone repositions (drag a card around territory), and the existing `zoneIndex` already puts it on top from the previous reposition.
2. **Track max `zoneIndex` per `(gameId, ownerId, zone)` on the Game row** as a JSON-encoded counter. Bump on assign, no scan needed.
3. **Add a separate `update_card_zindex` reducer** that takes an explicit `zoneIndex` from the client (which knows what's currently on top from its subscription state) and reserves the full-scan path for true zone changes.

**Recommendation:** Start with option 1 — minimal change, no schema impact. Option 2 is cleaner but more code.

**Expected impact:** Large (likely the second-biggest contributor after move-path scans).
**Effort:** Small for option 1, medium for options 2/3.
**Risk:** Low for option 1. Verify that "always re-stack on top" wasn't relied on by some interaction (e.g. clicking through a stack of overlapping cards).

---

## Priority 3 — Hoist scans in remaining hot reducers

**Files:** Multiple. Same `[...filter(gameId)]` pattern as `move_card`/`move_cards_batch`. The following reducers each scan multiple times per call:

- [`draw_card` / `draw_multiple` / `drawCardsForPlayer`](../spacetimedb/src/index.ts#L180) — called every turn
- [`shuffle_deck`, `shuffle_soul_deck`, `shuffle_card_into_deck`](../spacetimedb/src/index.ts#L3366) — called per shuffle
- [`reload_deck`](../spacetimedb/src/index.ts#L3850) — called when deck empties
- [`exchange_cards`, `exchange_from_deck`](../spacetimedb/src/index.ts#L4172) — multi-scan
- [`move_card_to_top_of_deck`, `move_card_to_bottom_of_deck`](../spacetimedb/src/index.ts#L4386)
- [`shuffle_opponent_deck`](../spacetimedb/src/index.ts#L5189)

**Change:** Same hoist pattern. The compact helpers already accept the hint.

**Expected impact:** Medium (each is less frequent than move_card individually; aggregate is meaningful).
**Effort:** Medium (one PR per reducer or one big PR — split if you want validation per reducer).
**Risk:** Pure refactor.

---

## Priority 4 — Trim `logAction` payloads

**Files:** All `logAction(...)` call sites. ~74 `JSON.stringify` calls in [index.ts](../spacetimedb/src/index.ts). Hot examples:

- `MOVE_CARD` payloads embed `cardName` AND `cardImgFile` — image filename can be re-derived client-side from the card identifier or looked up from the `CardInstance.cardImgFile` field on subscription. Same for `MOVE_CARDS_BATCH`.
- `DRAW_MULTIPLE` payload includes an entire card list with names + image files.

**Change:** Drop `cardImgFile` from move/draw payloads. Client looks it up from the existing `CardInstance` row it already has via subscription. Optional: drop `cardName` too if the client can resolve via cardInstanceId.

**Expected impact:** Medium. Each `JSON.stringify` of a 500-byte payload + the row insert is per-action cost across hundreds of moves per active game. Also reduces table storage growth (already low % but compounding).

**Effort:** Small.
**Risk:** Client `useTable(tables.GameAction)` consumers must continue to render the action log — verify the client falls back to the live CardInstance row for image. Will require a coordinated client + server change.

---

## Priority 5 — Skip full-row spread on narrow updates

**Files:** Many small reducers that toggle a single field via `{ ...card, isMeek: true }` and similar. Hot examples:

- [`meek_card` / `unmeek_card`](../spacetimedb/src/index.ts#L3895)
- [`flip_card`](../spacetimedb/src/index.ts#L3943)
- [`add_counter` / `remove_counter`](../spacetimedb/src/index.ts#L4047)
- [`set_note`](../spacetimedb/src/index.ts#L4129)

**Problem:** `CardInstance` has 32 columns. Each spread-and-update copies all 32 fields when only 1 changed — that's 32× the JS work and 32× the field assignments inside the SDK.

**Caveat (important):** The SpacetimeDB CLAUDE.md (line 411 of the SDK rules) explicitly warns:
> ❌ WRONG — partial update nulls out other fields!
> `ctx.db.task.id.update({ id: taskId, title: newTitle });`

So a "patch" object is NOT supported by the SDK — `update()` requires the full row. **This priority is blocked on either:**
1. Confirming with current SpacetimeDB docs that partial updates are still unsupported (they may have changed in 2.x).
2. Or, a different change: skip the update entirely when the field is already at the desired value (`if (card.isMeek === true) return;`). This is a smaller win but safe.

**Expected impact:** Medium (frequency × per-call savings).
**Effort:** Small per reducer; large if rolled across all sites.
**Risk:** **High if partial updates aren't supported** — verify before any change.

---

## Priority 6 — Hygiene: filter the unfiltered `useTable` subscriptions

**File:** [app/play/hooks/useGameState.ts:170-175](../app/play/hooks/useGameState.ts#L170-L175)

```ts
const [allGames] = useTable(tables.Game);            // ALL games
const [allPlayers] = useTable(tables.Player);        // ALL players
const [allCounters] = useTable(tables.CardCounter);  // ALL counters
```

**Status:** Listed for completeness, but **demoted from earlier rankings**. The CPU-only billing breakdown shows bandwidth is just 0.2% of cost, so subscription fan-out isn't the bottleneck. The cross-game subscription does add CPU to subscription delta evaluation, but with 27 games and 0 counter rows, it's currently rounding error.

**Why we'd still do it eventually:**
- Player rows update on every heartbeat / `register_presence` / `set_player_option` — at concurrency, this scales with N×N (N clients × N player updates).
- Once `CardCounter` is actually used (it has 0 rows today), unfiltered subscription becomes a real cost.
- Cross-game leak: clients receive Player rows from other people's games unnecessarily.

**Change:**
- Add `gameId` to `CardCounter` schema. Update the `add_counter` / `remove_counter` reducers and `useTable(tables.CardCounter.where(c => c.gameId.eq(gameId)))`.
- For `tables.Game` / `tables.Player`: subscribe by `code` first (already done in `client.tsx:195`), then once `gameId` is known, drop the unfiltered subscription in favor of `tables.Game.where(g => g.id.eq(gameId))` and `tables.Player.where(p => p.gameId.eq(gameId))`.

**Expected impact:** Small now, growing over time.
**Effort:** Medium (CardCounter is a schema change → republish + regen client bindings).
**Risk:** Schema migration. Existing `card_counter` rows will need a backfill or wipe (table is currently empty, so wipe-and-rebuild is safe).

---

## Things that LOOK expensive but aren't

Don't waste effort on these — the breakdown disproved each:

- **`public: true` on every table.** Affects bandwidth (0.2% of cost). Not a CPU multiplier beyond what the subscription system already accounts for.
- **Lobby query without an index on `is_public`** ([LobbyList.tsx:41](../app/play/components/LobbyList.tsx#L41)). Subscription SQL compiles once per session, and incremental delta evaluation doesn't full-scan. With the size of the Game table, this is rounding error.
- **`cleanup_stale_games`** ([spacetimedb/src/index.ts:1517](../spacetimedb/src/index.ts#L1517)). Hourly schedule, single Game scan over <100 rows. Negligible until the data grows by 10×.
- **`onConnect` / `onDisconnect` lifecycle hooks.** Tiny — single index lookups.
- **Storage growth.** 73 GB-seconds = 0.07 TeV. At current data size, storage is essentially free.

---

## Validation strategy

After each priority lands and is published:

```bash
spacetime publish redemption-multiplayer --module-path spacetimedb
```

Watch the dashboard energy meter the next day. Expected drops (rough, assumes uniform play volume):
- After P1 (`move_cards_batch` hoist): additional ~10–25% beyond PR #98.
- After P2 (`update_card_position`): could be the single biggest drop if drag spam is as common as suspected.
- After P3 (other hot reducers): incremental, smaller per-PR but cumulative.
- After P4 (log payload trim): small but measurable.

If a priority lands and TeV doesn't move, that's a signal — either the suspected hot path isn't actually hot, or the dominant cost lives in a different reducer than predicted. Re-read the dashboard's per-reducer breakdown (if it ever ships — currently on SpacetimeDB's roadmap per their pricing blog) before committing more work.

## Validation budget

Free tier resets monthly. With 726 TeV remaining as of 2026-04-30 and a daily burn rate similar to release day, you have ~0.4 days at that pace before hitting the cap. PR #98 needs to land and publish within that window. If TeV climbs faster than expected, consider:

- Temporarily disable public lobbies (force code-only joins) to cap concurrency until fixes land.
- Add a per-game-creation rate limit in the `create_game` reducer.
- Buy a top-up if you want to keep the lobby open during fixes.
