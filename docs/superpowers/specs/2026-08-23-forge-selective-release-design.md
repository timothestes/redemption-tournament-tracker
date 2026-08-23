# Forge Selective Release (per-card waves) — Design

**Date:** 2026-08-23
**Status:** Approved in chat 2026-08-23; amends `2026-08-22-forge-public-set-release-design.md`
**Scope:** Let a superadmin promote a chosen subset of a Forge set's cards — e.g. a promo set that releases one card at a time — instead of the whole set at once, while keeping the set open for future cards and waves.

---

## 1. Problem

The shipped promote flow (PR #317, migrations 090+091) releases a set all-or-nothing:

1. **No card selection.** `buildReport` (`app/forge/lib/promote.ts`) sweeps every non-archived, non-promoted card and raises a `not_approved` blocker per unapproved card. Releasing promo #1 while promo #2 is a draft is impossible, and there is no way to hold back an approved card.
2. **Promote locks the set.** `forge_promote_set` (migration 091) unconditionally sets `forge_sets.status='released'`, and `forge_create_card_in_set` / `forge_share_card_to_set` reject released sets — after releasing promo #1 the set could never take promo #2.
3. **Wave identity drift.** On a follow-up wave the set-code / official-name inputs are editable. `sameSetPrior` skips the collision checks by code alone, so typing a different official name on wave 2 would fork the set's display name in the catalog.

## 2. What already works (verified 2026-08-23)

The wave machinery from the original design's §4 is real and needs no change:

- `forge_public_releases` is deliberately non-unique on `set_code`; same-set code reuse is allowed and foreign-set reuse blocked (RPC + preflight).
- Cross-release `(set_code, name)` uniqueness and the one-release-in-flight-per-set rule are enforced in the RPC.
- `forge_abort_release` reverts the set's status only when no other release remains.
- `scripts/pull-forge-releases.js` iterates every synced release and concatenates rows; `parse-carddata.js` dedupes/absorbs per row. Multiple releases of one set already merge correctly.
- Verify-live, deck migration, image processing, and the bundle route are all per-release.
- `PromoteClient` already offers "Promote more cards (new wave)" once a release reaches `decks_migrated`.

So the delta is: selection in the TS layer, close-set semantics in the RPC, and identity locking across waves.

## 3. Design

### 3.1 Card selection (TS layer only — the RPC already validates exactly the rows it receives)

`getPromoteReport(setId, setCode, officialSet, selectedCardIds?)`:

- The report gains a **roster**: every card in the set except archived, grouped as
  - `approved` — selectable;
  - `unapproved` (draft/playtesting/private) — rendered unchecked and disabled with a "not final" label, never a blocker unless somehow selected;
  - `promoted` — prior waves, shown for context only.
- `selectedCardIds` omitted → default selection = all approved cards (full-release parity).
- Frozen rows, per-card identity checks (within-set dup name/img, public collisions, `released_name_collision`, prior-manifest imgFile collisions), and warnings run on the **selection only**. Set-identity checks (code/official/AB/in-flight) are unchanged.
- Selected ids are validated server-side: must belong to the set, be `approved` with an `approved_version_id`, not archived/promoted — anything else is a blocker (protects against a stale roster).
- Empty selection → the existing `no_cards` blocker.
- New report fields: `roster`, `selectedCount`, `totalReleasable` (count of non-archived, non-promoted cards), `closeEligible` (`selectedCount === totalReleasable`).

`promoteSet(setId, setCode, officialSet, selectedCardIds, closeSet)` re-runs `buildReport` with the same selection server-side (the stale-report protection is preserved verbatim) and passes `p_close_set` through to the RPC. `closeSet===true` with `closeEligible===false` fails before the RPC is called.

### 3.2 Set closing becomes explicit (migration 092)

Redefine `forge_promote_set` — **copy the 091 body** (redefine-from-latest rule) and:

- **Drop the old signature first** (`drop function public.forge_promote_set(uuid, text, text, jsonb)`) — `create or replace` with an added parameter would otherwise leave two overloads.
- New parameter `p_close_set boolean default true` (default preserves the shipped behavior for any caller that omits it).
- After the row loop:
  - `p_close_set = true` → require that no releasable card remains (`status not in ('archived','promoted')` for this set yields zero rows) — else `raise exception 'cannot close the set: N cards remain unreleased'`; then flip `status='released'` as today.
  - `p_close_set = false` → leave `forge_sets.status` untouched. The set keeps taking new cards and future waves indefinitely. (A set already `released` simply stays `released`; the UI treats the toggle as moot there.)
- **Official-name consistency:** before inserting, if any prior release exists with the same `set_code` but a different `btrim(official_set)`, raise. Same-code releases can never fork the catalog display name.
- Re-issue the `revoke`/`grant execute` statements for the new signature.

No table changes. `forge_abort_release` needs no change: it only reverts `status='released'` sets, and a partial release never set that.

### 3.3 Wave identity locking (UI + preflight)

When any release row exists for the set (any status), the preflight's set-code and official-name inputs are pre-filled from the most recent release and rendered read-only. Defense in depth: preflight raises a blocker if the submitted values differ from a prior release of this set — the RPC check in §3.2 is the last line.

### 3.4 UI (`PromoteClient.tsx` PreflightSection)

- Roster renders as a checkbox list in the three groups of §3.1; "Select all final cards" convenience toggle.
- Changing the selection invalidates the current report (the red button disables); "Run preflight" re-runs with the current selection.
- "Close the set after this release (no new cards)" checkbox: enabled only when `closeEligible`; checked by default when enabled, unchecked and disabled otherwise, with a hint ("N cards are not in this release — the set stays open"). Hidden when the set is already `released`.
- The type-to-confirm dialog copy states **"Releasing N of M cards"** so a partial release is never accidental, and states whether the set closes.

### 3.5 Sequential waves (unchanged, stated)

One release in flight per set stays enforced. Each wave must finish its full pipeline — images → overlay PR merged + deployed → verify-live → migrate decks — before the next wave can start. Acceptable for occasional promos; parallel per-card release machines are out of scope until that actually hurts.

## 4. Testing

- `__tests__/forge-anon-leak.test.ts`: update the `forge_promote_set` probe args to include `p_close_set` (named-arg RPC resolution). Suite is local-only (`npm run test:security`) — run it before merging; nothing in CI runs tests.
- Unit-test the pure selection logic where it is extractable (roster grouping, `closeEligible`); `buildReport` itself is supabase-coupled and is exercised manually.
- Manual flow per the `verify` skill: a two-card test set → release card 1 with the toggle off → confirm the set still accepts a new card and card 2 stays editable → release card 2 with the toggle on → confirm the set flips `released`. Abort a staged partial release → confirm set status untouched.

## 5. Out of scope

- Parallel/overlapping waves per set.
- Reopening a closed (`released`) set — superadmin SQL if ever needed.
- Per-card release state machines; any schema change.
- Relaxing the per-wave overlay-PR/deploy loop (auto-PR remains the original spec's stretch goal).
